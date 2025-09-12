// app.js (PWA del Cliente)
import { setupFirebase, checkMessagingSupport, auth, db } from './modules/firebase.js';
import * as UI from './modules/ui.js';
import * as Data from './modules/data.js';
import * as Auth from './modules/auth.js';

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
window.__BUILD_ID = 'pwa-2025-09-06-2';
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

// ───────────────── Campanita: parpadeo + contador ─────────────────
function setBellAttention(on, count = null) {
  const bell = document.getElementById('btn-notifs');
  const badge = document.getElementById('notif-counter');
  if (!bell) return;

  bell.classList.toggle('blink', !!on);

  if (badge) {
    if (count == null) {
      badge.style.display = on ? 'inline-block' : 'none';
      if (on) badge.textContent = '•';
    } else {
      badge.style.display = count > 0 ? 'inline-block' : 'none';
      badge.textContent = String(count);
    }
  }
}

// ───────────────── FCM (garantía local) ─────────────────
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
    const existing = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
    if (existing) {
      console.log('✅ SW FCM ya registrado:', existing.scope);
      return true;
    }
    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    console.log('✅ SW FCM registrado:', reg.scope || location.origin + '/');
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
  await ref.set({ fcmTokens: [token] }, { merge: true });
  localStorage.setItem('fcmToken', token);
  console.log('✅ Token FCM guardado en', ref.path);
}

/** Garantiza token si ya hay permiso (no fuerza prompt). */
async function initFCMForRampet() {
  if (!VAPID_PUBLIC) {
    console.warn('[FCM] Falta window.__RAMPET__.VAPID_PUBLIC en index.html');
    return;
  }
  await registerFcmSW();
  await ensureMessagingCompatLoaded();

  const perm = Notification?.permission || 'default';
  if (perm !== 'granted') {
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

  // SW→APP
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', async (ev) => {
      const t = ev?.data?.type;
      const d = ev?.data?.data || {};
      if (t === 'PUSH_READ') {
        await markInboxReadById(d.id);
        try { await fetchInboxBatchUnified?.(); } catch {}
        try { localStorage.setItem('inboxUnreads', '0'); } catch {}
        setBellAttention(false, 0);
      }
      if (t === 'PUSH_DELIVERED') {
        try {
          const cur = Number(localStorage.getItem('inboxUnreads') || '0') + 1;
          localStorage.setItem('inboxUnreads', String(cur));
          setBellAttention(true, cur);
        } catch {
          setBellAttention(true);
        }
      }
    });

    // Foreground (reenviado vía window.postMessage por notifications.js)
    window.addEventListener('message', (ev) => {
      if (ev?.data?.type === 'PUSH_DELIVERED') {
        try {
          const cur = Number(localStorage.getItem('inboxUnreads') || '0') + 1;
          localStorage.setItem('inboxUnreads', String(cur));
          setBellAttention(true, cur);
        } catch {
          setBellAttention(true);
        }
      }
    });
  }
}

// ==== marcar leído cuando se hace click en la notificación ====
async function markInboxReadById(notifId) {
  if (!notifId) return;
  try {
    const clienteRef = await resolveClienteRef(); // declarada más abajo
    if (!clienteRef) return;
    await clienteRef.collection('inbox').doc(String(notifId))
      .set({ status: 'read', readAt: new Date().toISOString() }, { merge: true });
  } catch (e) {
    console.warn('[INBOX] marcar leído error:', e?.message || e);
  }
}

// ───────────────── Instalación PWA (igual que tu versión) ─────────────────
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  console.log('✅ Evento "beforeinstallprompt" capturado. La app es instalable.');
});

window.addEventListener('appinstalled', async () => {
  console.log('✅ App instalada');
  localStorage.removeItem('installDismissed');
  deferredInstallPrompt = null;
  document.getElementById('install-prompt-card')?.style?.setProperty('display','none');
  document.getElementById('install-entrypoint')?.style?.setProperty('display','none');
  document.getElementById('install-help-modal')?.style?.setProperty('display','none');
  localStorage.setItem('pwaInstalled', 'true');

  const u = auth.currentUser;
  if (!u) return;
  try {
    const snap = await db.collection('clientes').where('authUID', '==', u.uid).limit(1).get();
    if (snap.empty) return;
    const ref = snap.docs[0].ref;

    const ua = navigator.userAgent || '';
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isAndroid = /Android/i.test(ua);
    const platform = isIOS ? 'iOS' : isAndroid ? 'Android' : 'Desktop';

    await ref.set({
      pwaInstalled: true,
      pwaInstalledAt: new Date().toISOString(),
      pwaInstallPlatform: platform
    }, { merge: true
