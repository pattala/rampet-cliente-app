// /modules/notifications.js — FCM + VAPID + UX opt-in (cards) + Geolocalización (banner)
// Requisitos: Firebase compat (app/auth/firestore/messaging) ya cargados.
// SW: /firebase-messaging-sw.js
// VAPID pública: window.__RAMPET__.VAPID_PUBLIC

'use strict';

const VAPID_PUBLIC = (window.__RAMPET__ && window.__RAMPET__.VAPID_PUBLIC) || '';
if (!VAPID_PUBLIC) console.warn('[FCM] Falta window.__RAMPET__.VAPID_PUBLIC en index.html');

function $(id){ return document.getElementById(id); }
function setDisplay(el, show){ if (el) el.style.display = show ? 'block' : 'none'; }

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
    await setFcmTokensOnCliente([]); // vacío en Firestore
    try { localStorage.removeItem('fcmToken'); } catch {}
    console.log('🗑️ Token FCM eliminado y tokens vaciados en cliente.');
  } catch (e) {
    console.warn('[FCM] borrarTokenYOptOut error:', e?.message || e);
  }
}
async function obtenerYGuardarToken() {
  await ensureMessagingCompatLoaded();
  try { await firebase.messaging().deleteToken(); } catch {}
  const tok = await firebase.messaging().getToken({ vapidKey: VAPID_PUBLIC });
  if (!tok) throw new Error('getToken devolvió vacío.');
  await guardarTokenEnMiDoc(tok);
  return tok;
}

// ───────────────────────────── Notificaciones: UI de opt-in ─────────────────────────────
function refreshNotifUIFromPermission() {
  const perm = (window.Notification?.permission) || 'default';
  const promptCard  = $('notif-prompt-card');     // marketing para pedir opt-in
  const switchCard  = $('notif-card');            // tarjeta con el deslizante
  const blockedWarn = $('notif-blocked-warning'); // advertencia si está bloqueado
  const switchEl    = $('notif-switch');

  if (perm === 'default') {
    // Solo aquí mostramos el switch (permiso NO aceptado todavía)
    const dismissed = !!localStorage.getItem('notifPermDismissed');
    setDisplay(promptCard, !dismissed);
    setDisplay(switchCard, true);
    setDisplay(blockedWarn, false);
    if (switchEl) switchEl.checked = false;
  } else if (perm === 'granted') {
    // Ya aceptó → no mostramos el switch ni el prompt
    setDisplay(promptCard, false);
    setDisplay(switchCard, false);
    setDisplay(blockedWarn, false);
  } else { // 'denied'
    // Bloqueado → solo warning
    setDisplay(promptCard, false);
    setDisplay(switchCard, false);
    setDisplay(blockedWarn, true);
    if (switchEl) switchEl.checked = false;
  }
}

function dispatchConsent(eventName, detail = {}) {
  try { document.dispatchEvent(new CustomEvent(eventName, { detail })); } catch {}
}

// ───────────────────────────── Geolocalización: banner + controles ──────────────────────
function refreshGeoBannerUI(state) {
  // state: 'granted' | 'prompt' | 'denied' | 'unknown'
  const banner   = $('geo-banner');
  const txt      = $('geo-banner-text');
  const btnOn    = $('geo-enable-btn');
  const btnOff   = $('geo-disable-btn');
  const btnHelp  = $('geo-help-btn');

  if (!banner) return;

  const disabledLocal = localStorage.getItem('geoDisabledByUser') === '1';

  if (state === 'granted' && !disabledLocal) {
    setDisplay(banner, true);
    if (txt) txt.textContent = '📍 Ubicación activada para recibir beneficios cercanos.';
    setDisplay(btnOn,  false);
    setDisplay(btnOff, true);
    setDisplay(btnHelp,false);
  } else if (state === 'prompt') {
    setDisplay(banner, true);
    if (txt) txt.textContent = '📍 Activá tu ubicación para ver beneficios cerca tuyo.';
    setDisplay(btnOn,  true);
    setDisplay(btnOff, false);
    setDisplay(btnHelp,false);
  } else if (state === 'denied') {
    setDisplay(banner, true);
    if (txt) txt.textContent = '📍 La ubicación está bloqueada en el navegador. Habilitala desde Configuración.';
    setDisplay(btnOn,  false);
    setDisplay(btnOff, false);
    setDisplay(btnHelp,true);
  } else {
    // unknown o sin API → mostramos invitación básica
    setDisplay(banner, true);
    if (txt) txt.textContent = '📍 Activá tu ubicación para ver beneficios cerca tuyo.';
    setDisplay(btnOn,  true);
    setDisplay(btnOff, false);
    setDisplay(btnHelp,false);
  }
}

