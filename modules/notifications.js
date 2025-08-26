// pwa/modules/notifications.js
// Canal completo: FG (onMessage) + BG (SW -> postMessage) + helpers Firestore + campanita + token único

import { auth, db, messaging, firebase, isMessagingSupported } from './firebase.js';
import * as UI from './ui.js';

// ---------- Constantes ----------
const TOKEN_LS_KEY = 'fcmToken';

// ---------- Utils Firestore ----------
async function getClienteDocRef() {
  try {
    if (!auth.currentUser) return null;
    const q = await db.collection('clientes')
      .where('authUID', '==', auth.currentUser.uid)
      .limit(1).get();
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

// ---------- Token FCM: único por usuario ----------
async function saveSingleTokenForUser(token) {
  const u = auth.currentUser;
  if (!u || !token) return;

  const qs = await db.collection('clientes')
    .where('authUID', '==', u.uid)
    .limit(1).get();
  if (qs.empty) return;

  const ref = qs.docs[0].ref;

  // Reemplaza todo el array por [token]
  await ref.set({ fcmTokens: [token] }, { merge: true });

  // Cache local para poder limpiar en logout y dedupe
  localStorage.setItem(TOKEN_LS_KEY, token);

  console.log('✅ Token FCM guardado como único:', token);
}

export async function handleSignOutCleanup() {
  try {
    const token = localStorage.getItem(TOKEN_LS_KEY);
    const u = auth.currentUser;

    if (u && token) {
      const qs = await db.collection('clientes')
        .where('authUID', '==', u.uid)
        .limit(1).get();

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

export async function ensureSingleToken() {
  try {
    const u = auth.currentUser;
    if (!u) return;

    const qs = await db.collection('clientes')
      .where('authUID', '==', u.uid)
      .limit(1).get();

    if (qs.empty) return;

    const doc = qs.docs[0];
    const data = doc.data() || {};
    const tokens = Array.isArray(data.fcmTokens) ? data.fcmTokens : [];

    if (tokens.length <= 1) return;

    // Elegimos uno: el del localStorage si existe, sino el primero del array
    const preferred = localStorage.getItem(TOKEN_LS_KEY) || tokens[0];

    await doc.ref.set({ fcmTokens: [preferred] }, { merge: true });
    localStorage.setItem(TOKEN_LS_KEY, preferred);

    console.log(`🧽 Dedupe de fcmTokens: ${tokens.length} → 1`);
  } catch (e) {
    console.warn('ensureSingleToken error:', e);
  }
}

// ---------- Permisos + token ----------
export function gestionarPermisoNotificaciones() {
  if (!isMessagingSupported || !auth.currentUser || !messaging) return;

  const promptCard = document.getElementById('notif-prompt-card');
  const switchCard = document.getElementById('notif-card');
  const blockedWarning = document.getElementById('notif-blocked-warning');
  const popUpYaGestionado = localStorage.getItem(`notifGestionado_${auth.currentUser.uid}`);

  if (promptCard) promptCard.style.display = 'none';
  if (switchCard) switchCard.style.display = 'none';
  if (blockedWarning) blockedWarning.style.display = 'none';

  if (Notification.permission === 'granted') {
    obtenerYGuardarToken().then(() => ensureSingleToken());
    return;
  }
  if (Notification.permission === 'denied') {
    if (blockedWarning) blockedWarning.style.display = 'block';
    return;
  }
  if (!popUpYaGestionado) {
    if (promptCard) promptCard.style.display = 'block';
  } else {
    if (switchCard) switchCard.style.display = 'block';
    const sw = document.getElementById('notif-switch');
    if (sw) sw.checked = false;
  }
}

async function obtenerYGuardarToken() {
  if (!isMessagingSupported || !auth.currentUser || !messaging) return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    const vapidKey = "BN12Kv7QI7PpxwGfpanJUQ55Uci7KXZmEscTwlE7MIbhI0TzvoXTUOaSSesxFTUbxWsYZUubK00xnLePMm_rtOA";

    const currentToken = await messaging.getToken({
      vapidKey,
      serviceWorkerRegistration: registration
    });

    if (currentToken) {
      await saveSingleTokenForUser(currentToken); // ⬅️ SOLO 1 token en Firestore
      return currentToken;
    } else {
      console.warn('⚠️ No se pudo obtener token');
      return null;
    }
  } catch (err) {
    console.error('obtenerYGuardarToken error:', err);
    if (err.code === 'messaging/permission-blocked' || err.code === 'messaging/permission-default') {
      const warn = document.getElementById('notif-blocked-warning');
      if (warn) warn.style.display = 'block';
    }
    return null;
  }
}

export function handlePermissionRequest() {
  localStorage.setItem(`notifGestionado_${auth.currentUser?.uid}`, 'true');
  const card = document.getElementById('notif-prompt-card');
  if (card) card.style.display = 'none';

  Notification.requestPermission().then(async (p) => {
    if (p === 'granted') {
      UI.showToast('¡Notificaciones activadas!', 'success');
      await obtenerYGuardarToken();
      await ensureSingleToken();
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
    Notification.requestPermission().then(async (p) => {
      if (p === 'granted') {
        UI.showToast('¡Notificaciones activadas!', 'success');
        const sc = document.getElementById('notif-card');
        if (sc) sc.style.display = 'none';
        await obtenerYGuardarToken();
        await ensureSingleToken();
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

// ========== INBOX MODAL RENDER ==========
function formatDate(ts) {
  try {
    if (!ts) return '';
    // Firestore Timestamp o Date ISO
    const d = ts.toDate ? ts.toDate() : (typeof ts === 'string' ? new Date(ts) : ts);
    return d.toLocaleString();
  } catch { return ''; }
}

async function getClienteDocRefSafe() {
  try {
    if (!auth.currentUser) return null;
    const q = await db.collection('clientes').where('authUID', '==', auth.currentUser.uid).limit(1).get();
    if (q.empty) return null;
    return q.docs[0].ref;
  } catch {
    return null;
  }
}

/**
 * Trae últimos N docs del inbox (ordenado por sentAt desc).
 * No asumo que exista "tipo", así que muestro lista plana y filtro expirados en cliente.
 */
async function fetchInboxDocs(limit = 50) {
  const ref = await getClienteDocRefSafe();
  if (!ref) return [];
  const snap = await ref.collection('inbox')
    .orderBy('sentAt', 'desc')
    .limit(limit)
    .get();
  const now = Date.now();

  const items = [];
  snap.forEach(doc => {
    const d = doc.data() || {};
    const expireOk = !d.expireAt || (d.expireAt.toDate ? d.expireAt.toDate().getTime() > now : new Date(d.expireAt).getTime() > now);
    if (expireOk) {
      items.push({ id: doc.id, ...d });
    }
  });
  return items;
}

function renderInboxList(items = []) {
  const list = document.getElementById('inbox-list');
  const empty = document.getElementById('inbox-empty');
  if (!list || !empty) return;

  if (!items.length) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  // Render simple (título, cuerpo, estado, fecha). Si hay url, se muestra como link.
  const html = items.map(it => {
    const status = it.status || 'sent';
    const sentAt = formatDate(it.sentAt);
    const url = it.url || it.click_action || '';
    const tag = it.tag ? `<span style="font-size:12px;color:#777;"> • ${it.tag}</span>` : '';
    const pill =
      status === 'read' ? '<span style="font-size:12px;padding:2px 8px;border-radius:999px;background:#e5f5e5;color:#1a7f37;">leído</span>' :
      status === 'delivered' ? '<span style="font-size:12px;padding:2px 8px;border-radius:999px;background:#fff3cd;color:#b58100;">nuevo</span>' :
      '<span style="font-size:12px;padding:2px 8px;border-radius:999px;background:#ffe8e8;color:#b00020;">pendiente</span>';

    const link = url
      ? `<a href="${url}" style="text-decoration:underline;">Ver</a>`
      : '';

    return `
      <div style="padding:12px 0;border-bottom:1px solid var(--border-color);">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <strong>${it.title || 'Sin título'}</strong>
          ${pill}
        </div>
        <div style="color:#555;margin:6px 0;">${it.body || ''}</div>
        <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;">
          <small style="color:#777;">${sentAt}${tag}</small>
          <div>${link}</div>
        </div>
      </div>
    `;
  }).join('');

  list.innerHTML = html;
}

function openInboxModal() {
  const modal = document.getElementById('inbox-modal');
  if (modal) modal.style.display = 'flex';
}
function closeInboxModal() {
  const modal = document.getElementById('inbox-modal');
  if (modal) modal.style.display = 'none';
}

/** Carga y muestra el inbox; no marca leído acá (lo hacemos al click de botón o al abrir si querés) */
export async function showInboxModal() {
  const items = await fetchInboxDocs(50);
  renderInboxList(items);
  openInboxModal();

  // listeners (idempotentes: quitamos y volvemos a agregar)
  const closeX = document.getElementById('close-inbox-modal');
  const closeBtn = document.getElementById('inbox-close-btn');
  const markBtn = document.getElementById('inbox-mark-read');

  if (closeX) {
    closeX.onclick = () => closeInboxModal();
  }
  if (closeBtn) {
    closeBtn.onclick = () => closeInboxModal();
  }
  if (markBtn) {
    markBtn.onclick = async () => {
      await markAllDeliveredAsRead();
      // refresco visual del listado con estados en “leído”
      const refreshed = await fetchInboxDocs(50);
      renderInboxList(refreshed);
      resetBellCounter();
      UI.showToast('Notificaciones marcadas como leídas', 'success');
    };
  }
}
