// /modules/notifications.js — FCM + VAPID + Opt-In (banner) + Switch + Geo + Domicilio (lógica depurada + FIX switch)
'use strict';

/* ────────────────────────────────────────────────────────────
   CONFIG / HELPERS
   ──────────────────────────────────────────────────────────── */
const VAPID_PUBLIC = (window.__RAMPET__ && window.__RAMPET__.VAPID_PUBLIC) || '';
if (!VAPID_PUBLIC) console.warn('[FCM] Falta window.__RAMPET__.VAPID_PUBLIC en index.html');

function $(id){ return document.getElementById(id); }
function show(el, on){ if (el) el.style.display = on ? 'block' : 'none'; }
function showInline(el, on){ if (el) el.style.display = on ? 'inline-block' : 'none'; }
function emit(name, detail){ try { document.dispatchEvent(new CustomEvent(name, { detail })); } catch {} }
function toast(msg, type='info'){ try { window.UI?.showToast?.(msg, type); } catch {} }
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

/* ────────────────────────────────────────────────────────────
   ESTADO LOCAL / CONSTANTES
   ──────────────────────────────────────────────────────────── */
const LS_NOTIF_STATE = 'notifState'; // 'deferred' | 'accepted' | 'blocked' | null
const LS_GEO_STATE   = 'geoState';   // 'deferred' | 'accepted' | 'blocked' | null

// GEO: supresión del banner grande por “cool-down”
const LS_GEO_SUPPRESS_UNTIL = 'geoSuppressUntil'; // epoch ms
const GEO_COOLDOWN_DAYS = (window.__RAMPET__?.GEO_COOLDOWN_DAYS ?? 60);

// GEO: “defer por sesión” (oculta banner grande solo hasta recargar)
const GEO_SS_DEFER_KEY = 'geoBannerDeferred';

// Domicilio: flags de sesión/persistencia
const SS_ADDR_DEFER  = 'addressBannerDeferred';
const LS_ADDR_DISMISS = 'addressBannerDismissed';

function _nowMs(){ return Date.now(); }
function setGeoSuppress(days = GEO_COOLDOWN_DAYS){
  try { localStorage.setItem(LS_GEO_SUPPRESS_UNTIL, String(_nowMs() + days*24*60*60*1000)); } catch {}
}
function clearGeoSuppress(){ try { localStorage.removeItem(LS_GEO_SUPPRESS_UNTIL); } catch {} }
function isGeoSuppressedNow(){ try { const until = +localStorage.getItem(LS_GEO_SUPPRESS_UNTIL) || 0; return until > _nowMs(); } catch { return false; } }

function isGeoDeferredThisSession(){ try { return sessionStorage.getItem(GEO_SS_DEFER_KEY) === '1'; } catch { return false; } }
function deferGeoBannerThisSession(){ try { sessionStorage.setItem(GEO_SS_DEFER_KEY,'1'); } catch {} }

let __notifReqInFlight = false;
let __tokenReqLock = null;
let __hardResetAttempted = false;
let __tailRetryScheduled = false;
let __tokenProvisionPending = false;
let __switchPrompting = false; // ← evita dobles prompts

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
  } catch {}
})();

/* ────────────────────────────────────────────────────────────
   BOOTSTRAP (primera sesión de pestaña)
   ──────────────────────────────────────────────────────────── */
function bootstrapFirstSessionUX(){
  try {
    if (sessionStorage.getItem('rampet:firstSessionDone') === '1') return;

    // NOTIFS → primera vez sin estado local: muestro card de marketing
    const st = (() => { try { return localStorage.getItem(LS_NOTIF_STATE); } catch { return null; } })();
    if (st == null) { show($('notif-prompt-card'), true); show($('notif-card'), false); }

    // GEO / DOMICILIO
    ensureAddressBannerButtons();
    wireGeoButtonsOnce();
    setTimeout(() => { updateGeoUI().catch(()=>{}); }, 0);

    // UI de notifs sin pedir permiso
    setTimeout(() => { refreshNotifUIFromPermission(); }, 0);

    sessionStorage.setItem('rampet:firstSessionDone', '1');
  } catch {}
}

/* ────────────────────────────────────────────────────────────
   NOTIF OFF — banner pequeño con botón a Perfil
   ──────────────────────────────────────────────────────────── */
