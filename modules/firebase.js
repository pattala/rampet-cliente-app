// modules/firebase.js (PWA) - VERSIÓN CORREGIDA
// Inicializa y exporta las instancias de Firebase v8.

// LÍNEA AÑADIDA: Capturamos el objeto global 'firebase' en una constante local.
const firebase = window.firebase;

let db, auth, messaging;
let isMessagingSupported = false;

export function setupFirebase() {
    const firebaseConfig = {
        apiKey: "AIzaSyAvBw_Cc-t8lfip_FtQ1w_w3DrPDYpxINs",
        authDomain: "sistema-fidelizacion.firebaseapp.com",
        projectId: "sistema-fidelizacion",
        storageBucket: "sistema-fidelizacion.appspot.com",
        messagingSenderId: "357176214962",
        appId: "1:357176214962:web:6c1df9b74ff0f3779490ab"
    };

    firebase.initializeApp(firebaseConfig);
    
    db = firebase.firestore();
    auth = firebase.auth();
    
    if (firebase.messaging.isSupported()) {
        messaging = firebase.messaging();
        isMessagingSupported = true;
    }
}

// LÍNEA CORREGIDA: Exportamos las variables correctamente.
export { db, auth, messaging, firebase, isMessagingSupported };
