// /modules/notifications.js — FCM + VAPID + Opt-In (card → switch próxima sesión) + “Beneficios cerca tuyo” (card → banner)
'use strict';

// ─────────────────────────────────────────────────────────────
// CONFIG / HELPERS
// ─────────────────────────────────────────────────────────────
const VAPID_PUBLIC = (window.__RAMPET__ && window.__RAMPET__.VAPID_PUBLIC) || '';
if (!VAPID_PUBLIC) console.warn('[FCM] Falta window.__RAMPET__.VAPID_PUBLIC en index.html');

function $(id){ return document.getElementById(id); }
function show(el, on){ if (el) el.style.display = on ? 'block' : 'none'; }
function showInline(el, on){ if (el) el.style.display = on ? 'inline-block' : 'none'; }

// Estado persistente (determinista)
const LS_NOTIF_STATE = 'notifState'; // 'deferred' | 'accepted' | 'blocked' | null
const LS_GEO_STATE   = 'geoState';   // 'deferred' | 'accepted' | 'blocked' | null

// Flags de sesión (para NO mostrar el switch/banner discretos hasta la próxima sesión)
let SESSION_NOTIF_DEFERRED = false;
let SESSION_GEO_DEFERRED = false;

// ───────────────── Firebase compat helpers ─────────────────
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
  try { localStorage.setItem(LS_NOTIF_STATE, 'accepted'); } catch {}
  console.log('✅ Token FCM guardado en clientes/' + clienteId);
}
async function borrarTokenYOptOut() {
  try {
    await ensureMessagingCompatLoaded();
    try { await firebase.messaging().deleteToken(); } catch {}
    await setFcmTokensOnCliente([]); // vacío en Firestore
    try { localStorage.removeItem('fcmToken'); } catch {}
    // no volvemos al card marketinero automáticamente
    try { localStorage.setItem(LS_NOTIF_STATE, 'deferred'); } catch {}
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

// ─────────────────────────────────────────────────────────────
// NOTIFICACIONES — UI
// ─────────────────────────────────────────────────────────────
function refreshNotifUIFromPermission() {
  const hasNotif = ('Notification' in window);
  const perm = hasNotif ? Notification.permission : 'unsupported';

  const cardMarketing = $('notif-prompt-card');     // ¡Activá tus beneficios!
  const cardSwitch    = $('notif-card');            // deslizante (sólo próxima sesión si tocó “Luego”)
  const warnBlocked   = $('notif-blocked-warning'); // aviso bloqueado
  const switchEl      = $('notif-switch');

  // reset base
  show(cardMarketing, false);
  show(cardSwitch, false);
  show(warnBlocked, false);

  if (!hasNotif) return;

  if (perm === 'granted') {
    if (switchEl) switchEl.checked = true;
    try { localStorage.setItem(LS_NOTIF_STATE, 'accepted'); } catch {}
    return; // nada más que mostrar
  }

  if (perm === 'denied') {
    show(warnBlocked, true);
    if (switchEl) switchEl.checked = false;
    try { localStorage.setItem(LS_NOTIF_STATE, 'blocked'); } catch {}
    return;
  }

  // perm === 'default'
  const state = localStorage.getItem(LS_NOTIF_STATE); // null | 'deferred' | 'accepted' | 'blocked'

  if (state === 'deferred') {
    // → mostrar switch SOLO en próxima sesión, no en la misma en la que tocó “Luego”
    if (!SESSION_NOTIF_DEFERRED) {
      show(cardSwitch, true);
      if (switchEl) switchEl.checked = false;
    }
    // si SESSION_NOTIF_DEFERRED === true, no mostramos nada ahora
  } else {
    // Primera vez (o sin registro) → SOLO card marketinero
    show(cardMarketing, true);
    if (switchEl) switchEl.checked = false;
  }
}

export async function handlePermissionRequest() {
  if (!('Notification' in window)) { refreshNotifUIFromPermission(); return; }

  const current = Notification.permission;
  try {
    if (current === 'granted') {
      await obtenerYGuardarToken();
      refreshNotifUIFromPermission();
      return;
    }
    if (current === 'denied') {
      refreshNotifUIFromPermission();
      return;
    }

    // current === 'default' → pedir permiso
    const status = await Notification.requestPermission();
    if (status === 'granted') {
      await obtenerYGuardarToken();
      refreshNotifUIFromPermission();
    } else if (status === 'denied') {
      try { localStorage.setItem(LS_NOTIF_STATE, 'blocked'); } catch {}
      refreshNotifUIFromPermission();
    } else {
      // dismiss del prompt nativo → cuenta como “Luego”
      try { localStorage.setItem(LS_NOTIF_STATE, 'deferred'); } catch {}
      SESSION_NOTIF_DEFERRED = true; // ← no mostrar switch hasta próxima sesión
      refreshNotifUIFromPermission();
    }
  } catch (e) {
    console.warn('[notifications] handlePermissionRequest error:', e?.message || e);
    refreshNotifUIFromPermission();
  }
}

export function dismissPermissionRequest() {
  // “Quizás más tarde” en el card marketing
  try { localStorage.setItem(LS_NOTIF_STATE, 'deferred'); } catch {}
  SESSION_NOTIF_DEFERRED = true; // ← evita que el switch salga en esta sesión
  const el = $('notif-prompt-card');
  if (el) el.style.display = 'none';
}

export async function handlePermissionSwitch(e) {
  const checked = !!e?.target?.checked;
  const perm = ('Notification' in window) ? Notification.permission : 'unsupported';

  if (!('Notification' in window)) { refreshNotifUIFromPermission(); return; }

  if (checked) {
    if (perm === 'granted') {
      try { await obtenerYGuardarToken(); } catch (err) { console.warn('[notifications] switch-on token error:', err?.message || err); }
      refreshNotifUIFromPermission();
    } else if (perm === 'default') {
      await handlePermissionRequest(); // actualiza la UI coherentemente
    } else {
      if ($('notif-switch')) $('notif-switch').checked = false;
      refreshNotifUIFromPermission();
    }
  } else {
    await borrarTokenYOptOut();
    refreshNotifUIFromPermission();
  }
}

// ─────────────────────────────────────────────────────────────
// FOREGROUND PUSH (una sola definición)
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
    console.warn('[notifications] onMessage hook error:', e?.message || e);
  }
}

