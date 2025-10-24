// /modules/notifications.js — FCM + VAPID + Opt-In (card → switch) + Geo + Domicilio
'use strict';

// ─────────────────────────────────────────────────────────────
// CONFIG / HELPERS
// ─────────────────────────────────────────────────────────────
const VAPID_PUBLIC = (window.__RAMPET__ && window.__RAMPET__.VAPID_PUBLIC) || '';
if (!VAPID_PUBLIC) console.warn('[FCM] Falta window.__RAMPET__.VAPID_PUBLIC en index.html');

// ⬇️ NUEVO: Edge/Chrome bloquean permisos si no hay contexto seguro
if (!window.isSecureContext) {
  console.warn('[FCM] El sitio NO está en contexto seguro (https o localhost). Notificaciones serán bloqueadas.');
}

// ⬇️ NUEVO: log de estado del permiso al cargar
try {
  if ('Notification' in window) {
    console.log('[FCM] Permission actual:', Notification.permission);
  } else {
    console.warn('[FCM] API Notification no soportada en este navegador.');
  }
} catch {}

function $(id){ return document.getElementById(id); }
function show(el, on){ if (el) el.style.display = on ? 'block' : 'none'; }
function showInline(el, on){ if (el) el.style.display = on ? 'inline-block' : 'none'; }
function emit(name, detail){ try { document.dispatchEvent(new CustomEvent(name, { detail })); } catch {} }

function toast(msg, type='info') {
  try { window.UI?.showToast?.(msg, type); } catch {}
  if (!window.UI?.showToast) console.log(`[${type}] ${msg}`);
}

// Estados persistentes
const LS_NOTIF_STATE = 'notifState'; // 'deferred' | 'accepted' | 'blocked' | null
const LS_GEO_STATE   = 'geoState';   // 'deferred' | 'accepted' | 'blocked' | null

// Ruta del Service Worker (RELATIVA para que funcione en subcarpetas también)
const SW_PATH = './firebase-messaging-sw.js';

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
    const existing = await navigator.serviceWorker.getRegistration(SW_PATH);
    if (existing) { console.log('✅ SW FCM ya registrado:', existing.scope); return true; }
    const reg = await navigator.serviceWorker.register(SW_PATH);
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

// ---- PATCH: escribir flags en clientes/{id}.config ----
async function setClienteConfigPatch(partial) {
  try {
    const uid = firebase.auth().currentUser?.uid;
    if (!uid) return;
    const clienteId = await getClienteDocIdPorUID(uid) || uid; // fallback uid
    const ref = firebase.firestore().collection('clientes').doc(clienteId);
    await ref.set({ config: partial }, { merge: true });
  } catch (e) {
    console.warn('[config] setClienteConfigPatch error:', e?.message || e);
  }
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

  let clienteId = await getClienteDocIdPorUID(uid);
  let ref;

  if (clienteId) {
    ref = firebase.firestore().collection('clientes').doc(clienteId);
  } else {
    // Fallback: usar uid como docId y crear el doc con authUID si no existe
    clienteId = uid;
    ref = firebase.firestore().collection('clientes').doc(clienteId);
    await ref.set({ authUID: uid, creadoDesde: 'pwa' }, { merge: true });
    console.warn('[FCM] Cliente no existía por authUID; creado fallback clientes/{uid}.');
  }

  // Leer tokens actuales
  let current = [];
  try {
    const snap = await ref.get();
    const data = snap.exists ? snap.data() : null;
    current = Array.isArray(data?.fcmTokens) ? data.fcmTokens : [];
  } catch {}

  const merged = dedupeTokens([...(newTokens || []), ...current]).slice(0, MAX_TOKENS);
  await ref.set({ fcmTokens: merged }, { merge: true });
  return clienteId;
}

async function clearFcmTokensOnCliente() {
  const uid = firebase.auth().currentUser?.uid;
  if (!uid) throw new Error('No hay usuario logueado.');
  const clienteId = await getClienteDocIdPorUID(uid);
  if (!clienteId) throw new Error('No encontré tu doc en clientes (authUID).');
  const ref = firebase.firestore().collection('clientes').doc(clienteId);
  await ref.set({ fcmTokens: [] }, { merge: true }); // ← borra la lista
}

