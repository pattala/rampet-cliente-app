// /modules/notifications.js — FCM + VAPID + UX opt-in (cards) + Geolocalización (banner)
// Requisitos: Firebase compat (app/auth/firestore/messaging), SW: /firebase-messaging-sw.js
// VAPID pública: window.__RAMPET__.VAPID_PUBLIC

'use strict';

// ─────────────────────────────────────────────────────────────
// CONFIG / HELPERS BÁSICOS
// ─────────────────────────────────────────────────────────────
const VAPID_PUBLIC = (window.__RAMPET__ && window.__RAMPET__.VAPID_PUBLIC) || '';
if (!VAPID_PUBLIC) console.warn('[FCM] Falta window.__RAMPET__.VAPID_PUBLIC en index.html');

function $(id){ return document.getElementById(id); }
function show(el, on){ if (el) el.style.display = on ? 'block' : 'none'; }
function setInline(el, on){ if (el) el.style.display = on ? 'inline-block' : 'none'; }

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
    // si ya está, no duplicar
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
    const messaging = firebase.messaging();
    try { await messaging.deleteToken(); } catch {}
    await setFcmTokensOnCliente([]); // vacío en Firestore
    try { localStorage.removeItem('fcmToken'); } catch {}
    console.log('🔕 Opt-out FCM aplicado (token eliminado y Firestore en blanco).');
  } catch (e) {
    console.warn('[FCM] borrarTokenYOptOut error:', e?.message || e);
  }
}
async function obtenerYGuardarToken() {
  await ensureMessagingCompatLoaded();
  // limpieza suave para evitar tokens viejos
  try { await firebase.messaging().deleteToken(); } catch {}
  const tok = await firebase.messaging().getToken({ vapidKey: VAPID_PUBLIC });
  if (!tok) throw new Error('getToken devolvió vacío.');
  await guardarTokenEnMiDoc(tok);
  return tok;
}

// ─────────────────────────────────────────────────────────────
// NOTIFICACIONES — UI (cards) SEGÚN PERMISOS
// ─────────────────────────────────────────────────────────────
function refreshNotifUIFromPermission() {
  const perm = ('Notification' in window) ? Notification.permission : 'unsupported';

  const cardMarketing = $('notif-prompt-card');     // “¡Activa tus Beneficios!”
  const cardSwitch    = $('notif-card');            // switch on/off
  const warnBlocked   = $('notif-blocked-warning'); // “bloqueaste notificaciones…”
  const switchEl      = $('notif-switch');

  // reset
  show(cardMarketing, false);
  show(cardSwitch, false);
  show(warnBlocked, false);

  if (perm === 'granted') {
    // Ya aceptó → ocultar todo (ni marketing ni switch)
    if (switchEl) switchEl.checked = true; // estado lógico interno
    return;
  }

  if (perm === 'default') {
    // Aún no decidió → marketing (si no lo descartó) + switch disponible
    const dismissed = localStorage.getItem('notifPermDismissed') === 'true';
    show(cardMarketing, !dismissed);
    show(cardSwitch, true);
    if (switchEl) switchEl.checked = false;
    return;
  }

  // denied o sin soporte → sólo warning
  show(warnBlocked, true);
  if (switchEl) switchEl.checked = false;
}

// Comunicación opcional por eventos (por si querés enganchar analytics)
function dispatchConsent(eventName, detail = {}) {
  try { document.dispatchEvent(new CustomEvent(eventName, { detail })); } catch {}
}

// Foreground push → mostrar OS notif y notificar a app.js (badge/INBOX)
async function hookOnMessage() {
  try {
    await ensureMessagingCompatLoaded();
    const messaging = firebase.messaging();
    messaging.onMessage(async (payload) => {
      const d = payload?.data || {};
      try {
        const reg = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js')
                 || await navigator.serviceWorker.getRegistration();
        if (reg?.showNotification) {
          await reg.showNotification(d.title || 'RAMPET', {
            body: d.body || '',
            icon: d.icon || 'https://rampet.vercel.app/images/mi_logo_192.png',
            tag: d.tag || d.id || 'rampet-fg',
            renotify: false,
            data: { id: d.id || null, url: d.url || d.click_action || '/?inbox=1', via: 'page' }
          });
        }
      } catch (e) { console.warn('[onMessage] showNotification error', e?.message || e); }
      try { window.postMessage({ type: 'PUSH_DELIVERED', data: d }, '*'); } catch {}
    });
  } catch (e) {
    console.warn('[notifications] onMessage hook error', e?.message || e);
  }
}

