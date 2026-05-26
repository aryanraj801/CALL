/**
 * useNotifications — Full Web Push notification system for NexaLink
 *
 * How it works:
 * 1. Registers the Service Worker (public/sw.js) on mount
 * 2. Subscribes to the Push API using the VAPID public key from the server
 * 3. Sends the PushSubscription to the signalling server so it can push
 *    notifications even when the browser tab is closed
 * 4. Provides a fallback `notify()` method for when the tab IS open
 *
 * Two notification types (matching user's spec):
 *   'update'  → chat messages:  "NexaLink received an update"
 *   'session' → calls/rooms:    "NexaLink requesting an active session"
 */

import { useCallback, useEffect, useRef } from 'react';

type NotifType = 'update' | 'session';

interface NexaNotifOptions {
  sender: string;
  body?: string;
  tag?: string;
  room?: string;
  onClick?: () => void;
}

// The signalling server URL — matches the WS URL used by useWebRTC
const WS_URL = (import.meta as any).env?.VITE_WS_URL || 'http://localhost:8000';

/** Convert a VAPID public key (base64url) to Uint8Array for the Push API */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function useNotifications() {
  const swRegRef = useRef<ServiceWorkerRegistration | null>(null);
  const subscribedRef = useRef(false);

  /* ── 1. Register Service Worker ──────────────────────────────────────────── */
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        swRegRef.current = reg;
        console.log('[Notifications] Service Worker registered ✔', reg.scope);
      })
      .catch((err) => {
        console.warn('[Notifications] SW registration failed:', err);
      });

    // Listen for postMessage from the SW (notification click navigation)
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'PUSH_NAVIGATE') {
        const { targetUrl, room } = event.data;
        // If a room is specified, navigate with a query param so App.tsx can auto-join
        if (room) {
          const url = new URL(window.location.href);
          url.searchParams.set('room', room);
          url.searchParams.set('auto', '1');
          window.history.pushState({}, '', url.toString());
          // Dispatch a custom event that App.tsx listens to
          window.dispatchEvent(new CustomEvent('nexalink:navigate', { detail: { room, targetUrl } }));
        } else if (targetUrl) {
          window.location.href = targetUrl;
        }
      }
    });
  }, []);

  /* ── 2. Request permission + subscribe to Web Push ───────────────────────── */
  const requestPermission = useCallback(async (username?: string) => {
    if (!('Notification' in window)) return;
    if (subscribedRef.current) return;

    // Ask for permission
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') return;

    // Need a service worker + Push support
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    try {
      const reg = swRegRef.current ?? await navigator.serviceWorker.ready;
      swRegRef.current = reg;

      // Fetch the server's VAPID public key
      const keyRes = await fetch(`${WS_URL}/vapid-public-key`);
      const { publicKey } = await keyRes.json();

      // Subscribe to push (or re-use existing subscription)
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
        });
      }

      // Send subscription to signalling server
      if (username) {
        await fetch(`${WS_URL}/api/push/subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, subscription: sub }),
        });
        subscribedRef.current = true;

        // Send username to the Service Worker so it can re-register on pushsubscriptionchange
        if (reg.active) {
          reg.active.postMessage({ type: 'SET_USERNAME', username });
        } else if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({ type: 'SET_USERNAME', username });
        }

        console.log('[Notifications] Web Push subscription saved for', username);
      }
    } catch (err) {
      console.warn('[Notifications] Push subscription failed:', err);
    }
  }, []);

  /** Unsubscribe on logout */
  const unsubscribe = useCallback(async (username: string) => {
    subscribedRef.current = false;
    try {
      const reg = swRegRef.current ?? await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch(`${WS_URL}/api/push/subscribe`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, subscription: sub }),
        });
        await sub.unsubscribe();
      } else {
        await fetch(`${WS_URL}/api/push/subscribe`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username }),
        });
      }
    } catch { /* silent */ }
  }, []);

  /* ── 3. In-tab fallback (fires when the browser IS open but tab is hidden) ─ */
  const notify = useCallback((type: NotifType, opts: NexaNotifOptions) => {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    // Only show in-tab notification when not focused (server push handles the rest)
    if (document.visibilityState === 'visible' && document.hasFocus()) return;

    const isCall = type === 'session';
    const title = isCall ? `📞 ${opts.sender} is calling` : `💬 Message from ${opts.sender}`;
    const body  = opts.body ?? (isCall ? 'NexaLink requesting an active session' : 'NexaLink received an update');
    const tag   = opts.tag ?? `nexalink-${type}`;

    // Use SW showNotification if available (so actions work), otherwise fallback
    if (swRegRef.current) {
      swRegRef.current.showNotification(title, {
        body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag,
        data: { room: opts.room ?? '', type, sender: opts.sender },
        vibrate: isCall ? [200, 100, 200, 100, 200] : [100, 50, 100],
        requireInteraction: isCall,
      } as NotificationOptions);
    } else {
      const n = new Notification(title, { body, icon: '/icon-192.png', tag, silent: false });
      n.onclick = () => { window.focus(); opts.onClick?.(); n.close(); };
      setTimeout(() => n.close(), 6000);
    }
  }, []);

  return { requestPermission, unsubscribe, notify };
}
