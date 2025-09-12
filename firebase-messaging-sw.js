/* public/firebase-messaging-sw.js — COMPAT */
'use strict';

importScripts('https://www.gstatic.com/firebasejs/9.6.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.6.0/firebase-messaging-compat.js');

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

firebase.initializeApp({
  apiKey: "AIzaSyAvBw_Cc-t8lfip_FtQ1w_w3DrPDYpxINs",
  authDomain: "sistema-fidelizacion.firebaseapp.com",
  projectId: "sistema-fidelizacion",
  storageBucket: "sistema-fidelizacion.appspot.com",
  messagingSenderId: "357176214962",
  appId: "1:357176214962:web:6c1df9b74ff0f3779490ab"
});

const messaging = firebase.messaging();

// Normaliza payload "data-only"
function normPayload(payload = {}) {
  const d = payload?.data || {};
  const url = d.url || d.click_action || '/notificaciones';
  const id  = d.id ? String(d.id) : undefined;
  const tag = (d.tag && String(d.tag)) || (id ? `push-${id}` : 'rampet');
  return {
    id,
    title: d.title || d.titulo || 'RAMPET',
    body:  d.body  || d.cuerpo || '',
    icon:  d.icon  || 'https://rampet.vercel.app/images/mi_logo_192.png',
    badge: d.badge || undefined,
    url,
    tag
  };
}

// Background: mostrar SIEMPRE la notificación y avisar a pestañas
messaging.onBackgroundMessage(async (payload) => {
  const d = normPayload(payload);

  try {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    list.forEach(c => c.postMessage({ type: 'PUSH_DELIVERED', data: d }));
  } catch {}

  const opts = {
    body: d.body,
    icon: d.icon,
    tag: d.tag,
    data: { id: d.id, url: d.url, via: 'sw' }
  };
  if (d.badge) opts.badge = d.badge;
  if (d.tag)   opts.renotify = false; // no “vibra” si llega otra con el mismo tag

  try {
    await self.registration.showNotification(d.title, opts);
  } catch (e) {
    // Evita rechazos no capturados en algunos navegadores
    console.warn('[SW] showNotification error:', e?.message || e);
  }
});

// Click → enfocamos/abrimos y avisamos “read”
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification?.data || {};
  const targetUrl = data.url || '/notificaciones';

  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    // avisar a todas las pestañas que se “leyó”
    clientsList.forEach(c => c.postMessage({ type: 'PUSH_READ', data: { id: data.id } }));

    // enfocar si ya existe, o abrir
    const absolute = new URL(targetUrl, self.location.origin).href;
    const existing = clientsList.find(c => c.url === absolute);
    if (existing) return existing.focus();
    return self.clients.openWindow(absolute);
  })());
});
