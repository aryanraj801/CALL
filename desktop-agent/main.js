const { app, BrowserWindow, globalShortcut, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { io } = require('socket.io-client');

let mainWindow = null;
let tray = null;
let wsClient = null;
let isTunnelActive = false;
let isNotificationsEnabled = true;
let isQuitting = false;

const iconPath = path.join(__dirname, 'icon.png');

function getTrayIcon() {
  if (fs.existsSync(iconPath)) {
    try {
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty()) {
        return img.resize({ width: 16, height: 16 });
      }
    } catch (err) {
      console.error('[Desktop Agent] Failed to parse icon.png for tray:', err);
    }
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
      <rect width="16" height="16" rx="4" fill="#111827"/>
      <path d="M4 12V4h2l3 4V4h2v8H9L6 8v4z" fill="#818cf8"/>
    </svg>
  `;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

function getWindowIcon() {
  if (fs.existsSync(iconPath)) {
    try {
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty()) {
        return img.resize({ width: 256, height: 256 });
      }
    } catch (err) {
      console.error('[Desktop Agent] Failed to parse icon.png for window:', err);
    }
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="14" fill="#111827"/>
      <path d="M18 46V18h8l12 16V18h8v28h-8L26 30v16z" fill="#818cf8"/>
    </svg>
  `;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: true, // Show window directly on startup for premium desktop experience
    title: 'NexaLink',
    icon: getWindowIcon(),
    backgroundColor: '#060813',
    webPreferences: {
      // SEC-07 FIX: NEVER enable nodeIntegration in a renderer that loads
      // any remote or user-generated content. This is the #1 Electron CVE.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webviewTag: false,
    },
  });

  // Try to load the live React client on port 3000, fallback to status diagnostics on fail
  mainWindow.loadURL('http://localhost:3000').catch((err) => {
    console.log('[Desktop Agent] NexaLink Web Client not running on port 3000. Loading fallback diagnostics dashboard.');
    mainWindow.setBounds({ width: 480, height: 380 });
    const dashboardPath = path.join(__dirname, 'dashboard.html');
    mainWindow.loadFile(dashboardPath).catch((e) => {
      console.error('[Desktop Agent] Failed to load offline dashboard:', e.message);
    });
  });

  mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
    console.warn(`[Desktop Agent] Load failed (${code}): ${description}`);
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('page-title-updated', (event, title) => {
    // Keep tray tooltip in sync with page title (showing current logged in user)
    if (tray) {
      const safeTitle = typeof title === 'string' ? title.slice(0, 120) : 'NexaLink';
      tray.setToolTip(safeTitle);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Setup background system trays and context menus
function setupTray() {
  tray = new Tray(getTrayIcon());
  updateTrayMenu();
  tray.setToolTip('NexaLink');
}

function updateTrayMenu() {
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open NexaLink',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
        }
      }
    },
    {
      label: isNotificationsEnabled ? 'Disable Notifications' : 'Enable Notifications',
      click: () => {
        isNotificationsEnabled = !isNotificationsEnabled;
        console.log(`[Desktop Agent] System Notifications ${isNotificationsEnabled ? 'ENABLED' : 'DISABLED'}`);
        updateTrayMenu();
      }
    },
    { type: 'separator' },
    { label: 'Toggle Input Tunnel', click: () => toggleTunnel() },
    { label: 'Force Kill Session (Ctrl+Shift+K)', click: () => triggerEmergencyKill() },
    { type: 'separator' },
    {
      label: 'Quit NexaLink',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    },
  ]);
  tray.setContextMenu(contextMenu);
}

function toggleTunnel() {
  isTunnelActive = !isTunnelActive;
  console.log(`[Desktop Agent] Input Tunnel State: ${isTunnelActive ? 'ACTIVE' : 'IDLE'}`);
}

// Global OS keypress hook revoking all sessions instantly (Chaperone protection)
function registerGlobalHotkeys() {
  const killShortcut = globalShortcut.register('CommandOrControl+Shift+K', () => {
    console.log('[EMERGENCY] Global OS Hotkey hit: Revoking all remote permissions.');
    triggerEmergencyKill();
  });

  if (!killShortcut) {
    console.warn('[Warning] Failed to register global kill-switch shortcut on this OS environment');
  }
}

function triggerEmergencyKill() {
  isTunnelActive = false;
  
  if (wsClient && wsClient.connected) {
    wsClient.emit('control_revoke');
  }

  // Update visual HTML state if window is active
  if (mainWindow) {
    mainWindow.webContents.executeJavaScript(`
      document.getElementById('status').innerText = 'EMERGENCY SHUTDOWN';
      document.getElementById('status').className = 'status active';
      const div = document.createElement('div');
      div.innerText = '[EMERGENCY] Local kill-switch executed. Connection closed.';
      div.style.color = '#f87171';
      document.getElementById('tunnel-log').appendChild(div);
    `);
  }
}

app.whenReady().then(() => {
  createWindow();

  // Try loading tray icon if exists, fallback gracefully
  try {
    setupTray();
  } catch (err) {
    console.error('[System Tray] Tray initialization failed:', err.message || err);
  }

  registerGlobalHotkeys();

  // BUG FIX: Initialize the WebSocket client connection to the signalling server
  // so the emergency kill-switch can propagate the event over the relay channel.
  // Re-connect automatically if the signalling server is temporarily unreachable.
  function connectWebSocket() {
    // Connect to Socket.IO signalling server on port 8000
    wsClient = io('http://localhost:8000', {
      transports: ['websocket'],
      auth: {
        agent: 'desktop-agent',
      },
      reconnection: true,
      reconnectionDelay: 5000,
    });

    wsClient.on('connect', () => {
      console.log('[Desktop Agent] WebSocket relay connected to signalling server.');
    });

    wsClient.on('connect_error', (err) => {
      console.warn('[Desktop Agent] WebSocket relay error (will retry):', err.message);
    });

    wsClient.on('disconnect', () => {
      console.log('[Desktop Agent] WebSocket relay closed. Reconnecting...');
    });
  }
  connectWebSocket();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
