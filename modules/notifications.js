// pwa/modules/notifications.js
// FG (onMessage) + BG (SW->postMessage) + Firestore helpers + campanita + token único + Inbox con pestañas

import { auth, db, messaging, firebase, isMessagingSupported } from './firebase.js';
import * as UI from './ui.js';
// Evita inicializar notificaciones más de una vez por usuario/sesión

// Si no los tenés ya, estos ayudan a no duplicar listeners:



// Evita inicializar notificaciones más de una vez por usuario
let __notifsInitUid = null;

// --- Guards para evitar duplicados ---
let __getTokenInFlight = null;           // evita llamadas paralelas a getToken()
let __lastSavedToken   = localStorage.getItem('fcmToken') || null; // cache local rápido
let __onMessageHooked  = false;          // evita enganchar onMessage 2+ veces
let __swChannelInited  = false;          // evita duplicar el canal SW→APP


// Registra/obtiene el SW de FCM con scope raíz y sin cachear el script
async function registerFcmSW() {
  if (!('serviceWorker' in navigator)) return null;

  try {
    // Si ya hay registro en '/', usalo (y actualizalo)
    const existing = await navigator.serviceWorker.getRegistration('/');
    if (existing) {
      try { await existing.update(); } catch {}
      return existing;
    }

    // Si no hay, registralo
    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
      scope: '/',
      updateViaCache: 'none'
    });
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    console.log('✅ SW FCM registrado:', reg.scope);
    return reg;
  } catch (e) {
    console.warn('[FCM] No se pudo registrar el SW:', e);
    return null;
  }
}

const TOKEN_LS_KEY = 'fcmToken';

// --- Firestore utils ---
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

// --- Badge 🔔 ---
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

// --- Token único ---
async function saveSingleTokenForUser(token) {
  const u = auth.currentUser;
  if (!u || !token) return;

  const qs = await db.collection('clientes')
    .where('authUID', '==', u.uid)
    .limit(1).get();
  if (qs.empty) return;

  const ref = qs.docs[0].ref;
  await ref.set({ fcmTokens: [token] }, { merge: true });

  localStorage.setItem(TOKEN_LS_KEY, token);
  // console.debug('✅ Token FCM guardado como único:', token);

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

    const preferred = localStorage.getItem(TOKEN_LS_KEY) || tokens[0];

    await doc.ref.set({ fcmTokens: [preferred] }, { merge: true });
    localStorage.setItem(TOKEN_LS_KEY, preferred);

    console.log(`🧽 Dedupe de fcmTokens: ${tokens.length} → 1`);
  } catch (e) {
    console.warn('ensureSingleToken error:', e);
  }
}

// --- Permisos + token ---
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

  // Si ya hay una obtención en curso, reutilizamos esa promesa
  if (__getTokenInFlight) return __getTokenInFlight;

  __getTokenInFlight = (async () => {
    try {
      // usar el SW ya registrado o registrarlo (evita cache del script)
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

// Dedupe fuerte: si es el mismo, no re-guardar ni loguear
if ((__lastSavedToken && __lastSavedToken === currentToken) ||
    (localStorage.getItem('fcmToken') === currentToken)) {
  // silencio: ya está guardado, no spameamos logs
  return currentToken;
}

await saveSingleTokenForUser(currentToken);   // guarda en Firestore y setea localStorage
__lastSavedToken = currentToken;              // cache en memoria

console.log('✅ Token FCM (nuevo) guardado:', currentToken);
return currentToken;


    } catch (err) {
      console.error('obtenerYGuardarToken error:', err);
      if (err.code === 'messaging/permission-blocked' || err.code === 'messaging/permission-default') {
        const warn = document.getElementById('notif-blocked-warning');
        if (warn) warn.style.display = 'block';
      }
      return null;
    } finally {
      __getTokenInFlight = null; // libera el candado
    }
  })();

  return __getTokenInFlight;
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

// --- Canal FG (app visible) ---
export function listenForInAppMessages() {
  if (!messaging) return;
   if (__onMessageHooked) return;    // ← evita múltiples hooks
  __onMessageHooked = true;
  
  messaging.onMessage(async (payload) => {
    const data = payload?.data || {};
    console.log('[FG] onMessage', data);
    if (data.id) await markDeliveredInInbox(data.id);
    const title = data.title || 'Mensaje';
    const body  = data.body  || '';
    UI.showToast(`📢 ${title}: ${body}`, 'info', 10000);
  });
}

// --- Canal BG → SW postMessage ---
function swMessageHandler(event) {
  const msg = event?.data || {};
  if (!msg || !msg.type) return;

  if (msg.type === 'PUSH_DELIVERED') {
    const d = msg.data || {};
    console.log('[SW→APP] delivered', d);
    if (d.id) markDeliveredInInbox(d.id);
    else bumpBellCounter(1);
  }
  if (msg.type === 'PUSH_READ') {
    const d = msg.data || {};
    console.log('[SW→APP] read', d);
    if (d.id) markReadInInbox(d.id);
    resetBellCounter();
  }
}

export function initNotificationChannel() {
  if (!('serviceWorker' in navigator)) return;
  if (__swChannelInited) return;               // ← NO volver a registrar
  navigator.serviceWorker.addEventListener('message', swMessageHandler);
  __swChannelInited = true;
  console.log('[INIT] SW message channel listo');
}


// --- Campanita ---
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

