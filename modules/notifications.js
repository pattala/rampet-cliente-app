// pwa/modules/notifications.js
// Canal completo: FG (onMessage) + BG (SW -> postMessage) + helpers Firestore + campanita

import { auth, db, messaging, firebase, isMessagingSupported } from './firebase.js';
import * as UI from './ui.js';

// ---------- Utils Firestore ----------
async function getClienteDocRef() {
  try {
    if (!auth.currentUser) return null;
    const q = await db.collection('clientes').where('authUID', '==', auth.currentUser.uid).limit(1).get();
    if (q.empty) return null;
    return q.docs[0].ref;
  } catch {
    return null;
  }
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
    console.log('[INBOX] delivered →', notifId);
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
    console.log('[INBOX] read →', notifId);
  } catch (e) {
    console.warn('markReadInInbox error:', e);
  }
}

// ---------- UI Badge 🔔 ----------
function getCounterEl() {
  return document.getElementById('notif-counter');
}
export function bumpBellCounter(delta = 1) {
  const el = getCounterEl();
  if (!el) return;
  const curr = Number(el.textContent || '0') || 0;
  const next = Math.max(0, curr + delta);
  if (next > 0) {
    el.textContent = String(next);
    el.style.display = 'inline-block';
  } else {
    el.textContent = '';
    el.style.display = 'none';
  }
}
export function resetBellCounter() {
  const el = getCounterEl();
  if (!el) return;
  el.textContent = '';
  el.style.display = 'none';
}

// ---------- Permisos + token ----------
export function gestionarPermisoNotificaciones() {
    if (!isMessagingSupported || !auth.currentUser || !messaging) return;

  const promptCard = document.getElementById('notif-prompt-card');
  const switchCard = document.getElementById('notif-card');
  const blockedWarning = document.getElementById('notif-blocked-warning');
  const popUpYaGestionado = localStorage.getItem(`notifGestionado_${auth.currentUser.uid}`);

  promptCard.style.display = 'none';
  switchCard.style.display = 'none';
  blockedWarning.style.display = 'none';

  if (Notification.permission === 'granted') {
    obtenerYGuardarToken();
    return;
  }
  if (Notification.permission === 'denied') {
    blockedWarning.style.display = 'block';
    return;
  }
  if (!popUpYaGestionado) {
    promptCard.style.display = 'block';
  } else {
    switchCard.style.display = 'block';
    const sw = document.getElementById('notif-switch');
    if (sw) sw.checked = false;
  }
}

async function obtenerYGuardarToken() {
  if (!isMessagingSupported || !auth.currentUser || !messaging) return;
  try {
    const snap = await db.collection('clientes').where('authUID', '==', auth.currentUser.uid).limit(1).get();
    if (snap.empty) return;
    const clienteRef = snap.docs[0].ref;

    const registration = await navigator.serviceWorker.ready;
    const vapidKey = "BN12Kv7QI7PpxwGfpanJUQ55Uci7KXZmEscTwlE7MIbhI0TzvoXTUOaSSesxFTUbxWsYZUubK00xnLePMm_rtOA";

    const currentToken = await messaging.getToken({ vapidKey, serviceWorkerRegistration: registration });
    if (currentToken) {
      await clienteRef.update({ fcmTokens: firebase.firestore.FieldValue.arrayUnion(currentToken) });
      console.log('✅ Token guardado/actualizado');
    } else {
      console.warn('⚠️ No se pudo obtener token');
    }
  } catch (err) {
    console.error('obtenerYGuardarToken error:', err);
    if (err.code === 'messaging/permission-blocked' || err.code === 'messaging/permission-default') {
      const warn = document.getElementById('notif-blocked-warning');
      if (warn) warn.style.display = 'block';
    }
  }
}

export function handlePermissionRequest() {
  localStorage.setItem(`notifGestionado_${auth.currentUser?.uid}`, 'true');
  const card = document.getElementById('notif-prompt-card');
  if (card) card.style.display = 'none';

  Notification.requestPermission().then(p => {
    if (p === 'granted') {
      UI.showToast('¡Notificaciones activadas!', 'success');
      obtenerYGuardarToken();
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
  const sw = document.getElementById('notif-switch');
  if (sw) sw.checked = false;
}
export function handlePermissionSwitch(e) {
  if (e.target.checked) {
    Notification.requestPermission().then(p => {
      if (p === 'granted') {
        UI.showToast('¡Notificaciones activadas!', 'success');
        const sc = document.getElementById('notif-card');
        if (sc) sc.style.display = 'none';
        obtenerYGuardarToken();
      } else {
        e.target.checked = false;
      }
    });
  }
}

// ---------- Canal FG (app visible) ----------
export function listenForInAppMessages() {
  if (!messaging) return;
  messaging.onMessage(async (payload) => {
    const data = payload?.data || {};
    console.log('[FG] onMessage', data);
    // marcar delivered
    if (data.id) await markDeliveredInInbox(data.id);
    // toast
    const title = data.title || 'Mensaje';
    const body  = data.body  || '';
    UI.showToast(`📢 ${title}: ${body}`, 'info', 10000);
  });
}

// ---------- Canal BG → SW postMessage ----------
function swMessageHandler(event) {
  const msg = event?.data || {};
  if (!msg || !msg.type) return;

  if (msg.type === 'PUSH_DELIVERED') {
    const d = msg.data || {};
    console.log('[SW→APP] delivered', d);
    if (d.id) markDeliveredInInbox(d.id);
    else bumpBellCounter(1); // si no vino id, al menos subimos el badge
  }
  if (msg.type === 'PUSH_READ') {
    const d = msg.data || {};
    console.log('[SW→APP] read', d);
    if (d.id) markReadInInbox(d.id);
    resetBellCounter();
  }
}

/** Inicializa el canal con el SW (escucha postMessage) */
export function initNotificationChannel() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.removeEventListener('message', swMessageHandler);
  navigator.serviceWorker.addEventListener('message', swMessageHandler);
  console.log('[INIT] SW message channel listo');
}

// ---------- Campanita ----------
export async function markAllDeliveredAsRead() {
  if (!auth.currentUser) return;
  const ref = await getClienteDocRef();
  if (!ref) return;
  try {
    const q = await ref.collection('inbox')
      .where('status', 'in', ['sent', 'delivered'])
      .get();
    const batch = db.batch();
    q.forEach(doc => {
      batch.set(doc.ref, {
        status: 'read',
        readAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });
    await batch.commit();
    resetBellCounter();
    console.log('[INBOX] markAllDeliveredAsRead →', q.size);
  } catch (e) {
    console.warn('markAllDeliveredAsRead error:', e);
  }
}
export async function handleBellClick() {
  await markAllDeliveredAsRead();
}

