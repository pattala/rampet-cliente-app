// /modules/notifications.js — FCM + VAPID + Opt-In (card → switch en próxima sesión) + “Beneficios cerca tuyo” (card → banner)
// Requiere: Firebase compat (app/auth/firestore/messaging) cargado y SW en /firebase-messaging-sw.js
'use strict';

// ─────────────────────────────────────────────────────────────
// CONFIG / HELPERS
// ─────────────────────────────────────────────────────────────
const VAPID_PUBLIC = (window.__RAMPET__ && window.__RAMPET__.VAPID_PUBLIC) || '';
if (!VAPID_PUBLIC) console.warn('[FCM] Falta window.__RAMPET__.VAPID_PUBLIC en index.html');

function $(id){ return document.getElementById(id); }
function show(el, on){ if (el) el.style.display = on ? 'block' : 'none'; }
function showInline(el, on){ if (el) el.style.display = on ? 'inline-block' : 'none'; }

// Estados persistentes (deterministas)
const LS_NOTIF_STATE = 'notifState'; // 'deferred' | 'accepted' | 'blocked' | null
const LS_GEO_STATE   = 'geoState';   // 'deferred' | 'accepted' | 'blocked' | null

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
    // Registrar siempre el SW de FCM si no está
    const existingByPath = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
    if (existingByPath) { console.log('✅ SW FCM ya registrado:', existingByPath.scope); return true; }
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
    // Queda en "deferred" para que el usuario use el switch cuando quiera (no card marketing)
    try { localStorage.setItem(LS_NOTIF_STATE, 'deferred'); } catch {}
    console.log('🔕 Opt-out FCM aplicado.');
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

  const cardMarketing = $('notif-prompt-card');     // “¡Activá tus beneficios exclusivos!”
  const cardSwitch    = $('notif-card');            // deslizante
  const warnBlocked   = $('notif-blocked-warning'); // aviso bloqueado
  const switchEl      = $('notif-switch');

  // reset
  show(cardMarketing, false);
  show(cardSwitch, false);
  show(warnBlocked, false);

  if (!hasNotif) return;

  if (perm === 'granted') {
    if (switchEl) switchEl.checked = true;
    try { localStorage.setItem(LS_NOTIF_STATE, 'accepted'); } catch {}
    return;
  }

  if (perm === 'denied') {
    if (switchEl) switchEl.checked = false;
    show(warnBlocked, true);
    try { localStorage.setItem(LS_NOTIF_STATE, 'blocked'); } catch {}
    return;
  }

  // perm === 'default'
  const state = localStorage.getItem(LS_NOTIF_STATE); // null | 'deferred' | 'accepted' | 'blocked'
  if (state === 'deferred') {
    // Próxima sesión luego de “Luego” → SOLO el switch
    show(cardSwitch, true);
    if (switchEl) switchEl.checked = false;
  } else {
    // Primera vez (o no marcado) → SOLO el card marketing
    show(cardMarketing, true);
    if (switchEl) switchEl.checked = false;
  }
}

export async function handlePermissionRequest() {
  if (!('Notification' in window)) { refreshNotifUIFromPermission(); return; }
  try {
    const current = Notification.permission;
    if (current === 'granted') {
      await obtenerYGuardarToken();
      refreshNotifUIFromPermission();
      return;
    }
    if (current === 'denied') {
      refreshNotifUIFromPermission();
      return;
    }

    // current === 'default'
    const status = await Notification.requestPermission();
    if (status === 'granted') {
      await obtenerYGuardarToken();
      refreshNotifUIFromPermission();
    } else if (status === 'denied') {
      try { localStorage.setItem(LS_NOTIF_STATE, 'blocked'); } catch {}
      refreshNotifUIFromPermission();
    } else {
      // dismissed (cerró el prompt nativo) → cuenta como “Luego”
      try { localStorage.setItem(LS_NOTIF_STATE, 'deferred'); } catch {}
      // No mostramos el switch en esta sesión
      refreshNotifUIFromPermission();
    }
  } catch (e) {
    console.warn('[notifications] handlePermissionRequest error:', e?.message || e);
    refreshNotifUIFromPermission();
  }
}

