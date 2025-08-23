// firebase-messaging-sw.js
// SW de FCM (compat clásico, NO ESM)
importScripts('https://www.gstatic.com/firebasejs/9.6.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.6.0/firebase-messaging-compat.js');

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

/** Normaliza payload data-only (soporta legacy) */
function normalizeData(raw = {}) {
  const d = raw.data || {};
  return {
    title: String(d.title || d.titulo || 'RAMPET'),
    body:  String(d.body  || d.cuerpo || ''),
    icon:  String(d.icon  || 'https://rampet.vercel.app/images/mi_logo.png'),
    url:   String(d.url   || d.click_action || '/notificaciones'),
    tag:   d.tag ? String(d.tag) : undefined
  };
}

// Solo background (app NO enfocada)
messaging.onBackgroundMessage((payload) => {
  const d = normalizeData(payload);

  // Avisar a la(s) pestaña(s) abierta(s) para subir contador / tracking
  self.clients.matchAll({ includeUncontrolled: true, type: "window" })
    .then(list => list.forEach(c => c.postMessage({ type: "PUSH_DELIVERED", data: d })));

  return self.registration.showNotification(d.title, {
    body: d.body,
    icon: d.icon,
    tag: d.tag,        // si repetís tag, colapsa/renotify
    renotify: true,
    data: { url: d.url }
  });
});

// Click → abrir o enfocar la PWA en la URL indicada
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification && event.notification.data && event.notification.data.url) || "/notificaciones";

  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const absolute = new URL(targetUrl, self.location.origin).href;

    // Si ya hay una ventana en esa URL, enfocar; si no, abrir nueva
    const existing = all.find(c => c.url === absolute);
    if (existing) return existing.focus();
    return clients.openWindow(absolute);
  })());
});
