// /modules/notifications.js — FCM + VAPID + Opt-In (card → switch) + Geo + Domicilio
'use strict';

/* ────────────────────────────────────────────────────────────
   CONFIG / HELPERS
   ──────────────────────────────────────────────────────────── */
const VAPID_PUBLIC = (window.__RAMPET__ && window.__RAMPET__.VAPID_PUBLIC) || '';
if (!VAPID_PUBLIC) console.warn('[FCM] Falta window.__RAMPET__.VAPID_PUBLIC en index.html');

if (!window.isSecureContext) {
  console.warn('[FCM] El sitio NO está en contexto seguro (https o localhost). Notificaciones serán bloqueadas.');
}

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

/** Bootstrap de primera sesión (pestaña/log-in actual) */
function bootstrapFirstSessionUX() {
  try {
    if (sessionStorage.getItem('rampet:firstSessionDone') === '1') return;

    // NOTIFS → primera vez real: card comercial
    const st = (() => { try { return localStorage.getItem(LS_NOTIF_STATE); } catch { return null; } })();
    if (st == null) {
      show($('notif-prompt-card'), true);
      show($('notif-card'), false);
    }

    // GEO / DOMICILIO
    try { wireGeoButtonsOnce(); } catch {}
    try { ; } catch {}
    setTimeout(() => { updateGeoUI().catch(()=>{}); }, 0);

    // UI notifs sin solicitar permisos
    setTimeout(() => { refreshNotifUIFromPermission(); }, 0);

    sessionStorage.setItem('rampet:firstSessionDone', '1');
  } catch {}
}

/* ────────────────────────────────────────────────────────────
   Banner “Notificaciones desactivadas por el usuario”
   ──────────────────────────────────────────────────────────── */
