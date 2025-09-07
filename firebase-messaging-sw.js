// pwa/modules/firebase.js
// Inicializa Firebase (compat) y expone auth, db, messaging, etc.
// OJO: acá NO hay toasts, NO hay onMessage, NO hay contador.

const firebase = window.firebase;

let app, db, auth, messaging;
let isMessagingSupported = false;

export function setupFirebase() {
  const firebaseConfig = {
    apiKey: "AIzaSyAvBw_Cc-t8lfip_FtQ1w_w3DrPDYpxINs",
    authDomain: "sistema-fidelizacion.firebaseapp.com",
    projectId: "sistema-fidelizacion",
    storageBucket: "sistema-fidelizacion.appspot.com",
    messagingSenderId: "357176214962",
    appId: "1:357176214962:web:6c1df9b74ff0f3779490ab",
  };

  // Evita re-init
  if (!firebase.apps || !firebase.apps.length) {
    app = firebase.initializeApp(firebaseConfig);
    try { firebase.analytics?.(app); } catch { /* opcional */ }
  } else {
    app = firebase.app();
  }

  db = firebase.firestore();
  auth = firebase.auth();
}

export async function checkMessagingSupport() {
  try {
    const supported = await firebase.messaging.isSupported();
    if (supported) {
      messaging = firebase.messaging();
      isMessagingSupported = true;
    } else {
      isMessagingSupported = false;
    }
  } catch (err) {
    console.warn("Messaging no soportado o bloqueado:", err?.message || err);
    isMessagingSupported = false;
  }
  return isMessagingSupported;
}

export { firebase, app, db, auth, messaging, isMessagingSupported };
