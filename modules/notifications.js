// /modules/notifications.js — FCM + VAPID + Opt-In (banner) + Switch + Geo + Domicilio (lógica depurada)
'use strict';

/* ────────────────────────────────────────────────────────────
   CONFIG / HELPERS
   ──────────────────────────────────────────────────────────── */
const VAPID_PUBLIC = (window.__RAMPET__ && window.__RAMPET__.VAPID_PUBLIC) || '';
if (!VAPID_PUBLIC) console.warn('[FCM] Falta window.__RAMPET__.VAPID_PUBLIC en index.html');

function $(id){ return document.getElementById(id); }
function show(el, on){ if (el) el.style.display = on ? 'block' : 'none'; }
function showInline(el, on){ if (el) el.style.display = on ? 'inline-block' : 'none'; }
function emit(name, detail){ try { document.dispatchEvent(new CustomEvent(name, { detail })); } catch (e) {} }
function toast(msg, type='info'){ try { window.UI && window.UI.showToast && window.UI.showToast(msg, type); } catch (e) {} }
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

/* ────────────────────────────────────────────────────────────
   ESTADO LOCAL / CONSTANTES
   ──────────────────────────────────────────────────────────── */
// NOTIFS
// LS_NOTIF_STATE: 'deferred' | 'accepted' | 'blocked' | 'soft_blocked' | null
const LS_NOTIF_STATE = 'notifState';
const LS_NOTIF_SUPPRESS_UNTIL = 'notifSuppressUntil'; // epoch ms (cooldown "No quiero")
// MINI-BANNER NOTIFS
const LS_NOTIF_MINI_LAST_SHOWN_AT  = 'notifMiniLastShownAt';   // timestamp última vez mostrado
const LS_NOTIF_MINI_SILENCE_UNTIL  = 'notifMiniSilenceUntil';  // silencio (10 días, o más)
const LS_NOTIF_MINI_NOQUIERO_COUNT = 'notifMiniNoQuieroCount'; // contador de "No quiero"

const NOTIF_MINI_INTERVAL_DAYS = 4;   // cada cuántos días se puede mostrar
const NOTIF_MINI_SILENCE_DAYS  = 10;  // silencio cuando cierra o dice No quiero

// GEO
const LS_GEO_STATE   = 'geoState';   // 'deferred' | 'accepted' | 'blocked' | null


// GEO: supresión del banner grande por “cool-down”
const LS_GEO_SUPPRESS_UNTIL = 'geoSuppressUntil'; // epoch ms
const GEO_COOLDOWN_DAYS = (window.__RAMPET__ && window.__RAMPET__.GEO_COOLDOWN_DAYS != null)
  ? window.__RAMPET__.GEO_COOLDOWN_DAYS : 60;

// GEO: “defer por sesión” (oculta banner grande solo hasta recargar)
const GEO_SS_DEFER_KEY = 'geoBannerDeferred';

// Domicilio: flags de sesión/persistencia
const SS_ADDR_DEFER  = 'addressBannerDeferred';
const LS_ADDR_DISMISS = 'addressBannerDismissed';

function _nowMs(){ return Date.now(); }
function setGeoSuppress(days = GEO_COOLDOWN_DAYS){
  try { localStorage.setItem(LS_GEO_SUPPRESS_UNTIL, String(_nowMs() + days*24*60*60*1000)); } catch (e) {}
}
function clearGeoSuppress(){ try { localStorage.removeItem(LS_GEO_SUPPRESS_UNTIL); } catch (e) {} }
function isGeoSuppressedNow(){
  try { const until = +localStorage.getItem(LS_GEO_SUPPRESS_UNTIL) || 0; return until > _nowMs(); }
  catch (e) { return false; }
}

function isGeoDeferredThisSession(){
  try { return sessionStorage.getItem(GEO_SS_DEFER_KEY) === '1'; } catch (e) { return false; }
}
function deferGeoBannerThisSession(){
  try { sessionStorage.setItem(GEO_SS_DEFER_KEY,'1'); } catch (e) {}
}

let __notifReqInFlight = false;
let __tokenReqLock = null;
let __hardResetAttempted = false;
let __tailRetryScheduled = false;
let __tokenProvisionPending = false;

const SW_PATH = '/firebase-messaging-sw.js';
const AUTO_RESUBSCRIBE = true;

/* ────────────────────────────────────────────────────────────
   ANTI “checked por HTML” — Perfil NOTIFS arranca OFF
   ──────────────────────────────────────────────────────────── */
(function ensureProfileCheckboxStartsOff(){
  try {
    const off = () => {
      const cb = document.getElementById('prof-consent-notif');
      if (cb) { cb.removeAttribute('checked'); cb.checked = false; }
    };
    off();
    if (document.readyState === 'loading') {
      document.addEventListener('readystatechange', () => {
        if (document.readyState === 'interactive' || document.readyState === 'complete') off();
      });
    }
  } catch (e) {}
})();

/* ────────────────────────────────────────────────────────────
   BOOTSTRAP (primera sesión de pestaña)
   ──────────────────────────────────────────────────────────── */
function bootstrapFirstSessionUX(){
  try {
    if (sessionStorage.getItem('rampet:firstSessionDone') === '1') return;

    // NOTIFS → primera vez sin estado local: muestro card de marketing
    let st = null;
    try { st = localStorage.getItem(LS_NOTIF_STATE); } catch (e) {}
    if (st == null) { show($('notif-prompt-card'), true); show($('notif-card'), false); }

    // GEO / DOMICILIO
    ensureAddressBannerButtons();
    wireGeoButtonsOnce();
    setTimeout(() => { updateGeoUI().catch(()=>{}); }, 0);

    // UI de notifs sin pedir permiso
    setTimeout(() => { refreshNotifUIFromPermission(); }, 0);

    sessionStorage.setItem('rampet:firstSessionDone', '1');
  } catch (e) {}
}

/* ────────────────────────────────────────────────────────────
   NOTIF OFF — banner pequeño con botón a Perfil
   ──────────────────────────────────────────────────────────── */
