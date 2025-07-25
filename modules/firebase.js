// pwa/modules/firebase.js (VERSIÓN FINAL Y ROBUSTA)
// Descripción: Corrige el manejo asíncrono y añade tolerancia a fallos
// en la inicialización de Analytics.

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
    
    // Inicializamos Analytics de forma segura para evitar bloqueos
    try {
        firebase.analytics(app);
    } catch (error) {
        console.warn("Firebase Analytics no se pudo inicializar. Esto puede ser debido a un bloqueador de anuncios y no afecta la funcionalidad principal.");
    }
    
    db = firebase.firestore();
    auth = firebase.auth();
}

/**
 * Comprueba la compatibilidad de Messaging de forma asíncrona y segura.
 */
export async function checkMessagingSupport() {
    try {
        // Usamos la promesa directamente para mayor compatibilidad
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
