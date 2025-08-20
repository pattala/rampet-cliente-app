/* RAMPET – FCM Service Worker (modo compat/híbrido) */

importScripts('https://www.gstatic.com/firebasejs/10.12.3/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.3/firebase-messaging-compat.js');

const SW_VERSION = 'rampet-sw-2025-08-20-h1';

// ⚠️ Con compat alcanza con el senderId para FCM:
firebase.initializeApp({
  messagingSenderId: '357176214962'
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());

const messaging = firebase.messaging();

// Normalizamos título/cuerpo y mostramos UNA sola notificación en background
messaging.onBackgroundMessage((payload) => {
  const n = payload?.notification || {};
  const d = payload?.data || {};

  const title = n.title || d.title || 'RAMPET';
  const body  = n.body  || d.body  || '';
  const icon  = d.icon || n.icon || '/images/icon-192.png';
  const badge = d.badge; // opcional
  const tag   = d.tag;   // opcional

  const data = {
    url: d.click_action || d.url || '/', // adónde abrir al click
    payload
  };

  self.registration.showNotification(title, {
    body,
    icon,
    badge,
    tag,
    data
  });
});

// Foco/abrir la PWA al click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        // Si ya hay una pestaña abierta, enfócala
        if ('focus' in client && client.url.includes(self.location.origin)) {
          return client.focus();
        }
      }
      // Si no, abrimos una nueva
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