function ensureNotifOffBanner() {
  let el = $('notif-off-banner');
  if (el) return el;

  el = document.createElement('div');
  el.id = 'notif-off-banner';
  el.style.cssText = [
    'display:none',
    'margin:6px 0',
    'padding:6px 10px',
    'font-size:0.78rem',
    'background:#fff7e6',
    'border:1px solid #ffe0b3',
    'border-radius:6px',
    'color:#705000'
  ].join(';');

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
      <span aria-hidden="true" style="font-size:14px;">🔕</span>
      <div style="flex:1 1 auto; line-height:1.2;">
        <div style="font-weight:600; margin-bottom:1px;">
          No estás recibiendo notificaciones.
        </div>
        <div>
          Te estás perdiendo <em>promos y ofertas</em> pensadas para vos.
          Activálas desde <em>Mi Perfil</em>.
        </div>
      </div>
      <div style="display:flex;gap:6px;">
        <button id="notif-off-open" class="secondary-btn" style="padding:2px 8px;font-size:0.75rem;">Abrir Perfil</button>
        <button id="notif-off-nothanks" class="link-btn" style="font-size:0.75rem;">No quiero</button>
        <button id="notif-off-close" class="link-btn" style="font-size:0.75rem;">✕</button>
      </div>
    </div>
  `;

  const slot = $('notif-off-slot');
  if (slot) slot.appendChild(el);
  else document.body.appendChild(el);

  // Abrir perfil
  $('notif-off-open').addEventListener('click', () => {
    try { window.UI.openProfileModal(); } catch {}
    try { syncProfileConsentUI(); } catch {}
  });

  // ✕ Cerrar → silencio 10 días
  $('notif-off-close').addEventListener('click', () => {
    const until = Date.now() + NOTIF_MINI_SILENCE_DAYS*24*60*60*1000;
    localStorage.setItem(LS_NOTIF_MINI_SILENCE_UNTIL, until);
    el.style.display = 'none';
    toast('Perfecto, no mostramos este aviso por unos días.','info');
  });

  // Botón NO QUIERO
  $('notif-off-nothanks').addEventListener('click', () => {
    let c = +(localStorage.getItem(LS_NOTIF_MINI_NOQUIERO_COUNT) || 0);
    c++;
    localStorage.setItem(LS_NOTIF_MINI_NOQUIERO_COUNT, c);

    const now = Date.now();

    if (c >= 2) {
      // Segunda vez ⇒ soft-block 25 días
      const sup = now + 25*24*60*60*1000;
      localStorage.setItem(LS_NOTIF_STATE, 'soft_blocked');
      localStorage.setItem(LS_NOTIF_SUPPRESS_UNTIL, sup);

      const silent = now + 25*24*60*60*1000;
      localStorage.setItem(LS_NOTIF_MINI_SILENCE_UNTIL, silent);

      el.style.display = 'none';
      toast('Listo, no insistimos más por un buen tiempo.','info');
    } else {
      // Primera vez ⇒ silencio 10 días
      const silent = now + NOTIF_MINI_SILENCE_DAYS*24*60*60*1000;
      localStorage.setItem(LS_NOTIF_MINI_SILENCE_UNTIL, silent);
      el.style.display = 'none';
      toast('Perfecto, no te lo recordamos por unos días.', 'info');
    }
  });

  return el;
}

function canShowMiniNotifBannerNow() {
  const now = Date.now();

  try {
    const silence = +localStorage.getItem(LS_NOTIF_MINI_SILENCE_UNTIL) || 0;
    if (silence > now) return false;

    const last = +localStorage.getItem(LS_NOTIF_MINI_LAST_SHOWN_AT) || 0;
    if (!last) return true;

    const interval = NOTIF_MINI_INTERVAL_DAYS * 24*60*60*1000;
    return (now - last) >= interval;
  } catch (e) {
    return true;
  }
}



function showNotifOffBanner(on) {
  const el = ensureNotifOffBanner();
  if (!el) return;

  if (!on) {
    el.style.display = 'none';
    return;
  }

  // Respetar silencio y frecuencia (cada 4 días)
  if (!canShowMiniNotifBannerNow()) {
    el.style.display = 'none';
    return;
  }

  // Registrar fecha de última exposición
  localStorage.setItem(LS_NOTIF_MINI_LAST_SHOWN_AT, Date.now().toString());
  el.style.display = 'block';
}

/* ────────────────────────────────────────────────────────────
   FIREBASE / SW helpers
   ──────────────────────────────────────────────────────────── */
async function ensureMessagingCompatLoaded(){
  if (typeof firebase?.messaging === 'function') return;
  await new Promise((ok, err) => {
    const s = document.createElement('script');
    s.src = 'https://www.gstatic.com/firebasejs/9.6.0/firebase-messaging-compat.js';
    s.onload = ok; s.onerror = err;
    document.head.appendChild(s);
  });
}
async function registerSW(){
  if (!('serviceWorker' in navigator)) { console.warn('[FCM] SW no soportado'); return false; }
  try {
    try {
      const head = await fetch(SW_PATH, { method: 'HEAD' });
      if (!head.ok) console.warn('[FCM] %s no accesible (HTTP %s )', SW_PATH, head.status);
    } catch (e) {}
    const existing = await navigator.serviceWorker.getRegistration(SW_PATH);
    if (existing) { console.log('✅ SW FCM ya registrado:', existing.scope); return true; }
    const reg = await navigator.serviceWorker.register(SW_PATH);
    console.log('✅ SW FCM registrado:', reg.scope || (location.origin + '/'));
    return true;
  } catch (e) { console.warn('[FCM] No se pudo registrar SW:', e && e.message || e); return false; }
}
async function waitForActiveSW(){
  if (!('serviceWorker' in navigator)) return null;
  let reg = null;
  try {
    reg = await navigator.serviceWorker.getRegistration(SW_PATH)
       || await navigator.serviceWorker.ready
       || await navigator.serviceWorker.getRegistration('/')
       || await navigator.serviceWorker.getRegistration();
  } catch (e) {}
  if (!reg) return null;
  if (reg.active && reg.active.state === 'activated') return reg;

  const sw = reg.active || reg.installing || reg.waiting;
  if (sw) {
    await new Promise((resolve)=>{
      const done = () => resolve();
      sw.addEventListener('statechange', ()=>{ if (sw.state === 'activated') done(); });
      if (sw.state === 'activated') done();
      setTimeout(done, 2500);
    });
  }
  try { reg = await navigator.serviceWorker.getRegistration(SW_PATH) || reg; } catch (e) {}
  return reg;
}

/* ────────────────────────────────────────────────────────────
   Firestore: clientes/{id}, config y tokens
   ──────────────────────────────────────────────────────────── */

async function getClienteDocIdPorUID(uid){
  // 1) Intentar usar la referencia centralizada que expone data.js en window.clienteRef
  try {
    const ref = (typeof window !== 'undefined') ? window.clienteRef : null;
    if (ref && ref.id) {
      return ref.id;
    }
  } catch (e) {
    console.warn("[PWA] Error leyendo window.clienteRef en notifications.js:", e);
  }

  // 2) Fallback: resolver por authUID directamente (más robusto, sin limit(1))
  if (!uid) {
    const current = firebase.auth().currentUser;
    uid = current && current.uid;
  }
  if (!uid) {
    console.error("[PWA] No hay UID para resolver cliente en getClienteDocIdPorUID");
    return null;
  }

  const snap = await firebase.firestore()
    .collection('clientes')
    .where('authUID','==', uid)
    .get(); // ← sin limit(1), queremos ver si hay duplicados

  if (snap.empty) {
    console.error("[PWA] No se encontró cliente para authUID (fallback en notifications.js):", uid);
    return null;
  }

  if (snap.size > 1) {
    console.warn(
      "[PWA] ALERTA: Más de un cliente con el mismo authUID (fallback en notifications.js).",
      {
        authUID: uid,
        ids: snap.docs.map(d => d.id)
      }
    );
  }

  // En fallback nos quedamos con el primero (el caso normal es que haya 1 solo)
  return snap.docs[0].id;
}

async function setClienteConfigPatch(partial){
  try {
    const uid = firebase.auth().currentUser && firebase.auth().currentUser.uid; if (!uid) return;
    const clienteId = await getClienteDocIdPorUID(uid) || uid;
    await firebase.firestore().collection('clientes').doc(clienteId).set({ config: partial }, { merge: true });
  } catch (e) { console.warn('[config] setClienteConfigPatch error:', e && e.message || e); }
}
const MAX_TOKENS = 5;
function dedupeTokens(arr){
  const out=[], seen = new Set();
  const list = Array.isArray(arr) ? arr : [];
  for (const t of list){ const s=(t||'').trim(); if (!s) continue; if (!seen.has(s)){ seen.add(s); out.push(s); } }
  return out;
}
async function setFcmTokensOnCliente(newTokens){
  const uid = firebase.auth().currentUser && firebase.auth().currentUser.uid; if (!uid) throw new Error('No hay usuario logueado.');
  let clienteId = await getClienteDocIdPorUID(uid);
  let ref;
  if (clienteId){ ref = firebase.firestore().collection('clientes').doc(clienteId); }
  else { clienteId = uid; ref = firebase.firestore().collection('clientes').doc(clienteId); await ref.set({ authUID: uid, creadoDesde: 'pwa' }, { merge:true }); }
  let current = [];
  try { const snap = await ref.get(); current = Array.isArray(snap.data() && snap.data().fcmTokens) ? snap.data().fcmTokens : []; } catch (e) {}
  const merged = dedupeTokens([].concat(newTokens || [], current)).slice(0, MAX_TOKENS);
  await ref.set({ fcmTokens: merged }, { merge: true });
  return clienteId;
}
async function clearFcmTokensOnCliente(){
  const uid = firebase.auth().currentUser && firebase.auth().currentUser.uid; if (!uid) throw new Error('No hay usuario logueado.');
  const clienteId = await getClienteDocIdPorUID(uid); if (!clienteId) throw new Error('No encontré tu doc en clientes (authUID).');
  await firebase.firestore().collection('clientes').doc(clienteId).set({ fcmTokens: [] }, { merge: true });
}

/* ────────────────────────────────────────────────────────────
   Token helpers (guardar/opt-out)
   ──────────────────────────────────────────────────────────── */
async function guardarTokenEnMiDoc(token){
  const clienteId = await setFcmTokensOnCliente([token]);
  await setClienteConfigPatch({ notifEnabled:true, notifOptInSource:'ui', notifUpdatedAt:new Date().toISOString() });
  try {
    localStorage.setItem('fcmToken', token);
    localStorage.setItem(LS_NOTIF_STATE,'accepted');
  } catch (e) {}
  // Ocultar inmediatamente UI de notifs (marketing + switch)
  try { show($('notif-card'), false); } catch (e) {}
  try { show($('notif-prompt-card'), false); } catch (e) {}
  emit('rampet:consent:notif-opt-in', { source:'ui' });
  showNotifOffBanner(false);
  console.log('✅ Token FCM guardado en clientes/' + clienteId);
}
async function borrarTokenYOptOut(){
  try {
    await ensureMessagingCompatLoaded();
    try { await firebase.messaging().deleteToken(); } catch (e) {}
    await clearFcmTokensOnCliente();
    try { localStorage.removeItem('fcmToken'); localStorage.setItem(LS_NOTIF_STATE,'blocked'); } catch (e) {}
    await setClienteConfigPatch({ notifEnabled:false, notifUpdatedAt:new Date().toISOString() });
    emit('rampet:consent:notif-opt-out', { source:'ui' });
    showNotifOffBanner(true);
  } catch(e){ console.warn('[FCM] borrarTokenYOptOut error:', e && e.message || e); }
}

/* Retries IndexedDB/SW */
function isBadRequestOnDelete(e){
  const m=(e && e.message ? e.message : '').toLowerCase();
  return m.includes('fcmregistrations') || m.includes('unsubscribe') || (m.includes('400') && m.includes('delete'));
}
function isTransientIdbError(e){
  const msg=(e && (e.message || String(e))) ? String(e.message || e).toLowerCase() : '';
  const name=(e && e.name) ? e.name.toLowerCase() : '';
  return name.includes('invalidstateerror') ||
         msg.includes('database connection is closing') ||
         msg.includes('mutation') ||
         msg.includes('database is closing') ||
         msg.includes("failed to execute 'transaction'");
}
function deleteDb(name){
  return new Promise((resolve)=>{ try{ const req=indexedDB.deleteDatabase(name); req.onsuccess=req.onerror=req.onblocked=()=>resolve(); }catch(e){ resolve(); } });
}
async function hardResetFcmStores(){
  try { localStorage.removeItem('fcmToken'); } catch (e) {}
  await deleteDb('firebase-messaging-database');
  await deleteDb('firebase-installations-database');
  try {
    const reg = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
    if (reg) { try { await reg.unregister(); } catch (e2) {} }
    await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    await navigator.serviceWorker.ready;
  } catch (e) {}
  await sleep(300);
}
async function getTokenWithRetry(reg, vapidKey, maxTries=6){
  while(__tokenReqLock){ try { await __tokenReqLock; } catch (e) {} }
  let attempt = 0;
  const run = (async()=>{
    for(;;){
      attempt++;
      try{
        reg = await waitForActiveSW() || reg;
        try { await navigator.serviceWorker.ready; } catch (e2) {}
        const tok = await firebase.messaging().getToken({ vapidKey, serviceWorkerRegistration: reg });
        return tok;
      }catch(e){
        if (isTransientIdbError(e) && attempt < maxTries){
          const delay = Math.min(200*(2**(attempt-1)), 2400);
          console.warn('[FCM] retry #%s en %sms… (%s)', attempt, delay, (e && e.message) || e);
          await sleep(delay);
          continue;
        }
        if (isBadRequestOnDelete(e) && !__hardResetAttempted){
          __hardResetAttempted = true;
          console.warn('[FCM] 400 DELETE. Hard reset y reintento…');
          await hardResetFcmStores();
          attempt = 0;
          continue;
        }
        throw e;
      }
    }
  })();
  __tokenReqLock = run;
  try { return await run; }
  finally { __tokenReqLock = null; }
}
async function obtenerYGuardarTokenOneShot(){
  await ensureMessagingCompatLoaded();
  const reg = await waitForActiveSW(); if (!reg || !reg.active) return null;
  __tokenProvisionPending = true;
  try{
    let tok = null;
    try { tok = await getTokenWithRetry(reg, VAPID_PUBLIC, 3); }
    catch(e){ console.warn('[FCM] one-shot getToken falló:', (e && e.message) || e); return null; }
    if (!tok) return null;
    await guardarTokenEnMiDoc(tok);
    try { refreshNotifUIFromPermission(); } catch (e) {}
    return tok;
  } finally { __tokenProvisionPending = false; }
}
async function obtenerYGuardarToken(){
  __tailRetryScheduled = false; __tokenProvisionPending = true;
  await ensureMessagingCompatLoaded();
  try{
    const reg = await waitForActiveSW();
    if (!reg || !reg.active){
      toast('No se pudo activar notificaciones (SW no activo).','error');
      try{
        const once = ()=>{ try { navigator.serviceWorker.removeEventListener('controllerchange', once); } catch (e) {} setTimeout(()=>{ obtenerYGuardarToken().catch(()=>{}); }, 300); };
        navigator.serviceWorker.addEventListener('controllerchange', once, { once:true });
      }catch(e){}
      throw new Error('SW no activo');
    }
    let tok = null;
    try { tok = await getTokenWithRetry(reg, VAPID_PUBLIC, 6); }
    catch(e){
      if (isTransientIdbError(e) && !__tailRetryScheduled){
        __tailRetryScheduled = true;
        setTimeout(()=>{ obtenerYGuardarToken().catch(()=>{}); }, 1500);
        throw e;
      }
      toast('No se pudo activar notificaciones.','error');
      throw e;
    }
    if (!tok){ toast('No se pudo activar notificaciones (token vacío).','warning'); throw new Error('token vacío'); }
    await guardarTokenEnMiDoc(tok);
    toast('Notificaciones activadas ✅','success');
    try { refreshNotifUIFromPermission(); } catch (e) {}
    return tok;
  } finally { __tokenProvisionPending = false; }
}

/* ────────────────────────────────────────────────────────────
   UI NOTIFICACIONES (banners + switch)
   ──────────────────────────────────────────────────────────── */
function isNotifEnabledLocally(){ try { return !!localStorage.getItem('fcmToken'); } catch (e) { return false; } }
async function fetchServerNotifEnabled(){
  try {
    const uid = firebase.auth().currentUser && firebase.auth().currentUser.uid; if (!uid) return null;
    const clienteId = await getClienteDocIdPorUID(uid) || uid;
    const snap = await firebase.firestore().collection('clientes').doc(clienteId).get();
    const data = snap.exists ? snap.data() : null;
    const hasTokens = Array.isArray(data && data.fcmTokens) && data.fcmTokens.length > 0;
    const cfgEnabled = !!(data && data.config && data.config.notifEnabled);
    return hasTokens && cfgEnabled;
  } catch (e) { return null; }
}

function refreshNotifUIFromPermission(){
  const hasNotif = ('Notification' in window);
  const perm     = hasNotif ? Notification.permission : 'unsupported';
  const cardMarketing = $('notif-prompt-card');
  const cardSwitch    = $('notif-card');
  const warnBlocked   = $('notif-blocked-warning');
  const switchEl      = $('notif-switch');

  show(cardMarketing, false);
  show(cardSwitch, false);
  show(warnBlocked, false);

  if (!hasNotif) return;

  let lsState = null;
  try { lsState = localStorage.getItem(LS_NOTIF_STATE) || null; } catch (e) {}
  const hasToken = isNotifEnabledLocally();
  const pending = __tokenProvisionPending || !!__tokenReqLock || __notifReqInFlight;

  // 1) Bloqueo REAL del navegador → mensaje técnico “candado…”
  if (perm === 'denied') {
    if (switchEl) switchEl.checked = false;
    show(warnBlocked, true);
    showNotifOffBanner(true);
    return;
  }

  // 2) Hard-block de la app (opt-out fuerte desde switch/perfil)
  if (lsState === 'blocked') {
    if (switchEl) switchEl.checked = false;
    // No mostramos el texto de "bloqueado en el navegador"
    show(warnBlocked, false);
    showNotifOffBanner(true);
    return;
  }

  // 3) Soft-block ("No quiero" en banner grande) + cooldown
  if (lsState === 'soft_blocked') {
    if (switchEl) switchEl.checked = false;

    let suppressUntil = 0;
    try {
      suppressUntil = +localStorage.getItem(LS_NOTIF_SUPPRESS_UNTIL) || 0;
    } catch (e) { suppressUntil = 0; }

    const now = Date.now();
    const inCooldown = suppressUntil && suppressUntil > now;

    // Durante el cooldown: no marketing, no banner técnico, ni banner off.
    // Pasado el cooldown: usamos el banner chico "no estás recibiendo notificaciones".
    show(warnBlocked, false);
    if (!pending && !inCooldown) {
      showNotifOffBanner(true);    // recordatorio suave después de 25 días
    } else {
      showNotifOffBanner(false);
    }
    return;
  }

  // 4) “deferred” (Luego) → mostrar switch OFF, marketing oculto
  if (lsState === 'deferred'){
    if (switchEl) switchEl.checked = false;
    if (!pending) show(cardSwitch, true);
    showNotifOffBanner(false);
    return;
  }

  // 5) granted
  if (perm === 'granted'){
    if (switchEl) switchEl.checked = !!hasToken;
    if (!hasToken && !pending) show(cardSwitch, true);
    showNotifOffBanner(!hasToken);
    return;
  }

  // 6) default → primera vez (banner grande marketing)
  if (!pending) show(cardMarketing, true);
  if (switchEl) switchEl.checked = false;
  showNotifOffBanner(false);
}


/* Watcher de permiso (mantiene UI y re-suscripción) */
let __permWatcher = { timer:null, last:null, wired:false };
function startNotifPermissionWatcher(){
  if (__permWatcher.wired) return; __permWatcher.wired = true;

  try {
    if ('permissions' in navigator && navigator.permissions && navigator.permissions.query){
      navigator.permissions.query({ name:'notifications' }).then((permStatus)=>{
        __permWatcher.last = permStatus.state;
        refreshNotifUIFromPermission(); syncProfileConsentUI();
        const st = localStorage.getItem(LS_NOTIF_STATE);
if (
  AUTO_RESUBSCRIBE &&
  permStatus.state === 'granted' &&
  hasPriorAppConsent() &&
  !isNotifEnabledLocally() &&
  st !== 'blocked' &&
  st !== 'soft_blocked'
) {
  obtenerYGuardarTokenOneShot().catch(()=>{});
}

        permStatus.onchange = ()=>{
          __permWatcher.last = permStatus.state;
          refreshNotifUIFromPermission(); syncProfileConsentUI();
          if (AUTO_RESUBSCRIBE && permStatus.state==='granted' && hasPriorAppConsent() && !isNotifEnabledLocally() && (localStorage.getItem(LS_NOTIF_STATE)!=='blocked')) {
            obtenerYGuardarTokenOneShot().catch(()=>{});
          }
        };
      }).catch(()=>{ startPollingWatcher(); });
      return;
    }
  } catch (e) {}
  startPollingWatcher();
}
function startPollingWatcher(){
  if (__permWatcher.timer) return;
  __permWatcher.timer = setInterval(()=>{
    const cur = (window.Notification && window.Notification.permission) || 'default';
    if (cur === __permWatcher.last) return;
    __permWatcher.last = cur;
    refreshNotifUIFromPermission(); syncProfileConsentUI();
  const st = localStorage.getItem(LS_NOTIF_STATE);
if (
  AUTO_RESUBSCRIBE &&
  cur === 'granted' &&
  hasPriorAppConsent() &&
  !isNotifEnabledLocally() &&
  st !== 'blocked' &&
  st !== 'soft_blocked'
) {
  obtenerYGuardarTokenOneShot().catch(()=>{});
}

  }, 1200);
}
function stopNotifPermissionWatcher(){ if (__permWatcher.timer){ clearInterval(__permWatcher.timer); __permWatcher.timer = null; } }

/* Handlers de notificaciones */
export async function handlePermissionRequest(){
  startNotifPermissionWatcher();
  if (!('Notification' in window)) { refreshNotifUIFromPermission(); return; }
  if (__notifReqInFlight) return;
  __notifReqInFlight = true;
  try{
    let ls = null;
    try { ls = localStorage.getItem(LS_NOTIF_STATE) || null; } catch (e) {}
    const current = Notification.permission;

    if (current === 'granted'){
      if (ls === 'blocked'){ showNotifOffBanner(true); refreshNotifUIFromPermission(); return; }
      await obtenerYGuardarToken();
      showNotifOffBanner(false);
      refreshNotifUIFromPermission();
      return;
    }

    if (current === 'denied'){
      try { localStorage.setItem(LS_NOTIF_STATE,'blocked'); } catch (e) {}
      emit('rampet:consent:notif-opt-out',{ source:'browser-denied' });
      showNotifOffBanner(true);
      refreshNotifUIFromPermission();
      return;
    }

    // default → prompt por acción del usuario
    const status = await Notification.requestPermission();
    if (status === 'granted'){
      let st = null; try { st = localStorage.getItem(LS_NOTIF_STATE) || null; } catch (e) {}
      if (st === 'blocked'){ showNotifOffBanner(true); }
      else { await obtenerYGuardarToken(); showNotifOffBanner(false); }
    } else if (status === 'denied'){
      try { localStorage.setItem(LS_NOTIF_STATE,'blocked'); } catch (e) {}
      emit('rampet:consent:notif-opt-out',{ source:'prompt' });
      showNotifOffBanner(true);
    } else {
      try { localStorage.setItem(LS_NOTIF_STATE,'deferred'); } catch (e) {}
      emit('rampet:consent:notif-dismissed',{});
    }
    refreshNotifUIFromPermission();
  } catch(e){
    console.warn('[notifications] handlePermissionRequest error:', (e && e.message) || e);
    refreshNotifUIFromPermission();
  } finally { __notifReqInFlight = false; }
}
export function handlePermissionBlockClick(){
  try {
    // “No quiero” = soft-block de marketing + cooldown
    localStorage.setItem(LS_NOTIF_STATE, 'soft_blocked');

    const now = Date.now();
    const DAYS = 25;
    const suppressUntil = now + DAYS * 24 * 60 * 60 * 1000;
    localStorage.setItem(LS_NOTIF_SUPPRESS_UNTIL, String(suppressUntil));
  } catch (e) {}

  // Ocultamos el banner grande de marketing
  show($('notif-prompt-card'), false);

  const sw = $('notif-switch');
  if (sw) sw.checked = false;

  // A nivel servidor dejamos notifEnabled en false (opt-out lógico)
  setClienteConfigPatch({
    notifEnabled: false,
    notifUpdatedAt: new Date().toISOString()
  }).catch(()=>{});

  emit('rampet:consent:notif-opt-out', { source:'ui-block' });
  toast('Podés volver a activarlas desde tu Perfil cuando quieras.','info');

  // La UI se recalcula según estado + cooldown
  refreshNotifUIFromPermission();

  // ⚠️ Importante: NO llamamos directamente a showNotifOffBanner(true)
  // porque durante el cooldown queremos silencio total.
}

export function dismissPermissionRequest(){
  try { localStorage.setItem(LS_NOTIF_STATE,'deferred'); } catch (e) {}
  show($('notif-prompt-card'), false);
  emit('rampet:consent:notif-dismissed', {});
  const sw = $('notif-switch'); if (sw) sw.checked = false;
  show($('notif-card'), true); // switch OFF visible
}
export async function handlePermissionSwitch(e){
  const checked = !!(e && e.target && e.target.checked);
  if (!('Notification' in window)) { refreshNotifUIFromPermission(); return; }
  const before = Notification.permission;

  if (checked){
    if (before === 'granted'){
      try { await obtenerYGuardarToken(); showNotifOffBanner(false); } catch (err) {}
    } else if (before === 'default'){
      const status = await Notification.requestPermission();
      if (status === 'granted'){
        try { await obtenerYGuardarToken(); showNotifOffBanner(false); } catch (err) {}
      } else if (status === 'denied'){
        try { localStorage.setItem(LS_NOTIF_STATE,'blocked'); } catch (e2) {}
        toast('Notificaciones bloqueadas en el navegador.','warning');
        const sw=$('notif-switch'); if (sw) sw.checked=false; showNotifOffBanner(true);
      } else {
        try { localStorage.setItem(LS_NOTIF_STATE,'deferred'); } catch (e3) {}
        const sw=$('notif-switch'); if (sw) sw.checked=false;
      }
    } else {
      toast('Tenés bloqueadas las notificaciones en el navegador.','warning');
      const sw=$('notif-switch'); if (sw) sw.checked=false;
      showNotifOffBanner(true);
    }
  } else {
    await borrarTokenYOptOut();
    showNotifOffBanner(true);
    toast('Notificaciones desactivadas.','info');
  }
  refreshNotifUIFromPermission();
}

/* Foreground push → mostrar notificación del sistema */
async function hookOnMessage(){
  try {
    await ensureMessagingCompatLoaded();
    const messaging = firebase.messaging();
    messaging.onMessage(async (payload)=>{
      const d = (payload && payload.data) || {};
      try {
        const reg = await navigator.serviceWorker.getRegistration(SW_PATH) || await navigator.serviceWorker.getRegistration();
        if (reg && reg.showNotification){
          await reg.showNotification(d.title || 'RAMPET', {
            body: d.body || '',
            icon: d.icon || '/images/mi_logo_192.png',
            tag : d.tag || d.id || 'rampet-fg',
            data: { url: d.url || d.click_action || '/?inbox=1' }
          });
        }
      } catch(e){ console.warn('[onMessage] error', (e && e.message) || e); }
    });
  } catch(e){ console.warn('[notifications] hookOnMessage error:', (e && e.message) || e); }
}

/* Cableado de botones del HTML (notifs) */
function wirePushButtonsOnce(){
  const allow = $('btn-activar-notif-prompt'); if (allow && !allow._wired){ allow._wired = true; allow.addEventListener('click', ()=>{ handlePermissionRequest(); }); }
  const later = $('btn-rechazar-notif-prompt'); if (later && !later._wired){ later._wired = true; later.addEventListener('click', ()=>{ dismissPermissionRequest(); }); }
  const block = $('btn-bloquear-notif-prompt'); if (block && !block._wired){ block._wired = true; block.addEventListener('click', ()=>{ handlePermissionBlockClick(); }); }
  const sw    = $('notif-switch');                if (sw && !sw._wired){ sw._wired = true; sw.addEventListener('change', handlePermissionSwitch); }
}

/* Sincronía con Perfil — NOTIFS */
export async function syncProfileConsentUI(){
  const cb = $('prof-consent-notif'); if (!cb) return;

  // Nunca arrancar tildado por HTML
  cb.removeAttribute('checked'); cb.checked = false;

  const hasNotif = ('Notification' in window);
  const perm = hasNotif ? Notification.permission : 'unsupported';
  let ls = null;
  try { ls = localStorage.getItem(LS_NOTIF_STATE) || null; } catch (e) {}

  // Si NO hay permiso concedido → OFF; normalizo residuos locales
  if (!hasNotif || perm === 'denied' || perm === 'default' || perm === 'prompt'){
    try {
      localStorage.removeItem('fcmToken');
      if (ls === 'accepted') localStorage.setItem(LS_NOTIF_STATE,'deferred');
    } catch (e2) {}
    cb.dataset.perm = perm;
    return;
  }

  // perm === 'granted' → ON sólo si hay token local o server confirma
  const localOn  = isNotifEnabledLocally();
  const serverOn = await (async()=>{ try { return await fetchServerNotifEnabled(); } catch (e3) { return null; } })();

  cb.checked = !!(localOn || serverOn);
  cb.dataset.perm = perm;
}
export async function handleProfileConsentToggle(checked){
  if (checked){
    if (('Notification' in window) && Notification.permission==='granted'){
      try { await obtenerYGuardarToken(); showNotifOffBanner(false); } catch (e) {}
    } else {
      try {
        const status = await Notification.requestPermission();
        if (status === 'granted'){
          try { await obtenerYGuardarToken(); showNotifOffBanner(false); } catch (e2) {}
        }
        else if (status === 'denied'){
          try { localStorage.setItem(LS_NOTIF_STATE,'blocked'); } catch (e3) {}
          toast('Notificaciones bloqueadas en el navegador.','warning');
          if ($('prof-consent-notif')) $('prof-consent-notif').checked=false;
          showNotifOffBanner(true);
        }
        else {
          try { localStorage.setItem(LS_NOTIF_STATE,'deferred'); } catch (e4) {}
          if ($('prof-consent-notif')) $('prof-consent-notif').checked=false;
        }
      } catch(e5){
        console.warn('[Perfil] requestPermission error:', (e5 && e5.message) || e5);
        if ($('prof-consent-notif')) $('prof-consent-notif').checked=false;
      }
    }
  } else {
    await borrarTokenYOptOut();
    showNotifOffBanner(true);
  }
  refreshNotifUIFromPermission();
}

/* ────────────────────────────────────────────────────────────
   GEO — Banners + Perfil  (Beneficios cerca tuyo = GEO)
   ──────────────────────────────────────────────────────────── */
function geoEls(){ return { banner:$('geo-banner'), txt:$('geo-banner-text'), btnOn:$('geo-enable-btn'), btnOff:$('geo-disable-btn'), btnHelp:$('geo-help-btn') }; }
function isGeoBlockedLocally(){ try { return localStorage.getItem(LS_GEO_STATE) === 'blocked'; } catch (e) { return false; } }

async function detectGeoPermission(){
  try {
    if (navigator.permissions && navigator.permissions.query){
      const st = await navigator.permissions.query({ name:'geolocation' });
      return st.state; // 'granted' | 'denied' | 'prompt'
    }
  } catch (e) {}
  return 'unknown';
}
async function hasDomicilioOnServer(){
  try {
    const uid = firebase.auth().currentUser && firebase.auth().currentUser.uid; if (!uid) return false;
    const clienteId = await getClienteDocIdPorUID(uid) || uid;
    const snap = await firebase.firestore().collection('clientes').doc(clienteId).get();
    const dom  = snap.exists ? (snap.data() && snap.data().domicilio) : null;
    const line = (dom && dom.addressLine ? dom.addressLine : '').trim();
    return !!line;
  } catch (e) { return false; }
}
async function shouldHideGeoBanner(){
  if (isGeoSuppressedNow()) return true;            // cool-down activo
  if (isGeoBlockedLocally()) return false;          // mostrar recordatorio (no ocultar)
  const perm = await detectGeoPermission();
  if (perm !== 'granted') return false;             // sin permiso → dejamos visible marketing
  try { if (localStorage.getItem(LS_ADDR_DISMISS) === '1') return true; } catch (e) {}
  return await hasDomicilioOnServer();
}
function hideGeoBanner(){ const { banner } = geoEls(); if (banner) banner.style.display = 'none'; }

/* Recordatorio chico GEO (tras “No gracias”) */
function ensureGeoOffReminder(){
  let el = $('geo-off-reminder'); if (el) return el;
  el = document.createElement('div');
  el.id = 'geo-off-reminder';
  el.className = 'card';
  el.style.cssText = 'display:none; margin:12px 0;';
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;justify-content:space-between;flex-wrap:wrap;">
      <div style="display:flex;gap:10px;align-items:center;">
        <span aria-hidden="true" style="font-size:18px;">📍</span>
        <div>
          <strong>Estás perdiéndote beneficios cerca tuyo.</strong><br/>
          Activá ubicación desde <em>Mi Perfil</em>.
        </div>
      </div>
      <div style="display:flex;gap:8px;">
        <button id="geo-off-open-profile" class="secondary-btn" type="button">Abrir Perfil</button>
        <button id="geo-off-hide" class="link-btn" type="button">Ocultar</button>
      </div>
    </div>`;
  const mountAt = document.querySelector('.container') || $('main-app-screen') || document.body;
  mountAt.insertBefore(el, mountAt.firstChild);

  const open = $('geo-off-open-profile');
  if (open && !open._wired){
    open._wired = true;
    open.addEventListener('click', ()=>{ try { window.UI && window.UI.openProfileModal && window.UI.openProfileModal(); } catch (e) {} });
  }
  const hide = $('geo-off-hide');
  if (hide && !hide._wired){
    hide._wired = true;
    hide.addEventListener('click', ()=>{ showGeoOffReminder(false); });
  }
  return el;
}
function showGeoOffReminder(on){ const el = ensureGeoOffReminder(); if (el) el.style.display = on ? 'block' : 'none'; }
async function maybeShowGeoOffReminder(){
  const perm = await detectGeoPermission();
  const addr = await hasDomicilioOnServer();
  const blocked = isGeoBlockedLocally();
  showGeoOffReminder(blocked && perm!=='granted' && !addr);
}

