// /modules/notifications.js — FCM + VAPID + token + UX de opt-in persistente (cards de marketing)
'use strict';

// Requisitos: Firebase compat (app/auth/firestore/messaging) ya cargados.
// SW: /firebase-messaging-sw.js
// VAPID pública: window.__RAMPET__.VAPID_PUBLIC

const VAPID_PUBLIC = (window.__RAMPET__ && window.__RAMPET__.VAPID_PUBLIC) || '';
if (!VAPID_PUBLIC) console.warn('[FCM] Falta window.__RAMPET__.VAPID_PUBLIC en index.html');

// ───────────────── Helpers ─────────────────
function $(id) { return document.getElementById(id); }

async function ensureMessagingCompatLoaded() {
  if (typeof firebase?.messaging === 'function') return;
  await new Promise((ok, err) => {
    const s = document.createElement('script');
    s.src = 'https://www.gstatic.com/firebasejs/9.6.0/firebase-messaging-compat.js';
    s.onload = ok; s.onerror = err;
    document.head.appendChild(s);
  });
}

async function registerSW() {
  if (!('serviceWorker' in navigator)) return false;
  try {
    const existing = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
    if (existing) { console.log('✅ SW FCM ya registrado:', existing.scope); return true; }
    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    console.log('✅ SW FCM registrado:', reg.scope || (location.origin + '/'));
    return true;
  } catch (e) {
    console.warn('[FCM] No se pudo registrar SW:', e?.message || e);
    return false;
  }
}

async function getClienteDocIdPorUID(uid) {
  const snap = await firebase.firestore()
    .collection('clientes')
    .where('authUID', '==', uid)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].id;
}

async function setFcmTokensOnCliente(tokensArray) {
  const uid = firebase.auth().currentUser?.uid;
  if (!uid) throw new Error('No hay usuario logueado.');
  const clienteId = await getClienteDocIdPorUID(uid);
  if (!clienteId) throw new Error('No encontré tu doc en clientes (authUID).');
  await firebase.firestore().collection('clientes').doc(clienteId)
    .set({ fcmTokens: tokensArray }, { merge: true });
  return clienteId;
}

async function guardarTokenEnMiDoc(token) {
  const clienteId = await setFcmTokensOnCliente([token]); // reemplazo total
  try { localStorage.setItem('fcmToken', token); } catch {}
  console.log('✅ Token FCM guardado en clientes/' + clienteId);
}

async function borrarTokenYOptOut() {
  try {
    await ensureMessagingCompatLoaded();
    try { await firebase.messaging().deleteToken(); } catch {}
    await setFcmTokensOnCliente([]); // deja vacío en Firestore
    try { localStorage.removeItem('fcmToken'); } catch {}
    console.log('🗑️ Token FCM eliminado y tokens vaciados en cliente.');
  } catch (e) {
    console.warn('[FCM] borrarTokenYOptOut error:', e?.message || e);
  }
}

async function obtenerYGuardarToken() {
  await ensureMessagingCompatLoaded();
  // Limpieza suave
  try { await firebase.messaging().deleteToken(); } catch {}
  const tok = await firebase.messaging().getToken({ vapidKey: VAPID_PUBLIC });
  if (!tok) throw new Error('getToken devolvió vacío.');
  await guardarTokenEnMiDoc(tok);
  return tok;
}

// ───────────────── UI (cards y switch) ─────────────────
function setDisplay(el, show) { if (el) el.style.display = show ? 'block' : 'none'; }

function refreshNotifUIFromPermission() {
  const perm = (window.Notification?.permission) || 'default';
  const promptCard  = $('notif-prompt-card');         // marketing para pedir opt-in
  const switchCard  = $('notif-card');                // tarjeta con switch
  const blockedWarn = $('notif-blocked-warning');     // advertencia de bloqueado
  const switchEl    = $('notif-switch');

  // Mostrar/ocultar según permiso actual
  if (perm === 'default') {
    setDisplay(promptCard, !localStorage.getItem('notifPermDismissed'));
    setDisplay(switchCard, false);
    setDisplay(blockedWarn, false);
  } else if (perm === 'granted') {
    setDisplay(promptCard, false);
    setDisplay(switchCard, true);
    setDisplay(blockedWarn, false);
    if (switchEl) switchEl.checked = true; // habilitado en el navegador
  } else { // 'denied'
    setDisplay(promptCard, false);
    setDisplay(switchCard, false);
    setDisplay(blockedWarn, true);
    if (switchEl) switchEl.checked = false;
  }
}

// Lado marketing: cuando llega nueva info de cliente/config, podrías decidir mostrar/ocultar banners
document.addEventListener('rampet:config-updated', () => {
  // Por ahora, UI depende principalmente de Notification.permission + localStorage dismiss.
  refreshNotifUIFromPermission();
});

// ───────────────── Eventos de consentimiento (para que data.js persista) ─────────────────
function dispatchConsent(eventName, detail = {}) {
  try { document.dispatchEvent(new CustomEvent(eventName, { detail })); } catch {}
}

