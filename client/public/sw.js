/**
 * NexaLink Service Worker — Web Push & Background Notifications
 *
 * Receives push events from the signalling server and shows OS-level
 * notifications even when the browser tab is closed.
 *
 * On click, opens or focuses the NexaLink tab and deep-links into
 * the correct room/session via a URL query param (?room=<name>).
 */

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

  const isCall = type === 'session';

  const title = isCall
    ? `📞 ${sender} is calling`
    : `💬 Message from ${sender}`;

  const notifBody = body || (isCall
    ? 'NexaLink requesting an active session'
    : 'NexaLink received an update');

  const tag = isCall ? 'nexalink-session' : `nexalink-chat-${sender}`;

  const options = {
    body: notifBody,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag,
    data: { room, type, sender, callType },
    actions: isCall
      ? [
          { action: 'accept', title: '✅ Accept' },
          { action: 'decline', title: '❌ Decline' },
        ]
      : [
          { action: 'open', title: '💬 Open Chat' },
        ],
    vibrate: isCall ? [200, 100, 200, 100, 200] : [100, 50, 100],
    requireInteraction: isCall,   // call notifications stay until clicked
    silent: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/* ── NOTIFICATION CLICK ──────────────────────────────────────────────────── */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const { room, type, action } = event.notification.data || {};
  const notifAction = event.action; // 'accept' | 'decline' | 'open' | ''

  // Build the target URL
  const base = self.location.origin; // e.g. https://nexalink.app
  let targetUrl = base;

  if (notifAction === 'decline') {
    // Just close — no navigation
    return;
  }

  if (room) {
    targetUrl = `${base}?room=${encodeURIComponent(room)}&auto=1`;
    if (type === 'session') {
      targetUrl += '&accept=1';
    }
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
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: event.oldSubscription?.options?.applicationServerKey })
      .then((newSub) => {
        // Send new subscription to the server
        return fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: newSub }),
        });
      })
  );
});

/* ── ACTIVATE (take immediate control) ───────────────────────────────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

console.log('[NexaLink SW] Service worker loaded — Web Push ready');