// ─────────────────────────────────────────────────────────────
export async function initNotificationsOnce() {
  await registerSW();

  if ('Notification' in window && Notification.permission === 'granted') {
    try { await obtenerYGuardarToken(); } catch (e) { console.warn('[FCM] init/granted token error:', e?.message || e); }
  }

  await hookOnMessage();
  refreshNotifUIFromPermission();
  return true;
}

// Compat: llamado desde data.js tras obtener datos del cliente.
export async function gestionarPermisoNotificaciones() {
  refreshNotifUIFromPermission();
}

export function handleBellClick() { return Promise.resolve(); }
export async function handleSignOutCleanup() {
  try { localStorage.removeItem('fcmToken'); } catch {}
  console.debug('[notifications] handleSignOutCleanup → fcmToken (local) limpiado');
}

// ─────────────────────────────────────────────────────────────
// “BENEFICIOS CERCA TUYO” — Card marketing → (próx. sesión) banner discreto
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

function setGeoMarketingUI(on) {
  const { banner, txt, btnOn, btnOff, btnHelp } = geoEls();
  if (!banner) return;
  show(banner, on);
  if (!on) return;

  // Copy sin mencionar “ubicación”
  if (txt) txt.textContent = '🎯 Activá esta opción para ver ofertas y beneficios cerca tuyo. No te pierdas oportunidades exclusivas en tu zona.';
  showInline(btnOn,  true);
  showInline(btnOff, false);
  showInline(btnHelp,false);

  // Botón "Luego" (solo en card marketing)
  let later = document.getElementById('geo-later-btn');
  if (!later) {
    later = document.createElement('button');
    later.id = 'geo-later-btn';
    later.className = 'secondary-btn';
    later.textContent = 'Luego';
    later.style.marginLeft = '8px';
    const actions = banner.querySelector('.prompt-actions') || banner;
    actions.appendChild(later);
    later.addEventListener('click', () => {
      try { localStorage.setItem(LS_GEO_STATE, 'deferred'); } catch {}
      SESSION_GEO_DEFERRED = true; // ← no mostrar banner discreto en esta sesión
      setGeoMarketingUI(false);
    });
  } else {
    later.style.display = 'inline-block';
  }
}

