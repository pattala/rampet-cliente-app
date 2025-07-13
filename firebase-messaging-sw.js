// Scripts for firebase and firebase messaging
importScripts('https://www.gstatic.com/firebasejs/9.6.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.6.0/firebase-messaging-compat.js');

// La configuración de Firebase debe ser la misma que en tu app principal
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

messaging.onBackgroundMessage((payload) => {
  console.log(
    '[firebase-messaging-sw.js] Received background message ',
    payload
  );
  
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/images/mi_logo.png' // Asegúrate de que esta ruta a tu logo sea correcta
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});