function ensureNotifOffBanner(){
  let el = $('notif-off-banner');
  if (el) return el;

  el = document.createElement('div');
  el.id = 'notif-off-banner';
  el.className = 'card';
  el.style.cssText = 'display:none; margin:12px 0;';
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;justify-content:space-between;flex-wrap:wrap;">
      <div style="display:flex;gap:10px;align-items:center;">
        <span aria-hidden="true" style="font-size:18px;">🔕</span>
        <div>
          <strong>No estás recibiendo notificaciones.</strong><br/>
          Te estás perdiendo <em>promos, novedades y ofertas</em> pensadas para vos. Activalas desde <em>Mi Perfil</em>.
        </div>
      </div>
      <div>
        <button id="notif-off-go-profile" class="secondary-btn" type="button" style="white-space:nowrap;">Abrir Perfil</button>
      </div>
    </div>`;
  const mountAt = document.querySelector('.container') || $('main-app-screen') || document.body;
  mountAt.insertBefore(el, mountAt.firstChild);

  const btn = $('notif-off-go-profile');
  if (btn && !btn._wired){
    btn._wired = true;
    btn.addEventListener('click', ()=>{
      try { window.UI?.openProfileModal?.(); } catch {}
      try { syncProfileConsentUI(); syncProfileGeoUI(); } catch {}
    });
  }
  return el;
}
function showNotifOffBanner(on){ const el = ensureNotifOffBanner(); if (el) el.style.display = on ? 'block' : 'none'; }

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
    try { const head = await fetch(SW_PATH, { method: 'HEAD' }); if (!head.ok) console.warn('[FCM] %s no accesible (HTTP %s )', SW_PATH, head.status); } catch {}
    const existing = await navigator.serviceWorker.getRegistration(SW_PATH);
    if (existing) { console.log('✅ SW FCM ya registrado:', existing.scope); return true; }
    const reg = await navigator.serviceWorker.register(SW_PATH);
    console.log('✅ SW FCM registrado:', reg.scope || (location.origin + '/'));
    return true;
  } catch (e) { console.warn('[FCM] No se pudo registrar SW:', e?.message || e); return false; }
}
async function waitForActiveSW(){
  if (!('serviceWorker' in navigator)) return null;
  let reg = null;
  try {
    reg = await navigator.serviceWorker.getRegistration(SW_PATH)
       || await navigator.serviceWorker.ready
       || await navigator.serviceWorker.getRegistration('/')
       || await navigator.serviceWorker.getRegistration();
  } catch {}
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
  try { reg = await navigator.serviceWorker.getRegistration(SW_PATH) || reg; } catch {}
  return reg;
}

/* ────────────────────────────────────────────────────────────
   Firestore: clientes/{id}, config y tokens
   ──────────────────────────────────────────────────────────── */
async function getClienteDocIdPorUID(uid){
  const snap = await firebase.firestore().collection('clientes').where('authUID','==', uid).limit(1).get();
  return snap.empty ? null : snap.docs[0].id;
}
async function setClienteConfigPatch(partial){
  try {
    const uid = firebase.auth().currentUser?.uid; if (!uid) return;
    const clienteId = await getClienteDocIdPorUID(uid) || uid;
    await firebase.firestore().collection('clientes').doc(clienteId).set({ config: partial }, { merge: true });
  } catch (e) { console.warn('[config] setClienteConfigPatch error:', e?.message || e); }
}
const MAX_TOKENS = 5;
function dedupeTokens(arr=[]){
  const out=[], seen = new Set();
  for (const t of arr){ const s=(t||'').trim(); if (!s) continue; if (!seen.has(s)){ seen.add(s); out.push(s); } }
  return out;
}
async function setFcmTokensOnCliente(newTokens){
  const uid = firebase.auth().currentUser?.uid; if (!uid) throw new Error('No hay usuario logueado.');
  let clienteId = await getClienteDocIdPorUID(uid);
  let ref;
  if (clienteId){ ref = firebase.firestore().collection('clientes').doc(clienteId); }
  else { clienteId = uid; ref = firebase.firestore().collection('clientes').doc(clienteId); await ref.set({ authUID: uid, creadoDesde: 'pwa' }, { merge:true }); }
  let current = [];
  try { const snap = await ref.get(); current = Array.isArray(snap.data()?.fcmTokens) ? snap.data().fcmTokens : []; } catch {}
  const merged = dedupeTokens([...(newTokens||[]), ...current]).slice(0, MAX_TOKENS);
  await ref.set({ fcmTokens: merged }, { merge: true });
  return clienteId;
}
async function clearFcmTokensOnCliente(){
  const uid = firebase.auth().currentUser?.uid; if (!uid) throw new Error('No hay usuario logueado.');
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
  } catch {}
  // Ocultar inmediatamente UI de notifs (marketing + switch)
  try { show($('notif-card'), false); } catch {}
  try { show($('notif-prompt-card'), false); } catch {}
  emit('rampet:consent:notif-opt-in', { source:'ui' });
  showNotifOffBanner(false);
  console.log('✅ Token FCM guardado en clientes/' + clienteId);
}
async function borrarTokenYOptOut(){
  try {
    await ensureMessagingCompatLoaded();
    try { await firebase.messaging().deleteToken(); } catch {}
    await clearFcmTokensOnCliente();
    try { localStorage.removeItem('fcmToken'); localStorage.setItem(LS_NOTIF_STATE,'blocked'); } catch {}
    await setClienteConfigPatch({ notifEnabled:false, notifUpdatedAt:new Date().toISOString() });
    emit('rampet:consent:notif-opt-out', { source:'ui' });
    showNotifOffBanner(true);
  } catch(e){ console.warn('[FCM] borrarTokenYOptOut error:', e?.message || e); }
}

/* Retries IndexedDB/SW */
function isBadRequestOnDelete(e){ const m=(e?.message||'').toLowerCase(); return m.includes('fcmregistrations')||m.includes('unsubscribe')|| (m.includes('400')&&m.includes('delete')); }
function isTransientIdbError(e){ const msg=(e?.message||String(e||'')).toLowerCase(); const name=(e?.name||'').toLowerCase(); return name.includes('invalidstateerror')||msg.includes('database connection is closing')||msg.includes('mutation')||msg.includes('database is closing')||msg.includes("failed to execute 'transaction'"); }
function deleteDb(name){ return new Promise((resolve)=>{ try{ const req=indexedDB.deleteDatabase(name); req.onsuccess=req.onerror=req.onblocked=()=>resolve(); }catch{ resolve(); } }); }
async function hardResetFcmStores(){
  try { localStorage.removeItem('fcmToken'); } catch {}
  await deleteDb('firebase-messaging-database');
  await deleteDb('firebase-installations-database');
  try {
    const reg = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
    if (reg) { try { await reg.unregister(); } catch {} }
    await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    await navigator.serviceWorker.ready;
  } catch {}
  await sleep(300);
}
async function getTokenWithRetry(reg, vapidKey, maxTries=6){
  while(__tokenReqLock){ await __tokenReqLock.catch(()=>{}); }
  let attempt = 0;
  const run = (async()=>{
    for(;;){
      attempt++;
      try{
        reg = await waitForActiveSW() || reg;
        await navigator.serviceWorker.ready.catch(()=>{});
        const tok = await firebase.messaging().getToken({ vapidKey, serviceWorkerRegistration: reg });
        return tok;
      }catch(e){
        if (isTransientIdbError(e) && attempt < maxTries){
          const delay = Math.min(200*(2**(attempt-1)), 2400);
          console.warn(`[FCM] retry #${attempt} en ${delay}ms… (${e?.message||e})`);
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
    try { tok = await getTokenWithRetry(reg, VAPID_PUBLIC, 3); } catch(e){ console.warn('[FCM] one-shot getToken falló:', e?.message || e); return null; }
    if (!tok) return null;
    await guardarTokenEnMiDoc(tok);
    try { refreshNotifUIFromPermission?.(); } catch {}
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
        const once = ()=>{ navigator.serviceWorker.removeEventListener('controllerchange', once); setTimeout(()=>{ obtenerYGuardarToken().catch(()=>{}); }, 300); };
        navigator.serviceWorker.addEventListener('controllerchange', once, { once:true });
      }catch{}
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
    try { refreshNotifUIFromPermission?.(); } catch {}
    return tok;
  } finally { __tokenProvisionPending = false; }
}

