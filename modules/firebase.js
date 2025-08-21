// pwa/modules/firebase.js (VERSIÓN COMPLETA: compat + foreground/banner + contador)
const firebase = window.firebase;

let db, auth, messaging, app;
let isMessagingSupported = false;

// ====== Badge / contador (persistido en localStorage) ======
function getUnread() { return Number(localStorage.getItem("notifUnread") || 0); }
function setUnread(n) {
  localStorage.setItem("notifUnread", String(n));
  const badge = document.querySelector("#notif-counter");
  if (badge) {
    badge.textContent = n > 99 ? "99+" : String(n);
    badge.style.display = n > 0 ? "inline-block" : "none";
  }
}
function incUnread() { setUnread(getUnread() + 1); }
export function resetUnread() { setUnread(0); }
document.addEventListener("DOMContentLoaded", () => setUnread(getUnread()));

// ====== Banner in-app (simple). Si tenés toasts propios, usalos acá ======
function showInAppToast(title, body, url) {
  let box = document.getElementById("push-toast");
  if (!box) {
    box = document.createElement("div");
    box.id = "push-toast";
    box.style.cssText = `
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
      background: #222; color: #fff; padding: 12px 14px; border-radius: 10px;
      box-shadow: 0 6px 20px rgba(0,0,0,.35); max-width: 360px;
      font: 14px/1.4 system-ui, -apple-system, Segoe UI, Roboto; cursor: pointer;
    `;
    document.body.appendChild(box);
  }
  box.innerHTML = `<strong>${title || "RAMPET"}</strong><br>${body || ""}`;
  box.onclick = () => { if (url) location.href = url; box.remove(); resetUnread(); };
  box.style.display = "block";
  setTimeout(() => { box.style.display = "none"; }, 6000);
}

// ====== Foreground handlers ======
function initForegroundMessaging() {
  if (!messaging) return;

  // Foreground (no muestra Notification del navegador)
  messaging.onMessage((payload) => {
    const d = payload && payload.data ? payload.data : {};
    const title = d.title || "RAMPET";
    const body  = d.body  || "";
    const url   = d.url   || "/notificaciones";
    showInAppToast(title, body, url);
    incUnread();
  });

  // Mensajes desde el SW cuando llega una push en background
  if (navigator.serviceWorker && navigator.serviceWorker.addEventListener) {
    navigator.serviceWorker.addEventListener("message", (evt) => {
      if (evt.data && evt.data.type === "PUSH_DELIVERED") {
        incUnread();
      }
    });
  }
}

// ====== Init Firebase ======
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
  
  try {
    firebase.analytics(app);
  } catch (error) {
    console.warn("Firebase Analytics no se pudo inicializar (posible bloqueador).");
  }
  
  db = firebase.firestore();
  auth = firebase.auth();
}

/**
 * Comprueba la compatibilidad de Messaging y configura foreground handlers.
 */
export async function checkMessagingSupport() {
  try {
    const supported = await firebase.messaging.isSupported();
    if (supported) {
      messaging = firebase.messaging();
      isMessagingSupported = true;
      initForegroundMessaging(); // 🔔 engancha onMessage + contador
    } else {
      isMessagingSupported = false;
    }
  } catch (error) {
    console.error("Error al comprobar la compatibilidad de Firebase Messaging:", error);
    isMessagingSupported = false;
  }
  return isMessagingSupported;
}

// Exports públicos
export { db, auth, messaging, app, firebase, isMessagingSupported };
