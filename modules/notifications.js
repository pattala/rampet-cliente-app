// /modules/notifications.js — FCM + VAPID + Opt-In (card → switch en próxima sesión) + “Beneficios cerca tuyo” (card → banner)
'use strict';

// ─────────────────────────────────────────────────────────────
// CONFIG / HELPERS
// ─────────────────────────────────────────────────────────────
const VAPID_PUBLIC = (window.__RAMPET__ && window.__RAMPET__.VAPID_PUBLIC) || '';
if (!VAPID_PUBLIC) console.warn('[FCM] Falta window.__RAMPET__.VAPID_PUBLIC en index.html');

function $(id){ return document.getElementById(id); }
function show(el, on){ if (el) el.style.display = on ? 'block' : 'none'; }
function showInline(el, on){ if (el) el.style.display = on ? 'inline-block' : 'none'; }

// Estados persistentes
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

// ───────── PATCH: merge & cap de fcmTokens (máx. 5, sin duplicados) ─────────
const MAX_TOKENS = 5;

function dedupeTokens(arr = []) {
  const out = [];
  const seen = new Set();
  for (const t of arr) {
    const s = (t || '').trim();
    if (!s) continue;
    if (!seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out;
}

async function setFcmTokensOnCliente(newTokens) {
  const uid = firebase.auth().currentUser?.uid;
  if (!uid) throw new Error('No hay usuario logueado.');
  const clienteId = await getClienteDocIdPorUID(uid);
  if (!clienteId) throw new Error('No encontré tu doc en clientes (authUID).');

  const ref = firebase.firestore().collection('clientes').doc(clienteId);

  // Leer tokens actuales
  let current = [];
  try {
    const snap = await ref.get();
    const data = snap.exists ? snap.data() : null;
    current = Array.isArray(data?.fcmTokens) ? data.fcmTokens : [];
  } catch {}

  // Merge → nuevo primero, luego los existentes; dedupe y cap
  const merged = dedupeTokens([...(newTokens || []), ...current]).slice(0, MAX_TOKENS);

  await ref.set({ fcmTokens: merged }, { merge: true });
  return clienteId;
}

// Guardado / borrado de token
async function guardarTokenEnMiDoc(token) {
  const clienteId = await setFcmTokensOnCliente([token]);
  try { localStorage.setItem('fcmToken', token); } catch {}
  try { localStorage.setItem(LS_NOTIF_STATE, 'accepted'); } catch {}
  console.log('✅ Token FCM guardado en clientes/' + clienteId);
}
async function borrarTokenYOptOut() {
  try {
    await ensureMessagingCompatLoaded();
    try { await firebase.messaging().deleteToken(); } catch {}
    await setFcmTokensOnCliente([]);
    try { localStorage.removeItem('fcmToken'); } catch {}
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

  const cardMarketing = $('notif-prompt-card');
  const cardSwitch    = $('notif-card');
  const warnBlocked   = $('notif-blocked-warning');
  const switchEl      = $('notif-switch');

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

  const state = localStorage.getItem(LS_NOTIF_STATE);
  if (state === 'deferred') {
    show(cardSwitch, true);
    if (switchEl) switchEl.checked = false;
  } else {
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
    const status = await Notification.requestPermission();
    if (status === 'granted') {
      await obtenerYGuardarToken();
    } else if (status === 'denied') {
      try { localStorage.setItem(LS_NOTIF_STATE, 'blocked'); } catch {}
    } else {
      try { localStorage.setItem(LS_NOTIF_STATE, 'deferred'); } catch {}
    }
    refreshNotifUIFromPermission();
  } catch (e) {
    console.warn('[notifications] handlePermissionRequest error:', e?.message || e);
    refreshNotifUIFromPermission();
  }
}
export function dismissPermissionRequest() {
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
      try { await obtenerYGuardarToken(); } catch (err) {}
    } else if (perm === 'default') {
      await handlePermissionRequest();
    } else {
      if ($('notif-switch')) $('notif-switch').checked = false;
    }
  } else {
    await borrarTokenYOptOut();
  }
  refreshNotifUIFromPermission();
}

// ─────────────────────────────────────────────────────────────
/** FOREGROUND PUSH: muestra sistemica incluso en foreground */
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
            icon: d.icon || 'https://rampet.vercel.app/images/mi_logo_192.png', // ← FIX dominio
            tag: d.tag || d.id || 'rampet-fg',
            data: { url: d.url || d.click_action || '/?inbox=1' }
          });
        }
      } catch (e) { console.warn('[onMessage] error', e?.message || e); }
    });
  } catch (e) {
    console.warn('[notifications] hookOnMessage error:', e?.message || e);
  }
}

