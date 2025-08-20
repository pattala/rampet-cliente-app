/* firebase-messaging-sw.js */
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

/**
 * Solo mostramos nosotros cuando el mensaje ES "data-only".
 * Si viene payload.notification, dejamos que el navegador muestre
 * la notificación automática de FCM (evitamos duplicados).
 */
messaging.onBackgroundMessage((payload) => {
  // Si FCM ya trae notification, no hacemos nada.
  if (payload?.notification && (payload.notification.title || payload.notification.body)) {
    return;
  }

  // Data-only
  const d = payload?.data || {};
  const title = d.title || "RAMPET";
  const body  = d.body  || "";
  const icon  = 'https://raw.githubusercontent.com/pattala/rampet-cliente-app/main/images/mi_logo.png';

  self.registration.showNotification(title, {
    body,
    icon,              // badge lo quitamos si no lo usás
    requireInteraction: false
  });
});
