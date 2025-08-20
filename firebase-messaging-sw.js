/* v2 - RAMPET SW: evita doble push y fija icono/badge */
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

// Ajustá si tenés otros assets
const ICON_URL  = 'https://rampet.vercel.app/images/mi_logo_192.png';
const BADGE_URL = 'https://rampet.vercel.app/images/mi_badge_72.png'; // si no existe, se reutiliza icono

// Muestra sólo si es DATA-ONLY. Si viene "notification", lo muestra FCM.
messaging.onBackgroundMessage((payload) => {
  if (payload && payload.notification) {
    // Ya la muestra FCM. No dupliques.
    return;
  }

  const title = (payload?.data?.title) || 'RAMPET';
  const body  = (payload?.data?.body)  || '';
  const link  = (payload?.data?.link)  || 'https://rampet.vercel.app/';

  const options = {
    body,
    icon: ICON_URL,
    badge: BADGE_URL || ICON_URL,
    data: { link }
  };

  self.registration.showNotification(title, options);
});

// Al hacer click, abrir/enfocar la PWA
self.addEventListener('notificationclick', (event) => {
  const url = event.notification?.data?.link || 'https://rampet.vercel.app/';
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
      for (const w of ws) { if ('focus' in w) return w.focus(); }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