function setGeoRegularUI(state) {
  const { banner, txt, btnOn, btnOff, btnHelp } = geoEls();
  if (!banner) return;

  // Mostrar banner discreto
  show(banner, true);

  if (state === 'granted') {
    try { localStorage.setItem(LS_GEO_STATE, 'accepted'); } catch {}
    // Mensaje informativo (sin decir “ubicación”)
    if (txt) txt.textContent = '✔️ Beneficios cerca tuyo activados. Vas a recibir promos exclusivas cuando estés en la zona.';
    showInline(btnOn,  false);
    showInline(btnOff, false);      // no ofrecemos “Desactivar”
    showInline(btnHelp,false);
    const later = document.getElementById('geo-later-btn');
    if (later) later.style.display = 'none';
    return;
  }

  if (state === 'prompt') {
    if (txt) txt.textContent = 'Activá esta opción para descubrir promos en tu zona.';
    showInline(btnOn,  true);
    showInline(btnOff, false);
    showInline(btnHelp,false);
    const later = document.getElementById('geo-later-btn');
    if (later) later.style.display = 'none';
    return;
  }

  // denied / unknown
  try { localStorage.setItem(LS_GEO_STATE, 'blocked'); } catch {}
  if (txt) txt.textContent = 'Para aprovechar beneficios en tu zona, habilitalo desde la configuración del navegador.';
  showInline(btnOn,  false);
  showInline(btnOff, false);
  showInline(btnHelp,true);
  const later = document.getElementById('geo-later-btn');
  if (later) later.style.display = 'none';
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
  const ls = localStorage.getItem(LS_GEO_STATE); // null | deferred | accepted | blocked

  if (state === 'granted') {
    setGeoMarketingUI(false);
    setGeoRegularUI('granted');
    return;
  }

  if (state === 'prompt' && ls !== 'deferred') {
    // Primera vez en la sesión sin “deferred” → card marketing
    setGeoMarketingUI(true);
    return;
  }

  // Si quedó “deferred”, sólo mostramos el banner discreto en PRÓXIMA sesión
  if (state === 'prompt' && ls === 'deferred') {
    if (SESSION_GEO_DEFERRED) {
      // Esta sesión: no mostrar nada
      setGeoMarketingUI(false);
      show(geoEls().banner, false);
      return;
    }
    setGeoMarketingUI(false);
    setGeoRegularUI('prompt');
    return;
  }

  // denied / unknown
  setGeoMarketingUI(false);
  setGeoRegularUI(state);
}

async function handleGeoEnable() {
  try {
    await new Promise((ok, err)=>{
      if (!navigator.geolocation?.getCurrentPosition) return err(new Error('Geolocalización no disponible.'));
      navigator.geolocation.getCurrentPosition(()=>ok(true), ()=>ok(false), { timeout: 10000 });
    });
    try { localStorage.setItem(LS_GEO_STATE, 'accepted'); } catch {}
  } catch {}
  updateGeoUI();
}
function handleGeoDisable() {
  // desactivación “suave” (no revoca permisos del navegador)
  try { localStorage.setItem(LS_GEO_STATE, 'deferred'); } catch {}
  updateGeoUI();
}
function handleGeoHelp() {
  alert('Para habilitarlo: abrí la configuración del sitio en tu navegador, buscá Permisos y activalo. Luego recargá esta página.');
}
function wireGeoButtonsOnce() {
  const { banner, btnOn, btnOff, btnHelp } = geoEls();
  if (!banner || banner._wired) return;
  banner._wired = true;
  btnOn?.addEventListener('click', handleGeoEnable);
  btnOff?.addEventListener('click', handleGeoDisable);
  btnHelp?.addEventListener('click', handleGeoHelp);
}

// Export para app.js
export async function ensureGeoOnStartup(){ wireGeoButtonsOnce(); await updateGeoUI(); }
export async function maybeRefreshIfStale(){ await updateGeoUI(); }
try { window.ensureGeoOnStartup = ensureGeoOnStartup; window.maybeRefreshIfStale = maybeRefreshIfStale; } catch {}
