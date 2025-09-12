// app.js (PWA del Cliente – instalación + notifs + INBOX modal con filtros)
// + Carrusel: autoplay 2.5s con setTimeout, drag desktop, snap estable en Edge, cursor grab, bloqueo drag de imágenes

import { setupFirebase, checkMessagingSupport, auth, db } from './modules/firebase.js';
import * as UI from './modules/ui.js';
import * as Data from './modules/data.js';
import * as Auth from './modules/auth.js';

// Notificaciones (único import desde notifications.js)
import {
  initNotificationsOnce,        // ← orquestador (canal SW→APP, onMessage, permisos y token, dedupe)
  handlePermissionRequest,       // UI: activar notifs desde tarjeta
  dismissPermissionRequest,      // UI: rechazar tarjeta
  handlePermissionSwitch,        // UI: switch en ajustes
  handleBellClick,               // UI: abrir modal inbox (sin autoleer)
  handleSignOutCleanup           // logout: limpieza token en Firestore/LS
} from './modules/notifications.js';

// === DEBUG / OBS ===
window.__RAMPET_DEBUG = true;
window.__BUILD_ID = 'pwa-2025-09-06-1';
function d(tag, ...args){ if (window.__RAMPET_DEBUG) console.log(`[DBG][${window.__BUILD_ID}] ${tag}`, ...args); }

window.__reportState = async (where='')=>{
  const notifPerm = (window.Notification?.permission)||'n/a';
  let swReady = false;
  try { swReady = !!(await navigator.serviceWorker?.getRegistration?.('/')); } catch {}
  const fcm = localStorage.getItem('fcmToken') ? 'present' : 'missing';
  let geo = 'n/a';
  try { if (navigator.permissions?.query) geo = (await navigator.permissions.query({name:'geolocation'})).state; } catch {}
  d(`STATE@${where}`, { notifPerm, swReady, fcm, geo });
};

// ──────────────────────────────────────────────────────────────
// ✨ PARCHE FCM (VAPID) — asegura token válido guardado en clientes/{docPorAuthUID}
// ──────────────────────────────────────────────────────────────
const VAPID_PUBLIC = (window.__RAMPET__ && window.__RAMPET__.VAPID_PUBLIC) || '';

async function ensureMessagingCompatLoaded() {
  if (typeof firebase?.messaging === 'function') return;
  await new Promise((ok, err) => {
    const s = document.createElement('script');
    s.src = 'https://www.gstatic.com/firebasejs/9.6.0/firebase-messaging-compat.js';
    s.onload = ok; s.onerror = err;
    document.head.appendChild(s);
  });
}

async function registerFcmSW() {
  if (!('serviceWorker' in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    console.log('✅ SW FCM registrado:', reg.scope || location.origin + '/');
    return true;
  } catch (e) {
    console.warn('[FCM] No se pudo registrar SW:', e?.message || e);
    return false;
  }
}

async function resolveClienteRefByAuthUID() {
  const u = auth.currentUser;
  if (!u) return null;
  const qs = await db.collection('clientes').where('authUID','==', u.uid).limit(1).get();
  if (qs.empty) return null;
  return qs.docs[0].ref;
}
// ==== MARCAR "READ" AUTOMÁTICO cuando se hace click en la notificación ====
async function markInboxReadById(notifId) {
  if (!notifId) return;
  try {
    const clienteRef = await resolveClienteRef(); // ya existe en tu app.js
    if (!clienteRef) return;
    await clienteRef.collection('inbox').doc(String(notifId))
      .set({ status: 'read', readAt: new Date().toISOString() }, { merge: true });
  } catch (e) {
    console.warn('[INBOX] marcar leído error:', e?.message || e);
  }
}

// Conectar canal SW → APP
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', async (ev) => {
    const t = ev?.data?.type;
    const d = ev?.data?.data || {};
    if (t === 'PUSH_READ') {
      await markInboxReadById(d.id);
      try { await fetchInboxBatchUnified?.(); } catch {}
    }
    if (t === 'PUSH_DELIVERED') {
      // opcional: actualizar badge, UI, etc.
    }
  });
}

async function guardarTokenEnMiDoc(token) {
  const ref = await resolveClienteRefByAuthUID();
  if (!ref) throw new Error('No encontré tu doc en clientes (authUID).');
  await ref.set({ fcmTokens: [token] }, { merge: true }); // ← reemplazo total
  localStorage.setItem('fcmToken', token);
  console.log('✅ Token FCM guardado en', ref.path);
}

/**
 * Intenta garantizar que, si el permiso está "granted" y hay VAPID,
 * exista un token actual y esté guardado en Firestore.
 * No fuerza el prompt: deja esa UX a tu módulo notifications.js y/o a los botones UI.
 */
async function initFCMForRampet() {
  if (!VAPID_PUBLIC) {
    console.warn('[FCM] Falta window.__RAMPET__.VAPID_PUBLIC en index.html');
    return;
  }
  await registerFcmSW();
  await ensureMessagingCompatLoaded();

  const perm = Notification?.permission || 'default';
  if (perm !== 'granted') {
    // No forzamos permiso aquí; tu UI (handlePermissionRequest) lo gestiona.
    d('FCM@skip', 'perm ≠ granted (no se solicita aquí)');
    return;
  }

  try {
    // Limpia token previo (si existiera) para evitar invalid/legacy
    try { await firebase.messaging().deleteToken(); } catch {}
    const tok = await firebase.messaging().getToken({ vapidKey: VAPID_PUBLIC });
    if (tok) {
      await guardarTokenEnMiDoc(tok);
      console.log('[FCM] token actual:', tok);
    } else {
      console.warn('[FCM] getToken devolvió vacío.');
    }
  } catch (e) {
    console.warn('[FCM] init error:', e?.message || e);
  }

  // Canal de mensajes del SW (opcional)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (ev) => {
      // ev.data = { type: 'PUSH_DELIVERED' | 'PUSH_READ', data: {...} }
      // acá podés enganchar UI si querés
    });
  }
}

