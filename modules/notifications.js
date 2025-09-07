// pwa/modules/notifications.js
// Notificaciones: permiso + token + dedupe + canal SW→APP + onMessage + campanita + inbox helpers

import { auth, db, messaging, firebase, isMessagingSupported } from './firebase.js';
import * as UI from './ui.js';

// —— Detección de contexto efímero (Incógnito/Invitado) ——
async function isEphemeralContext() {
  try {
    if (!navigator.storage?.estimate) return false;
    const { quota } = await navigator.storage.estimate();
    return !!quota && quota < 160 * 1024 * 1024; // ~160MB umbral (modo efímero)
  } catch { return false; }
}
function showIncognitoWarningIfAny() {
  const el = document.getElementById('notif-incognito-warning');
  if (el) el.style.display = 'block';
}

// —— Estado interno (guards para evitar duplicados) ——
const NOTIFS = (window.__RAMPET_NOTIFS ||= {
  onMsg: false,              // hook foreground onMessage
  swChan: false,             // canal SW→APP
  initUid: null,             // usuario ya inicializado
  inFlight: null,            // promesa getToken en curso
  lastToken: localStorage.getItem('fcmToken') || null,
});
const TOKEN_LS_KEY = 'fcmToken';

// —— Campanita (badge) ——
function getCounterEl() { return document.getElementById('notif-counter'); }
export function bumpBellCounter(delta = 1) {
  const el = getCounterEl(); if (!el) return;
  const curr = Number(el.textContent || '0') || 0;
  const next = Math.max(0, curr + delta);
  if (next > 0) { el.textContent = String(next); el.style.display = 'inline-block'; }
  else { el.textContent = ''; el.style.display = 'none'; }
}
export function resetBellCounter() {
  const el = getCounterEl(); if (!el) return;
  el.textContent = ''; el.style.display = 'none';
}

// —— Firestore helpers (cliente ↔ inbox) ——
async function getClienteDocRef() {
  try {
    if (!auth.currentUser) return null;
    const q = await db.collection('clientes')
      .where('authUID', '==', auth.currentUser.uid)
      .limit(1).get();
    if (q.empty) return null;
    return q.docs[0].ref;
  } catch { return null; }
}