// Guardado / borrado de token
async function guardarTokenEnMiDoc(token) {
  const clienteId = await setFcmTokensOnCliente([token]);

  // ← marcar opt-in en config
  await setClienteConfigPatch({
    notifEnabled: true,
    notifOptInSource: 'ui',
    notifUpdatedAt: new Date().toISOString()
  });

  try { localStorage.setItem('fcmToken', token); } catch {}
  try { localStorage.setItem(LS_NOTIF_STATE, 'accepted'); } catch {}
  emit('rampet:consent:notif-opt-in', { source: 'ui' });
  console.log('✅ Token FCM guardado en clientes/' + clienteId);
}
async function borrarTokenYOptOut() {
  try {
    await ensureMessagingCompatLoaded();
    try { await firebase.messaging().deleteToken(); } catch {}
    await clearFcmTokensOnCliente();                      // ← borra en Firestore
    try { localStorage.removeItem('fcmToken'); } catch {}
    try { localStorage.setItem(LS_NOTIF_STATE, 'deferred'); } catch {}

    // ← marcar opt-out en config
    await setClienteConfigPatch({
      notifEnabled: false,
      notifUpdatedAt: new Date().toISOString()
    });

    emit('rampet:consent:notif-opt-out', { source: 'ui' });
    console.log('🔕 Opt-out FCM aplicado.');
  } catch (e) {
    console.warn('[FCM] borrarTokenYOptOut error:', e?.message || e);
  }
}

