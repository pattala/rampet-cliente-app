// pwa/modules/firebase.js (VERSIÓN DEFINITIVA CORREGIDA)
// Descripción: Corrige el manejo asíncrono de checkMessagingSupport,
// que era la causa del bloqueo en la pantalla de "Cargando...".

const firebase = window.firebase;

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

/**
 * CORRECCIÓN CLAVE: Esta función ahora es asíncrona y maneja
 * correctamente la promesa devuelta por isSupported().
 */
export async function checkMessagingSupport() {
    try {
        const supported = await firebase.messaging.isSupported();
        if (supported) {
            messaging = firebase.messaging();
            isMessagingSupported = true;
        } else {
            isMessagingSupported = false;
        }
    } catch (error) {
        console.error("Error al comprobar la compatibilidad de Firebase Messaging:", error);
        isMessagingSupported = false;
    }
    return isMessagingSupported;
}

// Un único punto de exportación para todas las variables del módulo.
export { db, auth, messaging, app, firebase, isMessagingSupported };