// ──────────────────────────────────────────────────────────────
// LÓGICA DE INSTALACIÓN PWA
// ──────────────────────────────────────────────────────────────
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  console.log('✅ Evento "beforeinstallprompt" capturado. La app es instalable.');
});

window.addEventListener('appinstalled', async () => {
  console.log('✅ App instalada');
  localStorage.removeItem('installDismissed');
  deferredInstallPrompt = null;
  document.getElementById('install-prompt-card')?.style?.setProperty('display','none');
  document.getElementById('install-entrypoint')?.style?.setProperty('display','none');
  document.getElementById('install-help-modal')?.style?.setProperty('display','none');
  localStorage.setItem('pwaInstalled', 'true');

  const u = auth.currentUser;
  if (!u) return;
  try {
    const snap = await db.collection('clientes').where('authUID', '==', u.uid).limit(1).get();
    if (snap.empty) return;
    const ref = snap.docs[0].ref;

    const ua = navigator.userAgent || '';
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isAndroid = /Android/i.test(ua);
    const platform = isIOS ? 'iOS' : isAndroid ? 'Android' : 'Desktop';

    await ref.set({
      pwaInstalled: true,
      pwaInstalledAt: new Date().toISOString(),
      pwaInstallPlatform: platform
    }, { merge: true });
  } catch (e) {
    console.warn('No se pudo registrar la instalación en Firestore:', e);
  }
});

function isStandalone() {
  const displayModeStandalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  const iosStandalone = window.navigator.standalone === true;
  return displayModeStandalone || iosStandalone;
}
function showInstallPromptIfAvailable() {
  if (deferredInstallPrompt && !localStorage.getItem('installDismissed')) {
    const card = document.getElementById('install-prompt-card');
    if (card) card.style.display = 'block';
  }
}
async function handleInstallPrompt() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  console.log(`El usuario eligió: ${outcome}`);
  deferredInstallPrompt = null;
  const card = document.getElementById('install-prompt-card');
  if (card) card.style.display = 'none';
}
async function handleDismissInstall() {
  localStorage.setItem('installDismissed', 'true');
  const card = document.getElementById('install-prompt-card');
  if (card) card.style.display = 'none';
  console.log('El usuario descartó la instalación.');

  const u = auth.currentUser;
  if (!u) return;
  try {
    const snap = await db.collection('clientes').where('authUID', '==', u.uid).limit(1).get();
    if (snap.empty) return;
    await snap.docs[0].ref.set({
      pwaInstallDismissedAt: new Date().toISOString()
    }, { merge: true });
  } catch (e) {
    console.warn('No se pudo registrar el dismiss en Firestore:', e);
  }
}
function getInstallInstructions() {
  const ua = navigator.userAgent.toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isAndroid = /android/.test(ua);

  if (isIOS) {
    return `
      <p>En iPhone/iPad:</p>
      <ol>
        <li>Tocá el botón <strong>Compartir</strong>.</li>
        <li><strong>Añadir a pantalla de inicio</strong>.</li>
        <li>Confirmá con <strong>Añadir</strong>.</li>
      </ol>`;
  }
  if (isAndroid) {
    return `
      <p>En Android (Chrome/Edge):</p>
      <ol>
        <li>Menú <strong>⋮</strong> del navegador.</li>
        <li><strong>Instalar app</strong> o <strong>Añadir a pantalla principal</strong>.</li>
        <li>Confirmá.</li>
      </ol>`;
  }
  return `
    <p>En escritorio (Chrome/Edge):</p>
    <ol>
      <li>Icono <strong>Instalar</strong> en la barra de direcciones.</li>
      <li><strong>Instalar app</strong>.</li>
      <li>Confirmá.</li>
    </ol>`;
}

// ──────────────────────────────────────────────────────────────
// UTILIDAD: addEventListener seguro por id
// ──────────────────────────────────────────────────────────────
function on(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}

// ==== [RAMPET][GEO v2] Ubicación ON por defecto (si permitido) + franjas + refresco 6h ====

// Configuración
const GEO_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 horas para refresco silencioso
const SLOT_RADIUS_M = 200;                  // radio de consistencia (~200m)
const STABILITY_TARGET = 10;                // cuántas muestras "buenas" para estabilidad alta

// Franjas (07–12 / 12–18 / 18–24)
function currentTimeSlot(d = new Date()) {
  const h = d.getHours();
  if (h >= 7 && h < 12) return 'morning';
  if (h >= 12 && h < 18) return 'afternoon';
  return 'evening';
}

// Utilidades
function roundCoord(value, decimals = 3) {
  const f = Math.pow(10, decimals);
  return Math.round(value * f) / f;
}
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function updateSlotModel(slotData, lat, lng) {
  const prev = slotData || {};
  const center = prev.center || { lat, lng };
  const dist = haversineMeters(center.lat, center.lng, lat, lng);
  let samples = Math.max(0, prev.samples || 0);
  let stability = Math.max(0, Math.min(1, prev.stabilityScore || 0));

  if (dist <= SLOT_RADIUS_M) {
    samples += 1;
    stability = Math.min(1, samples / STABILITY_TARGET);
    const w = 1 / Math.max(1, samples);
    const newLat = center.lat * (1 - w) + lat * w;
    const newLng = center.lng * (1 - w) + lng * w;
    return {
      center: { lat: newLat, lng: newLng },
      samples,
      stabilityScore: stability,
      capturedAt: new Date().toISOString(),
      centerRounded: { lat3: roundCoord(newLat, 3), lng3: roundCoord(newLng, 3) }
    };
  } else {
    stability = Math.max(0, stability - 0.1);
    const w = 0.15;
    const newLat = center.lat * (1 - w) + lat * w;
    const newLng = center.lng * (1 - w) + lng * w;
    return {
      center: { lat: newLat, lng: newLng },
      samples,
      stabilityScore: stability,
      capturedAt: new Date().toISOString(),
      centerRounded: { lat3: roundCoord(newLat, 3), lng3: roundCoord(newLng, 3) }
    };
  }
}