function ensureNotifOffBanner() {
  let el = document.getElementById('notif-off-banner');
  if (el) return el;

  el = document.createElement('div');
  el.id = 'notif-off-banner';
  el.style.cssText =
    'display:none;margin:12px 0;padding:10px 12px;border-radius:10px;' +
    'background:#fff7ed;border:1px solid #fed7aa;color:#7c2d12;font-size:14px;';
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;justify-content:space-between;">
      <div style="display:flex;gap:10px;align-items:center;">
        <span aria-hidden="true" style="font-size:18px;">🔕</span>
        <div>
          <strong>No estás recibiendo notificaciones.</strong><br/>
          Podés volver a activarlas desde <em>Mi Perfil</em> cuando quieras.
        </div>
      </div>
      <div>
        <button id="notif-off-go-profile" class="secondary-btn" type="button" style="white-space:nowrap;">Abrir Perfil</button>
      </div>
    </div>
  `;
  const mountAt =
    document.getElementById('main') ||
    document.querySelector('.content') ||
    document.body;
  mountAt.insertBefore(el, mountAt.firstChild);

  const btn = el.querySelector('#notif-off-go-profile');
  if (btn && !btn._wired) {
    btn._wired = true;
    btn.addEventListener('click', () => {
      try { window.UI?.openTab?.('perfil'); } catch {}
    });
  }
  return el;
}
function showNotifOffBanner(on) { const el = ensureNotifOffBanner(); if (el) el.style.display = on ? 'block' : 'none'; }

/* Overlay de ayuda (DENIED) */
function showNotifHelpOverlay() {
  const warned = document.getElementById('notif-blocked-warning');
  if (warned) {
    warned.style.display = 'block';
    if (!warned.dataset.wired) {
      warned.innerHTML = `
        <p>🔒 Tenés las notificaciones <strong>bloqueadas</strong> en el navegador.</p>
        <p><strong>Cómo habilitar:</strong> clic en el ícono de candado (🔒) → <em>Notificaciones</em> → <strong>Permitir</strong>, y recargá la página.</p>
      `;
      warned.dataset.wired = '1';
    }
    return;
  }
  const id = '__notif_help_overlay__';
  if (document.getElementById(id)) return;
  const div = document.createElement('div');
  div.id = id;
  div.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px;';
  div.innerHTML = `
    <div role="dialog" aria-modal="true" style="max-width:520px;width:100%;background:#fff;border-radius:12px;padding:16px;box-shadow:0 10px 30px rgba(0,0,0,.2)">
      <h3 style="margin-top:0">Habilitar notificaciones</h3>
      <ol style="margin:8px 0 12px 20px;">
        <li>Clic en el ícono de <strong>candado (🔒)</strong> en la barra de direcciones.</li>
        <li>Abrí <strong>Permisos → Notificaciones</strong>.</li>
        <li>Elegí <strong>Permitir</strong> y recargá la página.</li>
      </ol>
      <div style="text-align:right;">
        <button id="__notif_help_close__" class="primary-btn">Entendido</button>
      </div>
    </div>`;
  document.body.appendChild(div);
  const close = () => { try { div.remove(); } catch {} };
  div.querySelector('#__notif_help_close__')?.addEventListener('click', close);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') close(); }, { once: true });
}
function hideNotifHelpOverlay(){
  try { document.getElementById('__notif_help_overlay__')?.remove(); } catch {}
  try { const w = document.getElementById('notif-blocked-warning'); if (w) w.style.display = 'none'; } catch {}
}

/* ────────────────────────────────────────────────────────────
   ESTADO LOCAL / CONSTANTES
   ──────────────────────────────────────────────────────────── */
const LS_NOTIF_STATE = 'notifState'; // 'deferred' | 'accepted' | 'blocked' | null
const LS_GEO_STATE   = 'geoState';   // 'deferred' | 'accepted' | 'blocked' | null
// Cool-down GEO (re-planteo no intrusivo pasado un tiempo)
const LS_GEO_SUPPRESS_UNTIL = 'geoSuppressUntil'; // almacena epoch ms (número)
const GEO_COOLDOWN_DAYS = (window.__RAMPET__?.GEO_COOLDOWN_DAYS ?? 60); // configurable, por defecto 60 días

function _nowMs(){ return Date.now(); }
function setGeoSuppress(days = GEO_COOLDOWN_DAYS){
  try { localStorage.setItem(LS_GEO_SUPPRESS_UNTIL, String(_nowMs() + days*24*60*60*1000)); } catch {}
}
function clearGeoSuppress(){
  try { localStorage.removeItem(LS_GEO_SUPPRESS_UNTIL); } catch {}
}
function isGeoSuppressedNow(){
  try { const until = +localStorage.getItem(LS_GEO_SUPPRESS_UNTIL) || 0; return until > _nowMs(); }
  catch { return false; }
}

// GEO: Defer del banner solo por sesión
const GEO_SS_DEFER_KEY = 'geoBannerDeferred'; // '1' => oculto hasta reload
function isGeoDeferredThisSession(){ try { return sessionStorage.getItem(GEO_SS_DEFER_KEY) === '1'; } catch { return false; } }
function deferGeoBannerThisSession(){ try { sessionStorage.setItem(GEO_SS_DEFER_KEY,'1'); } catch {} }

let __notifReqInFlight = false;
const SW_PATH = '/firebase-messaging-sw.js';
let __tailRetryScheduled = false; // evita múltiples reintentos “silenciosos”
let __tokenProvisionPending = false; // evita “flash” de UI durante provisión de token
/* ───────── Aggressive re-subscribe (opcional, solo reingreso) ─────── */
const AUTO_RESUBSCRIBE = true;

function hasPriorAppConsent() {
  try { return localStorage.getItem(LS_NOTIF_STATE) === 'accepted'; }
  catch { return false; }
}
function hasLocalToken() {
  try { return !!localStorage.getItem('fcmToken'); }
  catch { return false; }
}

/* ───────────────── Firebase compat helpers ──────────────── */
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
  if (!('serviceWorker' in navigator)) { console.warn('[FCM] SW no soportado'); return false; }
  try {
    try {
      const head = await fetch(SW_PATH, { method: 'HEAD' });
      if (!head.ok) console.warn('[FCM] %s no accesible (HTTP %s )', SW_PATH, head.status);
    } catch (e) {
      console.warn('[FCM] No se pudo verificar %s: %s', SW_PATH, e?.message || e);
    }

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

// Espera a que exista un SW ACTIVO (state === 'activated')
async function waitForActiveSW() {
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
    await new Promise((resolve) => {
      const done = () => resolve();
      sw.addEventListener('statechange', () => { if (sw.state === 'activated') done(); });
      if (sw.state === 'activated') done();
      setTimeout(done, 2500);
    });
  }

  try {
    reg = await navigator.serviceWorker.getRegistration(SW_PATH) || reg;
  } catch {}

  return reg;
}

/* ────────────────────────────────────────────────────────────
   Firestore helpers: clientes/{id} + config + tokens
   ──────────────────────────────────────────────────────────── */
async function getClienteDocIdPorUID(uid) {
  const snap = await firebase.firestore()
    .collection('clientes')
    .where('authUID', '==', uid)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].id;
}

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
    clienteId = uid;
    ref = firebase.firestore().collection('clientes').doc(clienteId);
    await ref.set({ authUID: uid, creadoDesde: 'pwa' }, { merge: true });
    console.warn('[FCM] Cliente no existía por authUID; creado fallback clientes/{uid}.');
  }

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
  await ref.set({ fcmTokens: [] }, { merge: true });
}

/* ────────────────────────────────────────────────────────────
   Token helpers
   ──────────────────────────────────────────────────────────── */
async function guardarTokenEnMiDoc(token) {
  const clienteId = await setFcmTokensOnCliente([token]);

  await setClienteConfigPatch({
    notifEnabled: true,
    notifOptInSource: 'ui',
    notifUpdatedAt: new Date().toISOString()
  });

  try { localStorage.setItem('fcmToken', token); } catch {}
  try { localStorage.setItem(LS_NOTIF_STATE, 'accepted'); } catch {}
  emit('rampet:consent:notif-opt-in', { source: 'ui' });
  hideNotifHelpOverlay();
  showNotifOffBanner(false);
  console.log('✅ Token FCM guardado en clientes/' + clienteId);
}

async function borrarTokenYOptOut() {
  try {
    await ensureMessagingCompatLoaded();
    try { await firebase.messaging().deleteToken(); } catch {}
    await clearFcmTokensOnCliente();
    try { localStorage.removeItem('fcmToken'); } catch {}
    try { localStorage.setItem(LS_NOTIF_STATE, 'blocked'); } catch {}

    await setClienteConfigPatch({
      notifEnabled: false,
      notifUpdatedAt: new Date().toISOString()
    });

    emit('rampet:consent:notif-opt-out', { source: 'ui' });
    showNotifOffBanner(true);
    console.log('🔕 Opt-out FCM aplicado.');
  } catch (e) {
    console.warn('[FCM] borrarTokenYOptOut error:', e?.message || e);
  }
}

/* Retries para errores transitorios de IndexedDB / SW recién activado */
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
let __tokenReqLock = null; // evita solapamientos

// === Manejo de errores 400 en DELETE fcmregistrations (hard reset controlado) ===
let __hardResetAttempted = false;

function isBadRequestOnDelete(e){
  const m = (e?.message || '').toLowerCase();
  return m.includes('fcmregistrations') || m.includes('unsubscribe') || (m.includes('400') && m.includes('delete'));
}

function isTransientIdbError(e){
  const msg = (e?.message || String(e || '')).toLowerCase();
  const name = (e?.name || '').toLowerCase();
  return (
    name.includes('invalidstateerror') ||
    msg.includes('database connection is closing') ||
    msg.includes('a mutation operation was attempted') ||
    msg.includes('the database is closing') ||
    msg.includes("failed to execute 'transaction'")
  );
}

function deleteDb(name){
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch { resolve(); }
  });
}

// Borra residuos locales y re-registra el SW para pedir un token "limpio"
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

async function getTokenWithRetry(reg, vapidKey, maxTries = 6) {
  // Evitar múltiples getToken simultáneos (Edge/Chromium cierran la DB si se pisan)
  while (__tokenReqLock) { await __tokenReqLock.catch(()=>{}); }

  let attempt = 0;
  const run = (async () => {
    for (;;) {
      attempt++;
      try {
        // Reconfirmar SW ACTIVADO entre intentos
        reg = await waitForActiveSW() || reg;
        await navigator.serviceWorker.ready.catch(()=>{});

        const tok = await firebase.messaging().getToken({
          vapidKey,
          serviceWorkerRegistration: reg
        });
        return tok; // éxito
      } catch (e) {
        // 2.1) Si es error transitorio de IndexedDB → backoff
        if (isTransientIdbError(e) && attempt < maxTries) {
          const delay = Math.min(200 * (2 ** (attempt - 1)), 2400);
          console.warn(`[FCM] getToken retry #${attempt} en ${delay}ms… (${e?.message||e})`);
          await sleep(delay);
          continue;
        }

        // 2.2) Si es 400 en DELETE fcmregistrations → hard reset (una sola vez)
        if (isBadRequestOnDelete(e) && !__hardResetAttempted) {
          __hardResetAttempted = true;
          console.warn('[FCM] 400 en DELETE de registro previo. Haciendo hard reset local y reintentando…');
          await hardResetFcmStores();
          attempt = 0;     // reiniciar ciclo de reintentos
          continue;
        }

        // 2.3) Cualquier otro caso → propagar
        throw e;
      }
    }
  })();

  __tokenReqLock = run;
  try { return await run; }
  finally { __tokenReqLock = null; }
}