async function detectGeoPermission() {
  try {
    if (navigator.permissions?.query) {
      const st = await navigator.permissions.query({ name: 'geolocation' });
      return st.state; // 'granted' | 'prompt' | 'denied'
    }
  } catch {}
  return 'unknown';
}

async function updateGeoUI() {
  const state = await detectGeoPermission();
  refreshGeoBannerUI(state);
}

async function handleGeoEnable() {
  // Dispara el prompt en estado 'prompt' y actualiza UI
  try {
    await new Promise((ok, err) => {
      if (!navigator.geolocation?.getCurrentPosition) return err(new Error('Geolocalización no disponible.'));
      navigator.geolocation.getCurrentPosition(
        () => ok(true),
        () => ok(false), // incluso si falla, igual refrescamos el UI
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 0 }
      );
    });
  } catch {}
  try { localStorage.removeItem('geoDisabledByUser'); } catch {}
  await updateGeoUI();
}

async function handleGeoDisable() {
  // No se puede “revocar” desde JS; respetamos la preferencia de usuario en la app.
  try { localStorage.setItem('geoDisabledByUser', '1'); } catch {}
  await updateGeoUI();
}

function handleGeoHelp() {
  alert('Para habilitar la ubicación: \n\n1) Abrí la configuración del sitio en tu navegador.\n2) Permisos → Ubicación → Permitir.\n3) Volvé a esta página y recargá.');
}

function wireGeoButtonsOnce() {
  const banner = $('geo-banner');
  if (!banner || banner._wired) return;
  banner._wired = true;
  $('geo-enable-btn')?.addEventListener('click', handleGeoEnable);
  $('geo-disable-btn')?.addEventListener('click', handleGeoDisable);
  $('geo-help-btn')?.addEventListener('click', handleGeoHelp);
}

// Expuestos para app.js (ya los venías llamando)
export async function ensureGeoOnStartup() {
  wireGeoButtonsOnce();
  await updateGeoUI();
}
export async function maybeRefreshIfStale() {
  await updateGeoUI();
}

// ───────────────────────────── API pública notificaciones ─────────────────────────────
export async function initNotificationsOnce() {
  await registerSW();

  const perm = ('Notification' in window) ? Notification.permission : 'unsupported';

  if (perm === 'granted') {
    try {
      await ensureMessagingCompatLoaded();
      const tok = await firebase.messaging().getToken({ vapidKey: VAPID_PUBLIC });
      if (tok) {
        await guardarTokenEnMiDoc(tok);
        dispatchConsent('rampet:consent:notif-opt-in', { source: 'init' });
      } else {
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

    const current = Notification.permission;
    if (current === 'granted') {
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
      refreshNotifUIFromPermission();
      dispatchConsent('rampet:consent:notif-opt-out', { source: 'blocked' });
      return;
    }

    // current === 'default'
    const status = await Notification.requestPermission();
    if (status === 'granted') {
      await obtenerYGuardarToken();
      refreshNotifUIFromPermission();
      dispatchConsent('rampet:consent:notif-opt-in', { source: 'prompt' });
    } else if (status === 'denied') {
      refreshNotifUIFromPermission();
      dispatchConsent('rampet:consent:notif-opt-out', { source: 'prompt-denied' });
    } else {
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
      await handlePermissionRequest(); // pedimos permiso; UI se refresca allí
    } else { // 'denied'
      refreshNotifUIFromPermission();
      if ($('notif-switch')) $('notif-switch').checked = false;
      dispatchConsent('rampet:consent:notif-opt-out', { source: 'blocked-switch' });
    }
  } else {
    // Si el usuario apaga el switch, respetamos un “opt-out app-level”
    await borrarTokenYOptOut();
    refreshNotifUIFromPermission();
    dispatchConsent('rampet:consent:notif-opt-out', { source: 'switch-off' });
  }
}

export function handleBellClick() { return Promise.resolve(); }
export async function handleSignOutCleanup() {
  try { localStorage.removeItem('fcmToken'); } catch {}
  console.debug('[notifications] handleSignOutCleanup → fcmToken (local) limpiado');
}

// Compat: llamado desde data.js tras obtener datos del cliente.
export async function gestionarPermisoNotificaciones() {
  try { refreshNotifUIFromPermission(); } catch (e) { console.warn('[notifications] gestionarPermisoNotificaciones error:', e?.message || e); }
}
