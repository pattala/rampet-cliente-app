/* v3 – evita doble notificación */
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

// Si viene "notification", deja que el navegador la muestre. No dupliques.
messaging.onBackgroundMessage((payload) => {
  if (payload && payload.notification) return;

  const data = payload?.data;
  if (!data) return;

  const title = data.title || "RAMPET";
  const body  = data.body  || "";
  const icon  = 'https://raw.githubusercontent.com/pattala/rampet-cliente-app/main/images/mi_logo.png';
  return self.registration.showNotification(title, { body, icon });
});