/*  One-shot para re-suscripción silenciosa (sin loops) */
async function obtenerYGuardarTokenOneShot() {
  await ensureMessagingCompatLoaded();

  const reg = await waitForActiveSW();
  if (!reg || !(reg.active)) {
    console.warn('[FCM] SW no activo (one-shot): no se re-suscribe');
    return null;
  }

  __tokenProvisionPending = true;       // <<< NUEVO
  try {
    let tok = null;
    try {
      tok = await getTokenWithRetry(reg, VAPID_PUBLIC, 3); // un poco más tolerante
    } catch (e) {
      console.warn('[FCM] one-shot getToken falló:', e?.message || e);
      return null; // sin toast
    }

    if (!tok) {
      console.warn('[FCM] one-shot getToken vacío');
      return null;
    }

    await guardarTokenEnMiDoc(tok);
    try { refreshNotifUIFromPermission?.(); } catch {}
    return tok;

  } finally {
    __tokenProvisionPending = false;    // <<< NUEVO
  }
}

/*  Normal (con retries y toasts) → CTA / switch */
async function obtenerYGuardarToken() {
  __tailRetryScheduled = false; // reset por si venimos de un intento anterior
  __tokenProvisionPending = true;       // <<< NUEVO
  await ensureMessagingCompatLoaded();

  try {
    const reg = await waitForActiveSW();
    if (!reg || !(reg.active)) {
      console.warn('[FCM] No hay ServiceWorker ACTIVO todavía.');
      toast('No se pudo activar notificaciones (SW no activo).', 'error');
      try {
        const once = () => {
          navigator.serviceWorker.removeEventListener('controllerchange', once);
          setTimeout(() => { obtenerYGuardarToken().catch(()=>{}); }, 300);
        };
        navigator.serviceWorker.addEventListener('controllerchange', once, { once: true });
      } catch {}
      throw new Error('SW no activo');
    }

    let tok = null;
    try {
      tok = await getTokenWithRetry(reg, VAPID_PUBLIC, 6);
    } catch (e) {
      if (isTransientIdbError(e) && !__tailRetryScheduled) {
        __tailRetryScheduled = true;
        console.warn('[FCM] getToken falló por IndexedDB; reintento silencioso en 1500ms…');
        setTimeout(() => { obtenerYGuardarToken().catch(()=>{}); }, 1500);
        throw e;
      }
      console.warn('[FCM] getToken() falló (tras retry):', e?.message || e);
      toast('No se pudo activar notificaciones.', 'error');
      throw e;
    }

    if (!tok) {
      console.warn('[FCM] getToken() devolvió vacío. Revisar VAPID/permiso.');
      toast('No se pudo activar notificaciones (token vacío).', 'warning');
      throw new Error('token vacío');
    }

    console.log('[FCM] Token OK:', tok.slice(0, 12) + '…');
    await guardarTokenEnMiDoc(tok);
    __tailRetryScheduled = false; // éxito → limpiar
    toast('Notificaciones activadas ✅', 'success');

    try { refreshNotifUIFromPermission?.(); } catch {}
    return tok;

  } finally {
    __tokenProvisionPending = false;    // <<< NUEVO: siempre liberar flag
  }
}

/* ────────────────────────────────────────────────────────────
   UI de Notificaciones (marketing + switch)
   ──────────────────────────────────────────────────────────── */
function refreshNotifUIFromPermission() {
  const hasNotif = ('Notification' in window);
  const perm = hasNotif ? Notification.permission : 'unsupported';

  const cardMarketing = $('notif-prompt-card');   // Onboarding (card comercial)
  const cardSwitch    = $('notif-card');          // Card con switch (perfil)
  const warnBlocked   = $('notif-blocked-warning');
  const switchEl      = $('notif-switch');

  show(cardMarketing, false);
  show(cardSwitch, false);
  show(warnBlocked, false);

  let hasToken = false;
  try { hasToken = !!localStorage.getItem('fcmToken'); } catch {}

  if (!hasNotif) return;

  // <<< NUEVO: estado “pendiente” para evitar flash de UI
  const pending = __tokenProvisionPending || !!__tokenReqLock || __notifReqInFlight;

  if (perm === 'granted') {
    if (switchEl) switchEl.checked = !!hasToken;
    try { localStorage.setItem(LS_NOTIF_STATE, hasToken ? 'accepted' : 'deferred'); } catch {}
    if (!hasToken && !pending) {        // <<< solo mostramos switch si NO está pendiente
      show(cardSwitch, true);
    }
  } else if (perm === 'denied') {
    if (switchEl) switchEl.checked = false;
    try { localStorage.setItem(LS_NOTIF_STATE, 'blocked'); } catch {}
    show(warnBlocked, true);
  } else {
    const state = (() => { try { return localStorage.getItem(LS_NOTIF_STATE) || null; } catch { return null; } })();

    if (state === 'blocked') {
      if (switchEl) switchEl.checked = false;
    } else if (state === 'deferred') {
      if (switchEl) switchEl.checked = false;
      if (!pending) show(cardSwitch, true);  // <<< también evitamos flash en “deferred”
    } else if (state === 'accepted' && hasToken) {
      if (switchEl) switchEl.checked = true;
    } else {
      if (switchEl) switchEl.checked = false;
      show(cardMarketing, true);
    }
  }

  // Banner “🔕” sólo si el usuario hizo opt-out local
  try {
    const st = localStorage.getItem(LS_NOTIF_STATE);
    showNotifOffBanner(st === 'blocked');
  } catch {}
}

/* ────────────────────────────────────────────────────────────
   Watcher de permiso (Permissions API + fallback polling)
   ──────────────────────────────────────────────────────────── */
