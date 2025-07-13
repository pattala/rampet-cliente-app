// firebase-messaging-sw.js (VERSIÓN FINAL Y DEFINITIVA)

// 1. Importar los scripts de Firebase
importScripts('https://www.gstatic.com/firebasejs/9.6.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.6.0/firebase-messaging-compat.js');

// 2. Añadir tu configuración de Firebase
const firebaseConfig = {
    apiKey: "AIzaSyAvBw_Cc-t8lfip_FtQ1w_w3DrPDYpxINs",
    authDomain: "sistema-fidelizacion.firebaseapp.com",
    projectId: "sistema-fidelizacion",
    storageBucket: "sistema-fidelizacion.appspot.com",
    messagingSenderId: "357176214962",
    appId: "1:357176214962:web:6c1df9b74ff0f3779490ab"
};

// 3. Inicializar Firebase
firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// 4. Configurar el manejador de mensajes en segundo plano
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Mensaje de datos recibido:', payload);

  // Extraemos los datos enviados desde el servidor. Es la única fuente de verdad.
  const notificationTitle = payload.data.title;
  const notificationBody = payload.data.body;
  const notificationIcon = payload.data.icon; // Usamos el ícono que nos manda el servidor

  const notificationOptions = {
    body: notificationBody,
    icon: notificationIcon,
    badge: notificationIcon // El badge es para Android
  };

  // El Service Worker muestra la notificación con los datos recibidos.
  return self.registration.showNotification(notificationTitle, notificationOptions);
});