/* Banner grande GEO (sin “Luego”) */
function setGeoMarketingUI(on){
  const { banner, txt, btnOn, btnOff, btnHelp } = geoEls();
  if (!banner) return;
  show(banner, on);
  if (!on) return;

  if (txt) txt.textContent = 'Activá para ver beneficios cerca tuyo.';
  showInline(btnOn, true);
  showInline(btnOff, false);  // no usamos “Luego” en GEO
  showInline(btnHelp, false);

  // asegurar “No gracias”
  let nogo = $('geo-nothanks-btn');
  if (!nogo){
    const actions = banner.querySelector('.prompt-actions') || banner;
    nogo = document.createElement('button');
    nogo.id = 'geo-nothanks-btn';
    nogo.className = 'link-btn';
    nogo.textContent = 'No gracias';
    nogo.style.marginLeft = '8px';
    actions.appendChild(nogo);
  }
  if (!nogo._wired){
    nogo._wired = true;
    nogo.addEventListener('click', async ()=>{
      try { localStorage.setItem(LS_GEO_STATE,'blocked'); } catch (e) {}
      setGeoSuppress(GEO_COOLDOWN_DAYS);
      stopGeoWatch();
      try { await setClienteConfigPatch({ geoEnabled:false, geoUpdatedAt:new Date().toISOString() }); } catch (e2) {}
      hideGeoBanner();
      toast('Podés activarlo cuando quieras desde tu Perfil.','info');
      emit('rampet:geo:changed', { enabled:false });
      showGeoOffReminder(true); // recordatorio chico SOLO para GEO
    });
  }
}
function setGeoRegularUI(state){
  const { banner, txt, btnOn, btnOff, btnHelp } = geoEls();
  if (!banner) return;
  show(banner, true);

  if (state === 'granted'){
    try { localStorage.setItem(LS_GEO_STATE,'accepted'); } catch (e) {}
    if (txt) txt.textContent = 'Listo: ya podés recibir beneficios cerca tuyo.';
    showInline(btnOn,false); showInline(btnOff,false); showInline(btnHelp,false);
    return;
  }
  if (state === 'denied'){
    try { localStorage.setItem(LS_GEO_STATE,'blocked'); } catch (e) {}
    if (txt) txt.textContent = 'Para activar beneficios cerca tuyo, habilitalo desde la configuración del navegador.';
    showInline(btnOn,false); showInline(btnOff,true); showInline(btnHelp,true);
    return;
  }
  if (txt) txt.textContent = 'Activá para ver beneficios cerca tuyo.';
  showInline(btnOn,true); showInline(btnOff,false); showInline(btnHelp,false);
}