// ───────────────── API pública (usada por app.js) ─────────────────
export async function initNotificationsOnce() {
  await registerSW();

  // No registramos onMessage aquí para evitar duplicar handlers con app.js.
  // app.js ya maneja onMessage (badge, refresh inbox, showNotification foreground si aplica).

  const perm = ('Notification' in window) ? Notification.permission : 'unsupported';

  if (perm === 'granted') {
    try {
      await ensureMessagingCompatLoaded();
      const tok = await firebase.messaging().getToken({ vapidKey: VAPID_PUBLIC });
      if (tok) {
        await guardarTokenEnMiDoc(tok);
        dispatchConsent('rampet:consent:notif-opt-in', { source: 'init' });
      } else {
        // No había token a pesar de permiso concedido: intentar obtenerlo
        const newTok = await obtenerYGuardarToken();
        if (newTok) dispatchConsent('rampet:consent:notif-opt-in', { source: 'init-mint' });
      }
    } catch (e) {
      console.warn('[notifications] init/granted error:', e?.message || e);
    }
  }

  refreshNotifUIFromPermission();
  return true;
}

export async function handlePermissionRequest() {
  try {
    if (!('Notification' in window)) return;

    // Evitar re-preguntar si ya está concedido o denegado
    const current = Notification.permission;
    if (current === 'granted') {
      // Asegurar token y UI
      try {
        await ensureMessagingCompatLoaded();
        const tok = await firebase.messaging().getToken({ vapidKey: VAPID_PUBLIC });
        if (tok) await guardarTokenEnMiDoc(tok);
      } catch (e) { console.warn('[notifications] granted/getToken error:', e?.message || e); }
      refreshNotifUIFromPermission();
      dispatchConsent('rampet:consent:notif-opt-in', { source: 'already-granted' });
      return;
    }
    if (current === 'denied') {
      // No podemos abrir el prompt: mostrar aviso
      refreshNotifUIFromPermission();
      dispatchConsent('rampet:consent:notif-opt-out', { source: 'blocked' });
      return;
    }

    // current === 'default' → pedir permiso
    const status = await Notification.requestPermission();
    if (status === 'granted') {
      await obtenerYGuardarToken();
      refreshNotifUIFromPermission();
      dispatchConsent('rampet:consent:notif-opt-in', { source: 'prompt' });
    } else if (status === 'denied') {
      refreshNotifUIFromPermission();
      dispatchConsent('rampet:consent:notif-opt-out', { source: 'prompt-denied' });
    } else {
      // 'default' → el usuario cerró el prompt sin respuesta
      try { localStorage.setItem('notifPermDismissed', 'true'); } catch {}
      refreshNotifUIFromPermission();
      dispatchConsent('rampet:consent:notif-dismissed', { source: 'prompt-dismissed' });
    }
  } catch (e) {
    console.warn('[notifications] handlePermissionRequest error:', e?.message || e);
  }
}

export function dismissPermissionRequest() {
  try { localStorage.setItem('notifPermDismissed', 'true'); } catch {}
  const el = $('notif-prompt-card');
  if (el) el.style.display = 'none';
  dispatchConsent('rampet:consent:notif-dismissed', { source: 'ui-dismiss' });
}

export async function handlePermissionSwitch(e) {
  const checked = !!e?.target?.checked;
  const perm = (window.Notification?.permission) || 'default';
  if (!('Notification' in window)) return;

  if (checked) {
    if (perm === 'granted') {
      try {
        await ensureMessagingCompatLoaded();
        const tok = await firebase.messaging().getToken({ vapidKey: VAPID_PUBLIC });
        if (tok) await guardarTokenEnMiDoc(tok);
        dispatchConsent('rampet:consent:notif-opt-in', { source: 'switch-on' });
      } catch (err) {
        console.warn('[notifications] switch-on getToken error:', err?.message || err);
      }
    } else if (perm === 'default') {
      // Intentar solicitar permiso
      await handlePermissionRequest();
      // El UI se refresca dentro de handlePermissionRequest
    } else { // 'denied'
      // No se puede activar desde la app; mostrar banner de bloqueado
      refreshNotifUIFromPermission();
      if ($('notif-switch')) $('notif-switch').checked = false;
      dispatchConsent('rampet:consent:notif-opt-out', { source: 'blocked-switch' });
    }
  } else {
    // Usuario desactiva desde el switch → borrar token y registrar opt-out app-level
    await borrarTokenYOptOut();
    refreshNotifUIFromPermission();
    dispatchConsent('rampet:consent:notif-opt-out', { source: 'switch-off' });
  }
}

export function handleBellClick() {
  // Hook para cuando abre el INBOX desde la campana; nada que hacer aquí por ahora.
  return Promise.resolve();
}

export async function handleSignOutCleanup() {
  try { localStorage.removeItem('fcmToken'); } catch {}
  // No borramos tokens en servidor aquí (depende de tu flujo de server).
  console.debug('[notifications] handleSignOutCleanup → fcmToken (local) limpiado');
}

// Compat: llamado desde data.js tras obtener datos del cliente.
// Dejamos que la UI se mantenga coherente (no fuerza prompts).
export async function gestionarPermisoNotificaciones() {
  try { refreshNotifUIFromPermission(); }
  catch (e) { console.warn('[notifications] gestionarPermisoNotificaciones error:', e?.message || e); }
}