/* ────────────────────────────────────────────────────────────
   UI NOTIFICACIONES (banners + switch)
   ──────────────────────────────────────────────────────────── */
function isNotifEnabledLocally(){ try { return !!localStorage.getItem('fcmToken'); } catch { return false; } }
async function fetchServerNotifEnabled(){
  try {
    const uid = firebase.auth().currentUser?.uid; if (!uid) return null;
    const clienteId = await getClienteDocIdPorUID(uid) || uid;
    const snap = await firebase.firestore().collection('clientes').doc(clienteId).get();
    const data = snap.exists ? snap.data() : null;
    const hasTokens = Array.isArray(data?.fcmTokens) && data.fcmTokens.length > 0;
    const cfgEnabled = !!data?.config?.notifEnabled;
    return hasTokens && cfgEnabled;
  } catch { return null; }
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

  const lsState = (()=>{ try { return localStorage.getItem(LS_NOTIF_STATE) || null; } catch { return null; } })();
  const hasToken = (()=>{ try { return !!localStorage.getItem('fcmToken'); } catch { return false; } })();
  const pending = __tokenProvisionPending || !!__tokenReqLock || __notifReqInFlight;

  // “blocked” → no marketing, no switch ON, banner chico ON
  if (lsState === 'blocked' || perm === 'denied'){
    if (switchEl) switchEl.checked = false;
    show(warnBlocked, true);
    showNotifOffBanner(true);
    return;
  }

  // “deferred” (Luego) → mostrar switch OFF, marketing oculto
  if (lsState === 'deferred'){
    if (switchEl) switchEl.checked = false;
    if (!pending) show(cardSwitch, true);
    showNotifOffBanner(false);
    return;
  }

  // granted
  if (perm === 'granted'){
    if (switchEl) switchEl.checked = !!hasToken;
    if (!hasToken && !pending) show(cardSwitch, true);
    showNotifOffBanner(!hasToken);
    return;
  }

  // default → primera vez
  if (!pending) show(cardMarketing, true);
  if (switchEl) switchEl.checked = false;
  showNotifOffBanner(false);
}

