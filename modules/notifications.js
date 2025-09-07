// pwa/modules/notifications.js
// Orquesta: permisos/UI, token único, canal SW→APP, onMessage, Inbox

import { auth, db, messaging, firebase, isMessagingSupported } from './firebase.js';
import * as UI from './ui.js';

// —— Heurística de contexto efímero (incógnito/invitado) —— //
async function isEphemeralContext() {
  try {
    if (!navigator.storage?.estimate) return false;
    const { quota } = await navigator.storage.estimate();
    return !!quota && quota < 160 * 1024 * 1024; // ~160MB umbral
  } catch { return false; }
}

// —— Estado único (evita duplicados) —— //
const NOTIFS = (window.__RAMPET_NOTIFS ||= {
  onMsg: false,
  swChan: false,
  initUid: null,
  inFlight: null,
  lastToken: localStorage.getItem('fcmToken') || null,
});
const TOKEN_LS_KEY = 'fcmToken';

// —— Helpers UI centralizados —— //
function setNotifUI({ prompt=false, card=false, blocked=false, switchChecked=false, incognito=false } = {}) {
  const promptCard = document.getElementById('notif-prompt-card');
  const switchCard = document.getElementById('notif-card');
  const blockedWarning = document.getElementById('notif-blocked-warning');
  const incogWarn = document.getElementById('notif-incognito-warning');

  if (promptCard) promptCard.style.display = prompt ? 'block' : 'none';
  if (switchCard) switchCard.style.display = card ? 'block' : 'none';
  if (blockedWarning) blockedWarning.style.display = blocked ? 'block' : 'none';
  if (incogWarn) incogWarn.style.display = incognito ? 'block' : 'none';

  const sw = document.getElementById('notif-switch');
  if (sw) sw.checked = !!switchChecked;
}

