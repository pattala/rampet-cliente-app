// /modules/notifications.js — FCM + VAPID + Opt-In (card → switch en próxima sesión) + Geolocalización (card → banner)
// Reqs: Firebase compat (app/auth/firestore/messaging), SW /firebase-messaging-sw.js, window.__RAMPET__.VAPID_PUBLIC

'use strict';

// ─────────────────────────────────────────────────────────────
// CONFIG / HELPERS
// ─────────────────────────────────────────────────────────────
const VAPID_PUBLIC = (window.__RAMPET__ && window.__RAMPET__.VAPID_PUBLIC) || '';
if (!VAPID_PUBLIC) console.warn('[FCM] Falta window.__RAMPET__.VAPID_PUBLIC en index.html');

const LS_NOTIF_DEFER = 'notifOptDefer';
const SS_NOTIF_DEFER_THIS = 'notifDeferThisSession';

const LS_GEO_DEFER = 'geoOptDefer';
const SS_GEO_DEFER_THIS = 'geoDeferThisSession';

function $(id){ return document.getElementById(id); }
function showBlock(el, on){ if (el) el.style.display = on ? 'block' : 'none'; }
function showInline(el, on){ if (el) el.style.display = on ? 'inline-block' : 'none'; }

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
    console.log('🔕 Opt-out FCM aplicado (token eliminado y Firestore en blanco).');
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

function dispatchConsent(eventName, detail = {}) {
  try { document.dispatchEvent(new CustomEvent(eventName, { detail })); } catch {}
}

// ─────────────────────────────────────────────────────────────
// NOTIFICACIONES — UI: Card (marketing) → Switch SOLO próxima sesión
// ─────────────────────────────────────────────────────────────
function refreshNotifUIFromPermission() {
  const hasNotif = ('Notification' in window);
  const perm = hasNotif ? Notification.permission : 'unsupported';

  const cardMarketing = $('notif-prompt-card');     // ¡Activa tus Beneficios!
  const cardSwitch    = $('notif-card');            // deslizante
  const warnBlocked   = $('notif-blocked-warning'); // aviso bloqueado
  const switchEl      = $('notif-switch');

  // reset
  showBlock(cardMarketing, false);
  showBlock(cardSwitch, false);
  showBlock(warnBlocked, false);

  if (!hasNotif) return;

  if (perm === 'granted') {
    if (switchEl) switchEl.checked = true;
    // al estar concedido, no se muestran ni card ni switch
    try { localStorage.removeItem(LS_NOTIF_DEFER); } catch {}
    try { sessionStorage.removeItem(SS_NOTIF_DEFER_THIS); } catch {}
    return;
  }

  if (perm === 'denied') {
    showBlock(warnBlocked, true);
    if (switchEl) switchEl.checked = false;
    return;
  }

  // perm === 'default'
  const deferred = localStorage.getItem(LS_NOTIF_DEFER) === '1';
  const deferredThis = sessionStorage.getItem(SS_NOTIF_DEFER_THIS) === '1';

  if (!deferred) {
    // NUNCA postergar → mostrar SOLO el card marketing
    showBlock(cardMarketing, true);
    if (switchEl) switchEl.checked = false;
    return;
  }

  // El usuario ya tocaron “Quizás más tarde” en una sesión previa
  // En la MISMA sesión no se muestra el switch (esperar próxima sesión)
  if (deferredThis) {
    if (switchEl) switchEl.checked = false;
    return; // no mostramos nada esta sesión
  }

  // Próxima sesión → mostrar deslizante
  showBlock(cardSwitch, true);
  if (switchEl) switchEl.checked = false;
}

