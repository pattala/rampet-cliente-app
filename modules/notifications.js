// pwa/modules/notifications.js  (versión robusta)
// - Garantiza soporte de FCM en runtime
// - Pide permiso, obtiene token con VAPID + SW listo
// - Guarda token en Firestore
// - Maneja UI de banners/switch
// - Escucha mensajes data-only en foreground (payload.data)

import { auth, db, messaging as exportedMessaging, firebase, isMessagingSupported as supportedFlag } from './firebase.js';
import * as UI from './ui.js';

// === TU VAPID PUBLIC KEY (Firebase Console > Cloud Messaging > Web push) ===
const VAPID_KEY = "BN12Kv7QI7PpxwGfpanJUQ55Uci7KXZmEscTwlE7MIbhI0TzvoXTUOaSSesxFTUbxWsYZUubK00xnLePMm_rtOA";

// -------------------------------------------------------------
// Helpers base
// -------------------------------------------------------------
async function ensureMessaging() {
  // Hay entornos donde supportedFlag puede ser false si nadie ejecutó el chequeo.
  // Por eso chequeamos en runtime también.
  let supported = supportedFlag;
  try {
    if (typeof firebase?.messaging?.isSupported === 'function') {
      supported = await firebase.messaging.isSupported();
    }
  } catch { supported = false; }

  if (!supported) return null;

  // Usa la instancia exportada si existe; si no, crea una nueva
  try {
    return exportedMessaging || firebase.messaging();
  } catch {
    return null;
  }
}

async function ensurePermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const res = await Notification.requestPermission();
  return res === 'granted';
}

async function getCurrentToken() {
  const msg = await ensureMessaging();
  if (!msg) throw new Error('FCM no soportado');

  const ok = await ensurePermission();
  if (!ok) throw new Error('Permiso no otorgado');

  // Esperar a que el SW esté activo y pasar registration + VAPID
  const registration = await navigator.serviceWorker.ready;
  const token = await msg.getToken({
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration
  });
  if (!token) throw new Error('No se pudo obtener el token FCM');
  return token;
}

async function saveTokenInClienteDoc(token) {
  if (!token || !auth.currentUser) return;
  // Buscar el doc del cliente por authUID (como ya haces en tu base)
  const q = await db.collection('clientes').where('authUID', '==', auth.currentUser.uid).limit(1).get();
  if (q.empty) return;

  const ref = q.docs[0].ref;
  await ref.set(
    { fcmTokens: firebase.firestore.FieldValue.arrayUnion(token) },
    { merge: true }
  );
  console.log('Token de notificación guardado/actualizado con éxito.');
}

// -------------------------------------------------------------
// UI principal (banners/switch) + obtención/guardado de token
// -------------------------------------------------------------
export async function gestionarPermisoNotificaciones() {
  if (!auth.currentUser) return;

  const promptCard = document.getElementById('notif-prompt-card');
  const switchCard = document.getElementById('notif-card');
  const blockedWarning = document.getElementById('notif-blocked-warning');
  const switchEl = document.getElementById('notif-switch');

  // reset UI
  if (promptCard) promptCard.style.display = 'none';
  if (switchCard) switchCard.style.display = 'none';
  if (blockedWarning) blockedWarning.style.display = 'none';

  // soporte
  const msg = await ensureMessaging();
  if (!msg) {
    // No hay soporte -> no mostramos nada
    return;
  }

  // Estados de permiso
  if (Notification.permission === 'granted') {
    try {
      const token = await getCurrentToken();
      await saveTokenInClienteDoc(token);
    } catch (err) {
      console.warn('No se pudo obtener/guardar token:', err?.message || err);
    }
    return;
  }

  if (Notification.permission === 'denied') {
    if (blockedWarning) blockedWarning.style.display = 'block';
    return;
  }

  // permission = 'default'
  // Mostramos prompt la primera vez; si el user lo cierra, dejamos el switch
  const key = `notifGestionado_${auth.currentUser.uid}`;
  const yaGestionado = localStorage.getItem(key);

  if (!yaGestionado && promptCard) {
    promptCard.style.display = 'block';
  } else if (switchCard) {
    switchCard.style.display = 'block';
    if (switchEl) switchEl.checked = false;
  }
}

export function handlePermissionRequest() {
  if (!auth.currentUser) return;
  const key = `notifGestionado_${auth.currentUser.uid}`;
  localStorage.setItem(key, 'true');
  const promptCard = document.getElementById('notif-prompt-card');
  if (promptCard) promptCard.style.display = 'none';

  Notification.requestPermission().then(async (permission) => {
    if (permission === 'granted') {
      UI.showToast('¡Notificaciones activadas!', 'success');
      try {
        const token = await getCurrentToken();
        await saveTokenInClienteDoc(token);
      } catch (err) {
        UI.showToast('No se pudo activar del todo (token).', 'warning');
      }
    } else {
      const switchCard = document.getElementById('notif-card');
      const switchEl = document.getElementById('notif-switch');
      if (switchCard) switchCard.style.display = 'block';
      if (switchEl) switchEl.checked = false;
    }
  });
}

export function dismissPermissionRequest() {
  if (!auth.currentUser) return;
  const key = `notifGestionado_${auth.currentUser.uid}`;
  localStorage.setItem(key, 'true');
  const promptCard = document.getElementById('notif-prompt-card');
  const switchCard = document.getElementById('notif-card');
  const switchEl = document.getElementById('notif-switch');
  if (promptCard) promptCard.style.display = 'none';
  if (switchCard) switchCard.style.display = 'block';
  if (switchEl) switchEl.checked = false;
}

export function handlePermissionSwitch(e) {
  if (!e?.target?.checked) return;
  Notification.requestPermission().then(async (permission) => {
    if (permission !== 'granted') {
      e.target.checked = false;
      return;
    }
    UI.showToast('¡Notificaciones activadas!', 'success');
    try {
      const token = await getCurrentToken();
      await saveTokenInClienteDoc(token);
      // Ocultamos la tarjeta del switch si querés
      const switchCard = document.getElementById('notif-card');
      if (switchCard) switchCard.style.display = 'none';
    } catch (err) {
      e.target.checked = false;
      UI.showToast('No se pudo activar del todo (token).', 'warning');
    }
  });
}

// -------------------------------------------------------------
// Foreground messages (data-only) -> toasts/actualización UI
// -------------------------------------------------------------
export async function listenForInAppMessages() {
  const msg = await ensureMessaging();
  if (!msg) return () => {};

  return msg.onMessage((payload) => {
    // En data-only, viene todo en payload.data.*
    const d = payload?.data || {};
    const title = d.title || 'Notificación';
    const body  = d.body  || '';
    UI.showToast(`📢 ${title}: ${body}`, 'info', 8000);
  });
}