/* GEO Perfil (switch) + server */
async function fetchServerGeoEnabled(){
  try {
    const uid = firebase.auth().currentUser && firebase.auth().currentUser.uid; if (!uid) return null;
    const clienteId = await getClienteDocIdPorUID(uid) || uid;
    const snap = await firebase.firestore().collection('clientes').doc(clienteId).get();
    const data = snap.exists ? snap.data() : null;
    return !!(data && data.config && data.config.geoEnabled);
  } catch (e) { return null; }
}
export async function syncProfileGeoUI(){
  const cb = $('prof-consent-geo'); if (!cb) return;
  const perm = await detectGeoPermission();
  let ls = null; try { ls = localStorage.getItem(LS_GEO_STATE) || null; } catch (e) {}

  // Pactado: “deferred” o “blocked” → SIEMPRE OFF
  if (ls === 'deferred' || ls === 'blocked' || perm === 'denied'){ cb.checked = false; return; }

  const serverOn = await fetchServerGeoEnabled();
  if (serverOn === true)  { cb.checked = true;  return; }
  if (serverOn === false) { cb.checked = false; return; }

  cb.checked = (perm === 'granted');
}
export async function handleProfileGeoToggle(checked){
  if (checked){
    await handleGeoEnable().catch(()=>{});
  } else {
    try { localStorage.setItem(LS_GEO_STATE,'blocked'); } catch (e) {}
    setGeoSuppress(GEO_COOLDOWN_DAYS);
    stopGeoWatch();
    try { await setClienteConfigPatch({ geoEnabled:false, geoUpdatedAt:new Date().toISOString() }); } catch (e2) {}
    setGeoOffByUserUI();
    emit('rampet:geo:changed', { enabled:false });
  }
  try { await updateGeoUI(); } catch (e3) {}
  try { await syncProfileGeoUI(); } catch (e4) {}
}

