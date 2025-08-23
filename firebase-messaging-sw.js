// firebase-messaging-sw.js  (compat, con tracking y ID limpio)
// ------------------------------------------------------------
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

/** Normaliza payload data-only y **conserva el id** */
function normalizeData(raw = {}) {
  const d = raw.data || {};
  return {
    id:   d.id ? String(d.id) : undefined,           // ⬅️ clave para marcar delivered/read
    title:String(d.title || d.titulo || 'RAMPET'),
    body: String(d.body  || d.cuerpo || ''),
    icon: String(d.icon  || 'https://rampet.vercel.app/images/mi_logo.png'),
    url:  String(d.url   || d.click_action || '/notificaciones'),
    tag:  d.tag ? String(d.tag) : undefined
  };
}

// Cuando llega en **background**
messaging.onBackgroundMessage((payload) => {
  const d = normalizeData(payload);

  // Avisar a las pestañas abiertas para marcar "delivered" y subir la campanita
  self.clients.matchAll({ includeUncontrolled: true, type: "window" })
    .then(list => list.forEach(c => c.postMessage({ type: "PUSH_DELIVERED", data: d })));

  return self.registration.showNotification(d.title, {
    body: d.body,
    icon: d.icon,
    tag: d.tag,           // si repetís tag, colapsa y renotify
    renotify: true,
    data: { id: d.id, url: d.url }  // ⬅️ guardamos id/url en la notificación
  });
});

// Click en la notificación → enfoca/abre la PWA y marca "read"
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const d = (event.notification && event.notification.data) || {};
  const targetUrl = d.url || "/notificaciones";

  event.waitUntil((async () => {
    // Informar a las ventanas que se leyó
    const clientsList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    clientsList.forEach(c => c.postMessage({ type: "PUSH_READ", data: { id: d.id } }));

    const absolute = new URL(targetUrl, self.location.origin).href;
    const existing = clientsList.find(c => c.url === absolute);
    if (existing) return existing.focus();
    return clients.openWindow(absolute);
  })());
});
