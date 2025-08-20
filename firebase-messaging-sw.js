/* firebase-messaging-sw.js
   Service Worker para FCM en modo "data-only".
   - Muestra la notificación SOLO desde payload.data (evita duplicados)
   - Fallback mínimo a payload.notification (solo por compatibilidad transitoria)
   - Maneja correctamente el click (focus/abrir y navegar)
*/

import { initializeApp } from "firebase/app";
import { getMessaging, onBackgroundMessage } from "firebase/messaging/sw";

// ⚠️ Cambiá este número cuando quieras forzar que los clientes se actualicen
const SW_VERSION = "rampet-sw-2025-08-20-02";

/* === 1) TU CONFIG DE FIREBASE (pegada desde tu mensaje) === */
const firebaseConfig = {
  apiKey: "AIzaSyAvBw_Cc-t8lfip_FtQ1w_w3DrPDYpxINs",
  authDomain: "sistema-fidelizacion.firebaseapp.com",
  projectId: "sistema-fidelizacion",
  storageBucket: "sistema-fidelizacion.appspot.com",
  messagingSenderId: "357176214962",
  appId: "1:357176214962:web:6c1df9b74ff0f3779490ab"
};
/* ===================================================================== */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", () => self.clients.claim());

// Inicializa Firebase en el SW
const app = initializeApp(firebaseConfig);
const messaging = getMessaging(app);

/** Helper: muestra notificación desde data */
function showFromData(d) {
  const title = d.title || "RAMPET";  // fallback mínimo
  const body  = d.body  || "";
  if (!title && !body) return;

  const icon  = d.icon  || undefined; // si no mandás icon, queda undefined
  const badge = d.badge || undefined;

  self.registration.showNotification(title, {
    body,
    icon,
    badge,
    data: {
      click_action: d.click_action || "/",
      type: d.type || "simple",
      v: SW_VERSION
    }
  });
}

/** Mensajes de fondo (background) — esperados en "data-only" */
onBackgroundMessage(messaging, (payload) => {
  // Log de depuración (podés quitarlo cuando valides)
  try { console.log("[FCM BG] payload:", JSON.stringify(payload)); } catch (e) {}

  const d = payload?.data || {};

  // Camino normal: title/body dentro de data
  if (d.title || d.body) {
    showFromData(d);
    return;
  }

  // Fallback mínimo si (todavía) llega notification (transitorio mientras migramos campañas)
  const nt = payload?.notification?.title;
  const nb = payload?.notification?.body;
  if (nt || nb) {
    self.registration.showNotification(nt || "RAMPET", {
      body: nb || "",
      icon: d.icon || undefined,
      badge: d.badge || undefined,
      data: {
        click_action: d.click_action || "/",
        type: d.type || "simple",
        v: SW_VERSION
      }
    });
  }
});

/** Click en la notificación → focus/abrir y navegar a click_action */
self.addEventListener("notificationclick", async (event) => {
  event.notification.close();
  const url = event.notification?.data?.click_action || "/";
  const clientsArr = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

  for (const c of clientsArr) {
    if ("focus" in c) {
      c.focus();
      try { c.navigate(url); } catch (e) {}
      return;
    }
  }
  await self.clients.openWindow(url);
});
