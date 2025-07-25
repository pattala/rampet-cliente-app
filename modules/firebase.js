// pwa/modules/firebase.js (VERSIÓN DEFINITIVA)
// Descripción: Corrige el error de sintaxis "Duplicate export".

const firebase = window.firebase;

// Declaramos las variables en el alcance del módulo, sin exportarlas aquí.
let db, auth, messaging, app;
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

    app = firebase.initializeApp(firebaseConfig);
    firebase.analytics(app);
    
    db = firebase.firestore();
    auth = firebase.auth();
}

export function checkMessagingSupport() {
    return new Promise((resolve) => {
        if (firebase.messaging.isSupported()) {
            messaging = firebase.messaging();
            isMessagingSupported = true;
            resolve(true);
        } else {
            isMessagingSupported = false;
            resolve(false);
        }
    });
}

// CORRECCIÓN: Un único punto de exportación para todas las variables del módulo.
export { db, auth, messaging, app, firebase, isMessagingSupported };