let __permWatcher = { timer:null, last:null, wired:false };

function startNotifPermissionWatcher(){
  if (__permWatcher.wired) return;
  __permWatcher.wired = true;

  try {
    if ('permissions' in navigator && navigator.permissions?.query) {
      navigator.permissions.query({ name: 'notifications' })
        .then((permStatus) => {
          __permWatcher.last = permStatus.state; // 'granted' | 'denied' | 'prompt'

          // SIEMPRE: refrescar UI
          refreshNotifUIFromPermission();

          // Re-suscripción agresiva (one-shot), nunca primera suscripción
          if (
            AUTO_RESUBSCRIBE &&
            permStatus.state === 'granted' &&
            hasPriorAppConsent() &&
            !hasLocalToken() &&
            (localStorage.getItem(LS_NOTIF_STATE) !== 'blocked')
          ) {
            obtenerYGuardarTokenOneShot().catch(()=>{});
          }

          // Cambios de permiso en caliente
          permStatus.onchange = () => {
            __permWatcher.last = permStatus.state;
            refreshNotifUIFromPermission();

            if (
              AUTO_RESUBSCRIBE &&
              permStatus.state === 'granted' &&
              hasPriorAppConsent() &&
              !hasLocalToken() &&
              (localStorage.getItem(LS_NOTIF_STATE) !== 'blocked')
            ) {
              obtenerYGuardarTokenOneShot().catch(()=>{});
            }
          };
        })
        .catch(() => { startPollingWatcher(); });
      return;
    }
  } catch {}

  startPollingWatcher();
}

function startPollingWatcher(){
  if (__permWatcher.timer) return;
  __permWatcher.last = (window.Notification?.permission) || 'default';

  __permWatcher.timer = setInterval(() => {
    const cur = (window.Notification?.permission) || 'default';
    if (cur === __permWatcher.last) return;
    __permWatcher.last = cur;

    refreshNotifUIFromPermission();

    if (
      AUTO_RESUBSCRIBE &&
      cur === 'granted' &&
      hasPriorAppConsent() &&
      !hasLocalToken() &&
      (localStorage.getItem(LS_NOTIF_STATE) !== 'blocked')
    ) {
      obtenerYGuardarTokenOneShot().catch(()=>{});
    }
  }, 1200);
}

function stopNotifPermissionWatcher(){
  if (__permWatcher.timer) { clearInterval(__permWatcher.timer); __permWatcher.timer = null; }
}

/* ────────────────────────────────────────────────────────────
   Handlers de Notificaciones
   ──────────────────────────────────────────────────────────── */
export async function handlePermissionRequest() {
  startNotifPermissionWatcher();

  if (!('Notification' in window)) {
    refreshNotifUIFromPermission();
    return;
  }

  if (__notifReqInFlight) {
    console.log('[FCM] requestPermission ya en curso');
    return;
  }

  __notifReqInFlight = true;
  try {
    const lsState = (() => { try { return localStorage.getItem(LS_NOTIF_STATE) || null; } catch { return null; } })();
    const current = Notification.permission; // 'granted' | 'denied' | 'default'

    if (current === 'granted') {
      if (lsState === 'blocked') {
        showNotifOffBanner(true);
        refreshNotifUIFromPermission();
        return;
      }
      await obtenerYGuardarToken();
      showNotifOffBanner(false);
      refreshNotifUIFromPermission();
      return;
    }

    if (current === 'denied') {
      try { localStorage.setItem(LS_NOTIF_STATE, 'blocked'); } catch {}
      emit('rampet:consent:notif-opt-out', { source: 'browser-denied' });
      showNotifHelpOverlay();
      showNotifOffBanner(true);
      refreshNotifUIFromPermission();
      return;
    }

    // default → pedimos permiso solo por acción del usuario
    const status = await Notification.requestPermission(); // 'granted' | 'denied' | 'default'

    if (status === 'granted') {
      const lsAfter = (() => { try { return localStorage.getItem(LS_NOTIF_STATE) || null; } catch { return null; } })();
      if (lsAfter === 'blocked') {
        showNotifOffBanner(true);
      } else {
        await obtenerYGuardarToken();
        showNotifOffBanner(false);
      }
    } else if (status === 'denied') {
      try { localStorage.setItem(LS_NOTIF_STATE, 'blocked'); } catch {}
      emit('rampet:consent:notif-opt-out', { source: 'prompt' });
      showNotifHelpOverlay();
      showNotifOffBanner(true);
    } else {
      try { localStorage.setItem(LS_NOTIF_STATE, 'deferred'); } catch {}
      emit('rampet:consent:notif-dismissed', {});
    }

    refreshNotifUIFromPermission();
  } catch (e) {
    console.warn('[notifications] handlePermissionRequest error:', e?.message || e);
    refreshNotifUIFromPermission();
  } finally {
    __notifReqInFlight = false;
  }
}

export function handlePermissionBlockClick() {
  try { localStorage.setItem(LS_NOTIF_STATE, 'blocked'); } catch {}
  show($('notif-prompt-card'), false);
  const sw = $('notif-switch'); if (sw) sw.checked = false;
  setClienteConfigPatch({
    notifEnabled: false,
    notifUpdatedAt: new Date().toISOString()
  }).catch(()=>{});
  emit('rampet:consent:notif-opt-out', { source: 'ui-block' });
  toast('Podés volver a activarlas desde tu Perfil cuando quieras.', 'info');
  refreshNotifUIFromPermission();
  showNotifOffBanner(true);
}

export function dismissPermissionRequest() {
  try { localStorage.setItem(LS_NOTIF_STATE, 'deferred'); } catch {}
  show($('notif-prompt-card'), false);
  emit('rampet:consent:notif-dismissed', {});
  const sw = $('notif-switch'); if (sw) sw.checked = false;
  show($('notif-card'), true);
}

