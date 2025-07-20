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

messaging.onBackgroundMessage(function(payload) {
  console.log('[SW] Mensaje de datos recibido:', payload);

  // ===== CAMBIO CLAVE: Leemos desde "payload.data" y definimos el ícono =====
  const notificationTitle = payload.data.title;
  const notificationBody = payload.data.body;
  const notificationIcon = 'https://raw.githubusercontent.com/pattala/rampet-cliente-app/main/images/mi_logo.png'; // URL pública y directa

   

  // =======================================================================

  const notificationOptions = {
    body: notificationBody,
    icon: notificationIcon,
    badge: notificationIcon // El badge es para Android
  };

  return self.registration.showNotification(notificationTitle, notificationOptions);
});
