/* public/firebase-messaging-sw.js — COMPAT (sin exports) */
'use strict';

importScripts('https://www.gstatic.com/firebasejs/9.6.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.6.0/firebase-messaging-compat.js');

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const firebaseConfig = {
  apiKey: "AIzaSyAvBw_Cc-t8lfip_FtQ1w_w3DrPDYpxINs",
  authDomain: "sistema-fidelizacion.firebaseapp.com",
  projectId: "sistema-fidelizacion",
  storageBucket: "sistema-fidelizacion.appspot.com",
  messagingSenderId: "357176214962",
  appId: "1:357176214962:web:6c1df9b74ff0f3779490ab"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// Normaliza payload data-only y conserva el id
function normalizeData(raw = {}) {
  const d = raw.data || {};
  return {
    id:   d.id ? String(d.id) : undefined,
    title:String(d.title || d.titulo || 'RAMPET'),
    body: String(d.body  || d.cuerpo || ''),
    icon: String(d.icon  || 'https://rampet.vercel.app/images/mi_logo_192.png'),
    url:  String(d.url   || d.click_action || '/notificaciones'),
    tag:  (d.tag && String(d.tag)) || (d.id ? `push-${String(d.id)}` : undefined)
  };
}

messaging.onBackgroundMessage((payload) => {
  const d = normalizeData(payload);

  // Avisamos a todas las pestañas
  self.clients.matchAll({ includeUncontrolled: true, type: "window" })
    .then(list => list.forEach(c => c.postMessage({ type: "PUSH_DELIVERED", data: d })));

  return self.registration.showNotification(d.title, {
    body: d.body,
    icon: d.icon,
    tag: d.tag,
    renotify: !!d.tag,
    data: { id: d.id, url: d.url }
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const d = event.notification?.data || {};
  const targetUrl = d.url || "/notificaciones";

  event.waitUntil((async () => {
    const clientsList = await clients.matchAll({ type: 'window', includeUncontrolled: true });

    // avisamos “read” a todas las pestañas abiertas
    clientsList.forEach(c => c.postMessage({ type: "PUSH_READ", data: { id: d.id } }));

    const absolute = new URL(targetUrl, self.location.origin).href;
    const existing = clientsList.find(c => c.url === absolute);
    if (existing) return existing.focus();
    return clients.openWindow(absolute);
  })());
});


// Llega en background → notificación + postMessage a pestañas
messaging.onBackgroundMessage((payload) => {
  const d = normalizeData(payload);

  // avisamos a todas las pestañas que llegó el push
  self.clients.matchAll({ includeUncontrolled: true, type: "window" })
    .then(list => list.forEach(c => c.postMessage({ type: "PUSH_DELIVERED", data: d })));

  // Sólo activar renotify si tenemos un tag no vacío
  const opts = {
    body: d.body,
    icon: d.icon,
    tag: d.tag,
    data: { id: d.id, url: d.url }
  };
  if (d.badge) opts.badge = d.badge;
  // renotify genera excepción si no hay tag → lo activamos condicionalmente
  if (d.tag) opts.renotify = true;

  return self.registration.showNotification(d.title, opts);
});

// Click → enfocamos/abrimos la PWA y avisamos “read”
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const d = (event.notification && event.notification.data) || {};
  const targetUrl = d.url || "/notificaciones";

  event.waitUntil((async () => {
    const clientsList = await clients.matchAll({ type: 'window', includeUncontrolled: true });

    // avisamos a las pestañas que el usuario "leyó"
    clientsList.forEach(c => c.postMessage({ type: "PUSH_READ", data: { id: d.id } }));

    const absolute = new URL(targetUrl, self.location.origin).href;
    // si ya hay una pestaña con esa URL exacta, enfocarla
    const existing = clientsList.find(c => c.url === absolute);
    if (existing) return existing.focus();
    // si no, abrir una nueva
    return clients.openWindow(absolute);
  })());
});