export async function handlePermissionSwitch(e) {
  const checked = !!e?.target?.checked;
  if (!('Notification' in window)) { refreshNotifUIFromPermission(); return; }

  const before = Notification.permission;

  if (checked) {
    if (before === 'granted') {
      try { await obtenerYGuardarToken(); showNotifOffBanner(false); } catch {}
    } else if (before === 'default') {
      const status = await Notification.requestPermission();
      if (status === 'granted') {
        try { await obtenerYGuardarToken(); showNotifOffBanner(false); } catch {}
      } else if (status === 'denied') {
        try { localStorage.setItem(LS_NOTIF_STATE, 'blocked'); } catch {}
        toast('Notificaciones bloqueadas en el navegador.', 'warning');
        const sw = $('notif-switch'); if (sw) sw.checked = false;
        showNotifHelpOverlay();
        showNotifOffBanner(true);
      } else {
        try { localStorage.setItem(LS_NOTIF_STATE, 'deferred'); } catch {}
        const sw = $('notif-switch'); if (sw) sw.checked = false;
      }
    } else { // denied
      toast('Tenés bloqueadas las notificaciones en el navegador.', 'warning');
      const sw = $('notif-switch'); if (sw) sw.checked = false;
      showNotifHelpOverlay();
      showNotifOffBanner(true);
    }
  } else {
    await borrarTokenYOptOut();
    showNotifOffBanner(true);
    toast('Notificaciones desactivadas.', 'info');
  }

  refreshNotifUIFromPermission();
}

/* ────────────────────────────────────────────────────────────
   Foreground push → notificación del sistema
   ──────────────────────────────────────────────────────────── */