// ─────────────────────────────────────────────────────────────
// GEOLOCALIZACIÓN — BANNER Y CONTROLES
// ─────────────────────────────────────────────────────────────
function geoEls(){
  return {
    banner: $('geo-banner'),
    txt: $('geo-banner-text'),
    btnOn: $('geo-enable-btn'),
    btnOff: $('geo-disable-btn'),
    btnHelp: $('geo-help-btn')
  };
}
function refreshGeoBannerUI(state) {
  const { banner, txt, btnOn, btnOff, btnHelp } = geoEls();
  if (!banner) return;

  const userSoftOff = localStorage.getItem('geoDisabledByUser') === '1';

  // Estado visible SIEMPRE (así el usuario sabe dónde activarlo)
  show(banner, true);

  if (state === 'granted' && !userSoftOff) {
    if (txt) txt.textContent = '📍 Ubicación activada para recibir beneficios cercanos.';
    setInline(btnOn,  false);
    setInline(btnOff, true);
    setInline(btnHelp,false);
    return;
  }

  if (state === 'prompt' && !userSoftOff) {
    if (txt) txt.textContent = '📍 Activá tu ubicación para ver beneficios cerca tuyo.';
    setInline(btnOn,  true);
    setInline(btnOff, false);
    setInline(btnHelp,false);
    return;
  }

  // denied / unknown / soft-off
  if (txt) txt.textContent = '📍 La ubicación está desactivada. Podés habilitarla desde Configuración del navegador.';
  setInline(btnOn,  false);
  setInline(btnOff, false);
  setInline(btnHelp,true);
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
  try {
    await new Promise((ok, err)=>{
      if (!navigator.geolocation?.getCurrentPosition) return err(new Error('Geolocalización no disponible.'));
      navigator.geolocation.getCurrentPosition(()=>ok(true), ()=>ok(false), { timeout: 10000 });
    });
    localStorage.removeItem('geoDisabledByUser');
  } catch {}
  updateGeoUI();
}
function handleGeoDisable() {
  localStorage.setItem('geoDisabledByUser', '1');
  updateGeoUI();
}
function handleGeoHelp() {
  alert('Para habilitar la ubicación:\n\n1) Abrí la configuración del sitio del navegador.\n2) Permisos → Ubicación → Permitir.\n3) Volvé a esta página y recargá.');
}
function wireGeoButtonsOnce() {
  const { banner, btnOn, btnOff, btnHelp } = geoEls();
  if (!banner || banner._wired) return;
  banner._wired = true;
  btnOn?.addEventListener('click', handleGeoEnable);
  btnOff?.addEventListener('click', handleGeoDisable);
  btnHelp?.addEventListener('click', handleGeoHelp);
}

// ── Export/Globals para que app.js pueda llamarlas como window.ensureGeoOnStartup()
export async function ensureGeoOnStartup() { wireGeoButtonsOnce(); await updateGeoUI(); }
export async function maybeRefreshIfStale() { await updateGeoUI(); }
// También las exponemos al global para compatibilidad sin tocar app.js
try {
  window.ensureGeoOnStartup = ensureGeoOnStartup;
  window.maybeRefreshIfStale = maybeRefreshIfStale;
} catch {}

// ─────────────────────────────────────────────────────────────
// API PÚBLICA USADA POR app.js / data.js
// ─────────────────────────────────────────────────────────────
export async function initNotificationsOnce() {
  await registerSW();

  // Si ya estaba concedido, aseguramos token; si no, no forzamos prompt aquí
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const tok = await obtenerYGuardarToken(); // genera/renueva y guarda
      if (tok) dispatchConsent('rampet:consent:notif-opt-in', { source: 'init' });
    } catch (e) {
      console.warn('[FCM] init/granted token error:', e?.message || e);
    }
  }

  // Hook foreground para banners del SO
  hookOnMessage();

  // Pintar UI inicial de cards
  refreshNotifUIFromPermission();

  return true;
}