async function markDeliveredInInbox(notifId) {
  if (!notifId) return;
  const ref = await getClienteDocRef();
  if (!ref) return;
  try {
    await ref.collection('inbox').doc(notifId).set({
      status: 'delivered',
      deliveredAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    bumpBellCounter(1);
  } catch (e) {
    console.warn('markDeliveredInInbox error:', e);
  }
}

async function markReadInInbox(notifId) {
  if (!notifId) return;
  const ref = await getClienteDocRef();
  if (!ref) return;
  try {
    await ref.collection('inbox').doc(notifId).set({
      status: 'read',
      readAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (e) {
    console.warn('markReadInInbox error:', e);
  }
}

// —— Token único (dedupe) ——
async function saveSingleTokenForUser(token) {
  const u = auth.currentUser;
  if (!u || !token) return;

  const qs = await db.collection('clientes').where('authUID', '==', u.uid).limit(1).get();
  if (qs.empty) return;

  await qs.docs[0].ref.set({ fcmTokens: [token] }, { merge: true });
  localStorage.setItem(TOKEN_LS_KEY, token);
}

export async function ensureSingleToken() {
  try {
    const u = auth.currentUser; if (!u) return;
    const qs = await db.collection('clientes').where('authUID', '==', u.uid).limit(1).get();
    if (qs.empty) return;

    const doc = qs.docs[0];
    const data = doc.data() || {};
    const tokens = Array.isArray(data.fcmTokens) ? data.fcmTokens : [];
    if (tokens.length <= 1) return;

    const preferred = localStorage.getItem(TOKEN_LS_KEY) || tokens[0];
    await doc.ref.set({ fcmTokens: [preferred] }, { merge: true });
    localStorage.setItem(TOKEN_LS_KEY, preferred);
    console.log(`🧽 Dedupe de fcmTokens: ${tokens.length} → 1`);
  } catch (e) {
    console.warn('ensureSingleToken error:', e);
  }
}

export async function handleSignOutCleanup() {
  try {
    const token = localStorage.getItem(TOKEN_LS_KEY);
    const u = auth.currentUser;

    if (u && token) {
      const qs = await db.collection('clientes').where('authUID', '==', u.uid).limit(1).get();
      if (!qs.empty) {
        await qs.docs[0].ref.update({
          fcmTokens: firebase.firestore.FieldValue.arrayRemove(token),
        });
        console.log('🧹 Token removido de Firestore en logout.');
      }
    }

    if (typeof messaging?.deleteToken === 'function' && token) {
      try { await messaging.deleteToken(token); } catch {}
    }
    localStorage.removeItem(TOKEN_LS_KEY);
  } catch (e) {
    console.warn('handleSignOutCleanup error:', e);
  }
}

// —— Permisos + token ——
export async function gestionarPermisoNotificaciones() {
  if (!isMessagingSupported || !auth.currentUser || !messaging) return;

  // Incógnito/invitado → no intentar token persistente
  if (await isEphemeralContext()) {
    showIncognitoWarningIfAny();
    const promptCard = document.getElementById('notif-prompt-card');
    const switchCard = document.getElementById('notif-card');
    if (promptCard) promptCard.style.display = 'none';
    if (switchCard) switchCard.style.display = 'block';
    const sw = document.getElementById('notif-switch'); if (sw) sw.checked = false;
    return;
  }

  const promptCard = document.getElementById('notif-prompt-card');
  const switchCard = document.getElementById('notif-card');
  const blockedWarning = document.getElementById('notif-blocked-warning');
  const u = auth.currentUser;
  const already = localStorage.getItem(`notifGestionado_${u.uid}`);

  if (promptCard) promptCard.style.display = 'none';
  if (switchCard) switchCard.style.display = 'none';
  if (blockedWarning) blockedWarning.style.display = 'none';

  if (Notification.permission === 'granted') {
    await obtenerYGuardarToken();
    await ensureSingleToken();
    return;
  }
  if (Notification.permission === 'denied') {
    if (blockedWarning) blockedWarning.style.display = 'block';
    return;
  }
  // default
  if (!already) {
    if (promptCard) promptCard.style.display = 'block';
  } else {
    if (switchCard) switchCard.style.display = 'block';
    const sw = document.getElementById('notif-switch'); if (sw) sw.checked = false;
  }
}

async function obtenerYGuardarToken() {
  if (!isMessagingSupported || !auth.currentUser || !messaging) return null;

  if (NOTIFS.inFlight) return NOTIFS.inFlight; // evita paralelos

  NOTIFS.inFlight = (async () => {
    try {
      const registration =
        (await navigator.serviceWorker.getRegistration('/')) ||
        (await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/', updateViaCache: 'none' })) ||
        (await navigator.serviceWorker.ready);

      const vapidKey = "BN12Kv7QI7PpxwGfpanJUQ55Uci7KXZmEscTwlE7MIbhI0TzvoXTUOaSSesxFTUbxWsYZUubK00xnLePMm_rtOA";

      const currentToken = await messaging.getToken({
        vapidKey,
        serviceWorkerRegistration: registration
      });

      if (!currentToken) {
        console.warn('⚠️ No se pudo obtener token');
        return null;
      }

      // Dedupe fuerte
      if ((NOTIFS.lastToken && NOTIFS.lastToken === currentToken) ||
          (localStorage.getItem(TOKEN_LS_KEY) === currentToken)) {
        return currentToken;
      }

      await saveSingleTokenForUser(currentToken);
      NOTIFS.lastToken = currentToken;
      console.log('✅ Token FCM (nuevo) guardado:', currentToken);
      return currentToken;

    } catch (err) {
      console.error('obtenerYGuardarToken error:', err);
      if (err?.code === 'messaging/permission-blocked' || err?.code === 'messaging/permission-default') {
        const warn = document.getElementById('notif-blocked-warning');
        if (warn) warn.style.display = 'block';
      }
      return null;
    } finally {
      NOTIFS.inFlight = null;
    }
  })();

  return NOTIFS.inFlight;
}

// —— Botones UI (prompt/switch) ——
export function handlePermissionRequest() {
  localStorage.setItem(`notifGestionado_${auth.currentUser?.uid}`, 'true');
  const card = document.getElementById('notif-prompt-card');
  if (card) card.style.display = 'none';

  Notification.requestPermission().then(async (p) => {
    if (p === 'granted') {
      UI.showToast('¡Notificaciones activadas!', 'success');
      const sc = document.getElementById('notif-card');
      if (sc) sc.style.display = 'none';            // <-- oculta el switch
      await obtenerYGuardarToken();
      await ensureSingleToken();
      await gestionarPermisoNotificaciones();        // <-- refresca UI por si quedó algo visible
    } else {
      const sc = document.getElementById('notif-card');
      const sw = document.getElementById('notif-switch');
      if (sc) sc.style.display = 'block';
      if (sw) sw.checked = false;
    }
  });
}


export function dismissPermissionRequest() {
  localStorage.setItem(`notifGestionado_${auth.currentUser?.uid}`, 'true');
  const pc = document.getElementById('notif-prompt-card');
  const sc = document.getElementById('notif-card');
  if (pc) pc.style.display = 'none';
  if (sc) sc.style.display = 'block';
  const sw = document.getElementById('notif-switch'); if (sw) sw.checked = false;
}

export function handlePermissionSwitch(e) {
  if (e.target.checked) {
    Notification.requestPermission().then(async (p) => {
      if (p === 'granted') {
        UI.showToast('¡Notificaciones activadas!', 'success');
        const sc = document.getElementById('notif-card'); if (sc) sc.style.display = 'none';
        await obtenerYGuardarToken();
        await ensureSingleToken();
      } else {
        e.target.checked = false;
      }
    });
  }
}

// —— Foreground onMessage (único) ——
export function listenForInAppMessages() {
  if (!messaging) return;
  if (NOTIFS.onMsg) return;
  NOTIFS.onMsg = true;

  messaging.onMessage(async (payload) => {
    const data = payload?.data || {};
    if (data.id) await markDeliveredInInbox(data.id);
    const title = data.title || 'Mensaje';
    const body  = data.body  || '';
    UI.showToast(`📢 ${title}: ${body}`, 'info', 10000);
  });
}

// —— Canal SW → APP ——
function swMessageHandler(event) {
  const msg = event?.data || {};
  if (!msg || !msg.type) return;

  if (msg.type === 'PUSH_DELIVERED') {
    const d = msg.data || {};
    if (d.id) markDeliveredInInbox(d.id);
    else bumpBellCounter(1);
  }
  if (msg.type === 'PUSH_READ') {
    const d = msg.data || {};
    if (d.id) markReadInInbox(d.id);
    resetBellCounter();
  }
}
export function initNotificationChannel() {
  if (!('serviceWorker' in navigator)) return;
  if (NOTIFS.swChan) return;
  navigator.serviceWorker.addEventListener('message', swMessageHandler);
  NOTIFS.swChan = true;
  console.log('[INIT] SW message channel listo');
}

// —— “Campanita” (no abrimos modal acá; app.js ya lo abre) ——
export async function handleBellClick() {
  // No abrimos el modal desde acá para evitar duplicar lógicas con app.js.
  // Este hook existe por compatibilidad con tu app.
  return;
}

// —— Inicialización de notifs (1 sola vez por usuario) ——
export async function initNotificationsOnce() {
  const u = auth.currentUser;
  if (!u || !isMessagingSupported || !messaging) return;

  if (NOTIFS.initUid === u.uid) return;
  NOTIFS.initUid = u.uid;

  initNotificationChannel();
  listenForInAppMessages();

  await gestionarPermisoNotificaciones();
  await ensureSingleToken();
}