async function hookOnMessage() {
  try {
    await ensureMessagingCompatLoaded();
    const messaging = firebase.messaging();
    messaging.onMessage(async (payload) => {
      const d = payload?.data || {};
      try {
        const reg =
          await navigator.serviceWorker.getRegistration(SW_PATH) ||
          await navigator.serviceWorker.getRegistration();
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

/* ────────────────────────────────────────────────────────────
   Cableado de botones de la UI (index.html)
   ──────────────────────────────────────────────────────────── */
function wirePushButtonsOnce() {
  const allow = document.getElementById('btn-activar-notif-prompt');
  if (allow && !allow._wired) {
    allow._wired = true;
    allow.addEventListener('click', () => { handlePermissionRequest(); });
  }

  const later = document.getElementById('btn-rechazar-notif-prompt');
  if (later && !later._wired) {
    later._wired = true;
    later.addEventListener('click', () => { dismissPermissionRequest(); });
  }

  const block = document.getElementById('btn-bloquear-notif-prompt');
  if (block && !block._wired) {
    block._wired = true;
    block.addEventListener('click', () => { handlePermissionBlockClick(); });
  }

  const sw = document.getElementById('notif-switch');
  if (sw && !sw._wired) {
    sw._wired = true;
    sw.addEventListener('change', handlePermissionSwitch);
  }
}

/* ────────────────────────────────────────────────────────────
   Sincro con “Mi Perfil” (checkbox) — NOTIFS
   ──────────────────────────────────────────────────────────── */
function isNotifEnabledLocally() {
  try { return !!localStorage.getItem('fcmToken'); }
  catch { return false; }
}

async function fetchServerNotifEnabled() {
  try {
    const uid = firebase.auth().currentUser?.uid;
    if (!uid) return null;
    const clienteId = await getClienteDocIdPorUID(uid) || uid;
    const snap = await firebase.firestore().collection('clientes').doc(clienteId).get();
    const data = snap.exists ? snap.data() : null;
    const hasTokens = Array.isArray(data?.fcmTokens) && data.fcmTokens.length > 0;
    const cfgEnabled = !!data?.config?.notifEnabled;
    return hasTokens && cfgEnabled;
  } catch { return null; }
}

export async function syncProfileConsentUI() {
  const cb = $('prof-consent-notif');
  if (!cb) return;

  const localOn = isNotifEnabledLocally();

  let serverOn = null;
  try { serverOn = await fetchServerNotifEnabled(); } catch {}

  cb.checked = !!(localOn || serverOn);
}

export async function handleProfileConsentToggle(checked) {
  if (checked) {
    if (('Notification' in window) && Notification.permission === 'granted') {
      try { await obtenerYGuardarToken(); showNotifOffBanner(false); } catch {}
    } else {
      try {
        const status = await Notification.requestPermission();
        if (status === 'granted') {
          try { await obtenerYGuardarToken(); showNotifOffBanner(false); } catch {}
        } else if (status === 'denied') {
          try { localStorage.setItem(LS_NOTIF_STATE, 'blocked'); } catch {}
          toast('Notificaciones bloqueadas en el navegador.', 'warning');
          $('prof-consent-notif') && ( $('prof-consent-notif').checked = false );
          showNotifHelpOverlay();
          showNotifOffBanner(true);
        } else {
          try { localStorage.setItem(LS_NOTIF_STATE, 'deferred'); } catch {}
          $('prof-consent-notif') && ( $('prof-consent-notif').checked = false );
        }
      } catch (e) {
        console.warn('[Perfil] requestPermission error:', e?.message || e);
        $('prof-consent-notif') && ( $('prof-consent-notif').checked = false );
      }
    }
  } else {
    await borrarTokenYOptOut();
    showNotifOffBanner(true);
  }
  refreshNotifUIFromPermission();
}

/* ────────────────────────────────────────────────────────────
   GEO — Helpers de banner + Perfil
   ──────────────────────────────────────────────────────────── */
function geoEls(){
  return {
    banner: $('geo-banner'),
    txt: $('geo-banner-text'),
    btnOn: $('geo-enable-btn'),
    btnOff: $('geo-disable-btn'),
    btnHelp: $('geo-help-btn')
  };
}
function isGeoBlockedLocally() {
  try { return localStorage.getItem(LS_GEO_STATE) === 'blocked'; }
  catch { return false; }
}

async function hasDomicilioOnServer() {
  try {
    const uid = firebase.auth().currentUser?.uid;
    if (!uid) return false;
    const clienteId = await getClienteDocIdPorUID(uid) || uid;
    const snap = await firebase.firestore().collection('clientes').doc(clienteId).get();
    const dom = snap.exists ? snap.data()?.domicilio : null;
    const line = (dom?.addressLine || '').trim();
    return !!line;
  } catch { return false; }
}

// Mostrar/ocultar banner GEO según permiso/domicilio/opt-out
async function shouldHideGeoBanner() {
// Si está suprimido por cool-down, escondemos banner global
if (isGeoSuppressedNow()) return true;
   
  if (isGeoBlockedLocally()) return false; // recordatorio visible
  const perm = await detectGeoPermission(); // 'granted' | 'denied' | 'prompt' | 'unknown'
  if (perm !== 'granted') return false;
  try { if (localStorage.getItem('addressBannerDismissed') === '1') return true; } catch {}
  return await hasDomicilioOnServer();
}

function hideGeoBanner() { const { banner } = geoEls(); if (banner) banner.style.display = 'none'; }

function setGeoMarketingUI(on) {
  const { banner, txt, btnOn, btnOff, btnHelp } = geoEls();
  if (!banner) return;

  show(banner, on);
  if (!on) return;

  if (txt) txt.textContent = 'Activá para ver ofertas y beneficios cerca tuyo.';
  showInline(btnOn, true);
  showInline(btnOff, false);
  showInline(btnHelp, false);

  const actions = banner.querySelector('.prompt-actions') || banner;

  // Botón “Luego” (solo sesión)
  let later = document.getElementById('geo-later-btn');
  if (!later) {
    later = document.createElement('button');
    later.id = 'geo-later-btn';
    later.className = 'secondary-btn';
    later.textContent = 'Luego';
    later.style.marginLeft = '8px';
    actions.appendChild(later);
  }
  if (!later._wired) {
    later._wired = true;
    later.onclick = () => { deferGeoBannerThisSession(); show(banner, false); };
  }

  // Botón “No gracias” (persistente)
  let nogo = document.getElementById('geo-nothanks-btn');
  if (!nogo) {
    nogo = document.createElement('button');
    nogo.id = 'geo-nothanks-btn';
    nogo.className = 'link-btn';
    nogo.textContent = 'No gracias';
    nogo.style.marginLeft = '8px';
    actions.appendChild(nogo);
  }
  if (!nogo._wired) {
    nogo._wired = true;
    nogo.onclick = async () => {
  try { localStorage.setItem(LS_GEO_STATE, 'blocked'); } catch {}
  setGeoSuppress(GEO_COOLDOWN_DAYS); // ⟵ suprimir global por X días
  stopGeoWatch();
  await setClienteConfigPatch({ geoEnabled: false, geoUpdatedAt: new Date().toISOString() }).catch(()=>{});
  hideGeoBanner(); // ⟵ se va el banner global
  toast(`No vamos a volver a pedirlo por ahora. Podés activarlo desde tu Perfil.`, 'info');
};

  }
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
    showInline(btnOn,false); showInline(btnOff,false); showInline(btnHelp,false);
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

// UI cuando el usuario lo desactivó desde el Perfil (bloqueo local)
function setGeoOffByUserUI() {
  const { banner, txt, btnOn, btnOff, btnHelp } = geoEls();
  if (!banner) return;
  show(banner, true);
  const later = document.getElementById('geo-later-btn');
  if (later) later.style.display = 'none';
  if (txt) txt.textContent = 'No vas a recibir beneficios en tu zona. Podés activarlo cuando quieras.';
  showInline(btnOn, true); showInline(btnOff, false); showInline(btnHelp, false);
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
// Si estamos en cool-down, no mostrar nada global
if (isGeoSuppressedNow()) { hideGeoBanner(); return; }
   
  if (isGeoDeferredThisSession()) { hideGeoBanner(); return; }

  const state = await detectGeoPermission();
  const hide = await shouldHideGeoBanner();

  // Si bloqueó desde perfil, nunca activamos aunque permiso sea granted
  if (isGeoBlockedLocally()) {
    stopGeoWatch();
    await setClienteConfigPatch({ geoEnabled: false, geoUpdatedAt: new Date().toISOString() });
    setGeoOffByUserUI();
    return;
  }

  if (state === 'granted') {
    setGeoMarketingUI(false);
    startGeoWatch();

    await setClienteConfigPatch({
      geoEnabled: true,
      geoOptInSource: 'permission',
      geoUpdatedAt: new Date().toISOString()
    });

    if (hide) { hideGeoBanner(); }
    else { setGeoRegularUI('granted'); }
    return;
  }

  // No granted → asegurar apagado
  stopGeoWatch();

  if (state === 'denied') {
    await setClienteConfigPatch({ geoEnabled: false, geoUpdatedAt: new Date().toISOString() });
    if (hide) { hideGeoBanner(); }
    else { setGeoMarketingUI(false); setGeoRegularUI('denied'); }
    return;
  }

  // state === 'prompt' | 'unknown'
  if (hide) { hideGeoBanner(); }
  else { setGeoMarketingUI(true); }
}
// ────────────────────────────────────────────────────────────
// GEO — Mini card contextual (p. ej. en "Beneficios cerca")
// ────────────────────────────────────────────────────────────

async function handleGeoEnable() {
  const { banner } = geoEls();

  try { localStorage.setItem(LS_GEO_STATE, 'accepted'); } catch {}
clearGeoSuppress(); // si acepta, levantamos cualquier cool-down previo

   emit('rampet:geo:enabled', { method: 'ui' });
  show(banner, false);
  startGeoWatch();

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
      navigator.geolocation.getCurrentPosition(() => { done(); }, () => { done(); }, { timeout: 3000, maximumAge: 120000, enableHighAccuracy: false });
      setTimeout(done, 3500);
    });
  } catch {}

  setTimeout(() => { updateGeoUI(); }, 0);
}

function handleGeoDisable() {
  // “Desactivar” del banner → diferido de sesión (para opt-out persistente usar “No gracias”)
  try { localStorage.setItem(LS_GEO_STATE, 'deferred'); } catch {}
  emit('rampet:geo:disabled', { method: 'ui' });
  setClienteConfigPatch({ geoEnabled: false, geoUpdatedAt: new Date().toISOString() }).catch(()=>{});
  updateGeoUI();
}

function handleGeoHelp() {
  alert('Para activarlo:\n\n1) Abrí configuración del navegador.\n2) Permisos → Activar ubicación.\n3) Recargá la página.');
}

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

/* ────────────────────────────────────────────────────────────
   GEO TRACKING “MIENTRAS ESTÉ ABIERTA”
   ──────────────────────────────────────────────────────────── */
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
      .collection('geo_raw').doc().set({ lat, lng, capturedAt: now, source: 'pwa' }, { merge: false });

    await db.collection('public_geo').doc(uid)
      .collection('samples').doc().set({ lat3: round3(lat), lng3: round3(lng), capturedAt: now, rounded: true, source: 'pwa' }, { merge: false });

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
  if (isGeoBlockedLocally()) return; // respetar opt-out del perfil
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
    if (document.visibilityState === 'visible') {
      if (!isGeoBlockedLocally()) startGeoWatch();
    } else {
      stopGeoWatch();
    }
  });
} catch {}

