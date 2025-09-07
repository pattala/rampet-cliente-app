// pwa/modules/firebase.js
// Compat: usa window.firebase ya cargado por los <script> de Firebase

const firebase = window.firebase;

let app, db, auth, messaging;
let isMessagingSupported = false;

// --- Init Firebase (app/db/auth) ---
export function setupFirebase() {
  const firebaseConfig = {
    apiKey: "AIzaSyAvBw_Cc-t8lfip_FtQ1w_w3DrPDYpxINs",
    authDomain: "sistema-fidelizacion.firebaseapp.com",
    projectId: "sistema-fidelizacion",
    storageBucket: "sistema-fidelizacion.appspot.com",
    messagingSenderId: "357176214962",
    appId: "1:357176214962:web:6c1df9b74ff0f3779490ab"
  };

  // Evita doble init
  if (firebase.apps && firebase.apps.length) {
    app = firebase.app();
  } else {
    app = firebase.initializeApp(firebaseConfig);
  }

  // Analytics puede fallar con bloqueadores: ignoramos error
  try { if (typeof firebase.analytics === "function") firebase.analytics(app); } catch {}

  db = firebase.firestore();
  auth = firebase.auth();
}

/**
 * Comprueba soporte de Messaging y devuelve boolean.
 * NO engancha onMessage ni toca la UI (lo maneja notifications.js)
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
  } catch (e) {
    console.warn("checkMessagingSupport error:", e?.message || e);
    isMessagingSupported = false;
  }
  return isMessagingSupported;
}

export { app, db, auth, messaging, firebase, isMessagingSupported };