// Detección simple de dispositivo (para marcar si es desktop/ip based)
function getDeviceInfo() {
  const ua = navigator.userAgent || '';
  const isMobile = /Android|iPhone|iPad|iPod|IEMobile|WPDesktop/i.test(ua);
  const isTablet = /iPad|Tablet/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const deviceType = isMobile ? (isTablet ? 'tablet' : 'mobile') : 'desktop';
  return { deviceType, isIOS, isAndroid, ua };
}
async function isEphemeralContext() {
  try {
    if (!navigator.storage?.estimate) return false;
    const { quota } = await navigator.storage.estimate();
    return !!quota && quota < 160 * 1024 * 1024;
  } catch { return false; }
}

// Banner (ON/OFF/DENIED)
function showGeoBanner({ state, message }) {
  const wrap = document.getElementById('geo-banner');
  const txt  = document.getElementById('geo-banner-text');
  const btnOff  = document.getElementById('geo-disable-btn');
  const btnOn   = document.getElementById('geo-enable-btn');
  const btnHelp = document.getElementById('geo-help-btn');
  if (!wrap || !txt || !btnOff || !btnOn || !btnHelp) return;

  wrap.style.display = 'block';
  txt.textContent = message || (
    state === 'on'
      ? '📍 Ubicación activada para recibir beneficios cercanos.'
      : state === 'denied'
        ? '⚠️ Tu navegador tiene la ubicación bloqueada para esta app.'
        : 'Podés activar tu ubicación para recibir beneficios cercanos.'
  );
  btnOff.style.display  = state === 'on'     ? 'inline-block' : 'none';
  btnOn.style.display   = state !== 'on'     ? 'inline-block' : 'none';
  btnHelp.style.display = state === 'denied' ? 'inline-block' : 'none';
}

// Guarda última ubicación “cruda” (y redondeada) + consentimiento
async function saveLastLocationToFirestore(pos) {
  const clienteRef = await resolveClienteRef();
  if (!clienteRef) return;

  const { latitude: lat, longitude: lng, accuracy } = pos.coords || {};
  const nowIso = new Date().toISOString();

  // snapshot previo para no degradar exactitud y para nombre/numeroSocio
  let prev = null;
  try {
    const snap = await clienteRef.get();
    prev = snap.exists ? snap.data() : null;
  } catch (_) {}

  // Clasificación de calidad + flag heurístico desktop/ip
  let quality = 'high';
  if (accuracy > 150) quality = 'low';
  else if (accuracy > 50) quality = 'medium';

  const { deviceType } = getDeviceInfo();
  const lowConfidence = (deviceType === 'desktop' && (accuracy == null || accuracy > 800)); // heurística PC/IP

  const hadGoodExact =
    prev?.lastLocation?.accuracy != null && prev.lastLocation.accuracy <= 80;

  const patch = {
    locationConsent: true,
    lastLocationRounded: {
      lat3: roundCoord(lat, 3),
      lng3: roundCoord(lng, 3),
      capturedAt: nowIso
    }
  };

  if (!(quality === 'low' && hadGoodExact)) {
    patch.lastLocation = {
      lat, lng, accuracy,
      capturedAt: nowIso,
      source: 'geolocation',
      quality,
      flags: { lowConfidence, deviceType }
    };
  } else {
    patch.lastLocationLowSample = {
      lat, lng, accuracy,
      capturedAt: nowIso,
      source: 'geolocation',
      quality: 'low',
      flags: { lowConfidence, deviceType }
    };
  }

  await clienteRef.set(patch, { merge: true });

  // ===== Espejo público (último punto) para el mapa =====
  try {
    const u = auth.currentUser;
    if (!u) return;

    // Leemos del doc del cliente para armar identidad visible
    // (si no hay, caemos a displayName/email/uid)
    let nombreOut = null;
    let numeroSocioOut = null;

    if (prev) {
      if (typeof prev.nombre === 'string' && prev.nombre.trim()) {
        nombreOut = prev.nombre.trim();
      }
      if (prev.numeroSocio != null && String(prev.numeroSocio).trim()) {
        numeroSocioOut = String(prev.numeroSocio).trim();
      }
    }

    let fallback =
      (u.displayName && u.displayName.trim()) ? u.displayName.trim()
        : (u.email ? u.email.split('@')[0] : u.uid);

    // Si hay numeroSocio, lo mostramos como “Socio NNN”
    const display =
      nombreOut ? nombreOut
        : (numeroSocioOut ? `Socio ${numeroSocioOut}` : fallback);

    await db.collection('public_heatmap').doc(u.uid).set({
      uid: u.uid,
      // guardamos TODOS para que el mapa los pueda leer sin joins
      nombre: nombreOut || null,
      numeroSocio: numeroSocioOut || null,
      display,                 // texto ya resuelto para mostrar
      lat3: roundCoord(lat, 3),
      lng3: roundCoord(lng, 3),
      capturedAt: nowIso,
      rounded: true,
      source: 'geolocation',
      updatedAt: nowIso
    }, { merge: true });
  } catch (e) {
    console.warn('[HEATMAP] write espejo falló (no crítico):', e?.message || e);
  }

  // ===== Histórico (recorrido) opcional =====
  try {
    const u = auth.currentUser;
    if (u) {
      await db.collection('public_geo').doc(u.uid).collection('samples').add({
        lat3: roundCoord(lat, 3),
        lng3: roundCoord(lng, 3),
        capturedAt: nowIso,
        source: 'geolocation',
        accuracy: accuracy ?? null,
        deviceType: getDeviceInfo().deviceType
      });
    }
  } catch (e) {
    // Si no existen reglas para public_geo, se ignora sin romper el flujo
    console.warn('[GEO] histórico no guardado (reglas o índices):', e?.message || e);
  }
}