/* ────────────────────────────────────────────────────────────
   FORMULARIO DOMICILIO (clientes/{id}.domicilio)
   ──────────────────────────────────────────────────────────── */
function buildAddressLine(c) {
  const parts = [];
  if (c.calle) parts.push(c.calle + (c.numero ? ' ' + c.numero : ''));
  const pisoDto = [c.piso, c.depto].filter(Boolean).join(' ');
  if (pisoDto) parts.push(pisoDto);
  if (c.codigoPostal || c.localidad) parts.push([c.codigoPostal, c.localidad].filter(Boolean).join(' '));
  if (c.provincia) parts.push(c.provincia === 'CABA' ? 'CABA' : `Provincia de ${c.provincia}`);
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
      hideGeoBanner();
      updateGeoUI().catch(()=>{});
      emit('rampet:geo:changed', { enabled: true });
    } catch (e) {
      console.error('save domicilio error', e);
      toast('No pudimos guardar el domicilio', 'error');
    }
  });

  // Si el HTML trae un “Luego” nativo (#address-skip), cablearlo
  const skipBtn = g('address-skip');
  if (skipBtn && !skipBtn._wired) {
    skipBtn._wired = true;
    skipBtn.addEventListener('click', () => {
      try { sessionStorage.setItem('addressBannerDeferred','1'); } catch {}
      toast('Podés cargarlo cuando quieras desde tu perfil.', 'info');
      try { document.getElementById('address-banner')?.style && (document.getElementById('address-banner').style.display='none'); } catch {}
    });
  }

  // NO llamamos  aquí (para evitar duplicados).
}

/* ── Domicilio: asegurar botones y wiring anti-duplicado ── */
function ensureAddressBannerButtons() {
  const banner = document.getElementById('address-banner');
  if (!banner) return;
  if (banner._wired) return; // evita duplicados
  banner._wired = true;

  // Si ya difirió por sesión o rechazó persistente, ocultar de entrada
  try {
    if (sessionStorage.getItem('addressBannerDeferred') === '1') { banner.style.display = 'none'; return; }
    if (localStorage.getItem('addressBannerDismissed') === '1') { banner.style.display = 'none'; return; }
  } catch {}

  // Contenedor de acciones
  const actions = banner.querySelector('.prompt-actions') || banner;

  // Si existe un “Luego” preexistente (#address-skip), SOLO cablearlo y NO crear otro
  const preLater = document.getElementById('address-skip');
  if (preLater && !preLater._wired) {
    preLater._wired = true;
    preLater.addEventListener('click', () => {
      try { sessionStorage.setItem('addressBannerDeferred', '1'); } catch {}
      toast('Podés cargarlo cuando quieras desde tu perfil.', 'info');
      banner.style.display = 'none';
    });
  }

  // Crear “Luego” sólo si NO hay ninguno (ni #address-skip ni #address-later-btn)
  let later = document.getElementById('address-later-btn');
  if (!preLater && !later) {
    later = document.createElement('button');
    later.id = 'address-later-btn';
    later.className = 'secondary-btn';
    later.textContent = 'Luego';
    later.style.marginLeft = '8px';
    actions.appendChild(later);
  }
  if (later && !later._wired) {
    later._wired = true;
    later.addEventListener('click', () => {
      try { sessionStorage.setItem('addressBannerDeferred', '1'); } catch {}
      toast('Podés cargarlo cuando quieras desde tu perfil.', 'info');
      banner.style.display = 'none';
    });
  }

  // “No quiero” (persistente), crear sólo si falta
  let nogo = document.getElementById('address-nothanks-btn');
  if (!nogo) {
    nogo = document.createElement('button');
    nogo.id = 'address-nothanks-btn';
    nogo.className = 'link-btn';
    nogo.textContent = 'No quiero';
    nogo.style.marginLeft = '8px';
    actions.appendChild(nogo);
  }
  if (!nogo._wired) {
    nogo._wired = true;
    nogo.addEventListener('click', () => {
      try { localStorage.setItem('addressBannerDismissed','1'); } catch {}
      banner.style.display = 'none';
      toast('Listo, no vamos a pedirte domicilio.', 'info');
    });
  }
}

/* ────────────────────────────────────────────────────────────
   GEO — Perfil (switch)
   ──────────────────────────────────────────────────────────── */
async function fetchServerGeoEnabled() {
  try {
    const uid = firebase.auth().currentUser?.uid;
    if (!uid) return null;
    const clienteId = await getClienteDocIdPorUID(uid) || uid;
    const snap = await firebase.firestore().collection('clientes').doc(clienteId).get();
    const data = snap.exists ? snap.data() : null;
    return !!data?.config?.geoEnabled;
  } catch { return null; }
}
/* ────────────────────────────────────────────────────────────
   MINI-PROMPT GEO CONTEXTUAL (slot #geo-context-slot)
   ──────────────────────────────────────────────────────────── */
function __isVisible(el){ try { return !!el && getComputedStyle(el).display !== 'none'; } catch { return false; } }