/* Watcher de permiso (mantiene UI y re-suscripción) */
let __permWatcher = { timer:null, last:null, wired:false };
function startNotifPermissionWatcher(){
  if (__permWatcher.wired) return; __permWatcher.wired = true;

  try {
    if ('permissions' in navigator && navigator.permissions?.query){
      navigator.permissions.query({ name:'notifications' }).then((permStatus)=>{
        __permWatcher.last = permStatus.state;
        refreshNotifUIFromPermission(); syncProfileConsentUI();
        if (AUTO_RESUBSCRIBE && permStatus.state==='granted' && hasPriorAppConsent() && !isNotifEnabledLocally() && (localStorage.getItem(LS_NOTIF_STATE)!=='blocked')) {
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
  } catch {}
  startPollingWatcher();
}
function startPollingWatcher(){
  if (__permWatcher.timer) return;
  __permWatcher.timer = setInterval(()=>{
    const cur = (window.Notification?.permission) || 'default';
    if (cur === __permWatcher.last) return;
    __permWatcher.last = cur;
    refreshNotifUIFromPermission(); syncProfileConsentUI();
    if (AUTO_RESUBSCRIBE && cur==='granted' && hasPriorAppConsent() && !isNotifEnabledLocally() && (localStorage.getItem(LS_NOTIF_STATE)!=='blocked')) {
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
    const ls = (()=>{ try { return localStorage.getItem(LS_NOTIF_STATE) || null; } catch { return null; } })();
    const current = Notification.permission;

    if (current === 'granted'){
      if (ls === 'blocked'){ showNotifOffBanner(true); refreshNotifUIFromPermission(); return; }
      await obtenerYGuardarToken();
      showNotifOffBanner(false);
      refreshNotifUIFromPermission();
      return;
    }

    if (current === 'denied'){
      try { localStorage.setItem(LS_NOTIF_STATE,'blocked'); } catch {}
      emit('rampet:consent:notif-opt-out',{ source:'browser-denied' });
      showNotifOffBanner(true);
      refreshNotifUIFromPermission();
      return;
    }

    // default → prompt por acción del usuario
    const status = await Notification.requestPermission();
    if (status === 'granted'){
      const st = (()=>{ try { return localStorage.getItem(LS_NOTIF_STATE) || null; } catch { return null; } })();
      if (st === 'blocked'){ showNotifOffBanner(true); }
      else { await obtenerYGuardarToken(); showNotifOffBanner(false); }
    } else if (status === 'denied'){
      try { localStorage.setItem(LS_NOTIF_STATE,'blocked'); } catch {}
      emit('rampet:consent:notif-opt-out',{ source:'prompt' });
      showNotifOffBanner(true);
    } else {
      try { localStorage.setItem(LS_NOTIF_STATE,'deferred'); } catch {}
      emit('rampet:consent:notif-dismissed',{});
    }
    refreshNotifUIFromPermission();
  } catch(e){
    console.warn('[notifications] handlePermissionRequest error:', e?.message || e);
    refreshNotifUIFromPermission();
  } finally { __notifReqInFlight = false; }
}

/* 🔧 FIX: Prompt desde el switch usando CLICK (user gesture) */
function wireSwitchWithGesture(sw){
  if (!sw || sw._gestureWired) return;
  sw._gestureWired = true;

  // CLICK: manejar permiso 'default' con gesto del usuario
  sw.addEventListener('click', (e) => {
    try {
      if (!('Notification' in window)) return;
      const perm = Notification.permission;

      // si ya está granted/denied dejamos que el change haga su trabajo
      if (perm === 'granted' || perm === 'denied') return;

      // perm === 'default' → pedimos permiso en el mismo gesto
      e.preventDefault();
      e.stopPropagation();
      if (__switchPrompting) return;
      __switchPrompting = true;

      // Oculto marketing por si estaba
      try { show($('notif-prompt-card'), false); } catch {}

      Notification.requestPermission().then(async (status) => {
        if (status === 'granted'){
          try { sw.checked = true; } catch {}
          try { await obtenerYGuardarToken(); } catch {}
          try { localStorage.setItem(LS_NOTIF_STATE,'accepted'); } catch {}
          showNotifOffBanner(false);
        } else if (status === 'denied'){
          try { sw.checked = false; } catch {}
          try { localStorage.setItem(LS_NOTIF_STATE,'blocked'); } catch {}
          toast('Notificaciones bloqueadas en el navegador.','warning');
          showNotifOffBanner(true);
        } else {
          // sigue default → lo tratamos como "Luego"
          try { sw.checked = false; } catch {}
          try { localStorage.setItem(LS_NOTIF_STATE,'deferred'); } catch {}
        }
        refreshNotifUIFromPermission();
      }).catch(()=>{
        try { sw.checked = false; } catch {}
      }).finally(()=>{
        __switchPrompting = false;
      });
    } catch {}
  }, { passive:false });
}

/* handler del banner de marketing */
export function handlePermissionBlockClick(){
  try { localStorage.setItem(LS_NOTIF_STATE,'blocked'); } catch {}
  show($('notif-prompt-card'), false);
  const sw = $('notif-switch'); if (sw) sw.checked = false;
  setClienteConfigPatch({ notifEnabled:false, notifUpdatedAt:new Date().toISOString() }).catch(()=>{});
  emit('rampet:consent:notif-opt-out', { source:'ui-block' });
  toast('Podés volver a activarlas desde tu Perfil cuando quieras.','info');
  refreshNotifUIFromPermission();
  showNotifOffBanner(true);
}
export function dismissPermissionRequest(){
  try { localStorage.setItem(LS_NOTIF_STATE,'deferred'); } catch {}
  show($('notif-prompt-card'), false);
  emit('rampet:consent:notif-dismissed', {});
  const sw = $('notif-switch'); if (sw) sw.checked = false;
  show($('notif-card'), true); // switch OFF visible
}

/* CHANGE: ON (suscribir) / OFF (desuscribir) cuando ya hay permiso */
export async function handlePermissionSwitch(e){
  const checked = !!e?.target?.checked;
  if (!('Notification' in window)) { refreshNotifUIFromPermission(); return; }
  const before = Notification.permission;

  if (checked){
    if (before === 'granted'){
      try { await obtenerYGuardarToken(); showNotifOffBanner(false); } catch {}
    } else if (before === 'default'){
      // si llega acá, el click-gesture no corrió (fallback)
      const status = await Notification.requestPermission();
      if (status === 'granted'){ try { await obtenerYGuardarToken(); showNotifOffBanner(false); } catch {} }
      else if (status === 'denied'){ try { localStorage.setItem(LS_NOTIF_STATE,'blocked'); } catch {}; toast('Notificaciones bloqueadas en el navegador.','warning'); const sw=$('notif-switch'); if (sw) sw.checked=false; showNotifOffBanner(true); }
      else { try { localStorage.setItem(LS_NOTIF_STATE,'deferred'); } catch {}; const sw=$('notif-switch'); if (sw) sw.checked=false; }
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
      const d = payload?.data || {};
      try {
        const reg = await navigator.serviceWorker.getRegistration(SW_PATH) || await navigator.serviceWorker.getRegistration();
        if (reg?.showNotification){
          await reg.showNotification(d.title || 'RAMPET', {
            body: d.body || '',
            icon: d.icon || '/images/mi_logo_192.png',
            tag : d.tag || d.id || 'rampet-fg',
            data: { url: d.url || d.click_action || '/?inbox=1' }
          });
        }
      } catch(e){ console.warn('[onMessage] error', e?.message || e); }
    });
  } catch(e){ console.warn('[notifications] hookOnMessage error:', e?.message || e); }
}

/* Cableado de botones del HTML (notifs) */
function wirePushButtonsOnce(){
  const allow = $('btn-activar-notif-prompt');   if (allow && !allow._wired){ allow._wired = true; allow.addEventListener('click', ()=>{ handlePermissionRequest(); }); }
  const later = $('btn-rechazar-notif-prompt');   if (later && !later._wired){ later._wired = true; later.addEventListener('click', ()=>{ dismissPermissionRequest(); }); }
  const block = $('btn-bloquear-notif-prompt');   if (block && !block._wired){ block._wired = true; block.addEventListener('click', ()=>{ handlePermissionBlockClick(); }); }
  const sw    = $('notif-switch');
  if (sw && !sw._wired){
    sw._wired = true;
    // FIX: gesto de usuario para permiso 'default'
    wireSwitchWithGesture(sw);
    // CHANGE: manejar granted/denied normalmente
    sw.addEventListener('change', handlePermissionSwitch);
  }
}

/* Sincronía con Perfil — NOTIFS */
export async function syncProfileConsentUI(){
  const cb = $('prof-consent-notif'); if (!cb) return;

  // Nunca arrancar tildado por HTML
  cb.removeAttribute('checked'); cb.checked = false;

  const hasNotif = ('Notification' in window);
  const perm = hasNotif ? Notification.permission : 'unsupported';
  const ls = (()=>{ try { return localStorage.getItem(LS_NOTIF_STATE) || null; } catch { return null; } })();

  // Si NO hay permiso concedido → OFF; normalizo residuos locales
  if (!hasNotif || perm === 'denied' || perm === 'default' || perm === 'prompt'){
    try {
      localStorage.removeItem('fcmToken');
      if (ls === 'accepted') localStorage.setItem(LS_NOTIF_STATE,'deferred');
    } catch {}
    cb.dataset.perm = perm;
    return;
  }

  // perm === 'granted' → ON sólo si hay token local o server confirma
  const localOn  = (()=>{ try { return !!localStorage.getItem('fcmToken'); } catch { return false; } })();
  const serverOn = await (async()=>{ try { return await fetchServerNotifEnabled(); } catch { return null; } })();

  cb.checked = !!(localOn || serverOn);
  cb.dataset.perm = perm;
}
export async function handleProfileConsentToggle(checked){
  if (checked){
    if (('Notification' in window) && Notification.permission==='granted'){ try { await obtenerYGuardarToken(); showNotifOffBanner(false); } catch {} }
    else {
      try {
        const status = await Notification.requestPermission();
        if (status === 'granted'){ try { await obtenerYGuardarToken(); showNotifOffBanner(false); } catch {} }
        else if (status === 'denied'){ try { localStorage.setItem(LS_NOTIF_STATE,'blocked'); } catch {}; toast('Notificaciones bloqueadas en el navegador.','warning'); $('prof-consent-notif') && ( $('prof-consent-notif').checked=false ); showNotifOffBanner(true); }
        else { try { localStorage.setItem(LS_NOTIF_STATE,'deferred'); } catch {}; $('prof-consent-notif') && ( $('prof-consent-notif').checked=false ); }
      } catch(e){ console.warn('[Perfil] requestPermission error:', e?.message || e); $('prof-consent-notif') && ( $('prof-consent-notif').checked=false ); }
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
function isGeoBlockedLocally(){ try { return localStorage.getItem(LS_GEO_STATE) === 'blocked'; } catch { return false; } }

async function detectGeoPermission(){
  try {
    if (navigator.permissions?.query){
      const st = await navigator.permissions.query({ name:'geolocation' });
      return st.state; // 'granted' | 'denied' | 'prompt'
    }
  } catch {}
  return 'unknown';
}
async function hasDomicilioOnServer(){
  try {
    const uid = firebase.auth().currentUser?.uid; if (!uid) return false;
    const clienteId = await getClienteDocIdPorUID(uid) || uid;
    const snap = await firebase.firestore().collection('clientes').doc(clienteId).get();
    const dom  = snap.exists ? snap.data()?.domicilio : null;
    const line = (dom?.addressLine || '').trim();
    return !!line;
  } catch { return false; }
}
async function shouldHideGeoBanner(){
  if (isGeoSuppressedNow()) return true;            // cool-down activo
  if (isGeoBlockedLocally()) return false;          // mostrar recordatorio (no ocultar)
  const perm = await detectGeoPermission();
  if (perm !== 'granted') return false;             // sin permiso → dejamos visible marketing
  try { if (localStorage.getItem(LS_ADDR_DISMISS) === '1') return true; } catch {}
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

  $('geo-off-open-profile')?.addEventListener('click', ()=>{ try { window.UI?.openProfileModal?.(); } catch{} });
  $('geo-off-hide')?.addEventListener('click', ()=>{ showGeoOffReminder(false); });
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

  if (txt) txt.textContent = 'Activá para ver beneficios cerca tuyo.'; // GEO copy
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
      try { localStorage.setItem(LS_GEO_STATE,'blocked'); } catch {}
      setGeoSuppress(GEO_COOLDOWN_DAYS);
      stopGeoWatch();
      await setClienteConfigPatch({ geoEnabled:false, geoUpdatedAt:new Date().toISOString() }).catch(()=>{});
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
    try { localStorage.setItem(LS_GEO_STATE,'accepted'); } catch {}
    if (txt) txt.textContent = 'Listo: ya podés recibir beneficios cerca tuyo.';
    showInline(btnOn,false); showInline(btnOff,false); showInline(btnHelp,false);
    return;
  }
  if (state === 'denied'){
    try { localStorage.setItem(LS_GEO_STATE,'blocked'); } catch {}
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
    const uid = firebase.auth().currentUser?.uid; if (!uid) return null;
    const clienteId = await getClienteDocIdPorUID(uid) || uid;
    const snap = await firebase.firestore().collection('clientes').doc(clienteId).get();
    const data = snap.exists ? snap.data() : null;
    return !!data?.config?.geoEnabled;
  } catch { return null; }
}
export async function syncProfileGeoUI(){
  const cb = $('prof-consent-geo'); if (!cb) return;
  const perm = await detectGeoPermission();
  const ls = (()=>{ try { return localStorage.getItem(LS_GEO_STATE) || null; } catch { return null; } })();

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
    try { localStorage.setItem(LS_GEO_STATE,'blocked'); } catch {}
    setGeoSuppress(GEO_COOLDOWN_DAYS);
    stopGeoWatch();
    await setClienteConfigPatch({ geoEnabled:false, geoUpdatedAt:new Date().toISOString() }).catch(()=>{});
    setGeoOffByUserUI();
    emit('rampet:geo:changed', { enabled:false });
  }
  await updateGeoUI().catch(()=>{});
  await syncProfileGeoUI().catch(()=>{});
}

/* GEO botones */
function wireGeoButtonsOnce(){
  const { banner, btnOn, btnOff, btnHelp } = geoEls();
  if (!banner || banner._wired) return; banner._wired = true;
  btnOn?.addEventListener('click', handleGeoEnable);
  // btnOff intencionalmente no se usa (no hay “Luego”)
  btnHelp?.addEventListener('click', ()=>{ alert('Para activarlo:\n\n1) Abrí configuración del navegador.\n2) Permisos → Activar ubicación.\n3) Recargá la página.'); });
}
async function handleGeoEnable(){
  try { localStorage.setItem(LS_GEO_STATE,'accepted'); } catch {}
  clearGeoSuppress();
  emit('rampet:geo:enabled', { method:'ui' });
  startGeoWatch();

  await setClienteConfigPatch({ geoEnabled:true, geoOptInSource:'ui', geoUpdatedAt:new Date().toISOString() }).catch(()=>{});

  // intento rápido de capturar 1 posición (no bloqueante)
  try {
    await new Promise((resolve)=>{
      if (!navigator.geolocation?.getCurrentPosition) return resolve();
      let done = false; const finish = ()=>{ if (done) return; done = true; resolve(); };
      navigator.geolocation.getCurrentPosition(()=>{ finish(); }, ()=>{ finish(); }, { timeout: 3000, maximumAge: 120000, enableHighAccuracy:false });
      setTimeout(finish, 3500);
    });
  } catch {}

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
    await setClienteConfigPatch({ geoEnabled:false, geoUpdatedAt:new Date().toISOString() });
    hideGeoBanner();
    await maybeShowGeoOffReminder();
    return;
  }

  if (state === 'granted'){
    setGeoMarketingUI(false);
    startGeoWatch();
    await setClienteConfigPatch({ geoEnabled:true, geoOptInSource:'permission', geoUpdatedAt:new Date().toISOString() });
    if (hide) hideGeoBanner(); else setGeoRegularUI('granted');
    showGeoOffReminder(false);
    return;
  }

  // state: prompt/unknown/denied
  stopGeoWatch();
  if (state === 'denied'){
    await setClienteConfigPatch({ geoEnabled:false, geoUpdatedAt:new Date().toISOString() });
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
function haversineMeters(a,b){ if(!a||!b) return Infinity; const R=6371000,toRad=d=>d*Math.PI/180; const dLat=toRad((b.lat||0)-(a.lat||0)), dLng=toRad((b.lng||0)-(a.lng||0)); const la1=toRad(a.lat||0), la2=toRad(b.lat||0); const h=Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2; return 2*R*Math.asin(Math.sqrt(h)); }
function todayKey(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function incDailyCount(){ const day=todayKey(); const curDay=localStorage.getItem(LS_GEO_DAY); if (curDay!==day){ localStorage.setItem(LS_GEO_DAY,day); localStorage.setItem(LS_GEO_COUNT,'0'); } const c=+localStorage.getItem(LS_GEO_COUNT)||0; localStorage.setItem(LS_GEO_COUNT,String(c+1)); return c+1; }
function canWriteMoreToday(){ const day=todayKey(); const curDay=localStorage.getItem(LS_GEO_DAY); const c=+localStorage.getItem(LS_GEO_COUNT)||0; return (curDay!==day)||(c<GEO_CONF.DAILY_CAP); }
async function writeGeoSamples(lat,lng){
  try {
    if (!canWriteMoreToday()) return;
    const uid = firebase.auth().currentUser?.uid; if (!uid) return;
    const clienteId = await getClienteDocIdPorUID(uid); if (!clienteId) return;

    const db  = firebase.firestore();
    const now = firebase.firestore.FieldValue.serverTimestamp();

    await db.collection('clientes').doc(clienteId).collection('geo_raw').doc().set({ lat,lng,capturedAt:now,source:'pwa' }, { merge:false });
    await db.collection('public_geo').doc(uid).collection('samples').doc().set({ lat3:round3(lat), lng3:round3(lng), capturedAt:now, rounded:true, source:'pwa' }, { merge:false });
    incDailyCount();
  } catch(e){ console.warn('[geo] writeGeoSamples error', e?.message || e); }
}
function shouldRecord(lat,lng){ const nowT=Date.now(); const dt=(nowT-(lastSample.t||0))/1000; if (dt>=GEO_CONF.THROTTLE_S) return true; const dist=haversineMeters((lastSample.lat!=null&&lastSample.lng!=null)?{lat:lastSample.lat,lng:lastSample.lng}:null,{lat,lng}); return dist>=GEO_CONF.DIST_M; }
function onGeoPosSuccess(pos){
  try {
    const lat = pos?.coords?.latitude, lng = pos?.coords?.longitude;
    if (lat==null || lng==null) return;
    if (!shouldRecord(lat,lng)) return;
    lastSample = { t:Date.now(), lat, lng };
    writeGeoSamples(lat, lng);
  } catch(e){ console.warn('[geo] onGeoPosSuccess error', e?.message || e); }
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
  } catch(e){ console.warn('[geo] start watch error', e?.message || e); }
}
function stopGeoWatch(){ try { if (geoWatchId!=null) navigator.geolocation.clearWatch(geoWatchId); } catch{} geoWatchId=null; }
async function ensureGeoWatchIfPermitted(){
  try {
    if (document.visibilityState!=='visible' || isGeoBlockedLocally()){ stopGeoWatch(); return; }
    const perm = await detectGeoPermission();
    if (perm === 'granted') startGeoWatch(); else stopGeoWatch();
  } catch { stopGeoWatch(); }
}
try { document.addEventListener('visibilitychange', ()=>{ ensureGeoWatchIfPermitted(); }); } catch {}

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
  } catch {}

  const actions = banner.querySelector('.prompt-actions') || banner;

  // Abrir formulario
  const openBtn = banner.querySelector('#address-open-btn') || $('address-open-btn');
  if (openBtn && !openBtn._wired){
    openBtn._wired = true;
    openBtn.addEventListener('click', ()=>{
      try { $('address-card').style.display='block'; } catch {}
      banner.style.display='none';
      try { initDomicilioForm(); } catch {}
    });
  }

  // ÚNICO “Luego” — SCOPED al banner
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
      try { sessionStorage.setItem(SS_ADDR_DEFER,'1'); } catch {}
      toast('Podés cargarlo cuando quieras desde tu perfil.','info');
      banner.style.display = 'none'; // se oculta SOLO por sesión
    });
  }

  // “No gracias” (persistente) — SCOPED al banner
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
      try { localStorage.setItem(LS_ADDR_DISMISS,'1'); } catch {}
      banner.style.display = 'none';
      toast('Listo, no vamos a pedirte domicilio.','info');
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
  if (c.provincia) parts.push(c.provincia === 'CABA' ? 'CABA' : `Provincia de ${c.provincia}`;
  return parts.filter(Boolean).join(', ');
}

export async function initDomicilioForm(){
  const card = $('address-card'); if (!card || card._wired) return; card._wired = true;
  const q = (sel) => card.querySelector(sel);
  const g = id => $(id);
  const getValues = ()=>({
    calle:g('dom-calle')?.value?.trim()||'',
    numero:g('dom-numero')?.value?.trim()||'',
    piso:g('dom-piso')?.value?.trim()||'',
    depto:g('dom-depto')?.value?.trim()||'',
    localidad:g('dom-localidad')?.value?.trim()||'',
    partido:g('dom-partido')?.value?.trim()||'',
    provincia:g('dom-provincia')?.value?.trim()||'',
    codigoPostal:g('dom-cp')?.value?.trim()||'',
    pais:g('dom-pais')?.value?.trim()||'',
    referencia:g('dom-referencia')?.value?.trim()||''
  });

  // Precarga
  try {
    const uid = firebase.auth().currentUser?.uid;
    if (uid){
      const clienteId = await getClienteDocIdPorUID(uid);
      if (clienteId){
        const snap = await firebase.firestore().collection('clientes').doc(clienteId).get();
        const dom  = snap.data()?.domicilio?.components;
        if (dom){
          g('dom-calle').value = dom.calle || '';
          g('dom-numero').value = dom.numero || '';
          g('dom-piso').value = dom.piso || '';
          g('dom-depto').value = dom.depto || '';
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

  // Guardar
  q('#address-save')?.addEventListener('click', async ()=>{
    try{
      const uid = firebase.auth().currentUser?.uid; if (!uid) return toast('Iniciá sesión para guardar tu domicilio','warning');
      const clienteId = await getClienteDocIdPorUID(uid); if (!clienteId) return toast('No encontramos tu ficha de cliente','error');

      const components = getValues();
      const addressLine = buildAddressLine(components);
      await firebase.firestore().collection('clientes').doc(clienteId).set({
        domicilio:{ addressLine, components, geocoded:{ lat:null,lng:null,geohash7:null,provider:null,confidence:null,geocodedAt:null,verified:false } }
      }, { merge:true });

      try { localStorage.setItem(LS_ADDR_DISMISS,'1'); } catch {}
      toast('Domicilio guardado. ¡Gracias!','success');

      // Cierro form y banner definitivamente
      try { card.style.display='none'; } catch {}
      try { $('address-banner').style.display='none'; } catch {}

      // Actualizo UI relacionada
      hideGeoBanner();
      updateGeoUI().catch(()=>{});
      emit('rampet:geo:changed', { enabled:true });

      // Si existe resumen en perfil, intento actualizarlo rápido
      try {
        const summary = $('prof-address-summary');
        if (summary) summary.textContent = addressLine || '—';
      } catch {}
    }catch(e){ console.error('save domicilio error', e); toast('No pudimos guardar el domicilio','error'); }
  });

  // Cancel / Luego del FORM (SCOPED al form)
  const skipBtn = q('#address-cancel') || q('#address-skip');
  if (skipBtn && !skipBtn._wired){
    skipBtn._wired = true;
    skipBtn.addEventListener('click', ()=>{
      try { sessionStorage.setItem(SS_ADDR_DEFER,'1'); } catch {}
      toast('Podés cargarlo cuando quieras desde tu perfil.','info');
      try { card.style.display='none'; } catch {}
      try { $('address-banner').style.display='block'; } catch {}
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
} catch {}

// Sincronizar SIEMPRE al abrir el Perfil (wrap sobre UI.openProfileModal si existe)
try {
  const ui = window.UI;
  if (ui && typeof ui.openProfileModal === 'function' && !ui.openProfileModal._rampetPatched){
    const prev = ui.openProfileModal;
    ui.openProfileModal = (...args) => {
      const r = prev.apply(ui, args);
      try { syncProfileConsentUI(); syncProfileGeoUI(); } catch {}
      return r;
    };
    ui.openProfileModal._rampetPatched = true;
  }
} catch {}

document.addEventListener('rampet:consent:notif-opt-in',  ()=>{ syncProfileConsentUI(); });
document.addEventListener('rampet:consent:notif-opt-out', ()=>{ syncProfileConsentUI(); });
document.addEventListener('rampet:consent:notif-dismissed', ()=>{ syncProfileConsentUI(); });

document.addEventListener('rampet:geo:changed', ()=>{ try { syncProfileGeoUI(); maybeShowGeoOffReminder(); } catch {} });

document.addEventListener('visibilitychange', ()=>{
  if (document.visibilityState==='visible'){
    syncProfileConsentUI();
    syncProfileGeoUI();
    maybeShowGeoOffReminder();
  }
});

/* ────────────────────────────────────────────────────────────
   INIT (llamado desde app.js luego de logueo)
   ──────────────────────────────────────────────────────────── */
export async function initNotificationsOnce(){
  await registerSW();
  await waitForActiveSW().catch(()=>{});

  bootstrapFirstSessionUX();
  startNotifPermissionWatcher();

  if (AUTO_RESUBSCRIBE && ('Notification' in window) && Notification.permission==='granted'
      && hasPriorAppConsent() && !isNotifEnabledLocally() && (localStorage.getItem(LS_NOTIF_STATE)!=='blocked')){
    await obtenerYGuardarTokenOneShot().catch(()=>{});
  }

  await hookOnMessage();
  refreshNotifUIFromPermission();
  wirePushButtonsOnce();

  // Perfil (una sola vez)
  const profCb = $('prof-consent-notif');
  if (profCb && !profCb._wired){ profCb._wired=true; profCb.addEventListener('change', (e)=>handleProfileConsentToggle(!!e.target.checked)); }
  await syncProfileConsentUI();

  const profGeo = $('prof-consent-geo');
  if (profGeo && !profGeo._wired){ profGeo._wired=true; profGeo.addEventListener('change', (e)=>handleProfileGeoToggle(!!e.target.checked)); }
  await syncProfileGeoUI();

  // Recordatorio GEO según estado
  maybeShowGeoOffReminder();

  return true;
}
export async function gestionarPermisoNotificaciones(){ refreshNotifUIFromPermission(); }
export function handleBellClick(){ return Promise.resolve(); }
export async function handleSignOutCleanup(){
  try { localStorage.removeItem('fcmToken'); } catch {}
  try { sessionStorage.removeItem('rampet:firstSessionDone'); } catch {}
}

/* helpers menores */
function hasPriorAppConsent(){ try { return localStorage.getItem(LS_NOTIF_STATE) === 'accepted'; } catch { return false; } }
