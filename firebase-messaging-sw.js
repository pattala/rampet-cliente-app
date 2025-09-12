/* public/firebase-messaging-sw.js — COMPAT + deep-link seguro */
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

/** Rutas permitidas (si no matchea → fallback a /?inbox=1) */
const ALLOWED_PATHS = new Set([
  '/', '/notificaciones', '/beneficios', '/premios', '/historial', '/puntos'
]);

// Normaliza payload "data-only"
function normPayload(payload = {}) {
  const d = payload?.data || {};
  const rawUrl = d.url || d.click_action || '/?inbox=1';
  const id  = d.id ? String(d.id) : undefined;
  const tag = (d.tag && String(d.tag)) || (id ? `push-${id}` : 'rampet');
  return {
    id,
    title: d.title || d.titulo || 'RAMPET',
    body:  d.body  || d.cuerpo || '',
    icon:  d.icon  || 'https://rampet.vercel.app/images/mi_logo_192.png',
    badge: d.badge || undefined,
    url:   rawUrl,
    tag
  };
}

// Background: notificación + avisar a las pestañas
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
  // renotify sólo si realmente querés “vibrar” al repetir tag. Lo dejamos en false.
  opts.renotify = false;

  try {
    await self.registration.showNotification(d.title, opts);
  } catch (e) {
    console.warn('[SW] showNotification error:', e?.message || e);
  }
});

// Click → enfocamos/abrimos y avisamos “read”; si la URL no es válida, fallback a /?inbox=1
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification?.data || {};
  const raw = data.url || '/?inbox=1';

  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    // avisar a todas las pestañas que se “leyó”
    clientsList.forEach(c => c.postMessage({ type: 'PUSH_READ', data: { id: data.id } }));

    // normalizar destino
    const u = new URL(raw, self.location.origin);
    const safePath = ALLOWED_PATHS.has(u.pathname) ? (u.pathname + u.search) : '/?inbox=1';
    const absolute = new URL(safePath, self.location.origin).href;

    // enfocar si ya existe, o abrir
    const existing = clientsList.find(c => c.url === absolute);
    if (existing) return existing.focus();
    return self.clients.openWindow(absolute);
  })());
});
