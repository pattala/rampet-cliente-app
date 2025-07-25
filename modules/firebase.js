// pwa/modules/firebase.js (VERSIÓN FINAL CORREGIDA)
// Descripción: Corrige el error de exportación que impedía a otros módulos
// importar el objeto principal 'firebase'.

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

// CORRECCIÓN: Se vuelve a exportar el objeto 'firebase'
export { db, auth, messaging, app, firebase, isMessagingSupported };
