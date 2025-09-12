/* public/firebase-messaging-sw.js — COMPAT + SPA Fallback */
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

/* ──────────────────────────────────────────────────────────────
   SPA FALLBACK: cualquier navegación interna → index.html
   (evita 404 de Vercel en /mis-puntos y asegura que cargue app.js)
   ────────────────────────────────────────────────────────────── */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Sólo interceptar navegaciones (click en links / location.assign)
  if (req.mode !== 'navigate') return;

  // Origen distinto → no tocamos
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Requests de archivos estáticos (js, css, imgs, etc.) → dejarlos pasar
  if (/\.(?:js|mjs|css|map|png|jpg|jpeg|gif|svg|ico|webp|json|txt|pdf|woff2?)$/i.test(url.pathname)) {
    return;
  }

  // Fallback a / (index.html) para todas las rutas internas "de app"
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      // Si el host nos devuelve 404 (p.e. Vercel), forzar index.html
      if (res && res.status === 404) {
        return fetch('/');
      }
      return res;
    } catch (_e) {
      // Sin conexión u otro error → intentar index.html
      return fetch('/');
    }
  })());
});

/* ──────────────────────────────────────────────────────────────
   Normalización payload data-only
   ────────────────────────────────────────────────────────────── */
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

/* ──────────────────────────────────────────────────────────────
   Background: mostrar notificación y avisar a pestañas
   ────────────────────────────────────────────────────────────── */
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
  // renotify en false para que no "vibre" si llega otra con mismo tag
  opts.renotify = false;

  try {
    await self.registration.showNotification(d.title, opts);
  } catch (e) {
    console.warn('[SW] showNotification error:', e?.message || e);
  }
});

/* ──────────────────────────────────────────────────────────────
   Click: enfocar/abrir y avisar “read”
   ────────────────────────────────────────────────────────────── */
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