// Al abrir: solo mostrar el modal (NO marca leídos automáticamente)
export async function handleBellClick() {
  await showInboxModal();
}
// Llamar una sola vez por sesión/usuario
export async function initNotificationsOnce() {
  const u = auth.currentUser;
  if (!u || !isMessagingSupported || !messaging) return;

  if (__notifsInitUid === u.uid) {
    // Ya inicializado para este usuario; no repetir
    return;
  }
  __notifsInitUid = u.uid;

  // 1) Canal SW→APP (con guard que ya agregaste)
  initNotificationChannel();

  // 2) Mensajes en foreground (con guard __onMessageHooked si lo agregaste)
  listenForInAppMessages();

  // 3) Permisos + token (esto internamente llama a obtenerYGuardarToken(), ahora sin duplicar)
  gestionarPermisoNotificaciones();

  // 4) Extra: dedupe en Firestore si había viejos (tu helper)
  ensureSingleToken();
}

// ========== INBOX ==========
function formatDate(ts) {
  try {
    if (!ts) return '';
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
    const notExpired =
      !d.expireAt ||
      (d.expireAt.toDate ? d.expireAt.toDate().getTime() > now : new Date(d.expireAt).getTime() > now);
    if (notExpired) items.push({ id: doc.id, ...d });
  });
  return items;
}

function bucketOf(it = {}) {
  const s = (it.source || it.type || '').toString().toLowerCase();
  if (s.includes('promo') || s.includes('camp')) return 'promos';
  if (s.includes('punto') || s === 'points') return 'puntos';
  return s ? s : 'otros';
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
      ? `<a href="#" class="inbox-item-link" data-url="${encodeURIComponent(url)}" style="text-decoration:underline;">Ver</a>`
      : '';

    return `
      <div class="inbox-item" style="padding:12px 0;border-bottom:1px solid var(--border-color);">
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

  list.querySelectorAll('.inbox-item-link').forEach(a => {
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      const raw = a.getAttribute('data-url') || '';
      const url = decodeURIComponent(raw);

      closeInboxModal();
      if (!url || url === '/notificaciones') return;

      const target = url.startsWith('/') ? `/${url.replace(/^\//,'')}` : `/${url}`;
      window.location.href = `/?open=${encodeURIComponent(target)}`;
    }, { once:false });
  });
}

function openInboxModal() {
  const modal = document.getElementById('inbox-modal');
  if (modal) modal.style.display = 'flex';
}
function closeInboxModal() {
  const modal = document.getElementById('inbox-modal');
  if (modal) modal.style.display = 'none';
}

let _inboxTab = 'todos';
function setActiveTabUI(tab) {
  const all = ['todos','promos','puntos','otros'];
  all.forEach(t => {
    const btn = document.getElementById(`inbox-tab-${t}`);
    if (!btn) return;
    if (t === tab) {
      btn.classList.remove('secondary-btn');
      btn.classList.add('primary-btn');
    } else {
      btn.classList.remove('primary-btn');
      btn.classList.add('secondary-btn');
    }
  });
}

async function renderInboxByTab(tab = 'todos') {
  _inboxTab = tab;
  setActiveTabUI(tab);
  const items = await fetchInboxDocs(50);
  const filtered = (tab === 'todos')
    ? items
    : items.filter(it => bucketOf(it) === tab);
  renderInboxList(filtered);
}

export async function showInboxModal() {
  await renderInboxByTab(_inboxTab || 'todos');
  openInboxModal();

  const closeX = document.getElementById('close-inbox-modal');
  const closeBtn = document.getElementById('inbox-close-btn');
  const markBtn = document.getElementById('inbox-mark-read');

  if (closeX) closeX.onclick = () => closeInboxModal();
  if (closeBtn) closeBtn.onclick = () => closeInboxModal();
  if (markBtn) {
    markBtn.onclick = async () => {
      await markAllDeliveredAsRead();
      await renderInboxByTab(_inboxTab || 'todos');
      resetBellCounter();
      UI.showToast('Notificaciones marcadas como leídas', 'success');
    };
  }

  const tabs = [
    { id: 'inbox-tab-todos',  tab: 'todos'  },
    { id: 'inbox-tab-promos', tab: 'promos' },
    { id: 'inbox-tab-puntos', tab: 'puntos' },
    { id: 'inbox-tab-otros',  tab: 'otros'  },
  ];
  tabs.forEach(({id, tab}) => {
    const el = document.getElementById(id);
    if (el) el.onclick = () => renderInboxByTab(tab);
  });
}
// Inicializa canal SW→APP, onMessage y token SOLO una vez por usuario/sesión
export async function initNotificationsOnce() {
  try {
    const u = auth.currentUser;
    if (!u || !isMessagingSupported || !messaging) return;

    // si ya se inicializó para este usuario, no repetir
    if (__notifsInitUid === u.uid) return;
    __notifsInitUid = u.uid;

    // 1) canal del SW → app (con guard interno)
    initNotificationChannel();

    // 2) mensajes en foreground (con guard interno __onMessageHooked si lo usás)
    listenForInAppMessages();

    // 3) permisos + token (adentro ya usa obtenerYGuardarToken y dedupe)
    await gestionarPermisoNotificaciones();

    // 4) limpieza de tokens en Firestore si hubiera más de uno
    await ensureSingleToken();
  } catch (e) {
    console.warn('[notifs] initNotificationsOnce error:', e);
  }
}






