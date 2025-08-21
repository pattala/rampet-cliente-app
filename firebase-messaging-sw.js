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

/**
 * Normaliza el payload para data-only.
 * Soporta claves legacy: titulo/cuerpo/click_action.
 */
function normalizeData(raw = {}) {
  const d = raw.data || {};
  // compat legacy
  const title = d.title || d.titulo || 'RAMPET';
  const body  = d.body  || d.cuerpo || '';
  const icon  = d.icon  || 'https://rampet.vercel.app/images/mi_logo.png';
  const url   = d.url   || d.click_action || '/';
  const tag   = d.tag   || '';

  return {
    title: String(title),
    body:  String(body),
    icon:  String(icon),
    url:   String(url),
    tag:   String(tag),
  };
}

// Solo background (cuando la PWA no está en foco)
messaging.onBackgroundMessage((payload) => {
  // console.log('[SW] Background message:', payload);
  const d = normalizeData(payload);

  const options = {
    body: d.body,
    icon: d.icon,
    badge: d.icon,
    tag: d.tag || undefined, // ayuda a colapsar duplicados si coincidiera
    data: { url: d.url }     // guardamos el deep link para el click
  };
  return self.registration.showNotification(d.title, options);
});

// Deep link al hacer click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || '/';
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const url = new URL(targetUrl, self.location.origin).href;
    // Reutiliza ventana si ya está abierta
    const client = allClients.find(c => c.url === url);
    if (client) return client.focus();
    return clients.openWindow(url);
  })());
});
