/* v3 – evita doble notificación y usa ícono nuevo */
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

// Solo mostrar nosotros si es DATA-ONLY.
// Si viene `notification` (Chrome ya muestra), NO duplicar.
messaging.onBackgroundMessage((payload) => {
  // Si el payload trae 'notification', dejamos que el navegador lo muestre.
  if (payload && payload.notification) {
    // nada: evita doble toast
    return;
  }
  const data = payload && payload.data ? payload.data : null;
  if (!data) return;

  const title = data.title || "RAMPET";
  const body  = data.body  || "";
  const icon  = 'https://raw.githubusercontent.com/pattala/rampet-cliente-app/main/images/mi_logo.png';

  return self.registration.showNotification(title, {
    body,
    icon
    // sin badge
  });
});
