// app.js — PWA del Cliente (instalación, notifs foreground + badge local, INBOX destacar/borrar + opt-in persistente)
import { setupFirebase, checkMessagingSupport, auth, db } from './modules/firebase.js';
import * as UI from './modules/ui.js';
import * as Data from './modules/data.js';
import * as Auth from './modules/auth.js';

// Notificaciones (único import desde notifications.js)
import {
  initNotificationsOnce,
  handlePermissionRequest,
  dismissPermissionRequest,
  handlePermissionSwitch,
  handleBellClick,
  handleSignOutCleanup
} from './modules/notifications.js';

// === DEBUG / OBS ===
window.__RAMPET_DEBUG = true;
window.__BUILD_ID = 'pwa-2025-09-07-3'; // bump
function d(tag, ...args){ if (window.__RAMPET_DEBUG) console.log(`[DBG][${window.__BUILD_ID}] ${tag}`, ...args); }

window.__reportState = async (where='')=>{
  const notifPerm = (window.Notification?.permission)||'n/a';
  let swReady = false;
  try { swReady = !!(await navigator.serviceWorker?.getRegistration?.('/')); } catch {}
  const fcm = localStorage.getItem('fcmToken') ? 'present' : 'missing';
  let geo = 'n/a';
  try { if (navigator.permissions?.query) geo = (await navigator.permissions.query({name:'geolocation'})).state; } catch {}
  d(`STATE@${where}`, { notifPerm, swReady, fcm, geo });
};

// 🔥 CAMBIO — helper rápido de toast
function showToast(msg, type='info', ms=4000){
  const c = document.getElementById('toast-container');
  if (!c) { alert(msg); return; }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(()=> el.remove(), ms);
}

// ──────────────────────────────────────────────────────────────
// FCM (foreground): asegurar token + handlers
// ──────────────────────────────────────────────────────────────
const VAPID_PUBLIC = (window.__RAMPET__ && window.__RAMPET__.VAPID_PUBLIC) || '';

async function ensureMessagingCompatLoaded() {
  if (typeof firebase?.messaging === 'function') return;
  await new Promise((ok, err) => {
    const s = document.createElement('script');
    s.src = 'https://www.gstatic.com/firebasejs/9.6.0/firebase-messaging-compat.js';
    s.onload = ok; s.onerror = err;
    document.head.appendChild(s);
  });
}

async function registerFcmSW() {
  if (!('serviceWorker' in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    console.log('✅ SW FCM registrado:', reg.scope || (location.origin + '/'));
    return true;
  } catch (e) {
    console.warn('[FCM] No se pudo registrar SW:', e?.message || e);
    return false;
  }
}

async function resolveClienteRefByAuthUID() {
  const u = auth.currentUser;
  if (!u) return null;
  const qs = await db.collection('clientes').where('authUID','==', u.uid).limit(1).get();
  if (qs.empty) return null;
  return qs.docs[0].ref;
}

async function guardarTokenEnMiDoc(token) {
  const ref = await resolveClienteRefByAuthUID();
  if (!ref) throw new Error('No encontré tu doc en clientes (authUID).');
  await ref.set({ fcmTokens: [token] }, { merge: true }); // reemplazo total
  try { localStorage.setItem('fcmToken', token); } catch {}
  console.log('✅ Token FCM guardado en', ref.path);
}

/** Foreground: notificación del sistema aunque la PWA esté abierta */
async function showForegroundNotification(data) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;

    const opts = {
      body: data.body || '',
      icon: data.icon || 'https://rampet.vercel.app/images/mi_logo_192.png',
      data: { id: data.id, url: data.url || '/?inbox=1' }
    };
    if (data.tag) { opts.tag = data.tag; opts.renotify = true; }
    if (data.badge) opts.badge = data.badge;

    await reg.showNotification(data.title || 'RAMPET', opts);
  } catch (e) {
    console.warn('[FCM] showForegroundNotification error:', e?.message || e);
  }
}

/** Badge campanita — solo local (suma al llegar, se limpia al abrir INBOX) */
function ensureBellBlinkStyle(){
  if (document.getElementById('__bell_blink_css__')) return;
  const css = `
    @keyframes rampet-blink { 0%,100%{opacity:1} 50%{opacity:.3} }
    #btn-notifs.blink { animation: rampet-blink 1s linear infinite; }
  `;
  const style = document.createElement('style');
  style.id = '__bell_blink_css__';
  style.textContent = css;
  document.head.appendChild(style);
}
function getBadgeCount(){ const n = Number(localStorage.getItem('notifBadgeCount')||'0'); return Number.isFinite(n)? n : 0; }
function setBadgeCount(n){
  ensureBellBlinkStyle();
  try { localStorage.setItem('notifBadgeCount', String(Math.max(0, n|0))); } catch {}
  const badge = document.getElementById('notif-counter');
  const bell  = document.getElementById('btn-notifs');
  if (!badge || !bell) return;
  if (n > 0) {
    badge.textContent = String(n);
    badge.style.display = 'inline-block';
    bell.classList.add('blink');
  } else {
    badge.style.display = 'none';
    bell.classList.remove('blink');
  }
}
function bumpBadge(){ setBadgeCount(getBadgeCount() + 1); }
function resetBadge(){ setBadgeCount(0); }

