// firebase-messaging-sw.js (Versión que lee desde "data" y arregla el logo)

importScripts('https://www.gstatic.com/firebasejs/9.6.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.6.0/firebase-messaging-compat.js');

const firebaseConfig = {
    apiKey: "AIzaSyAvBw_Cc-tJgqS2sW_FtQ1w_w3DrPDYpxINs",
    authDomain: "sistema-fidelizacion.firebaseapp.com",
    projectId: "sistema-fidelizacion",
    storageBucket: "sistema-fidelizacion.appspot.com",
    messagingSenderId: "357176214962",
    appId: "1:357176214962:web:6c1df9b74ff0f3779490ab"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
  console.log('[SW] Mensaje recibido en segundo plano:', payload);

  // --- INICIO DE LA CORRECCIÓN CLAVE ---
  // Leemos el título y el cuerpo desde el objeto "data"
  const notificationTitle = payload.data.title;
  const notificationBody = payload.data.body;
  // Usamos la URL pública y directa de la imagen
  const notificationIcon = 'https://i.postimg.cc/tJgqS2sW/mi_logo.png';
  // --- FIN DE LA CORRECCIÓN CLAVE ---

  const notificationOptions = {
    body: notificationBody,
    icon: notificationIcon,
    badge: notificationIcon // El badge es para Android
  };

  return self.registration.showNotification(notificationTitle, notificationOptions);
});
