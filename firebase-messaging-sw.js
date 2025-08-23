// firebase-messaging-sw.js  (compat, NO ESM)
importScripts('https://www.gstatic.com/firebasejs/9.6.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.6.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAvBw_Cc-t8lfip_FtQ1w_w3DrPDYpxINs",
  authDomain: "sistema-fidelizacion.firebaseapp.com",
  projectId: "sistema-fidelizacion",
  storageBucket: "sistema-fidelizacion.appspot.com",
  messagingSenderId: "357176214962",
  appId: "1:357176214962:web:6c1df9b74ff0f3779490ab"
});
const messaging = firebase.messaging();

/** Normaliza payload data-only */
function normalizeData(raw = {}) {
  const d = raw.data || {};
  return {
    id:   String(d.id || ''),              // notifId que manda el server
    title:String(d.title || d.titulo || 'RAMPET'),
    body: String(d.body  || d.cuerpo || ''),
    icon: String(d.icon  || 'https://rampet.vercel.app/images/mi_logo.png'),
    url:  String(d.url   || d.click_action || '/notificaciones'),
    tag:  d.tag ? String(d.tag) : undefined
  };
}

// ——— BACKGROUND (app NO enfocada) ———
messaging.onBackgroundMessage(async (payload) => {
  const d = normalizeData(payload);

  // Avisar a pestañas → “delivered”
  const clientsList = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
  clientsList.forEach(c => {
    c.postMessage({ type: "PUSH_DELIVERED", data: d });
  });

  // Mostrar notificación del sistema
  return self.registration.showNotification(d.title, {
    body: d.body,
    icon: d.icon,
    tag: d.tag,
    renotify: true,
    data: { url: d.url, id: d.id }
  });
});

// ——— CLICK = read + abrir/enfocar ———
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification?.data?.url) || "/notificaciones";
  const notifId = (event.notification?.data?.id) || "";

  event.waitUntil((async () => {
    // Informar a una pestaña abierta que el usuario “leyó” la notificación
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    all.forEach(c => c.postMessage({ type: "PUSH_READ", notifId, url: targetUrl }));

    // Enfocar si ya existe, sino abrir
    const absolute = new URL(targetUrl, self.location.origin).href;
    const existing = all.find(c => c.url === absolute);
    if (existing) return existing.focus();
    return clients.openWindow(absolute);
  })());
});
