// Archivo a modificar: pwa/modules/firebase.js (VERSIÓN FINAL)

// Capturamos el objeto global 'firebase' que cargan los scripts del HTML.
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

    // 1. Inicializamos la aplicación. Este paso es obligatorio.
    const app = firebase.initializeApp(firebaseConfig);

    // 2. Inicializamos Analytics (buena práctica).
    firebase.analytics(app);
    
    // 3. Obtenemos las instancias de los servicios que usaremos.
    db = firebase.firestore();
    auth = firebase.auth();
    
    // 4. Verificamos si Messaging es compatible DESPUÉS de la inicialización.
    if (firebase.messaging.isSupported()) {
        messaging = firebase.messaging();
        isMessagingSupported = true;
    } else {
        isMessagingSupported = false;
    }
}

// 5. Exportamos todo para que el resto de la app pueda usarlo.
export { db, auth, messaging, firebase, isMessagingSupported };