// Actualiza el slot de la franja actual (centro + estabilidad)
async function saveSlotSample(pos) {
  const clienteRef = await resolveClienteRef();
  if (!clienteRef) return;

  const { latitude: lat, longitude: lng } = pos.coords || {};
  const slot = currentTimeSlot();

  const snap = await clienteRef.get();
  const data = snap.exists ? snap.data() : {};
  const prevSlot = data?.timeSlots?.[slot] || null;

  const updated = updateSlotModel(prevSlot, lat, lng);

  const patch = {
    [`timeSlots.${slot}.center`]: updated.center,
    [`timeSlots.${slot}.centerRounded`]: updated.centerRounded,
    [`timeSlots.${slot}.capturedAt`]: updated.capturedAt,
    [`timeSlots.${slot}.samples`]: updated.samples,
    [`timeSlots.${slot}.stabilityScore`]: updated.stabilityScore
  };
  await clienteRef.set(patch, { merge: true });
}

// Desactivar desde UI
async function disableLocationInFirestore() {
  const clienteRef = await resolveClienteRef();
  if (!clienteRef) return;
  await clienteRef.set({
    locationConsent: false,
    lastLocation: null,
    lastLocationRounded: null,
    timeSlots: {}
  }, { merge: true });
}

// Helper geolocalización
function getPosition(opts) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, opts);
  });
}