/* GEO botones */
function wireGeoButtonsOnce(){
  const { banner, btnOn, btnOff, btnHelp } = geoEls();
  if (!banner || banner._wired) return; banner._wired = true;
  if (btnOn) btnOn.addEventListener('click', handleGeoEnable);
  // btnOff intencionalmente no se usa (no hay “Luego”)
  if (btnHelp) btnHelp.addEventListener('click', ()=>{
    alert('Para activarlo:\n\n1) Abrí configuración del navegador.\n2) Permisos > Ubicación: Permitir.\n3) Recargá la página.');
  });
}
async function handleGeoEnable(){
  try { localStorage.setItem(LS_GEO_STATE,'accepted'); } catch (e) {}
  clearGeoSuppress();
  emit('rampet:geo:enabled', { method:'ui' });
  startGeoWatch();

  try { await setClienteConfigPatch({ geoEnabled:true, geoOptInSource:'ui', geoUpdatedAt:new Date().toISOString() }); } catch (e2) {}

  // intento rápido de capturar 1 posición (no bloqueante)
  try {
    await new Promise((resolve)=>{
      if (!(navigator.geolocation && navigator.geolocation.getCurrentPosition)) return resolve();
      let done = false; const finish = ()=>{ if (done) return; done = true; resolve(); };
      navigator.geolocation.getCurrentPosition(()=>{ finish(); }, ()=>{ finish(); }, { timeout: 3000, maximumAge: 120000, enableHighAccuracy:false });
      setTimeout(finish, 3500);
    });
  } catch (e3) {}

  setTimeout(()=>{ updateGeoUI(); }, 0);
}
function setGeoOffByUserUI(){
  const { banner, txt, btnOn, btnOff, btnHelp } = geoEls();
  if (!banner) return;
  show(banner, true);
  if (txt) txt.textContent = 'No vas a recibir beneficios en tu zona. Podés activarlo cuando quieras.';
  showInline(btnOn,true); showInline(btnOff,false); showInline(btnHelp,false);
}

