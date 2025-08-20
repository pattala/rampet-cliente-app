// firebase-messaging-sw.js — RAMPET (reemplazo completo)

// Mantengo tu versión para no cambiar librerías
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

// Tomar control inmediatamente
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", () => self.clients.claim());

/**
 * IMPORTANTE:
 * - Si el server envía webpush.notification, el navegador MUESTRA la notificación solo.
 * - Para evitar duplicados, acá solo mostramos si NO existe payload.notification.
 */
messaging.onBackgroundMessage((payload) => {
  // Si llega con notification, dejamos que el browser la muestre (evita doble push).
  if (payload && payload.notification) return;

  const d = payload?.data || {};
  const title = d.title || "RAMPET";
  const body  = d.body  || "";
  // Usá los valores que lleguen en data; si no, ícono local de la PWA
  const icon  = d.icon  || "/images/mi_logo_192.png";
  const badge = d.badge || icon;
  const link  = d.link  || d.click_action || "/";

  self.registration.showNotification(title, {
    body,
    icon,
    badge,
    data: { link }
  });
});

// Click en la notificación → abrir PWA / link
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification?.data?.link || "/";
  event.waitUntil(clients.openWindow(url));
});