async function requestAndSaveLocation(reason = 'startup') {
  if (!('geolocation' in navigator)) {
    showGeoBanner({ state: 'off', message: 'Este dispositivo no soporta geolocalización.' });
    return;
  }

  // Helper local para pedir posición con opciones
  function attempt(opts) {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, opts);
    });
  }

  // Leemos estado actual (informativo / UX)
  let perm = 'unknown';
  try {
    perm = (await navigator.permissions?.query?.({ name: 'geolocation' }))?.state || 'unknown';
  } catch {}

  try {
    let pos;

    // Intento A: más exigente, para disparar prompt si está en "prompt"
    try {
      pos = await attempt({ enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
    } catch (e1) {
      // Si se pasó de tiempo o no hay proveedor, intentamos con menos precisión y más tiempo
      if (e1?.code === 3 /* TIMEOUT */ || e1?.code === 2 /* POSITION_UNAVAILABLE */) {
        pos = await attempt({ enableHighAccuracy: false, timeout: 25000, maximumAge: 0 });
      } else {
        throw e1; // otros errores (por ej. denied) se propagan
      }
    }

    // Guardado + UI
    await saveLastLocationToFirestore(pos);
    await saveSlotSample(pos);
    showGeoBanner({ state: 'on' });
  } catch (err) {
    const code = err?.code;
    const msg  = err?.message || '';
    console.warn(`[GEO] getCurrentPosition error: ${code} ${msg} (perm: ${perm})`);

    // 1 = PERMISSION_DENIED (usuario o navegador lo negó)
    if (code === 1 || perm === 'denied') {
      showGeoBanner({
        state: 'denied',
        message: '⚠️ La ubicación está bloqueada para este sitio. Habilitala desde el candado (ubicación → Permitir) y recargá.'
      });
    } else {
      // 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT (mostramos "off" amigable)
      showGeoBanner({
        state: 'off',
        message: 'No pudimos obtener tu ubicación. Intentá de nuevo o revisá el permiso en el candado.'
      });
    }
  }
}



// Primera interacción natural para pedir permiso si está en "prompt"
let _geoFirstInteractionBound = false;
function setupFirstInteractionOnce() {
  if (_geoFirstInteractionBound) return;
  _geoFirstInteractionBound = true;

  const handler = async () => {
    document.removeEventListener('click', handler, true);
    document.removeEventListener('keydown', handler, true);
    document.removeEventListener('touchstart', handler, true);
    await requestAndSaveLocation('first_interaction');
  };
  document.addEventListener('click', handler, true);
  document.addEventListener('keydown', handler, true);
  document.addEventListener('touchstart', handler, true);
}

// ON por defecto si ya está “granted”; si “prompt”, pedimos en primera interacción; si “denied”, avisamos.
async function ensureGeoOnStartup() {
   // Si es invitado/incógnito, no forzamos geo; mostramos info y pedimos en primer gesto
  if (await isEphemeralContext()) {
    showGeoBanner({
      state: 'off',
      message: 'Estás en modo Invitado/Incógnito: la ubicación sólo funciona temporalmente en esta sesión.'
    });
    setupFirstInteractionOnce(); // que el usuario la active manualmente
    return;
  }

  const clienteRef = await resolveClienteRef();
  if (!clienteRef) return;

  try {
    const snap = await clienteRef.get();
    const data = snap.exists ? snap.data() : {};
    if (data?.locationConsent === false) {
      showGeoBanner({ state: 'off' });
      return;
    }
  } catch (_) {}

  if ('permissions' in navigator && navigator.permissions?.query) {
    try {
      const st = await navigator.permissions.query({ name: 'geolocation' });
      if (st.state === 'granted') {
        await requestAndSaveLocation('startup_granted');
      } else if (st.state === 'prompt') {
        showGeoBanner({ state: 'off' });
        setupFirstInteractionOnce();
      } else {
        showGeoBanner({ state: 'denied' });
      }
      st.onchange = () => {
        if (st.state === 'granted') requestAndSaveLocation('perm_change_granted');
        else if (st.state === 'denied') showGeoBanner({ state: 'denied' });
      };
      return;
    } catch (_) {}
  }

  showGeoBanner({ state: 'off' });
  setupFirstInteractionOnce();
}

async function maybeRefreshIfStale() {
  const clienteRef = await resolveClienteRef();
  if (!clienteRef) return;
  try {
    const snap = await clienteRef.get();
    const data = snap.exists ? snap.data() : {};
    if (data?.locationConsent === false) return;

    const now = Date.now();
    let stale = true;

    if (data?.lastLocation?.capturedAt) {
      const t = new Date(data.lastLocation.capturedAt).getTime();
      if (isFinite(t) && (now - t) < GEO_MAX_AGE_MS) stale = false;
    }
    const slot = currentTimeSlot();
    const slotCap = data?.timeSlots?.[slot]?.capturedAt;
    if (slotCap) {
      const t2 = new Date(slotCap).getTime();
      if (isFinite(t2) && (now - t2) < GEO_MAX_AGE_MS) stale = false;
    }

    if (stale) {
      await requestAndSaveLocation('refresh_visible');
    }
  } catch (e) {
    console.warn('[GEO] maybeRefreshIfStale error:', e?.message || e);
  }
}

// ==== [RAMPET][HOME LIMITS] Límite de historial y vencimientos + 'Ver todo' ====
const UI_LIMITS = {
  HISTORIAL_MAX: 8,
  VENC_FECHAS_MAX: 3,
};

const _rampetUiObservers = [];
function registerObserver(mo){ _rampetUiObservers.push(mo); }
function cleanupUiObservers(){
  while (_rampetUiObservers.length) {
    const mo = _rampetUiObservers.pop();
    try { mo.disconnect(); } catch {}
  }
}

function ensureVerTodoLink(container, linkId, text, onClick){
  if (!container) return;
  let link = container.querySelector('#' + linkId);
  if (!link) {
    link = document.createElement('a');
    link.id = linkId;
    link.className = 'ver-todo-link';
    link.textContent = text;
    link.href = 'javascript:void(0)';
    container.appendChild(link);
  }
  link.onclick = onClick;
}

async function limitHistorialReciente() {
  const ul = document.getElementById('lista-historial');
  if (!ul) return;
  const items = Array.from(ul.querySelectorAll('li'));
  if (items.length > UI_LIMITS.HISTORIAL_MAX) {
    items.slice(UI_LIMITS.HISTORIAL_MAX).forEach(li => { li.style.display = 'none'; });
    const container = ul.parentElement || ul;
    ensureVerTodoLink(container, 'ver-historial-link', 'Ver todo el historial', async () => {
      await openInboxModal();
    });
  }
}

async function limitVencimientos() {
  const list = document.querySelector('.venc-list');
  if (!list) return;
  const items = Array.from(list.querySelectorAll('li')).filter(li => !li.classList.contains('venc-empty'));
  if (items.length > UI_LIMITS.VENC_FECHAS_MAX) {
    items.slice(UI_LIMITS.VENC_FECHAS_MAX).forEach(li => { li.style.display = 'none'; });
    const container = list.parentElement || list;
    ensureVerTodoLink(container, 'ver-venc-link', 'Ver todos los vencimientos', async () => {
      await openInboxModal();
    });
  }
}

function setupMainLimitsObservers() {
  const hist = document.getElementById('lista-historial');
  if (hist) {
    const mo = new MutationObserver(() => limitHistorialReciente());
    mo.observe(hist, { childList: true });
    registerObserver(mo);
    limitHistorialReciente();
  }
  const venc = document.querySelector('.venc-list');
  if (venc) {
    const mo2 = new MutationObserver(() => limitVencimientos());
    mo2.observe(venc, { childList: true });
    registerObserver(mo2);
    limitVencimientos();
  }
}

// ──────────────────────────────────────────────────────────────
// TÉRMINOS & CONDICIONES (modal existente en HTML)
// ──────────────────────────────────────────────────────────────
function termsModal() { return document.getElementById('terms-modal'); }
function termsTextEl() { return document.getElementById('terms-text'); }

function loadTermsContent() {
  const el = termsTextEl();
  if (!el) return;
  el.innerHTML = `
    <p><strong>1. Generalidades:</strong> El programa de fidelización "Club RAMPET" es un beneficio exclusivo para nuestros clientes. La participación en el programa es gratuita e implica la aceptación total de los presentes términos y condiciones.</p>
    <p><strong>2. Consentimiento de Comunicaciones:</strong> Al registrarte y/o aceptar los términos en la aplicación, otorgas tu consentimiento explícito para recibir comunicaciones transaccionales y promocionales del Club RAMPET a través de correo electrónico y notificaciones push. Estas comunicaciones son parte integral del programa de fidelización e incluyen, entre otros, avisos sobre puntos ganados, premios canjeados, promociones especiales y vencimiento de puntos. Puedes gestionar tus preferencias de notificaciones en cualquier momento.</p>
    <p><strong>3. Acumulación de Puntos:</strong> Los puntos se acumularán según la tasa de conversión vigente establecida por RAMPET. Los puntos no tienen valor monetario, no son transferibles a otras personas ni canjeables por dinero en efectivo.</p>
    <p><strong>4. Canje de Premios:</strong> El canje de premios se realiza exclusivamente en el local físico y será procesado por un administrador del sistema. La PWA sirve como un catálogo para consultar los premios disponibles y los puntos necesarios. Para realizar un canje, el cliente debe presentar una identificación válida.</p>
    <p><strong>5. Validez y Caducidad:</strong> Los puntos acumulados tienen una fecha de caducidad que se rige por las reglas definidas en el sistema. El cliente será notificado de los vencimientos próximos a través de los canales de comunicación aceptados para que pueda utilizarlos a tiempo.</p>
    <p><strong>6. Modificaciones del Programa:</strong> RAMPET se reserva el derecho de modificar los términos y condiciones, la tasa de conversión, el catálogo de premios o cualquier otro aspecto del programa de fidelización, inclusive su finalizacion, en cualquier momento y sin previo aviso.</p>
  `;
}
function openTermsModal(){ const m=termsModal(); if(!m) return; loadTermsContent(); m.style.display='flex'; }
function closeTermsModal(){ const m=termsModal(); if(!m) return; m.style.display='none'; }
function wireTermsModalBehavior(){
  const m=termsModal(); if(!m||m._wired) return; m._wired=true;
  on('close-terms-modal','click',closeTermsModal);
  on('accept-terms-btn-modal','click',closeTermsModal);
  m.addEventListener('click',(e)=>{ if(e.target===m) closeTermsModal(); });
  document.addEventListener('keydown',(e)=>{ if(e.key==='Escape' && m.style.display==='flex') closeTermsModal(); });
}

// ──────────────────────────────────────────────────────────────
// INBOX MODAL
// ──────────────────────────────────────────────────────────────
let inboxFilter = 'all';
let inboxLastSnapshot = [];

function normalizeCategory(v){
  if (!v) return '';
  const x = String(v).toLowerCase();
  if (['punto','puntos','movimientos','historial'].includes(x)) return 'puntos';
  if (['promo','promos','promoción','promocion','campaña','campanas','campaña','campañas'].includes(x)) return 'promos';
  if (['otro','otros','general','aviso','avisos'].includes(x)) return 'otros';
  return x;
}
function itemMatchesFilter(it){
  if (inboxFilter === 'all') return true;
  const cat = normalizeCategory(it.categoria || it.category);
  return cat === inboxFilter;
}
function renderInboxList(items){
  const list = document.getElementById('inbox-list');
  const empty = document.getElementById('inbox-empty');
  if (!list || !empty) return;

  const data = items.filter(itemMatchesFilter);
  empty.style.display = data.length ? 'none' : 'block';

  if (!data.length) { list.innerHTML = ''; return; }

  list.innerHTML = data.map(it=>{
    const sentAt = it.sentAt ? (it.sentAt.toDate ? it.sentAt.toDate() : new Date(it.sentAt)) : null;
    const dateTxt = sentAt ? sentAt.toLocaleString() : '';
    const url = it.url || '/notificaciones';
    return `
      <div class="card" style="margin:8px 0; cursor:pointer;" data-url="${url}">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
          <div style="flex:1 1 auto;">
            <div style="font-weight:700;">${it.title || 'Mensaje'}</div>
            <div style="color:#555; margin-top:6px;">${it.body || ''}</div>
            <div style="color:#999; font-size:12px; margin-top:8px;">${dateTxt}</div>
          </div>
          <div style="flex:0 0 auto;">➡️</div>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.card[data-url]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const goto = el.getAttribute('data-url') || '/notificaciones';
      window.location.href = goto;
    });
  });
}

let inboxPagination = { clienteRefPath:null };

async function resolveClienteRef() {
  if (inboxPagination.clienteRefPath) return db.doc(inboxPagination.clienteRefPath);
  const u = auth.currentUser;
  if (!u) return null;
  const qs = await db.collection('clientes').where('authUID','==', u.uid).limit(1).get();
  if (qs.empty) return null;
  inboxPagination.clienteRefPath = qs.docs[0].ref.path;
  return qs.docs[0].ref;
}

async function fetchInboxBatchUnified() {
  const clienteRef = await resolveClienteRef();
  if (!clienteRef) { renderInboxList([]); return; }

  try {
    const snap = await clienteRef.collection('inbox')
      .orderBy('sentAt','desc')
      .limit(50)
      .get();

    const items = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    inboxLastSnapshot = items;
    renderInboxList(items);
  } catch (e) {
    console.warn('[INBOX] fetch error:', e?.message || e);
    inboxLastSnapshot = [];
    renderInboxList([]);
  }
}

function wireInboxModal(){
  const modal = document.getElementById('inbox-modal');
  if (!modal || modal._wired) return;
  modal._wired = true;

  const setActive =(idActive)=>{
    ['inbox-tab-todos','inbox-tab-promos','inbox-tab-puntos','inbox-tab-otros'].forEach(id=>{
      const btn = document.getElementById(id);
      if (!btn) return;
      const isActive = id===idActive;
      btn.classList.toggle('primary-btn', isActive);
      btn.classList.toggle('secondary-btn', !isActive);
    });
  };

  on('inbox-tab-todos','click', async ()=>{ inboxFilter='all';   setActive('inbox-tab-todos');  renderInboxList(inboxLastSnapshot); });
  on('inbox-tab-promos','click',async ()=>{ inboxFilter='promos'; setActive('inbox-tab-promos'); renderInboxList(inboxLastSnapshot); });
  on('inbox-tab-puntos','click',async ()=>{ inboxFilter='puntos'; setActive('inbox-tab-puntos'); renderInboxList(inboxLastSnapshot); });
  on('inbox-tab-otros','click', async ()=>{ inboxFilter='otros';  setActive('inbox-tab-otros');  renderInboxList(inboxLastSnapshot); });

  on('close-inbox-modal','click', ()=> modal.style.display='none');
  on('inbox-close-btn','click', ()=> modal.style.display='none');
  modal.addEventListener('click',(e)=>{ if(e.target===modal) modal.style.display='none'; });

  on('inbox-mark-read','click', async ()=>{
    const clienteRef = await resolveClienteRef();
    if (!clienteRef || !inboxLastSnapshot.length) return;
    const batch = db.batch();
    inboxLastSnapshot
      .filter(itemMatchesFilter)
      .forEach(it=>{
        const ref = clienteRef.collection('inbox').doc(it.id);
        batch.set(ref, { status:'read', readAt:new Date().toISOString() }, { merge:true });
      });
    try{ await batch.commit(); await fetchInboxBatchUnified(); }
    catch(e){ console.warn('[INBOX] marcar leído error:', e?.message || e); }
  });

  document.addEventListener('keydown',(e)=>{ if(e.key==='Escape' && modal.style.display==='flex'){ modal.style.display='none'; }});
}

async function openInboxModal() {
  wireInboxModal();
  inboxFilter = 'all';
  await fetchInboxBatchUnified();
  const modal = document.getElementById('inbox-modal');
  if (modal) modal.style.display = 'flex';
}

// ──────────────────────────────────────────────────────────────
function carruselSlides(root){
  return root ? Array.from(root.querySelectorAll('.banner-item, .banner-item-texto')) : [];
}
function carruselIdxCercano(root){
  const slides = carruselSlides(root);
  if (!slides.length) return 0;
  const mid = root.scrollLeft + root.clientWidth/2;
  let best = 0, dmin = Infinity;
  slides.forEach((s,i)=>{
    const c = s.offsetLeft + s.offsetWidth/2;
    const d = Math.abs(c - mid);
    if (d < dmin){ dmin = d; best = i; }
  });
  return best;
}
function carruselScrollTo(root, idx, smooth=true){
  const slides = carruselSlides(root);
  if (!slides.length) return;
  const i = Math.max(0, Math.min(idx, slides.length-1));
  const t = slides[i];
  const left = t.offsetLeft - (root.clientWidth - t.offsetWidth)/2;
  root.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
}
function carruselUpdateDots(root, dotsRoot){
  if (!dotsRoot) return;
  const dots = Array.from(dotsRoot.querySelectorAll('.indicador'));
  if (!dots.length) return;
  const idx = carruselIdxCercano(root);
  dots.forEach((d,i)=> d.classList.toggle('activo', i===idx));
}
function carruselWireDots(root, dotsRoot, pause, resumeSoon){
  if (!root || !dotsRoot) return;
  Array.from(dotsRoot.querySelectorAll('.indicador')).forEach((dot,i)=>{
    dot.tabIndex = 0;
    dot.onclick = ()=>{ pause(); carruselScrollTo(root, i); resumeSoon(1200); };
    dot.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); dot.click(); } };
  });
}

function initCarouselBasic(){
  const root = document.getElementById('carrusel-campanas');
  const dotsRoot = document.getElementById('carrusel-indicadores');
  if (!root) return;

  root.querySelectorAll('img').forEach(img => img.setAttribute('draggable','false'));

  function setScrollBehaviorSmooth(enable){ root.style.scrollBehavior = enable ? 'smooth' : 'auto'; }

  let isDown = false;
  let startX = 0;
  let startScroll = 0;
  let raf = null;

  const AUTOPLAY = 2500;
  const RESUME_DELAY = 1200;
  let autoplayTimer = null;

  function clearAutoplay(){ if (autoplayTimer){ clearTimeout(autoplayTimer); autoplayTimer = null; } }
  function scheduleAutoplay(delay = AUTOPLAY){
    clearAutoplay();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    autoplayTimer = setTimeout(()=>{
      if (!isDown && document.visibilityState === 'visible'){
        const slides = carruselSlides(root);
        if (slides.length){
          const cur = carruselIdxCercano(root);
          const next = (cur + 1) % slides.length;
          carruselScrollTo(root, next, true);
        }
      }
      scheduleAutoplay(AUTOPLAY);
    }, delay);
  }
  function pauseAutoplay(){ clearAutoplay(); }
  function resumeAutoplaySoon(delay = AUTOPLAY){ clearAutoplay(); autoplayTimer = setTimeout(()=> scheduleAutoplay(), delay); }

  const onDown = (e)=>{
    isDown = true;
    startX = e.clientX;
    startScroll = root.scrollLeft;
    root.classList.add('arrastrando');
    try{ root.setPointerCapture(e.pointerId);}catch{}
    setScrollBehaviorSmooth(false);
    pauseAutoplay();
  };
  const onMove = (e)=>{
    if(!isDown) return;
    root.scrollLeft = startScroll - (e.clientX - startX);
    if (e.cancelable) e.preventDefault();
  };
  const finishDrag = (e)=>{
    if(!isDown) return;
    isDown = false;
    root.classList.remove('arrastrando');
    try{ if(e?.pointerId!=null) root.releasePointerCapture(e.pointerId);}catch{}
    const idx = carruselIdxCercano(root);
    setScrollBehaviorSmooth(true);
    carruselScrollTo(root, idx, true);
    resumeAutoplaySoon(RESUME_DELAY);
  };

  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove, { passive:true });
  root.addEventListener('pointerup', finishDrag, { passive:true });
  root.addEventListener('pointercancel', finishDrag, { passive:true });
  root.addEventListener('mouseleave', ()=>{ if(isDown) finishDrag({}); }, { passive:true });

  root.addEventListener('mouseenter', pauseAutoplay, { passive:true });
  root.addEventListener('mouseleave', ()=> resumeAutoplaySoon(RESUME_DELAY), { passive:true });

  const onScroll = ()=>{
    if (raf) return;
    raf = requestAnimationFrame(()=>{
      carruselUpdateDots(root, dotsRoot);
      raf = null;
    });
    pauseAutoplay();
    resumeAutoplaySoon(RESUME_DELAY);
  };
  root.addEventListener('scroll', onScroll, { passive:true });

  root.addEventListener('click', () => resumeAutoplaySoon(RESUME_DELAY), true);

  carruselWireDots(root, dotsRoot, pauseAutoplay, resumeAutoplaySoon);
  carruselUpdateDots(root, dotsRoot);
  if (dotsRoot){
    dotsRoot.addEventListener('click', () => resumeAutoplaySoon(RESUME_DELAY));
  }

  let snapT = null;
  function snapSoon(delay=90){
    clearTimeout(snapT);
    snapT = setTimeout(()=>{
      const idx = carruselIdxCercano(root);
      setScrollBehaviorSmooth(true);
      carruselScrollTo(root, idx, true);
    }, delay);
  }
  window.addEventListener('resize', ()=> snapSoon(150));

  setScrollBehaviorSmooth(false);
  carruselScrollTo(root, 0, false);
  setScrollBehaviorSmooth(true);
  scheduleAutoplay(AUTOPLAY);

  document.addEventListener('visibilitychange', ()=>{
    if (document.hidden) pauseAutoplay();
    else resumeAutoplaySoon(AUTOPLAY);
  });

  const mo = new MutationObserver(()=>{
    root.querySelectorAll('img').forEach(img => img.setAttribute('draggable','false'));
    carruselUpdateDots(root, dotsRoot);
  });
  mo.observe(root, { childList:true });
  root._rampetObs = mo;
}

// ──────────────────────────────────────────────────────────────
// LISTENERS DE PANTALLAS
// ──────────────────────────────────────────────────────────────
function setupAuthScreenListeners() {
  on('show-register-link', 'click', (e) => { e.preventDefault(); UI.showScreen('register-screen'); });
  on('show-login-link', 'click', (e) => { e.preventDefault(); UI.showScreen('login-screen'); });

  on('login-btn', 'click', Auth.login);
  on('register-btn', 'click', Auth.registerNewAccount);

  on('show-terms-link', 'click', (e) => { e.preventDefault(); openTermsModal(); });
  on('forgot-password-link', 'click', (e) => { e.preventDefault(); Auth.sendPasswordResetFromLogin(); });

  on('close-terms-modal', 'click', closeTermsModal);
}
// ──────────────────────────────────────────────────────────────
// GEO UI (NO-OP seguro si no están los elementos)
// ──────────────────────────────────────────────────────────────
function setupGeoUi() {
  const on = (id, ev, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(ev, fn);
  };

  on('geo-enable-btn', 'click', async () => {
    try { await requestAndSaveLocation('enable_click'); }
    catch (e) { console.warn('[GEO] enable click error:', e?.message || e); }
  });

  on('geo-disable-btn', 'click', async () => {
    try {
      await disableLocationInFirestore();
      showGeoBanner({ state: 'off', message: 'Ubicación desactivada. Podés volver a activarla cuando quieras.' });
    } catch (e) {
      console.warn('[GEO] disable error:', e?.message || e);
    }
  });

  on('geo-help-btn', 'click', () => {
    alert('Para habilitar la ubicación, abrí los permisos del sitio en tu navegador y permití "Ubicación". Luego tocá "Activar ubicación".');
  });
}

function setupMainAppScreenListeners() {
  on('logout-btn', 'click', async () => {
    await handleSignOutCleanup();
    const c = document.getElementById('carrusel-campanas');
    if (c && c._rampetObs) { try { c._rampetObs.disconnect(); } catch {} }
    cleanupUiObservers();
    Auth.logout();
  });

  on('change-password-btn', 'click', UI.openChangePasswordModal);
  on('save-new-password-btn', 'click', Auth.changePassword);
  on('close-password-modal', 'click', UI.closeChangePasswordModal);

  on('show-terms-link-banner', 'click', (e) => { e.preventDefault(); openTermsModal(); });
  on('footer-terms-link', 'click', (e) => { e.preventDefault(); openTermsModal(); });
  on('accept-terms-btn-modal', 'click', Data.acceptTerms);

  on('btn-install-pwa', 'click', handleInstallPrompt);
  on('btn-dismiss-install', 'click', handleDismissInstall);

  on('btn-notifs', 'click', async () => {
    await openInboxModal();
    await handleBellClick();
  });

  on('install-entrypoint', 'click', async () => {
    if (deferredInstallPrompt) {
      try { await handleInstallPrompt(); return; } catch (e) { console.warn('Error prompt nativo:', e); }
    }
    const modal = document.getElementById('install-help-modal');
    const instructions = document.getElementById('install-instructions');
    if (instructions) instructions.innerHTML = getInstallInstructions();
    if (modal) modal.style.display = 'block';
  });
  on('close-install-help', 'click', () => {
    const modal = document.getElementById('install-help-modal');
    if (modal) modal.style.display = 'none';
  });

  on('btn-activar-notif-prompt', 'click', handlePermissionRequest);
  on('btn-rechazar-notif-prompt', 'click', dismissPermissionRequest);
  on('notif-switch', 'change', handlePermissionSwitch);
  setupGeoUi();
}

// ──────────────────────────────────────────────────────────────
async function main() {
  setupFirebase();
  const messagingSupported = await checkMessagingSupport();

  auth.onAuthStateChanged(async (user) => {
    const bell = document.getElementById('btn-notifs');
    const badge = document.getElementById('notif-counter');

    wireTermsModalBehavior();
    wireInboxModal();

    if (user) {
      if (bell) bell.style.display = 'inline-block';
      setupMainAppScreenListeners();

      Data.listenToClientData(user);

      await ensureGeoOnStartup();

      document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible') {
          await maybeRefreshIfStale();
        }
      });

      setupMainLimitsObservers();

      if (messagingSupported) {
        // 🔴 Aseguramos token con VAPID y guardado en clientes/{docPorAuthUID}
        await initFCMForRampet();

        // 🟡 Dejamos tu inicializador original (no debería romper; si en tu entorno duplica trabajo, se puede quitar)
        await initNotificationsOnce?.();

        console.log('[FCM] token actual:', localStorage.getItem('fcmToken') || '(sin token)');
        window.__reportState?.('post-init-notifs'); // ← ping de estado
      }

      showInstallPromptIfAvailable();

      const installBtn = document.getElementById('install-entrypoint');
      if (installBtn) {
        installBtn.style.display = isStandalone() ? 'none' : 'inline-block';
      }

      initCarouselBasic();
    } else {
      if (bell) bell.style.display = 'none';
      if (badge) badge.style.display = 'none';
      setupAuthScreenListeners();
      UI.showScreen('login-screen');

      const c = document.getElementById('carrusel-campanas');
      if (c && c._rampetObs) { try { c._rampetObs.disconnect(); } catch {} }
    }
  });
}

document.addEventListener('DOMContentLoaded', main);

