// pwa/modules/firebase.js (VERSIÓN FINAL)
// Descripción: Inicializa la app y exporta las instancias y una función
// para comprobar la compatibilidad de Messaging cuando la app esté lista.

const firebase = window.firebase;

// Exportamos las instancias para ser asignadas después.
export let db, auth, messaging, app;
export let isMessagingSupported = false; // El valor por defecto es false

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

// Nueva función que se llamará cuando la app esté lista
export function checkMessagingSupport() {
    // Esta promesa se resuelve después de que isSupported() ha hecho su trabajo
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
