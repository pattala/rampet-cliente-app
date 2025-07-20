// firebase-messaging-sw.js (VERSIÓN RESTAURADA Y OPTIMIZADA)

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
  console.log('[SW] Mensaje recibido en segundo plano:', payload);

  // Verificamos que el payload contenga la estructura esperada
  if (payload.notification) {
    const notificationTitle = payload.notification.title;
    const notificationOptions = {
      body: payload.notification.body,
      // Usamos una URL pública y completa para el ícono para máxima compatibilidad
      icon: 'https://i.postimg.cc/tJgqS2sW/mi-logo.png',
      badge: 'https://i.postimg.cc/tJgqS2sW/mi-logo.png' // El badge es para Android
    };

    // El Service Worker muestra la notificación
    return self.registration.showNotification(notificationTitle, notificationOptions);
  }
});