export async function maybeShowGeoContextPrompt(slotId = 'geo-context-slot') {
  // 0) Slot válido
  const slot = document.getElementById(slotId);
  if (!slot) return;

  // 1) Respeto de supresiones / diferidos / bloqueos
  if (isGeoSuppressedNow()) { slot.innerHTML = ''; return; }          // cool-down activo
  if (isGeoDeferredThisSession()) { slot.innerHTML = ''; return; }     // diferido por sesión
  if (isGeoBlockedLocally()) { slot.innerHTML = ''; return; }          // opt-out desde Perfil o "No gracias"

  // 2) Evitar solapar con banners grandes ya visibles
  const addressBanner = document.getElementById('address-banner');
  const geoBanner     = document.getElementById('geo-banner');
  if (__isVisible(addressBanner) || __isVisible(geoBanner)) {
    slot.innerHTML = '';
    return;
  }

  // 3) Estado actual: si ya hay permiso o ya cargó domicilio, no mostramos
  const perm = await detectGeoPermission(); // 'granted' | 'denied' | 'prompt' | 'unknown'
  const hasAddr = await hasDomicilioOnServer();
  if (perm === 'granted' || hasAddr) {
    slot.innerHTML = '';
    return;
  }

  // 4) Render (idempotente)
  if (slot.querySelector('#geo-context-prompt')) return;
  slot.innerHTML = `
    <div id="geo-context-prompt" class="card" style="margin:12px 0; padding:12px; border:1px solid #e5e7eb; border-radius:12px;">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
        <div style="flex:1;">
          <div style="font-weight:600;">Promos cerca tuyo</div>
          <div style="font-size:14px; opacity:.8;">Activá ubicación para ver beneficios cerca de vos. Podés apagarlo cuando quieras.</div>
        </div>
        <button id="geo-context-activate" class="primary-btn" type="button">Activar</button>
      </div>
      <div style="margin-top:10px; display:flex; gap:8px;">
        <button id="geo-context-later" class="secondary-btn" type="button">Luego</button>
        <button id="geo-context-nothanks" class="link-btn" type="button">No gracias</button>
      </div>
    </div>
  `;

  const byId = (id) => slot.querySelector('#' + id);

  // Activar → usa el flujo normal (respeta LS_GEO_STATE, config, watch, etc.)
  byId('geo-context-activate')?.addEventListener('click', async () => {
    try { await handleGeoEnable(); } catch {}
    try { clearGeoSuppress(); } catch {}
    slot.innerHTML = '';
  });

  // Luego → diferimos solo por sesión (igual que el banner grande)
  byId('geo-context-later')?.addEventListener('click', () => {
    try { deferGeoBannerThisSession(); } catch {}
    slot.innerHTML = '';
    toast('Podés activarlo cuando quieras desde tu Perfil.', 'info');
  });

  // No gracias → bloqueo local + cool-down
  byId('geo-context-nothanks')?.addEventListener('click', async () => {
    try { localStorage.setItem(LS_GEO_STATE, 'blocked'); } catch {}
    try { setGeoSuppress(GEO_COOLDOWN_DAYS); } catch {}
    try { stopGeoWatch(); } catch {}
    try { await setClienteConfigPatch({ geoEnabled: false, geoUpdatedAt: new Date().toISOString() }); } catch {}
    slot.innerHTML = '';
    toast('Listo, no vamos a insistir por un tiempo. Podés activarlo desde tu Perfil.', 'info');
    emit('rampet:geo:changed', { enabled: false });
  });
}

// Exponer para uso desde index/app
try { window.maybeShowGeoContextPrompt = maybeShowGeoContextPrompt; } catch {}

export async function syncProfileGeoUI() {
  const cb = $('prof-consent-geo');
  if (!cb) return;

  if (isGeoBlockedLocally()) { cb.checked = false; return; }

  let serverOn = null;
  try { serverOn = await fetchServerGeoEnabled(); } catch {}

  if (serverOn === true) { cb.checked = true; return; }
  if (serverOn === false) { cb.checked = false; return; }

  const perm = await detectGeoPermission();
  cb.checked = (perm === 'granted');
}

export async function handleProfileGeoToggle(checked) {
  if (checked) {
     clearGeoSuppress();
    try { localStorage.setItem(LS_GEO_STATE, 'accepted'); } catch {}
    await setClienteConfigPatch({ geoEnabled: true, geoOptInSource: 'ui', geoUpdatedAt: new Date().toISOString() });
    startGeoWatch();
    emit('rampet:geo:changed', { enabled: true });
    updateGeoUI().catch(()=>{});
  } else {
    try { localStorage.setItem(LS_GEO_STATE, 'blocked'); } catch {}
    await setClienteConfigPatch({ geoEnabled: false, geoUpdatedAt: new Date().toISOString() });
    stopGeoWatch();
    emit('rampet:geo:changed', { enabled: false });
    updateGeoUI().catch(()=>{});
  }
}

/* ────────────────────────────────────────────────────────────
   Exposiciones y sincronías globales
   ──────────────────────────────────────────────────────────── */
try {
  window.handlePermissionRequest = handlePermissionRequest;
  window.handlePermissionSwitch = (e) => handlePermissionSwitch(e);
  window.handlePermissionBlockClick = handlePermissionBlockClick;
  window.syncProfileConsentUI = syncProfileConsentUI;
  window.handleProfileConsentToggle = handleProfileConsentToggle;
  window.syncProfileGeoUI = syncProfileGeoUI;
  window.handleProfileGeoToggle = handleProfileGeoToggle;
   window.maybeShowGeoContextPrompt = maybeShowGeoContextPrompt;
} catch {}

document.addEventListener('rampet:consent:notif-opt-in',  () => { syncProfileConsentUI(); });
document.addEventListener('rampet:consent:notif-opt-out', () => { syncProfileConsentUI(); });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    syncProfileConsentUI();
    syncProfileGeoUI();
  }
});

/* ────────────────────────────────────────────────────────────
   INIT (se llama desde app.js al loguearse)
   ──────────────────────────────────────────────────────────── */
export async function initNotificationsOnce() {
  await registerSW();
  await waitForActiveSW().catch(()=>{});

  // 1) UX de primer ingreso (domicilio/geo + card comercial notifs si corresponde)
  bootstrapFirstSessionUX();

  // 2) Watcher (solo UI) + re-suscripción one-shot si corresponde
  startNotifPermissionWatcher();

  // Re-suscripción agresiva (one-shot) también al iniciar
  if (
    AUTO_RESUBSCRIBE &&
    ('Notification' in window) &&
    Notification.permission === 'granted' &&
    hasPriorAppConsent() &&
    !hasLocalToken() &&
    (localStorage.getItem(LS_NOTIF_STATE) !== 'blocked')
  ) {
    await obtenerYGuardarTokenOneShot().catch(()=>{});
  }

  await hookOnMessage();
  refreshNotifUIFromPermission();
  wirePushButtonsOnce();

  // Checkboxes de Perfil
  const profCb = $('prof-consent-notif');
  if (profCb && !profCb._wired) {
    profCb._wired = true;
    profCb.addEventListener('change', (e) => handleProfileConsentToggle(!!e.target.checked));
  }
  syncProfileConsentUI();

  const profGeo = $('prof-consent-geo');
  if (profGeo && !profGeo._wired) {
    profGeo._wired = true;
    profGeo.addEventListener('change', (e) => handleProfileGeoToggle(!!e.target.checked));
  }
  syncProfileGeoUI();

  return true;
}

export async function gestionarPermisoNotificaciones() { refreshNotifUIFromPermission(); }
export function handleBellClick() { return Promise.resolve(); }
export async function handleSignOutCleanup() {
  try { localStorage.removeItem('fcmToken'); } catch {}
  try { sessionStorage.removeItem('rampet:firstSessionDone'); } catch {}
}