/* GEO UI global */
async function updateGeoUI(){
  if (isGeoDeferredThisSession()){ hideGeoBanner(); await maybeShowGeoOffReminder(); return; }

  const state = await detectGeoPermission();
  const hide  = await shouldHideGeoBanner();

  if (isGeoBlockedLocally()){
    stopGeoWatch();
    try { await setClienteConfigPatch({ geoEnabled:false, geoUpdatedAt:new Date().toISOString() }); } catch (e) {}
    hideGeoBanner();
    await maybeShowGeoOffReminder();
    return;
  }

  if (state === 'granted'){
    setGeoMarketingUI(false);
    startGeoWatch();
    try { await setClienteConfigPatch({ geoEnabled:true, geoOptInSource:'permission', geoUpdatedAt:new Date().toISOString() }); } catch (e2) {}
    if (hide) hideGeoBanner(); else setGeoRegularUI('granted');
    showGeoOffReminder(false);
    return;
  }

  // state: prompt/unknown/denied
  stopGeoWatch();
  if (state === 'denied'){
    try { await setClienteConfigPatch({ geoEnabled:false, geoUpdatedAt:new Date().toISOString() }); } catch (e3) {}
    if (hide) hideGeoBanner(); else { setGeoMarketingUI(false); setGeoRegularUI('denied'); }
    await maybeShowGeoOffReminder();
    return;
  }

  // prompt o unknown
  if (hide) hideGeoBanner(); else setGeoMarketingUI(true);
  await maybeShowGeoOffReminder();
}

/* GEO tracking mientras está abierta */
const GEO_CONF = { THROTTLE_S: 180, DIST_M: 250, DAILY_CAP: 30 };
const LS_GEO_DAY='geoDay', LS_GEO_COUNT='geoCount';
let geoWatchId=null, lastSample={ t:0, lat:null, lng:null };