async function obtenerYGuardarToken() {
  await ensureMessagingCompatLoaded();
  try { await firebase.messaging().deleteToken(); } catch {}
  // ⚠️ buscar el SW por ruta relativa; si no, intentar cualquiera activo
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH)
           || await navigator.serviceWorker.getRegistration();
  if (!reg) throw new Error('SW FCM no está registrado.');
  const tok = await firebase.messaging().getToken({ vapidKey: VAPID_PUBLIC, serviceWorkerRegistration: reg });

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
      emit('rampet:consent:notif-opt-out', { source: 'prompt' });
    } else {
      try { localStorage.setItem(LS_NOTIF_STATE, 'deferred'); } catch {}
      emit('rampet:consent:notif-dismissed', {});
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
  emit('rampet:consent:notif-dismissed', {});
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
/** FOREGROUND PUSH: muestra sistémica incluso en foreground */
async function hookOnMessage() {
  try {
    await ensureMessagingCompatLoaded();
    const messaging = firebase.messaging();
    messaging.onMessage(async (payload) => {
      const d = payload?.data || {};
      try {
        // Usar la misma estrategia: primero el SW por ruta relativa, si no hay, cualquiera.
        const reg = await navigator.serviceWorker.getRegistration(SW_PATH)
                 || await navigator.serviceWorker.getRegistration();
        if (reg?.showNotification) {
          await reg.showNotification(d.title || 'RAMPET', {
            body: d.body || '',
            icon: d.icon || '/images/mi_logo_192.png',
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
    try {
      await obtenerYGuardarToken();
      // refuerza el flag por si ya existía token
      await setClienteConfigPatch({
        notifEnabled: true,
        notifUpdatedAt: new Date().toISOString()
      });
    } catch {}
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
    showInline(btnOff,false);
    showInline(btnHelp,false);
    return;
  }

  if (state === 'denied') {
    try { localStorage.setItem(LS_GEO_STATE, 'blocked'); } catch {}
    if (txt) txt.textContent = 'Para activar beneficios cerca tuyo, habilitalo desde la configuración del navegador.';
    showInline(btnOn,false); showInline(btnOff,false); showInline(btnHelp,true);
    return;
  }

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

async function updateGeoUI() {
  const state = await detectGeoPermission();

  if (state === 'granted') {
    setGeoMarketingUI(false);
    setGeoRegularUI('granted');
    startGeoWatch();

    // ⬇️ NUEVO: si el navegador ya tenía permiso, reflejamos en Firestore
    await setClienteConfigPatch({
      geoEnabled: true,
      geoOptInSource: 'permission',
      geoUpdatedAt: new Date().toISOString()
    });

    return;
  }

  // Sin permiso → frenamos el watch y reflejamos desactivado
  stopGeoWatch();

  if (state === 'denied') {
    setGeoMarketingUI(false);
    setGeoRegularUI('denied');

    // ⬇️ NUEVO: guardamos que está deshabilitado
    await setClienteConfigPatch({
      geoEnabled: false,
      geoUpdatedAt: new Date().toISOString()
    });

    return;
  }

  // Estado "prompt"/desconocido: mostramos marketing y no tocamos config
  setGeoMarketingUI(true);
}


// Activar: optimista y verificación liviana
async function handleGeoEnable() {
  const { banner } = geoEls();

  try { localStorage.setItem(LS_GEO_STATE, 'accepted'); } catch {}
  emit('rampet:geo:enabled', { method: 'ui' });
  show(banner, false);
  startGeoWatch();

  // ← marcar geoEnabled en config
  await setClienteConfigPatch({
    geoEnabled: true,
    geoOptInSource: 'ui',
    geoUpdatedAt: new Date().toISOString()
  });

  try {
    await new Promise((resolve) => {
      if (!navigator.geolocation?.getCurrentPosition) return resolve();

      let settled = false;
      const done = () => { if (settled) return; settled = true; resolve(); };

      navigator.geolocation.getCurrentPosition(
        () => { done(); },
        () => { done(); },
        { timeout: 3000, maximumAge: 120000, enableHighAccuracy: false }
      );

      setTimeout(done, 3500);
    });
  } catch {}

  setTimeout(() => { updateGeoUI(); }, 0);
}

function handleGeoDisable() {
  try { localStorage.setItem(LS_GEO_STATE, 'deferred'); } catch {}
  emit('rampet:geo:disabled', { method: 'ui' });

  // ← marcar geo deshabilitado en config
  setClienteConfigPatch({
    geoEnabled: false,
    geoUpdatedAt: new Date().toISOString()
  }).catch(() => {});

  updateGeoUI();
}
function handleGeoHelp() { alert('Para activarlo:\n\n1) Abrí configuración del navegador.\n2) Permisos → Activar ubicación.\n3) Recargá la página.'); }
function wireGeoButtonsOnce() {
  const { banner, btnOn, btnOff, btnHelp } = geoEls();
  if (!banner || banner._wired) return; banner._wired = true;
  btnOn?.addEventListener('click', handleGeoEnable);
  btnOff?.addEventListener('click', handleGeoDisable);
  btnHelp?.addEventListener('click', handleGeoHelp);
}

export async function ensureGeoOnStartup(){ wireGeoButtonsOnce(); await updateGeoUI(); }
export async function maybeRefreshIfStale(){ await updateGeoUI(); }
try { window.ensureGeoOnStartup = ensureGeoOnStartup; window.maybeRefreshIfStale = maybeRefreshIfStale; } catch {}

// ─────────────────────────────────────────────────────────────
// GEO TRACKING “MIENTRAS ESTÉ ABIERTA”
// ─────────────────────────────────────────────────────────────
const GEO_CONF = { THROTTLE_S: 180, DIST_M: 250, DAILY_CAP: 30 };
const LS_GEO_DAY = 'geoDay';
const LS_GEO_COUNT = 'geoCount';

let geoWatchId = null;
let lastSample = { t: 0, lat: null, lng: null };

function round3(n){ return Math.round((+n) * 1e3) / 1e3; }
function haversineMeters(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad((b.lat||0) - (a.lat||0));
  const dLng = toRad((b.lng||0) - (a.lng||0));
  const la1 = toRad(a.lat||0), la2 = toRad(b.lat||0);
  const h = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function incDailyCount() {
  const day = todayKey();
  const curDay = localStorage.getItem(LS_GEO_DAY);
  if (curDay !== day) {
    localStorage.setItem(LS_GEO_DAY, day);
    localStorage.setItem(LS_GEO_COUNT, '0');
  }
  const c = +localStorage.getItem(LS_GEO_COUNT) || 0;
  localStorage.setItem(LS_GEO_COUNT, String(c+1));
  return c+1;
}
function canWriteMoreToday() {
  const day = todayKey();
  const curDay = localStorage.getItem(LS_GEO_DAY);
  const c = +localStorage.getItem(LS_GEO_COUNT) || 0;
  return (curDay !== day) || (c < GEO_CONF.DAILY_CAP);
}

async function writeGeoSamples(lat, lng) {
  try {
    if (!canWriteMoreToday()) return;
    const uid = firebase.auth().currentUser?.uid;
    if (!uid) return;
    const clienteId = await getClienteDocIdPorUID(uid);
    if (!clienteId) return;

    const db = firebase.firestore();
    const now = firebase.firestore.FieldValue.serverTimestamp();

    await db.collection('clientes').doc(clienteId)
      .collection('geo_raw').doc().set({
        lat, lng, capturedAt: now, source: 'pwa'
      }, { merge: false });

    await db.collection('public_geo').doc(uid)
      .collection('samples').doc().set({
        lat3: round3(lat), lng3: round3(lng),
        capturedAt: now, rounded: true, source: 'pwa'
      }, { merge: false });

    incDailyCount();
  } catch (e) {
    console.warn('[geo] writeGeoSamples error', e?.message || e);
  }
}

function shouldRecord(lat, lng) {
  const nowT = Date.now();
  const dt = (nowT - (lastSample.t || 0)) / 1000;
  if (dt >= GEO_CONF.THROTTLE_S) return true;
  const dist = haversineMeters(
    (lastSample.lat != null && lastSample.lng != null) ? {lat:lastSample.lat, lng:lastSample.lng} : null,
    { lat, lng }
  );
  return dist >= GEO_CONF.DIST_M;
}

function onGeoPosSuccess(pos) {
  try {
    const lat = pos?.coords?.latitude;
    const lng = pos?.coords?.longitude;
    if (lat == null || lng == null) return;
    if (!shouldRecord(lat, lng)) return;
    lastSample = { t: Date.now(), lat, lng };
    writeGeoSamples(lat, lng);
  } catch (e) {
    console.warn('[geo] onGeoPosSuccess error', e?.message || e);
  }
}
function onGeoPosError(_) {}

function startGeoWatch() {
  if (!navigator.geolocation || geoWatchId != null) return;
  if (document.visibilityState !== 'visible') return;
  try {
    geoWatchId = navigator.geolocation.watchPosition(
      onGeoPosSuccess, onGeoPosError,
      { enableHighAccuracy: false, maximumAge: 60000, timeout: 10000 }
    );
  } catch (e) { console.warn('[geo] start watch error', e?.message || e); }
}
function stopGeoWatch() {
  try { if (geoWatchId != null) { navigator.geolocation.clearWatch(geoWatchId); } } catch {}
  geoWatchId = null;
}

try {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') startGeoWatch();
    else stopGeoWatch();
  });
} catch {}

// ─────────────────────────────────────────────────────────────
// FORMULARIO DOMICILIO (clientes/{id}.domicilio)
// ─────────────────────────────────────────────────────────────
function buildAddressLine(c) {
  const parts = [];
  if (c.calle) parts.push(c.calle + (c.numero ? ' ' + c.numero : ''));
  const pisoDto = [c.piso, c.depto].filter(Boolean).join(' ');
  if (pisoDto) parts.push(pisoDto);
  if (c.codigoPostal || c.localidad) {
    parts.push([c.codigoPostal, c.localidad].filter(Boolean).join(' '));
  }
  if (c.provincia) {
    parts.push(c.provincia === 'CABA' ? 'CABA' : `Provincia de ${c.provincia}`);
  }
  return parts.filter(Boolean).join(', ');
}

export async function initDomicilioForm() {
  const card = document.getElementById('address-card');
  if (!card || card._wired) return; card._wired = true;

  const g = id => document.getElementById(id);
  const getValues = () => ({
    calle: g('dom-calle')?.value?.trim() || '',
    numero: g('dom-numero')?.value?.trim() || '',
    piso: g('dom-piso')?.value?.trim() || '',
    depto: g('dom-depto')?.value?.trim() || '',
    localidad: g('dom-localidad')?.value?.trim() || '',
    partido: g('dom-partido')?.value?.trim() || '',
    provincia: g('dom-provincia')?.value?.trim() || '',
    codigoPostal: g('dom-cp')?.value?.trim() || '',
    pais: g('dom-pais')?.value?.trim() || '',
    referencia: g('dom-referencia')?.value?.trim() || '',
  });

  // Precargar si existe
  try {
    const uid = firebase.auth().currentUser?.uid;
    if (uid) {
      const clienteId = await getClienteDocIdPorUID(uid);
      if (clienteId) {
        const snap = await firebase.firestore().collection('clientes').doc(clienteId).get();
        const dom = snap.data()?.domicilio?.components;
        if (dom) {
          g('dom-calle').value = dom.calle || '';
          g('dom-numero').value = dom.numero || '';
          g('dom-piso').value = dom.piso || '';
          g('dom-depto').value = dom.depto || '';
          // g('dom-barrio').value = dom.barrio || '';
          g('dom-localidad').value = dom.localidad || '';
          g('dom-partido').value = dom.partido || '';
          g('dom-provincia').value = dom.provincia || '';
          g('dom-cp').value = dom.codigoPostal || '';
          g('dom-pais').value = dom.pais || 'Argentina';
          g('dom-referencia').value = dom.referencia || '';
        }
      }
    }
  } catch {}

  g('address-save')?.addEventListener('click', async () => {
    try {
      const uid = firebase.auth().currentUser?.uid;
      if (!uid) return toast('Iniciá sesión para guardar tu domicilio','warning');
      const clienteId = await getClienteDocIdPorUID(uid);
      if (!clienteId) return toast('No encontramos tu ficha de cliente','error');

      const components = getValues();
      const addressLine = buildAddressLine(components);
      await firebase.firestore().collection('clientes').doc(clienteId).set({
        domicilio: {
          addressLine,
          components,
          geocoded: { lat: null, lng: null, geohash7: null, provider: null, confidence: null, geocodedAt: null, verified: false }
        }
      }, { merge: true });

      try { localStorage.setItem('addressBannerDismissed', '1'); } catch {}
      toast('Domicilio guardado. ¡Gracias!', 'success');
    } catch (e) {
      console.error('save domicilio error', e);
      toast('No pudimos guardar el domicilio', 'error');
    }
  });

  g('address-skip')?.addEventListener('click', () => {
    toast('Podés cargarlo cuando quieras desde tu perfil.', 'info');
  });
}