export async function handlePermissionRequest() {
  if (!('Notification' in window)) { refreshNotifUIFromPermission(); return; }

  const current = Notification.permission;
  try {
    if (current === 'granted') {
      await obtenerYGuardarToken();
      refreshNotifUIFromPermission();
      dispatchConsent('rampet:consent:notif-opt-in', { source: 'already-granted' });
      return;
    }
    if (current === 'denied') {
      refreshNotifUIFromPermission();
      dispatchConsent('rampet:consent:notif-opt-out', { source: 'blocked' });
      return;
    }

    // current === 'default' → pedir permiso
    const status = await Notification.requestPermission();
    if (status === 'granted') {
      await obtenerYGuardarToken();
      // ocultar marketing + switch
      try { localStorage.removeItem(LS_NOTIF_DEFER); } catch {}
      try { sessionStorage.removeItem(SS_NOTIF_DEFER_THIS); } catch {}
      refreshNotifUIFromPermission();
      dispatchConsent('rampet:consent:notif-opt-in', { source: 'prompt' });
    } else if (status === 'denied') {
      refreshNotifUIFromPermission();
      dispatchConsent('rampet:consent:notif-opt-out', { source: 'prompt-denied' });
    } else {
      // cerró el prompt sin elegir → lo tratamos como “más tarde” de esta sesión
      try { localStorage.setItem(LS_NOTIF_DEFER, '1'); } catch {}
      try { sessionStorage.setItem(SS_NOTIF_DEFER_THIS, '1'); } catch {}
      refreshNotifUIFromPermission();
      dispatchConsent('rampet:consent:notif-dismissed', { source: 'prompt-dismissed' });
    }
  } catch (e) {
    console.warn('[notifications] handlePermissionRequest error:', e?.message || e);
    refreshNotifUIFromPermission();
  }
}

export function dismissPermissionRequest() {
  // “Quizás más tarde” → switch recién la PRÓXIMA sesión
  try { localStorage.setItem(LS_NOTIF_DEFER, '1'); } catch {}
  try { sessionStorage.setItem(SS_NOTIF_DEFER_THIS, '1'); } catch {}
  const el = $('notif-prompt-card');
  if (el) el.style.display = 'none';
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
      await handlePermissionRequest(); // esto actualiza la UI coherentemente
    } else {
      if ($('notif-switch')) $('notif-switch').checked = false;
      refreshNotifUIFromPermission();
      dispatchConsent('rampet:consent:notif-opt-out', { source: 'blocked-switch' });
    }
  } else {
    await borrarTokenYOptOut();
    refreshNotifUIFromPermission();
    dispatchConsent('rampet:consent:notif-opt-out', { source: 'switch-off' });
  }
}

// ─────────────────────────────────────────────────────────────
// NOTIFS: hook foreground (banner del SO) + init
// ─────────────────────────────────────────────────────────────
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

export async function initNotificationsOnce() {
  await registerSW();
  if ('Notification' in window && Notification.permission === 'granted') {
    try { await obtenerYGuardarToken(); dispatchConsent('rampet:consent:notif-opt-in', { source: 'init' }); }
    catch (e) { console.warn('[FCM] init/granted token error:', e?.message || e); }
  }
  await hookOnMessage();
  refreshNotifUIFromPermission();
  return true;
}

export async function gestionarPermisoNotificaciones() {
  refreshNotifUIFromPermission();
}

export function handleBellClick() { return Promise.resolve(); }

export async function handleSignOutCleanup() {
  try { localStorage.removeItem('fcmToken'); } catch {}
  console.debug('[notifications] handleSignOutCleanup → fcmToken (local) limpiado');
}

// ─────────────────────────────────────────────────────────────
// GEOLOCALIZACIÓN — Card marketing → (próx. sesión) banner regular
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

function ensureGeoLaterButton() {
  const { banner } = geoEls();
  if (!banner) return null;
  let later = document.getElementById('geo-later-btn');
  if (!later) {
    later = document.createElement('button');
    later.id = 'geo-later-btn';
    later.className = 'secondary-btn';
    later.textContent = 'Luego';
    later.style.marginLeft = '8px';
    later.addEventListener('click', () => {
      try { localStorage.setItem(LS_GEO_DEFER, '1'); } catch {}
      try { sessionStorage.setItem(SS_GEO_DEFER_THIS, '1'); } catch {}
      // Ocultamos marketing esta sesión
      showBlock(banner, false);
    });
    // Colgar en la zona de acciones del banner
    const actions = banner.querySelector('.prompt-actions') || banner;
    actions.appendChild(later);
  }
  return later;
}