// —— Firestore utils —— //
async function getClienteDocRef() {
  try {
    const u = auth.currentUser;
    if (!u) return null;
    const q = await db.collection('clientes').where('authUID', '==', u.uid).limit(1).get();
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

// —— Campanita: badge simple —— //
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

// —— Token único (dedupe) —— //
async function saveSingleTokenForUser(token) {
  const u = auth.currentUser;
  if (!u || !token) return;
  const qs = await db.collection('clientes').where('authUID', '==', u.uid).limit(1).get();
  if (qs.empty) return;
  await qs.docs[0].ref.set({ fcmTokens: [token] }, { merge: true });
  localStorage.setItem(TOKEN_LS_KEY, token);
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

// —— Permisos + token (UI coherente) —— //
export async function gestionarPermisoNotificaciones() {
  if (!isMessagingSupported || !auth.currentUser || !messaging) return;

  const ephemeral = await isEphemeralContext(); // sólo avisamos; no forzamos UI equivocada
  const perm = Notification?.permission || 'default';
  const popUpYaGestionado = localStorage.getItem(`notifGestionado_${auth.currentUser.uid}`);

  // Aviso de incógnito/invitado (si existe el elemento)
  setNotifUI({ incognito: ephemeral });

  if (perm === 'granted') {
    // Permiso OK → ocultar todas las tarjetas y asegurar token
    setNotifUI({ prompt:false, card:false, blocked:false, switchChecked:true });
    obtenerYGuardarToken().then(() => ensureSingleToken());
    return;
  }

  if (perm === 'denied') {
    // Bloqueado a nivel navegador → mostrar aviso
    setNotifUI({ prompt:false, card:false, blocked:true, switchChecked:false });
    return;
  }

  // perm === 'default' (prompt)
  if (!popUpYaGestionado) {
    // Mostrar la tarjeta de “¿Activar notificaciones?”
    setNotifUI({ prompt:true, card:false, blocked:false, switchChecked:false });
  } else {
    // Ya gestionado → mostrar switch para reintentar manualmente
    setNotifUI({ prompt:false, card:true, blocked:false, switchChecked:false });
  }
}

async function obtenerYGuardarToken() {
  if (!isMessagingSupported || !auth.currentUser || !messaging) return null;
  if (NOTIFS.inFlight) return NOTIFS.inFlight;

  NOTIFS.inFlight = (async () => {
    try {
      // Asegura un SW válido para getToken
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
      // Si el navegador bloquea, mostramos warning (si existe)
      const warn = document.getElementById('notif-blocked-warning');
      if (warn && (err?.code === 'messaging/permission-blocked' || err?.code === 'messaging/permission-default')) {
        warn.style.display = 'block';
      }
      return null;
    } finally {
      NOTIFS.inFlight = null;
    }
  })();

  return NOTIFS.inFlight;
}

// — Pedir permiso desde la tarjeta —
export function handlePermissionRequest() {
  localStorage.setItem(`notifGestionado_${auth.currentUser?.uid}`, 'true');
  setNotifUI({ prompt:false }); // ocultar prompt mientras se pide

  Notification.requestPermission().then(async (p) => {
    if (p === 'granted') {
      UI.showToast('¡Notificaciones activadas!', 'success');
      setNotifUI({ card:false, blocked:false, switchChecked:true });
      await obtenerYGuardarToken();
      await ensureSingleToken();
    } else if (p === 'denied') {
      setNotifUI({ prompt:false, card:false, blocked:true, switchChecked:false });
    } else {
      // default otra vez → mostrar switch para reintentar manual
      setNotifUI({ prompt:false, card:true, blocked:false, switchChecked:false });
    }
  });
}

export function dismissPermissionRequest() {
  localStorage.setItem(`notifGestionado_${auth.currentUser?.uid}`, 'true');
  setNotifUI({ prompt:false, card:true, blocked:false, switchChecked:false });
}

export function handlePermissionSwitch(e) {
  if (!e?.target) return;
  if (e.target.checked) {
    Notification.requestPermission().then(async (p) => {
      if (p === 'granted') {
        UI.showToast('¡Notificaciones activadas!', 'success');
        setNotifUI({ card:false, blocked:false, switchChecked:true });
        await obtenerYGuardarToken();
        await ensureSingleToken();
      } else if (p === 'denied') {
        e.target.checked = false;
        setNotifUI({ card:false, blocked:true, switchChecked:false });
      } else {
        e.target.checked = false;
        setNotifUI({ card:true, blocked:false, switchChecked:false });
      }
    });
  }
}

// —— Foreground (app visible) —— //
export function listenForInAppMessages() {
  if (!messaging) return;
  if (NOTIFS.onMsg) return;
  NOTIFS.onMsg = true;

  messaging.onMessage(async (payload) => {
    const data = payload?.data || {};
    console.log('[FG] onMessage', data);
    if (data.id) await markDeliveredInInbox(data.id);
    const title = data.title || 'Mensaje';
    const body  = data.body  || '';
    UI.showToast(`📢 ${title}: ${body}`, 'info', 10000);
  });
}

// —— Canal BG (SW→APP) —— //
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
  if (NOTIFS.swChan) return;
  navigator.serviceWorker.addEventListener('message', swMessageHandler);
  NOTIFS.swChan = true;
  console.log('[INIT] SW message channel listo');
}

// —— Inbox helpers —— //
export async function markAllDeliveredAsRead() {
  const ref = await getClienteDocRef();
  if (!ref) return;
  try {
    const q = await ref.collection('inbox').where('status', 'in', ['sent', 'delivered']).get();
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

async function getClienteDocRefSafe() {
  try {
    if (!auth.currentUser) return null;
    const q = await db.collection('clientes').where('authUID', '==', auth.currentUser.uid).limit(1).get();
    if (q.empty) return null;
    return q.docs[0].ref;
  } catch { return null; }
}

async function fetchInboxDocs(limit = 50) {
  const ref = await getClienteDocRefSafe();
  if (!ref) return [];
  const snap = await ref.collection('inbox').orderBy('sentAt', 'desc').limit(limit).get();
  const now = Date.now();
  const items = [];
  snap.forEach(doc => {
    const d = doc.data() || {};
    const notExpired = !d.expireAt ||
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
    const sentAt = (() => {
      try {
        const d = it.sentAt?.toDate ? it.sentAt.toDate() : (typeof it.sentAt === 'string' ? new Date(it.sentAt) : it.sentAt);
        return d ? d.toLocaleString() : '';
      } catch { return ''; }
    })();
    const url = it.url || it.click_action || '';
    const tag = it.tag ? `<span style="font-size:12px;color:#777;"> • ${it.tag}</span>` : '';
    const pill =
      status === 'read' ? '<span style="font-size:12px;padding:2px 8px;border-radius:999px;background:#e5f5e5;color:#1a7f37;">leído</span>' :
      status === 'delivered' ? '<span style="font-size:12px;padding:2px 8px;border-radius:999px;background:#fff3cd;color:#b58100;">nuevo</span>' :
      '<span style="font-size:12px;padding:2px 8px;border-radius:999px;background:#ffe8e8;color:#b00020;">pendiente</span>';

    const link = url ? `<a href="#" class="inbox-item-link" data-url="${encodeURIComponent(url)}" style="text-decoration:underline;">Ver</a>` : '';

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
      const modal = document.getElementById('inbox-modal');
      if (modal) modal.style.display = 'none';
      if (!url || url === '/notificaciones') return;
      const target = url.startsWith('/') ? `/${url.replace(/^\//,'')}` : `/${url}`;
      window.location.href = `/?open=${encodeURIComponent(target)}`;
    });
  });
}

function openInboxModal() { const m = document.getElementById('inbox-modal'); if (m) m.style.display = 'flex'; }
function closeInboxModal(){ const m = document.getElementById('inbox-modal'); if (m) m.style.display = 'none'; }

let _inboxTab = 'todos';
function setActiveTabUI(tab) {
  ['todos','promos','puntos','otros'].forEach(t => {
    const btn = document.getElementById(`inbox-tab-${t}`);
    if (!btn) return;
    const isActive = (t === tab);
    btn.classList.toggle('primary-btn', isActive);
    btn.classList.toggle('secondary-btn', !isActive);
  });
}

async function renderInboxByTab(tab = 'todos') {
  _inboxTab = tab;
  setActiveTabUI(tab);
  const items = await fetchInboxDocs(50);
  const filtered = (tab === 'todos') ? items : items.filter(it => bucketOf(it) === tab);
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

  [
    { id: 'inbox-tab-todos',  tab: 'todos'  },
    { id: 'inbox-tab-promos', tab: 'promos' },
    { id: 'inbox-tab-puntos', tab: 'puntos' },
    { id: 'inbox-tab-otros',  tab: 'otros'  },
  ].forEach(({id, tab}) => {
    const el = document.getElementById(id);
    if (el) el.onclick = () => renderInboxByTab(tab);
  });
}

// —— Init una sola vez por usuario —— //
export async function initNotificationsOnce() {
  const u = auth.currentUser;
  if (!u || !isMessagingSupported || !messaging) return;
  if (NOTIFS.initUid === u.uid) return;

  NOTIFS.initUid = u.uid;
  initNotificationChannel();
  listenForInAppMessages();
  await gestionarPermisoNotificaciones(); // UI + token si aplica
  await ensureSingleToken();              // dedupe post-init
}
