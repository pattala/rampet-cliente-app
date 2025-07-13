// firebase-messaging-sw.js (VERSIÓN FINAL Y ROBUSTA)

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
  console.log('[SW] Mensaje de datos recibido en segundo plano:', payload);

  // --- INICIO DE LA CORRECCIÓN CLAVE ---
  // Extraemos los datos enviados desde el servidor. El payload contiene un objeto "data".
  const notificationTitle = payload.data.title;
  const notificationBody = payload.data.body;
  const notificationIcon = 'https://i.postimg.cc/tJgqS2sW/mi-logo.png'; // URL completa y pública de tu logo

  const notificationOptions = {
    body: notificationBody,
    icon: notificationIcon,
    badge: notificationIcon // Opcional: para notificaciones en Android
  };
  // --- FIN DE LA CORRECCIÓN CLAVE ---

  // El Service Worker es el único responsable de mostrar la notificación.
  // Esto devuelve una promesa, lo que le indica al navegador que no cierre el SW hasta que termine.
  return self.registration.showNotification(notificationTitle, notificationOptions);
});