/** onMessage foreground → notificación + badge + refrescar inbox si visible */
async function registerForegroundFCMHandlers() {
  await ensureMessagingCompatLoaded();
  const messaging = firebase.messaging();

  messaging.onMessage(async (payload) => {
    const d = (()=>{
      const dd = payload?.data || {};
      const id  = dd.id ? String(dd.id) : undefined;
      const tag = dd.tag ? String(dd.tag) : (id ? `push-${id}` : undefined);
      return {
        id,
        title: String(dd.title || dd.titulo || 'RAMPET'),
        body:  String(dd.body  || dd.cuerpo || ''),
        icon:  String(dd.icon  || 'https://rampet.vercel.app/images/mi_logo_192.png'),
        badge: dd.badge ? String(dd.badge) : undefined,
        url:   String(dd.url   || dd.click_action || '/?inbox=1'),
        tag
      };
    })();

    await showForegroundNotification(d);
    bumpBadge();

    try {
      const modal = document.getElementById('inbox-modal');
      if (modal && modal.style.display === 'flex') {
        await fetchInboxBatchUnified?.();
      }
    } catch {}
  });

  // Canal SW → APP
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', async (ev) => {
      const t = ev?.data?.type;
      if (t === 'PUSH_DELIVERED') {
        bumpBadge();
      } else if (t === 'OPEN_INBOX') {
        await openInboxModal();
      }
    });
  }
}

/** Garantiza token si perm=granted (no fuerza prompt aquí) */
async function initFCMForRampet() {
  if (!VAPID_PUBLIC) {
    console.warn('[FCM] Falta window.__RAMPET__.VAPID_PUBLIC en index.html');
    return;
  }
  await registerFcmSW();
  await ensureMessagingCompatLoaded();

  if ((Notification?.permission || 'default') !== 'granted') {
    d('FCM@skip', 'perm ≠ granted (no se solicita aquí)');
    return;
  }

  try {
    try { await firebase.messaging().deleteToken(); } catch {}
    const tok = await firebase.messaging().getToken({ vapidKey: VAPID_PUBLIC });
    if (tok) {
      await guardarTokenEnMiDoc(tok);
      console.log('[FCM] token actual:', tok);
    } else {
      console.warn('[FCM] getToken devolvió vacío.');
    }
  } catch (e) {
    console.warn('[FCM] init error:', e?.message || e);
  }

  await registerForegroundFCMHandlers();
}

// ... (sin cambios hasta setupMainAppScreenListeners)

// ──────────────────────────────────────────────────────────────
// LISTENERS de app principal
// ──────────────────────────────────────────────────────────────
function setupMainAppScreenListeners() {
  // Logout igual...

  // 🔥 CAMBIO — flujo completo de cambiar clave
  on('change-password-btn', 'click', () => {
    const m = document.getElementById('password-modal');
    if (m) m.style.display = 'flex';
  });
  on('close-password-modal', 'click', () => {
    const m = document.getElementById('password-modal');
    if (m) m.style.display = 'none';
  });
  on('save-new-password-btn', 'click', async () => {
    const input = document.getElementById('new-password-input');
    const newPass = input?.value?.trim() || '';
    if (newPass.length < 6) {
      showToast('La clave debe tener al menos 6 caracteres', 'error');
      return;
    }
    try {
      await auth.currentUser.updatePassword(newPass);
      showToast('✅ Clave actualizada con éxito', 'success');
      const m = document.getElementById('password-modal');
      if (m) m.style.display = 'none';
      input.value = '';
    } catch (e) {
      console.warn('changePassword error:', e);
      showToast('❌ Error al actualizar la clave', 'error');
    }
  });

  // 🔥 CAMBIO — notifs botón "Luego"
  on('btn-rechazar-notif-prompt', 'click', async () => {
    try { await Data.saveNotifDismiss(); } catch {}
    try { await dismissPermissionRequest(); } catch {}
    try { await window.__reportState?.('notif-dismiss'); } catch {}
  });

  // resto igual...
}

// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────
async function main() {
  setupFirebase();
  const messagingSupported = await checkMessagingSupport();

  auth.onAuthStateChanged(async (user) => {
    // ... igual hasta GEO inicio

    // GEO inicio (si existe en este bundle)
    try { await window.ensureGeoOnStartup?.(); } catch {}

    // 🔥 CAMBIO — si pospuso, mostrar banner chico en próxima sesión
    const geoState = localStorage.getItem('geoState');
    if (geoState === 'deferred') {
      try { await window.maybeRefreshIfStale?.(); } catch {}
    }

    // ... resto igual
  });
}

document.addEventListener('DOMContentLoaded', main);
