// firebase-messaging-sw.js (VERSIÓN DEFINITIVA Y CORRECTA)

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
// Esta es la forma más robusta de manejar notificaciones.
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Mensaje de datos recibido en segundo plano:', payload);
  
  // Extraemos los datos enviados desde el servidor
  const notificationTitle = payload.data.title;
  const notificationOptions = {
    body: payload.data.body,
    icon: payload.data.icon // Usamos el ícono que nos manda el servidor
  };

  // El Service Worker AHORA SÍ es responsable de mostrar la notificación
  // usando los datos que recibió.
  self.registration.showNotification(notificationTitle, notificationOptions);
});
