/**
 * NexaLink Service Worker — Web Push & Background Notifications
 *
 * Receives push events from the signalling server and shows OS-level
 * notifications even when the browser tab is closed.
 *
 * On click, opens or focuses the NexaLink tab and deep-links into
 * the correct room/session via a URL query param (?room=<name>).
 */

/* ── USERNAME PERSISTENCE (for pushsubscriptionchange) ─────────────────── */
// The main app sends the username to the SW via postMessage after subscribing.
// We persist it in the Cache API (survives SW restarts, unlike global vars).

const META_CACHE = 'nexalink-meta';

async function storeUsername(username) {
  const cache = await caches.open(META_CACHE);
  await cache.put('/meta/username', new Response(username));
}

async function getStoredUsername() {
  try {
    const cache = await caches.open(META_CACHE);
    const resp = await cache.match('/meta/username');
    return resp ? await resp.text() : null;
  } catch {
    return null;
  }
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SET_USERNAME' && event.data.username) {
    storeUsername(event.data.username);
    console.log('[NexaLink SW] Username stored for push renewal:', event.data.username);
  }
});

/* ── PUSH EVENT ──────────────────────────────────────────────────────────── */
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { type: 'update', sender: 'NexaLink', body: event.data.text(), room: '' };
  }

  const { type = 'update', sender = 'NexaLink', body, room = '', callType = 'video' } = payload;

  const isCall    = type === 'session';
  const isFile    = type === 'file_transfer';
  const isContact = type === 'contact';
  const isChat    = type === 'chat';

  let title = `💬 Message from ${sender}`;
  if (isCall) {
    title = `📞 ${sender} is calling`;
  } else if (isFile) {
    title = `📁 Secure File from ${sender}`;
  } else if (isContact) {
    title = `👤 ${sender} added you`;
  } else if (isChat) {
    title = `💬 ${sender}`;
  }

  let notifBody = body;
  if (!notifBody) {
    if (isCall) {
      notifBody = 'NexaLink requesting an active session';
    } else if (isFile) {
      const sizeMB = payload.fileSize ? (payload.fileSize / (1024 * 1024)).toFixed(2) : '0.00';
      notifBody = `${payload.fileName || 'file'} (${sizeMB} MB)`;
    } else if (isContact) {
      notifBody = `${sender} added you as a contact`;
    } else {
      notifBody = 'NexaLink received an update';
    }
  }

  const tag = isCall     ? 'nexalink-session'
            : isFile     ? `nexalink-file-${payload.transferId}`
            : isContact  ? `nexalink-contact-${sender}`
            : `nexalink-chat-${sender}`;

  const options = {
    body: notifBody,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag,
    data: { room, type, sender, callType, transferId: payload.transferId, fileName: payload.fileName, fileSize: payload.fileSize },
    actions: isCall
      ? [
          { action: 'accept', title: '✅ Accept' },
          { action: 'decline', title: '❌ Decline' },
        ]
      : (isFile
        ? [
            { action: 'accept_file', title: '📥 Accept' },
            { action: 'decline_file', title: '❌ Decline' },
          ]
        : [
            { action: 'open', title: '💬 Open NexaLink' },
          ]),
    vibrate: isCall ? [200, 100, 200, 100, 200] : (isFile ? [150, 100, 150] : [100, 50, 100]),
    requireInteraction: isCall || isFile,
    silent: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/* ── NOTIFICATION CLICK ──────────────────────────────────────────────────── */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const { room, type, transferId } = event.notification.data || {};
  const notifAction = event.action; // 'accept' | 'decline' | 'open' | 'accept_file' | 'decline_file' | ''

  // Build the target URL
  const base = self.location.origin; // e.g. https://nexalink.app
  let targetUrl = base;

  if (notifAction === 'decline' || notifAction === 'decline_file') {
    // Just close — no navigation
    return;
  }

  if (room) {
    targetUrl = `${base}?room=${encodeURIComponent(room)}&auto=1`;
    if (type === 'session') {
      targetUrl += '&accept=1';
    }
  } else if (type === 'file_transfer' && transferId) {
    targetUrl = `${base}?transferId=${transferId}&auto=1`;
  }

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // If a NexaLink tab is already open, focus it and navigate
        for (const client of clientList) {
          if (client.url.startsWith(base) && 'focus' in client) {
            client.focus();
            client.postMessage({ type: 'PUSH_NAVIGATE', targetUrl, room, notifType: type });
            return;
          }
        }
        // No open tab — open a new one
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});

/* ── PUSH SUBSCRIPTION CHANGE ───────────────────────────────────────────── */
// Handles automatic subscription renewal (browser rotates push endpoint)
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const newSub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: event.oldSubscription?.options?.applicationServerKey,
        });

        // Retrieve stored username so the server knows who this subscription belongs to
        const username = await getStoredUsername();
        if (!username) {
          console.warn('[NexaLink SW] No stored username for subscription renewal — skipping');
          return;
        }

        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, subscription: newSub }),
        });
        console.log('[NexaLink SW] Push subscription renewed for:', username);
      } catch (err) {
        console.error('[NexaLink SW] pushsubscriptionchange failed:', err);
      }
    })()
  );
});

/* ── ACTIVATE (take immediate control) ───────────────────────────────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

console.log('[NexaLink SW] Service worker loaded — Web Push ready');
