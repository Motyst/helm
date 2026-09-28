// Loaded into the service worker (workbox importScripts). Shows timer alerts sent by the Helm
// server over Web Push, and opens Helm when one is tapped.

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    (async () => {
      // An open, focused Helm rings the timer itself (sound and banner); don't double up.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (data.tag === 'helm-timer' && windows.some((w) => w.focused && w.visibilityState === 'visible')) return;
      await self.registration.showNotification(data.title || 'Helm', {
        body: data.body || '',
        tag: data.tag || 'helm',
        renotify: true,
        requireInteraction: data.tag === 'helm-timer',
        vibrate: [300, 150, 300, 150, 600],
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: { url: data.url || '/' },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) return open.focus();
      return self.clients.openWindow(url);
    })(),
  );
});
