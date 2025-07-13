// firebase-messaging-sw.js (VERSIÓN CORREGIDA Y DEFINITIVA)

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

// 4. Configurar el manejador de mensajes en segundo plano (LA PARTE CLAVE)
// Este bloque es necesario para que las notificaciones se reciban cuando la app está cerrada.
// Sin embargo, lo dejamos SIN la línea `self.registration.showNotification`.
// De esta forma, el navegador mostrará la notificación que ya viene del servidor.
messaging.onBackgroundMessage((payload) => {
  console.log(
    '[firebase-messaging-sw.js] Mensaje recibido en segundo plano. El navegador lo mostrará automáticamente.',
    payload
  );
  
  // ¡NO HAY NADA MÁS QUE HACER AQUÍ!
});