export function dismissPermissionRequest() {
  // “Quizás más tarde” → marcar deferred y ocultar card. Sin switch en esta sesión.
  try { localStorage.setItem(LS_NOTIF_STATE, 'deferred'); } catch {}
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
      await handlePermissionRequest(); // esto actualiza la UI coherentemente
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
// INIT
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

// Compat con data.js
export async function gestionarPermisoNotificaciones() {
  refreshNotifUIFromPermission();
}
export function handleBellClick() { return Promise.resolve(); }
export async function handleSignOutCleanup() {
  try { localStorage.removeItem('fcmToken'); } catch {}
  console.debug('[notifications] handleSignOutCleanup → fcmToken (local) limpiado');
}

// ─────────────────────────────────────────────────────────────
// “BENEFICIOS CERCA TUYO” — Card marketing → (próx. sesión) banner
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

// Card marketing (solo primera vez en sesión con permission = prompt y sin deferred)
function setGeoMarketingUI(on) {
  const { banner, txt, btnOn, btnOff, btnHelp } = geoEls();
  if (!banner) return;
  show(banner, on);
  if (!on) return;

  if (txt) txt.textContent = 'Activá para ver ofertas y beneficios cerca tuyo.';
  showInline(btnOn,  true);
  showInline(btnOff, false);
  showInline(btnHelp,false);

  // Botón “Luego” (solo aquí). Lo recreamos idempotente por si reentramos.
  let later = document.getElementById('geo-later-btn');
  if (!later) {
    later = document.createElement('button');
    later.id = 'geo-later-btn';
    later.className = 'secondary-btn';
    later.textContent = 'Luego';
    later.style.marginLeft = '8px';
    const actions = banner.querySelector('.prompt-actions') || banner;
    actions.appendChild(later);
  }
  // (Re)asignar handler de forma segura
  later.onclick = () => {
    try { localStorage.setItem(LS_GEO_STATE, 'deferred'); } catch {}
    // Ocultamos el card de marketing y NO mostramos nada más en esta sesión
    show(banner, false);
  };
}

// Banner regular (sesiones siguientes o estados distintos de “marketing”)
function setGeoRegularUI(state) {
  const { banner, txt, btnOn, btnOff, btnHelp } = geoEls();
  if (!banner) return;

  show(banner, true);

  // Aseguramos que el botón “Luego” NO quede visible en el banner regular
  const later = document.getElementById('geo-later-btn');
  if (later) later.style.display = 'none';

  if (state === 'granted') {
    try { localStorage.setItem(LS_GEO_STATE, 'accepted'); } catch {}
    if (txt) txt.textContent = 'Listo: ya podés recibir ofertas y beneficios cerca tuyo.';
    showInline(btnOn,  false);
    // Si querés ocultar la opción de desactivar a nivel app, comentá la siguiente línea:
    showInline(btnOff, true);
    showInline(btnHelp,false);
    return;
  }

  if (state === 'prompt') {
    // Solo mostramos el banner regular si alguna vez pospuso (deferred)
    if (localStorage.getItem(LS_GEO_STATE) === 'deferred') {
      if (txt) txt.textContent = 'Activá para ver ofertas y beneficios cerca tuyo.';
      showInline(btnOn,  true);
      showInline(btnOff, false);
      showInline(btnHelp,false);
      return;
    }
    // Si no había deferred, el flujo marketing se encarga.
    show(banner, false);
    return;
  }

  // denied / unknown
  try { localStorage.setItem(LS_GEO_STATE, 'blocked'); } catch {}
  if (txt) txt.textContent = 'Para activar beneficios cerca tuyo, habilitalo desde la configuración del navegador.';
  showInline(btnOn,  false);
  showInline(btnOff, false);
  showInline(btnHelp,true);
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
    // Primera vez en esta sesión → card marketing
    setGeoMarketingUI(true);
    return;
  }

  // Sesiones siguientes / pospuesto → banner regular
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
  // Desactivar “suave” a nivel app (no revoca permisos del navegador)
  try { localStorage.setItem(LS_GEO_STATE, 'deferred'); } catch {}
  updateGeoUI();
}
function handleGeoHelp() {
  alert('Para activarlo:\n\n1) Abrí la configuración del sitio del navegador.\n2) Permisos → Ubicación → Permitir.\n3) Volvé a esta página y recargá.');
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