function round3(n){ return Math.round((+n)*1e3)/1e3; }
function haversineMeters(a,b){
  if(!a||!b) return Infinity;
  const R=6371000,toRad=d=>d*Math.PI/180;
  const dLat=toRad((b.lat||0)-(a.lat||0)), dLng=toRad((b.lng||0)-(a.lng||0));
  const la1=toRad(a.lat||0), la2=toRad(b.lat||0);
  const h=Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
function todayKey(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function incDailyCount(){
  const day=todayKey();
  const curDay=localStorage.getItem(LS_GEO_DAY);
  if (curDay!==day){ localStorage.setItem(LS_GEO_DAY,day); localStorage.setItem(LS_GEO_COUNT,'0'); }
  const c=+localStorage.getItem(LS_GEO_COUNT)||0;
  localStorage.setItem(LS_GEO_COUNT,String(c+1));
  return c+1;
}
function canWriteMoreToday(){
  const day=todayKey();
  const curDay=localStorage.getItem(LS_GEO_DAY);
  const c=+localStorage.getItem(LS_GEO_COUNT)||0;
  return (curDay!==day)||(c<GEO_CONF.DAILY_CAP);
}
async function writeGeoSamples(lat,lng){
  try {
    if (!canWriteMoreToday()) return;
    const uid = firebase.auth().currentUser && firebase.auth().currentUser.uid; if (!uid) return;
    const clienteId = await getClienteDocIdPorUID(uid); if (!clienteId) return;

    const db  = firebase.firestore();
    const now = firebase.firestore.FieldValue.serverTimestamp();

    await db.collection('clientes').doc(clienteId).collection('geo_raw').doc().set({ lat,lng,capturedAt:now,source:'pwa' }, { merge:false });
    await db.collection('public_geo').doc(uid).collection('samples').doc().set({ lat3:round3(lat), lng3:round3(lng), capturedAt:now, rounded:true, source:'pwa' }, { merge:false });
    incDailyCount();
  } catch(e){ console.warn('[geo] writeGeoSamples error', (e && e.message) || e); }
}
function shouldRecord(lat,lng){
  const nowT=Date.now();
  const dt=(nowT-(lastSample.t||0))/1000;
  if (dt>=GEO_CONF.THROTTLE_S) return true;
  const dist=haversineMeters((lastSample.lat!=null&&lastSample.lng!=null)?{lat:lastSample.lat,lng:lastSample.lng}:null,{lat,lng});
  return dist>=GEO_CONF.DIST_M;
}
function onGeoPosSuccess(pos){
  try {
    const lat = pos && pos.coords && pos.coords.latitude;
    const lng = pos && pos.coords && pos.coords.longitude;
    if (lat==null || lng==null) return;
    if (!shouldRecord(lat,lng)) return;
    lastSample = { t:Date.now(), lat, lng };
    writeGeoSamples(lat, lng);
  } catch(e){ console.warn('[geo] onGeoPosSuccess error', (e && e.message) || e); }
}
function onGeoPosError(_){}
function startGeoWatch(){
  if (!navigator.geolocation || geoWatchId!=null) return;
  if (isGeoBlockedLocally()) return;
  if (document.visibilityState!=='visible') return;
  try {
    geoWatchId = navigator.geolocation.watchPosition(
      onGeoPosSuccess, onGeoPosError,
      { enableHighAccuracy:false, maximumAge:60000, timeout:10000 }
    );
  } catch(e){ console.warn('[geo] start watch error', (e && e.message) || e); }
}
function stopGeoWatch(){ try { if (geoWatchId!=null) navigator.geolocation.clearWatch(geoWatchId); } catch(e) {} geoWatchId=null; }
async function ensureGeoWatchIfPermitted(){
  try {
    if (document.visibilityState!=='visible' || isGeoBlockedLocally()){ stopGeoWatch(); return; }
    const perm = await detectGeoPermission();
    if (perm === 'granted') startGeoWatch(); else stopGeoWatch();
  } catch (e) { stopGeoWatch(); }
}
try { document.addEventListener('visibilitychange', ()=>{ ensureGeoWatchIfPermitted(); }); } catch (e) {}

/* ────────────────────────────────────────────────────────────
   DOMICILIO (banner “📍 Sumá tu domicilio…”) — wiring simple
   ──────────────────────────────────────────────────────────── */
function ensureAddressBannerButtons(){
  const banner = $('address-banner'); if (!banner) return;
  if (banner._wired) return; banner._wired = true;

  // Si ya se difirió por sesión o se descartó persistente → ocultar
  try {
    if (sessionStorage.getItem(SS_ADDR_DEFER) === '1'){ banner.style.display='none'; return; }
    if (localStorage.getItem(LS_ADDR_DISMISS) === '1'){ banner.style.display='none'; return; }
  } catch (e) {}

  const actions = banner.querySelector('.prompt-actions') || banner;

  // Abrir formulario
  const openBtn = banner.querySelector('#address-open-btn') || $('address-open-btn');
  if (openBtn && !openBtn._wired){
    openBtn._wired = true;
    openBtn.addEventListener('click', ()=>{
      try { $('address-card').style.display='block'; } catch (e) {}
      banner.style.display='none';
      try { initDomicilioForm(); } catch (e2) {}
    });
  }

  // ÚNICO “Luego”
  let later = banner.querySelector('#address-skip');
  if (!later){
    later = document.createElement('button');
    later.id = 'address-skip';
    later.className = 'secondary-btn';
    later.textContent = 'Luego';
    later.style.marginLeft = '8px';
    actions.appendChild(later);
  }
  if (!later._wired){
    later._wired = true;
    later.addEventListener('click', ()=>{
      try { sessionStorage.setItem(SS_ADDR_DEFER,'1'); } catch (e) {}
      toast('Podés cargarlo cuando quieras desde tu perfil.','info');
      banner.style.display = 'none'; // se oculta SOLO por sesión
    });
  }

  // “No gracias” (persistente)
  let nogo = banner.querySelector('#address-nothanks-btn');
  if (!nogo){
    nogo = document.createElement('button');
    nogo.id = 'address-nothanks-btn';
    nogo.className = 'link-btn';
    nogo.textContent = 'No gracias';
    nogo.style.marginLeft = '8px';
    actions.appendChild(nogo);
  }
  if (!nogo._wired){
    nogo._wired = true;
    nogo.addEventListener('click', ()=>{
      try { localStorage.setItem(LS_ADDR_DISMISS,'1'); } catch (e) {}
      banner.style.display = 'none';
      toast('Listo, no vamos a pedirte domicilio.','info');
       // 🔹 Nuevo: avisamos al módulo de datos para que marque esto en Firestore
      emit('rampet:address:dismissed', { source: 'banner' });
    });
  }
}

/* Form DOMICILIO (precarga + guardar) */
function buildAddressLine(c){
  const parts = [];
  if (c.calle) parts.push(c.calle + (c.numero ? ' ' + c.numero : ''));
  const pisoDto = [c.piso, c.depto].filter(Boolean).join(' ');
  if (pisoDto) parts.push(pisoDto);
  if (c.codigoPostal || c.localidad) parts.push([c.codigoPostal, c.localidad].filter(Boolean).join(' '));
  if (c.provincia) parts.push(c.provincia === 'CABA' ? 'CABA' : `Provincia de ${c.provincia}`);
  return parts.filter(Boolean).join(', ');
}

export async function initDomicilioForm() {
  const card = $('address-card');
  if (!card || card._wired) return;
  card._wired = true;

  const q = (sel) => card.querySelector(sel);
  const g = (id) => $(id);

  // Flag: el cliente ya tenía domicilio guardado en servidor
  let hadServerAddress = false;

  const getValues = () => ({
    calle:        g('dom-calle')?.value?.trim()        || '',
    numero:       g('dom-numero')?.value?.trim()       || '',
    piso:         g('dom-piso')?.value?.trim()         || '',
    depto:        g('dom-depto')?.value?.trim()        || '',
    localidad:    g('dom-localidad')?.value?.trim()    || '',
    partido:      g('dom-partido')?.value?.trim()      || '',
    provincia:    g('dom-provincia')?.value?.trim()    || '',
    codigoPostal: g('dom-cp')?.value?.trim()           || '',
    pais:         g('dom-pais')?.value?.trim()         || '',
    referencia:   g('dom-referencia')?.value?.trim()   || ''
  });

  // ─────────────────────────────────────────────
  // Precarga desde Firestore
  // ─────────────────────────────────────────────
  try {
    const current = firebase.auth().currentUser;
    const uid = current && current.uid;
    if (uid) {
      const clienteId = await getClienteDocIdPorUID(uid);
      if (clienteId) {
        const snap = await firebase.firestore()
          .collection('clientes')
          .doc(clienteId)
          .get();

        const dom = snap.data()?.domicilio?.components;
        if (dom) {
          hadServerAddress = true;

          g('dom-calle').value      = dom.calle        || '';
          g('dom-numero').value     = dom.numero       || '';
          g('dom-piso').value       = dom.piso         || '';
          g('dom-depto').value      = dom.depto        || '';
          g('dom-localidad').value  = dom.localidad    || '';
          g('dom-partido').value    = dom.partido      || '';
          g('dom-provincia').value  = dom.provincia    || '';
          g('dom-cp').value         = dom.codigoPostal || '';
          g('dom-pais').value       = dom.pais         || 'Argentina';
          g('dom-referencia').value = dom.referencia   || '';

          // Refrescar datalists según provincia/partido precargados
          try {
            const provEl = g('dom-provincia');
            if (provEl) {
              provEl.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const provVal = dom.provincia || '';
            const partEl = g('dom-partido');
            if (/^Buenos Aires$/i.test(provVal) && partEl && partEl.value) {
              partEl.dispatchEvent(new Event('input', { bubbles: true }));
            }
          } catch (e2) {
            console.warn('[ADDR] no se pudo refrescar datalists dom-:', e2);
          }
        }
      }
    }
  } catch (e) {
    console.warn('[ADDR] error precarga domicilio:', e);
  }

  // ─────────────────────────────────────────────
  // Botón "Luego"/"Cancelar" (según modo)
  // ─────────────────────────────────────────────
  const skipBtn = q('#address-cancel') || q('#address-skip');
  if (hadServerAddress && skipBtn) {
    // Modo edición: que no diga "Luego", que diga "Cancelar"
    skipBtn.textContent = 'Cancelar';
  }

  // ─────────────────────────────────────────────
  // Guardar domicilio
  // ─────────────────────────────────────────────
  const saveBtn = q('#address-save');
  if (saveBtn && !saveBtn._wired) {
    saveBtn._wired = true;
    saveBtn.addEventListener('click', async () => {
      try {
        const current = firebase.auth().currentUser;
        const uid = current && current.uid;
        if (!uid) {
          toast('Iniciá sesión para guardar tu domicilio', 'warning');
          return;
        }

        const clienteId = await getClienteDocIdPorUID(uid);
        if (!clienteId) {
          toast('No encontramos tu ficha de cliente', 'error');
          return;
        }

        // Leemos valores del form
        let components = getValues();

        // Para CABA/Capital, copiamos localidad → barrio
        if (/^CABA|Capital/i.test(components.provincia) && components.localidad) {
          components = {
            ...components,
            barrio: components.localidad
          };
        }

        const addressLine = buildAddressLine(components);

        await firebase.firestore()
          .collection('clientes')
          .doc(clienteId)
          .set({
            domicilio: {
              addressLine,
              components,
              geocoded: {
                lat: null,
                lng: null,
                geohash7: null,
                provider: null,
                confidence: null,
                geocodedAt: null,
                verified: false
              }
            }
          }, { merge: true });

        try { localStorage.setItem(LS_ADDR_DISMISS, '1'); } catch (e) {}

        toast('Domicilio guardado. ¡Gracias!', 'success');

        // Cierro form y banner definitivamente
        try { card.style.display = 'none'; } catch (e2) {}
        try { $('address-banner').style.display = 'none'; } catch (e3) {}

        // Actualizo UI relacionada (GEO, perfil)
        hideGeoBanner();
        try { await updateGeoUI(); } catch (e4) {}
        emit('rampet:geo:changed', { enabled: true });

        try {
          const summary = $('prof-address-summary');
          if (summary) summary.textContent = addressLine || '—';
        } catch (e5) {}
      } catch (e) {
        console.error('save domicilio error', e);
        toast('No pudimos guardar el domicilio', 'error');
      }
    });
  }

  // ─────────────────────────────────────────────
  // Cancel / Luego del FORM
  // ─────────────────────────────────────────────
  if (skipBtn && !skipBtn._wired) {
    skipBtn._wired = true;
    skipBtn.addEventListener('click', () => {
      // Si ya tiene domicilio guardado (o lo guardó en esta sesión),
      // este botón funciona como "Cancelar edición".
      let hasSavedAddress = hadServerAddress;
      try {
        if (localStorage.getItem(LS_ADDR_DISMISS) === '1') {
          hasSavedAddress = true;
        }
      } catch (e) {}

      if (hasSavedAddress) {
        try { card.style.display = 'none'; } catch (e2) {}
        return;
      }

      // Primer domicilio: comportamiento original de "Luego"
      try { sessionStorage.setItem(SS_ADDR_DEFER, '1'); } catch (e) {}
      toast('Podés cargarlo cuando quieras desde tu perfil.', 'info');
      try { card.style.display = 'none'; } catch (e2) {}
      try { $('address-banner').style.display = 'block'; } catch (e3) {}
    });
  }
}


/* ────────────────────────────────────────────────────────────
   MINI-PROMPT GEO contextual (desactivado por acuerdo)
   ──────────────────────────────────────────────────────────── */
export async function maybeShowGeoContextPrompt(){ const slot = $('geo-context-slot'); if (slot) slot.innerHTML=''; return; }

/* ────────────────────────────────────────────────────────────
   EXPOSICIONES / EVENTOS
   ──────────────────────────────────────────────────────────── */
try {
  window.handlePermissionRequest   = handlePermissionRequest;
  window.handlePermissionSwitch    = (e)=>handlePermissionSwitch(e);
  window.handlePermissionBlockClick= handlePermissionBlockClick;
  window.syncProfileConsentUI      = syncProfileConsentUI;
  window.handleProfileConsentToggle= handleProfileConsentToggle;
  window.syncProfileGeoUI          = syncProfileGeoUI;
  window.handleProfileGeoToggle    = handleProfileGeoToggle;
  if (!window.maybeShowGeoContextPrompt) window.maybeShowGeoContextPrompt = maybeShowGeoContextPrompt;
} catch (e) {}

// Sincronizar SIEMPRE al abrir el Perfil (wrap sobre UI.openProfileModal si existe)
try {
  const ui = window.UI;
  if (ui && typeof ui.openProfileModal === 'function' && !ui.openProfileModal._rampetPatched){
    const prev = ui.openProfileModal;
    ui.openProfileModal = (...args) => {
      const r = prev.apply(ui, args);
      try { syncProfileConsentUI(); syncProfileGeoUI(); } catch (e) {}
      return r;
    };
    ui.openProfileModal._rampetPatched = true;
  }
} catch (e) {}

document.addEventListener('rampet:consent:notif-opt-in',  ()=>{ try { syncProfileConsentUI(); } catch (e) {} });
document.addEventListener('rampet:consent:notif-opt-out', ()=>{ try { syncProfileConsentUI(); } catch (e) {} });
document.addEventListener('rampet:consent:notif-dismissed', ()=>{ try { syncProfileConsentUI(); } catch (e) {} });

document.addEventListener('rampet:geo:changed', ()=>{ try { syncProfileGeoUI(); maybeShowGeoOffReminder(); } catch (e) {} });
// Aseguramos que el banner de domicilio tenga siempre sus botones
try {
  document.addEventListener('rampet:config-updated', () => {
    try {
      ensureAddressBannerButtons();
    } catch (e) {
      console.warn('[ADDR] Error al asegurar botones del banner de domicilio:', e);
    }
  });
} catch (e) {}

document.addEventListener('visibilitychange', ()=>{
  if (document.visibilityState==='visible'){
    try { syncProfileConsentUI(); } catch (e) {}
    try { syncProfileGeoUI(); } catch (e2) {}
    try { maybeShowGeoOffReminder(); } catch (e3) {}
  }
});

/* ────────────────────────────────────────────────────────────
   INIT (llamado desde app.js luego de logueo)
   ──────────────────────────────────────────────────────────── */
export async function initNotificationsOnce(){
  await registerSW();
  try { await waitForActiveSW(); } catch (e) {}

  bootstrapFirstSessionUX();
  startNotifPermissionWatcher();

  if (AUTO_RESUBSCRIBE && ('Notification' in window) && Notification.permission==='granted'
      && hasPriorAppConsent() && !isNotifEnabledLocally() && (localStorage.getItem(LS_NOTIF_STATE)!=='blocked')){
    try { await obtenerYGuardarTokenOneShot(); } catch (e) {}
  }

  await hookOnMessage();
  refreshNotifUIFromPermission();
  wirePushButtonsOnce();

  // Perfil (una sola vez)
  const profCb = $('prof-consent-notif');
  if (profCb && !profCb._wired){ profCb._wired=true; profCb.addEventListener('change', (e)=>handleProfileConsentToggle(!!(e && e.target && e.target.checked))); }
  await syncProfileConsentUI();

  const profGeo = $('prof-consent-geo');
  if (profGeo && !profGeo._wired){ profGeo._wired=true; profGeo.addEventListener('change', (e)=>handleProfileGeoToggle(!!(e && e.target && e.target.checked))); }
  await syncProfileGeoUI();

  // Recordatorio GEO según estado
  maybeShowGeoOffReminder();

  return true;
}
export async function gestionarPermisoNotificaciones(){ refreshNotifUIFromPermission(); }
export function handleBellClick(){ return Promise.resolve(); }
export async function handleSignOutCleanup(){
  try { localStorage.removeItem('fcmToken'); } catch (e) {}
  try { sessionStorage.removeItem('rampet:firstSessionDone'); } catch (e2) {}
}

/* helpers menores */ function hasPriorAppConsent(){ try { return localStorage.getItem(LS_NOTIF_STATE) === 'accepted'; } catch { return false; } }