export async function gestionarPermisoNotificaciones() {
  // No pedimos permiso acá, sólo ponemos la UI en estado correcto
  refreshNotifUIFromPermission();
}

export async function handlePermissionRequest() {
  if (!('Notification' in window)) { refreshNotifUIFromPermission(); return; }

  const current = Notification.permission;
  try {
    if (current === 'granted') {
      // Asegurar token y ocultar UI
      await obtenerYGuardarToken();
      refreshNotifUIFromPermission();
      dispatchConsent('rampet:consent:notif-opt-in', { source: 'already-granted' });
      return;
    }
    if (current === 'denied') {
      // No podemos abrir prompt; mostramos warning
      refreshNotifUIFromPermission();
      dispatchConsent('rampet:consent:notif-opt-out', { source: 'blocked' });
      return;
    }

    // current === 'default' → pedir permiso
    const status = await Notification.requestPermission();
    if (status === 'granted') {
      await obtenerYGuardarToken();
      // Ocultamos marketing + switch
      try { localStorage.removeItem('notifPermDismissed'); } catch {}
      refreshNotifUIFromPermission();
      dispatchConsent('rampet:consent:notif-opt-in', { source: 'prompt' });
    } else if (status === 'denied') {
      refreshNotifUIFromPermission();
      dispatchConsent('rampet:consent:notif-opt-out', { source: 'prompt-denied' });
    } else {
      // “default” otra vez (cerró el prompt) → consideramos dismiss
      try { localStorage.setItem('notifPermDismissed', 'true'); } catch {}
      refreshNotifUIFromPermission();
      dispatchConsent('rampet:consent:notif-dismissed', { source: 'prompt-dismissed' });
    }
  } catch (e) {
    console.warn('[notifications] handlePermissionRequest error:', e?.message || e);
    // Si algo falló, mantenemos UI coherente
    refreshNotifUIFromPermission();
  }
}

export function dismissPermissionRequest() {
  try { localStorage.setItem('notifPermDismissed', 'true'); } catch {}
  refreshNotifUIFromPermission();
  dispatchConsent('rampet:consent:notif-dismissed', { source: 'ui-dismiss' });
}

export async function handlePermissionSwitch(e) {
  const checked = !!e?.target?.checked;
  const perm = ('Notification' in window) ? Notification.permission : 'unsupported';

  if (!('Notification' in window)) { refreshNotifUIFromPermission(); return; }

  if (checked) {
    if (perm === 'granted') {
      try { await obtenerYGuardarToken(); dispatchConsent('rampet:consent:notif-opt-in', { source: 'switch-on' }); }
      catch (err) { console.warn('[notifications] switch-on token error:', err?.message || err); }
      refreshNotifUIFromPermission();
    } else if (perm === 'default') {
      // Al encender con permiso “default”, pedimos permiso
      await handlePermissionRequest(); // esto actualiza la UI
    } else {
      // denied → no podemos; devolvemos el switch a OFF y mostramos warning
      if ($('notif-switch')) $('notif-switch').checked = false;
      refreshNotifUIFromPermission();
      dispatchConsent('rampet:consent:notif-opt-out', { source: 'blocked-switch' });
    }
  } else {
    // OFF → opt-out app-level (borrar token y limpiar en Firestore)
    await borrarTokenYOptOut();
    refreshNotifUIFromPermission();
    dispatchConsent('rampet:consent:notif-opt-out', { source: 'switch-off' });
  }
}

export function handleBellClick() { return Promise.resolve(); }

export async function handleSignOutCleanup() {
  try { localStorage.removeItem('fcmToken'); } catch {}
  // No hacemos deleteToken aquí si no hay sesión; lo hará el login siguiente si corresponde
  console.debug('[notifications] handleSignOutCleanup → fcmToken (local) limpiado');
}