function setGeoMarketingUI(on) {
  const { banner, txt, btnOn, btnOff, btnHelp } = geoEls();
  if (!banner) return;
  showBlock(banner, on);
  if (!on) return;
  if (txt) txt.textContent = '📍 Ofertas cerca tuyo: activá tu ubicación para no perderte beneficios exclusivos.';
  showInline(btnOn,  true);
  showInline(btnOff, false);
  showInline(btnHelp,false);
  ensureGeoLaterButton()?.classList.remove('hidden');
}

function setGeoRegularUI(state) {
  const { banner, txt, btnOn, btnOff, btnHelp } = geoEls();
  if (!banner) return;
  showBlock(banner, true);

  if (state === 'granted' && localStorage.getItem(LS_GEO_DEFER) !== '1') {
    if (txt) txt.textContent = '📍 Ubicación activada para recibir beneficios cercanos.';
    showInline(btnOn,  false);
    showInline(btnOff, true);
    showInline(btnHelp,false);
  } else if (state === 'prompt' && localStorage.getItem(LS_GEO_DEFER) === '1') {
    if (txt) txt.textContent = '📍 Activá tu ubicación para ver beneficios cerca tuyo.';
    showInline(btnOn,  true);
    showInline(btnOff, false);
    showInline(btnHelp,false);
  } else {
    if (txt) txt.textContent = '📍 La ubicación está desactivada. Podés habilitarla desde Configuración del navegador.';
    showInline(btnOn,  false);
    showInline(btnOff, false);
    showInline(btnHelp,true);
  }

  // En modo regular ocultamos el botón "Luego" si existe
  const later = document.getElementById('geo-later-btn');
  if (later) later.classList.add('hidden');
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

  const deferred = localStorage.getItem(LS_GEO_DEFER) === '1';
  const deferredThis = sessionStorage.getItem(SS_GEO_DEFER_THIS) === '1';

  if (state === 'prompt' && !deferred) {
    // Primera vez (sin defer) → card marketinero (esta sesión)
    if (!deferredThis) {
      setGeoMarketingUI(true);
      return;
    }
    // Si ya lo pospuso en esta sesión, no mostrar nada más esta sesión
    setGeoMarketingUI(false);
    showBlock(geoEls().banner, false);
    return;
  }

  // Próximas sesiones (o distintos estados) → banner regular
  setGeoMarketingUI(false);
  setGeoRegularUI(state);
}

async function handleGeoEnable() {
  try {
    await new Promise((ok, err)=>{
      if (!navigator.geolocation?.getCurrentPosition) return err(new Error('Geolocalización no disponible.'));
      navigator.geolocation.getCurrentPosition(()=>ok(true), ()=>ok(false), { timeout: 10000 });
    });
    // Si se habilitó, limpiamos defer
    try { localStorage.removeItem(LS_GEO_DEFER); } catch {}
    try { sessionStorage.removeItem(SS_GEO_DEFER_THIS); } catch {}
  } catch {}
  updateGeoUI();
}
function handleGeoDisable() {
  // Desactivar “suave” a nivel app (no revoca permisos del navegador)
  try { localStorage.setItem(LS_GEO_DEFER, '1'); } catch {}
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
  ensureGeoLaterButton();
}

// Export + globals para compat con app.js actual
export async function ensureGeoOnStartup(){ wireGeoButtonsOnce(); await updateGeoUI(); }
export async function maybeRefreshIfStale(){ await updateGeoUI(); }
try { window.ensureGeoOnStartup = ensureGeoOnStartup; window.maybeRefreshIfStale = maybeRefreshIfStale; } catch {}

// ─────────────────────────────────────────────────────────────
// FOREGROUND PUSH
// ─────────────────────────────────────────────────────────────
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
  } catch (e) { console.warn('[notifications] onMessage hook error', e?.message || e); }
}

// ─────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────
export async function initNotificationsOnce() {
  await registerSW();

  if ('Notification' in window && Notification.permission === 'granted') {
    try { await obtenerYGuardarToken(); dispatchConsent('rampet:consent:notif-opt-in', { source: 'init' }); }
    catch (e) { console.warn('[FCM] init/granted token error:', e?.message || e); }
  }

  await hookOnMessage();
  refreshNotifUIFromPermission();
  return true;
}
