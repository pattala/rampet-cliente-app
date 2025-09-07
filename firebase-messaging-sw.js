// firebase-messaging-sw.js  (compat)
importScripts('https://www.gstatic.com/firebasejs/9.6.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.6.0/firebase-messaging-compat.js');

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate',  (e) => e.waitUntil(self.clients.claim()));

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

function normalizeData(raw = {}) {
  const d = raw.data || {};
  return {
    id:   d.id ? String(d.id) : undefined,
    title:String(d.title || d.titulo || 'RAMPET'),
    body: String(d.body  || d.cuerpo || ''),
    icon: String(d.icon  || 'https://rampet.vercel.app/images/mi_logo.png'),
    url:  String(d.url   || d.click_action || '/notificaciones'),
    tag:  d.tag ? String(d.tag) : undefined
  };
}

messaging.onBackgroundMessage((payload) => {
  const d = normalizeData(payload);

  self.clients.matchAll({ includeUncontrolled: true, type: "window" })
    .then(list => list.forEach(c => c.postMessage({ type: "PUSH_DELIVERED", data: d })));

  return self.registration.showNotification(d.title, {
    body: d.body,
    icon: d.icon,
    tag: d.tag,
    renotify: true,
    data: { id: d.id, url: d.url }
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const d = (event.notification && event.notification.data) || {};
  const targetUrl = d.url || "/notificaciones";

  event.waitUntil((async () => {
    const clientsList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    clientsList.forEach(c => c.postMessage({ type: "PUSH_READ", data: { id: d.id } }));

    const absolute = new URL(targetUrl, self.location.origin).href;
    const existing = clientsList.find(c => c.url === absolute);
    if (existing) return existing.focus();
    return clients.openWindow(absolute);
  })());
});