// ─────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────
export async function initNotificationsOnce() {
  await registerSW();
  if ('Notification' in window && Notification.permission === 'granted') {
    try { await obtenerYGuardarToken(); } catch {}
  }
  await hookOnMessage();
  refreshNotifUIFromPermission();
  return true;
}
export async function gestionarPermisoNotificaciones() { refreshNotifUIFromPermission(); }
export function handleBellClick() { return Promise.resolve(); }
export async function handleSignOutCleanup() { try { localStorage.removeItem('fcmToken'); } catch {} }

// ─────────────────────────────────────────────────────────────
// “BENEFICIOS CERCA TUYO”
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

/** Card marketing (primera vez o cuando no está activo) */
function setGeoMarketingUI(on) {
  const { banner, txt, btnOn, btnOff, btnHelp } = geoEls();
  if (!banner) return;
  show(banner, on);
  if (!on) return;
  if (txt) txt.textContent = 'Activá para ver ofertas y beneficios cerca tuyo.';
  showInline(btnOn,true); showInline(btnOff,false); showInline(btnHelp,false);

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
  later.onclick = () => {
    try { localStorage.setItem(LS_GEO_STATE, 'deferred'); } catch {}
    show(banner, false);
  };
}

/** Banner/estado regular */
function setGeoRegularUI(state) {
  const { banner, txt, btnOn, btnOff, btnHelp } = geoEls();
  if (!banner) return;
  show(banner,true);

  const later = document.getElementById('geo-later-btn');
  if (later) later.style.display = 'none';

  if (state === 'granted') {
    try { localStorage.setItem(LS_GEO_STATE, 'accepted'); } catch {}
    if (txt) txt.textContent = 'Listo: ya podés recibir ofertas y beneficios cerca tuyo.';
    showInline(btnOn,false);
    showInline(btnOff,false); // ← ocultamos “desactivar” cuando está activo
    showInline(btnHelp,false);
    return;
  }

  // Bloqueado: mostrar ayuda (no podemos volver a pedir permiso hasta que el user cambie el setting)
  if (state === 'denied') {
    try { localStorage.setItem(LS_GEO_STATE, 'blocked'); } catch {}
    if (txt) txt.textContent = 'Para activar beneficios cerca tuyo, habilitalo desde la configuración del navegador.';
    showInline(btnOn,false); showInline(btnOff,false); showInline(btnHelp,true);
    return;
  }

  // Estado prompt/unknown: cae en marketing card (se maneja en updateGeoUI)
  if (txt) txt.textContent = 'Activá para ver ofertas y beneficios cerca tuyo.';
  showInline(btnOn,true); showInline(btnOff,false); showInline(btnHelp,false);
}

async function detectGeoPermission() {
  try {
    if (navigator.permissions?.query) {
      const st = await navigator.permissions.query({ name: 'geolocation' });
      return st.state; // 'granted' | 'denied' | 'prompt'
    }
  } catch {}
  return 'unknown';
}

/** Política acordada:
 * - Si NO está activo al iniciar (prompt/unknown) → mostrar CARD marketing.
 * - Si está BLOQUEADO → mostrar banner de ayuda.
 * - Si está ACTIVO → mostrar texto “Listo…” y sin botón desactivar.
 */
async function updateGeoUI() {
  const state = await detectGeoPermission();

  if (state === 'granted') {
    setGeoMarketingUI(false);
    setGeoRegularUI('granted');
    return;
  }
  if (state === 'denied') {
    setGeoMarketingUI(false);
    setGeoRegularUI('denied'); // ayuda
    return;
  }

  // prompt/unknown → card marketing (copy “te estás perdiendo promos…”)
  setGeoMarketingUI(true);
}

async function handleGeoEnable() {
  try {
    await new Promise((ok,err)=>{ if(!navigator.geolocation?.getCurrentPosition) return err(); navigator.geolocation.getCurrentPosition(()=>ok(true),()=>ok(false)); });
    try { localStorage.setItem(LS_GEO_STATE, 'accepted'); } catch {}
  } catch {}
  updateGeoUI();
}
function handleGeoDisable() {
  try { localStorage.setItem(LS_GEO_STATE, 'deferred'); } catch {}
  updateGeoUI();
}
function handleGeoHelp() { alert('Para activarlo:\n\n1) Abrí configuración del navegador.\n2) Permisos → Activar.\n3) Recargá la página.'); }
function wireGeoButtonsOnce() {
  const { banner, btnOn, btnOff, btnHelp } = geoEls();
  if (!banner || banner._wired) return; banner._wired = true;
  btnOn?.addEventListener('click', handleGeoEnable);
  btnOff?.addEventListener('click', handleGeoDisable);
  btnHelp?.addEventListener('click', handleGeoHelp);
}

// Export
export async function ensureGeoOnStartup(){ wireGeoButtonsOnce(); await updateGeoUI(); }
export async function maybeRefreshIfStale(){ await updateGeoUI(); }
try { window.ensureGeoOnStartup = ensureGeoOnStartup; window.maybeRefreshIfStale = maybeRefreshIfStale; } catch {}
