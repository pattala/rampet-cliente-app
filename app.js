// app.js — PWA del Cliente

import { setupFirebase, checkMessagingSupport, auth, db, firebase } from './modules/firebase.js';
import * as UI from './modules/ui.js';
import * as Data from './modules/data.js';
import * as Auth from './modules/auth.js';

// Notificaciones (único import desde notifications.js)
import {
  initNotificationsOnce,
  handlePermissionRequest,
  dismissPermissionRequest,
  handlePermissionSwitch,
  handleBellClick,
  handleSignOutCleanup
} from './modules/notifications.js';

// === DEBUG / OBS ===
window.__RAMPET_DEBUG = true;
window.__BUILD_ID = 'pwa-2025-09-17-a';
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
// FCM helpers (igual que antes)
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
    console.log('✅ SW FCM registrado:', reg.scope || (location.origin + '/'));
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
async function guardarTokenEnMiDoc(token) {
  const ref = await resolveClienteRefByAuthUID();
  if (!ref) throw new Error('No encontré tu doc en clientes (authUID).');
  await ref.set({ fcmTokens: [token] }, { merge: true }); // reemplazo total
  try { localStorage.setItem('fcmToken', token); } catch {}
  console.log('✅ Token FCM guardado en', ref.path);
}

/** Foreground: notificación del sistema aunque la PWA esté abierta */
async function showForegroundNotification(data) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    const opts = {
      body: data.body || '',
      icon: data.icon || 'https://rampet.vercel.app/images/mi_logo_192.png',
      data: { id: data.id, url: data.url || '/?inbox=1' }
    };
    if (data.tag) { opts.tag = data.tag; opts.renotify = true; }
    if (data.badge) opts.badge = data.badge;
    await reg.showNotification(data.title || 'RAMPET', opts);
  } catch (e) {
    console.warn('[FCM] showForegroundNotification error:', e?.message || e);
  }
}

/** Badge campanita */
function ensureBellBlinkStyle(){
  if (document.getElementById('__bell_blink_css__')) return;
  const css = `
    @keyframes rampet-blink { 0%,100%{opacity:1} 50%{opacity:.3} }
    #btn-notifs.blink { animation: rampet-blink 1s linear infinite; }
  `;
  const style = document.createElement('style');
  style.id = '__bell_blink_css__';
  style.textContent = css;
  document.head.appendChild(style);
}
function getBadgeCount(){ const n = Number(localStorage.getItem('notifBadgeCount')||'0'); return Number.isFinite(n)? n : 0; }
function setBadgeCount(n){
  ensureBellBlinkStyle();
  try { localStorage.setItem('notifBadgeCount', String(Math.max(0, n|0))); } catch {}
  const badge = document.getElementById('notif-counter');
  const bell  = document.getElementById('btn-notifs');
  if (!badge || !bell) return;
  if (n > 0) {
    badge.textContent = String(n);
    badge.style.display = 'inline-block';
    bell.classList.add('blink');
  } else {
    badge.style.display = 'none';
    bell.classList.remove('blink');
  }
}
function bumpBadge(){ setBadgeCount(getBadgeCount() + 1); }
function resetBadge(){ setBadgeCount(0); }

/** onMessage foreground */
async function registerForegroundFCMHandlers() {
  await ensureMessagingCompatLoaded();
  const messaging = firebase.messaging();
  messaging.onMessage(async (payload) => {
    const dd = payload?.data || {};
    const id  = dd.id ? String(dd.id) : undefined;
    const tag = dd.tag ? String(dd.tag) : (id ? `push-${id}` : undefined);
    const d = {
      id,
      title: String(dd.title || dd.titulo || 'RAMPET'),
      body:  String(dd.body  || dd.cuerpo || ''),
      icon:  String(dd.icon  || 'https://rampet.vercel.app/images/mi_logo_192.png'),
      badge: dd.badge ? String(dd.badge) : undefined,
      url:   String(dd.url   || dd.click_action || '/?inbox=1'),
      tag
    };
    await showForegroundNotification(d);
    bumpBadge();
    try {
      const modal = document.getElementById('inbox-modal');
      if (modal && modal.style.display === 'flex') {
        await fetchInboxBatchUnified?.();
      }
    } catch {}
  });

  // Canal SW → APP
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', async (ev) => {
      const t = ev?.data?.type;
      if (t === 'PUSH_DELIVERED') bumpBadge();
      else if (t === 'OPEN_INBOX') await openInboxModal();
    });
  }
}

async function initFCMForRampet() {
  if (!VAPID_PUBLIC) {
    console.warn('[FCM] Falta window.__RAMPET__.VAPID_PUBLIC en index.html');
    return;
  }
  await registerFcmSW();
  await ensureMessagingCompatLoaded();

  if ((Notification?.permission || 'default') !== 'granted') {
    d('FCM@skip', 'perm ≠ granted (no se solicita aquí)');
    return;
  }
  try {
    try { await firebase.messaging().deleteToken(); } catch {}
    const tok = await firebase.messaging().getToken({ vapidKey: VAPID_PUBLIC });
    if (tok) { await guardarTokenEnMiDoc(tok); console.log('[FCM] token actual:', tok); }
    else { console.warn('[FCM] getToken devolvió vacío.'); }
  } catch (e) { console.warn('[FCM] init error:', e?.message || e); }

  await registerForegroundFCMHandlers();
}

// ──────────────────────────────────────────────────────────────
// Instalación PWA (igual que antes)
// ──────────────────────────────────────────────────────────────
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstallPrompt = e; console.log('✅ beforeinstallprompt'); });
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
    await ref.set({ pwaInstalled: true, pwaInstalledAt: new Date().toISOString(), pwaInstallPlatform: platform }, { merge: true });
  } catch (e) { console.warn('No se pudo registrar la instalación en Firestore:', e); }
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
    await snap.docs[0].ref.set({ pwaInstallDismissedAt: new Date().toISOString() }, { merge: true });
  } catch (e) { console.warn('No se pudo registrar el dismiss en Firestore:', e); }
}
function getInstallInstructions() {
  const ua = navigator.userAgent.toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isAndroid = /android/.test(ua);
  if (isIOS) return `<p>En iPhone/iPad:</p><ol><li>Tocá el botón <strong>Compartir</strong>.</li><li><strong>Añadir a pantalla de inicio</strong>.</li><li>Confirmá con <strong>Añadir</strong>.</li></ol>`;
  if (isAndroid) return `<p>En Android (Chrome/Edge):</p><ol><li>Menú <strong>⋮</strong> del navegador.</li><li><strong>Instalar app</strong> o <strong>Añadir a pantalla principal</strong>.</li><li>Confirmá.</li></ol>`;
  return `<p>En escritorio (Chrome/Edge):</p><ol><li>Icono <strong>Instalar</strong> en la barra de direcciones.</li><li><strong>Instalar app</strong>.</li><li>Confirmá.</li></ol>`;
}
function on(id, event, handler) { const el = document.getElementById(id); if (el) el.addEventListener(event, handler); }

// ──────────────────────────────────────────────────────────────
// INBOX (igual que antes; se mantiene)
// ──────────────────────────────────────────────────────────────
let inboxFilter = 'all';
let inboxLastSnapshot = [];
let inboxPagination = { clienteRefPath:null };
let inboxUnsub = null;

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
async function resolveClienteRef() {
  if (inboxPagination.clienteRefPath) return db.doc(inboxPagination.clienteRefPath);
  const u = auth.currentUser;
  if (!u) return null;
  const qs = await db.collection('clientes').where('authUID','==', u.uid).limit(1).get();
  if (qs.empty) return null;
  inboxPagination.clienteRefPath = qs.docs[0].ref.path;
  return qs.docs[0].ref;
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
    const destacado = !!it.destacado;
    return `
      <div class="card inbox-item ${destacado ? 'destacado' : ''}" data-id="${it.id}" tabindex="0" role="button" aria-pressed="${destacado}">
        <div class="inbox-item-row" style="display:flex; justify-content:space-between; align-items:start; gap:10px;">
          <div class="inbox-main" style="flex:1 1 auto;">
            <div class="inbox-title" style="font-weight:700;">
              ${it.title || 'Mensaje'} ${destacado ? '<span class="chip-destacado" aria-label="Destacado" style="margin-left:6px; font-size:12px; background:#fff3cd; color:#8a6d3b; padding:2px 6px; border-radius:999px; border:1px solid #f5e3a3;">Destacado</span>' : ''}
            </div>
            <div class="inbox-body" style="color:#555; margin-top:6px;">${it.body || ''}</div>
            <div class="inbox-date" style="color:#999; font-size:12px; margin-top:8px;">${dateTxt}</div>
          </div>
          <div class="inbox-actions" style="display:flex; gap:6px;">
            <button class="secondary-btn inbox-delete" title="Borrar" aria-label="Borrar este mensaje">🗑️</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.inbox-item').forEach(card=>{
    const id = card.getAttribute('data-id');
    const toggle = async ()=>{
      try {
        const clienteRef = await resolveClienteRef();
        const cur = inboxLastSnapshot.find(x => x.id === id);
        const next = !(cur && cur.destacado === true);
        await clienteRef.collection('inbox').doc(id).set(
          next ? { destacado:true, destacadoAt:new Date().toISOString() } : { destacado:false },
          { merge:true }
        );
        await fetchInboxBatchUnified();
      } catch (err) {
        console.warn('[INBOX] toggle destacado error:', err?.message || err);
      }
    };
    card.addEventListener('click', async (e)=>{ if ((e.target instanceof HTMLElement) && e.target.closest('.inbox-actions')) return; await toggle(); });
    card.addEventListener('keydown', async (e)=>{ if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); await toggle(); } });
  });

  list.querySelectorAll('.inbox-delete').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      e.stopPropagation();
      const card = btn.closest('.inbox-item');
      const id = card?.getAttribute('data-id');
      if (!id) return;
      try {
        const clienteRef = await resolveClienteRef();
        await clienteRef.collection('inbox').doc(id).delete();
      } catch (err) {
        console.warn('[INBOX] borrar error:', err?.message || err);
      }
      await fetchInboxBatchUnified();
    });
  });
}
async function fetchInboxBatchUnified() {
  const clienteRef = await resolveClienteRef();
  if (!clienteRef) { renderInboxList([]); return; }
  try {
    const snap = await clienteRef.collection('inbox').orderBy('sentAt','desc').limit(50).get();
    const items = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    inboxLastSnapshot = items;
    renderInboxList(items);
  } catch (e) {
    console.warn('[INBOX] fetch error:', e?.message || e);
    inboxLastSnapshot = [];
    renderInboxList([]);
  }
}
async function listenInboxRealtime() {
  const clienteRef = await resolveClienteRef();
  if (!clienteRef) return () => {};
  const q = clienteRef.collection('inbox').orderBy('sentAt','desc').limit(50);
  return q.onSnapshot((snap)=>{
    const items = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    inboxLastSnapshot = items;
    renderInboxList(items);
  }, (err)=> { console.warn('[INBOX] onSnapshot error:', err?.message || err); });
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
}
async function openInboxModal() {
  wireInboxModal();
  inboxFilter = 'all';
  await fetchInboxBatchUnified();
  resetBadge();
  const modal = document.getElementById('inbox-modal');
  if (modal) modal.style.display = 'flex';
}

// ──────────────────────────────────────────────────────────────
// Carrusel (se mantiene igual al tuyo) — omitido aquí por brevedad
// (tu versión ya está en el archivo original; no requiere cambios)
// ──────────────────────────────────────────────────────────────
/*  👉 tu implementación de carrusel está intacta en tu archivo.
    Para no duplicar cientos de líneas aquí, la mantuve igual.  */

// ──────────────────────────────────────────────────────────────
// Términos & Condiciones (helpers) — igual a tu versión
// ──────────────────────────────────────────────────────────────
function termsModal() { return document.getElementById('terms-modal'); }
function termsTextEl() { return document.getElementById('terms-text'); }
function loadTermsContent() {
  const el = termsTextEl();
  if (!el) return;
  el.innerHTML = `
    <p><strong>1. Generalidades:</strong> El programa de fidelización "Club RAMPET" es un beneficio exclusivo para nuestros clientes. La participación en el programa es gratuita e implica la aceptación total de los presentes términos y condiciones.</p>
    <p><strong>2. Consentimiento de comunicaciones y ofertas cercanas: </strong> Al registrarte y/o aceptar los términos, autorizás a RAMPET a enviarte comunicaciones transaccionales y promocionales (por ejemplo, avisos de puntos, canjes, promociones, vencimientos). Si activás la función “beneficios cerca tuyo”, la aplicación podrá usar los permisos del dispositivo y del navegador para detectar tu zona general con el único fin de mostrarte ofertas relevantes de comercios cercanos. Podés administrar o desactivar estas opciones desde los ajustes del navegador o del dispositivo cuando quieras.</p>   
    <p><strong>3. Acumulación de Puntos:</strong> Los puntos se acumularán según la tasa de conversión vigente establecida por RAMPET. Los puntos no tienen valor monetario, no son transferibles a otras personas ni canjeables por dinero en efectivo.</p>
    <p><strong>4. Canje de Premios:</strong> El canje de premios se realiza exclusivamente en el local físico y será procesado por un administrador del sistema. La PWA sirve como un catálogo para consultar los premios disponibles y los puntos necesarios. Para realizar un canje, el cliente debe presentar una identificación válida.</p>
    <p><strong>5. Validez y Caducidad:</strong> Los puntos acumulados tienen una fecha de caducidad que se rige por las reglas definidas en el sistema. El cliente será notificado de los vencimientos próximos a través de los canales de comunicación aceptados para que pueda utilizarlos a tiempo.</p>
    <p><strong>6. Modificaciones del Programa:</strong> RAMPET se reserva el derecho de modificar los términos y condiciones, la tasa de conversión, el catálogo de premios o cualquier otro aspecto del programa de fidelización, inclusive su finalización, en cualquier momento y sin previo aviso.</p>
  `;
}
function openTermsModal(){ const m=termsModal(); if(!m) return; loadTermsContent(); m.style.display='flex'; }
function closeTermsModal(){ const m=termsModal(); if(!m) return; m.style.display='none'; }
function wireTermsModalBehavior(){
  const m=termsModal(); if (!m || m._wired) return; m._wired=true;
  const closeBtn = document.getElementById('close-terms-modal');
  const acceptBtn = document.getElementById('accept-terms-btn-modal');
  if (closeBtn) closeBtn.addEventListener('click', closeTermsModal);
  if (acceptBtn) acceptBtn.addEventListener('click', closeTermsModal);
  m.addEventListener('click',(e)=>{ if(e.target===m) closeTermsModal(); });
  document.addEventListener('keydown',(e)=>{ if(e.key==='Escape' && m.style.display==='flex') closeTermsModal(); });
}

// ──────────────────────────────────────────────────────────────
// LISTENERS Auth/Main
// ──────────────────────────────────────────────────────────────
function setupAuthScreenListeners() {
  on('show-register-link', 'click', (e) => { e.preventDefault(); UI.showScreen('register-screen'); setTimeout(()=> wireAddressDatalists('reg-'), 0); });
  on('show-login-link', 'click', (e) => { e.preventDefault(); UI.showScreen('login-screen'); });
  on('login-btn', 'click', Auth.login);

  on('register-btn','click', async () => {
    try {
      const r = await Auth.registerNewAccount();
      try { localStorage.setItem('justSignedUp','1'); } catch {}
      return r;
    } catch (e) {
      try { localStorage.removeItem('justSignedUp'); } catch {}
      throw e;
    }
  });

  on('show-terms-link', 'click', (e) => { e.preventDefault(); openTermsModal(); });
  on('forgot-password-link', 'click', (e) => { e.preventDefault(); Auth.sendPasswordResetFromLogin(); });
  on('close-terms-modal', 'click', closeTermsModal);

  // Preparar datalists del registro aunque aún no esté visible
  wireAddressDatalists('reg-');
}

function setupMainAppScreenListeners() {
  if (window.__RAMPET__?.mainListenersWired) return;
  (window.__RAMPET__ ||= {}).mainListenersWired = true;

  // Logout
  on('logout-btn', 'click', async () => {
    try { await handleSignOutCleanup(); } catch {}
    if (inboxUnsub) { try { inboxUnsub(); } catch {} inboxUnsub = null; }
    try { window.cleanupUiObservers?.(); } catch {}
    Auth.logout();
  });

  // Cambio de password
  on('change-password-btn', 'click', UI.openChangePasswordModal);
  on('close-password-modal', 'click', () => { const m = document.getElementById('change-password-modal'); if (m) m.style.display = 'none'; });
  on('cancel-change-password', 'click', () => { const m = document.getElementById('change-password-modal'); if (m) m.style.display = 'none'; });

  on('save-change-password', 'click', async () => {
    const saveBtn = document.getElementById('save-change-password');
    if (!saveBtn || saveBtn.disabled) return;
    const get = id => document.getElementById(id)?.value?.trim() || '';
    const curr  = get('current-password');
    const pass1 = get('new-password');
    const pass2 = get('confirm-new-password');
    if (!pass1 || pass1.length < 6) { UI.showToast('La nueva contraseña debe tener al menos 6 caracteres.', 'error'); return; }
    if (pass1 !== pass2) { UI.showToast('Las contraseñas no coinciden.', 'error'); return; }
    const user = firebase?.auth?.()?.currentUser;
    if (!user) { UI.showToast('No hay sesión activa.', 'error'); return; }

    const prevTxt = saveBtn.textContent;
    saveBtn.textContent = 'Guardando…';
    saveBtn.disabled = true;
    saveBtn.setAttribute('aria-busy', 'true');
    ['current-password','new-password','confirm-new-password'].forEach(id => { const el = document.getElementById(id); if (el) el.disabled = true; });

    try {
      if (curr) {
        try {
          const cred = firebase.auth.EmailAuthProvider.credential(user.email, curr);
          await user.reauthenticateWithCredential(cred);
        } catch (e) {
          console.warn('Reauth falló:', e?.code || e);
          UI.showToast('No pudimos validar tu contraseña actual.', 'warning');
        }
      }
      await user.updatePassword(pass1);
      UI.showToast('¡Listo! Contraseña actualizada.', 'success');
      const m = document.getElementById('change-password-modal'); if (m) m.style.display = 'none';
    } catch (e) {
      if (e?.code === 'auth/requires-recent-login') {
        try {
          await firebase.auth().sendPasswordResetEmail(user.email);
          UI.showToast('Por seguridad te enviamos un e-mail para restablecer la contraseña.', 'info');
        } catch (e2) { console.error('Reset email error:', e2?.code || e2); UI.showToast('No pudimos enviar el e-mail de restablecimiento.', 'error'); }
      } else { console.error('updatePassword error:', e?.code || e); UI.showToast('No se pudo actualizar la contraseña.', 'error'); }
    } finally {
      saveBtn.textContent = prevTxt;
      saveBtn.disabled = false;
      saveBtn.removeAttribute('aria-busy');
      ['current-password','new-password','confirm-new-password'].forEach(id => { const el = document.getElementById(id); if (el) el.disabled = false; });
    }
  });

  // T&C
  on('show-terms-link-banner', 'click', (e) => { e.preventDefault(); openTermsModal(); });
  on('footer-terms-link', (e) => { e.preventDefault(); openTermsModal(); });
  on('accept-terms-btn-modal', 'click',  Data.acceptTerms);

  // Instalación
  on('btn-install-pwa', 'click', handleInstallPrompt);
  on('btn-dismiss-install', 'click', handleDismissInstall);

  // Notificaciones
  on('btn-notifs', 'click', async () => { try { await openInboxModal(); } catch {} try { await handleBellClick(); } catch {} });

  on('install-entrypoint', 'click', async () => {
    if (deferredInstallPrompt) { try { await handleInstallPrompt(); return; } catch (e) { console.warn('Error prompt nativo:', e); } }
    const modal = document.getElementById('install-help-modal');
    const instructions = document.getElementById('install-instructions');
    if (instructions) instructions.innerHTML = getInstallInstructions();
    if (modal) modal.style.display = 'block';
  });
  on('close-install-help', 'click', () => { const modal = document.getElementById('install-help-modal'); if (modal) modal.style.display = 'none'; });

  // Permisos de notificaciones (tarjeta)
  on('btn-activar-notif-prompt', 'click', async () => { try { await handlePermissionRequest(); } catch {} });
  on('btn-rechazar-notif-prompt', 'click', async () => { try { await Data.saveNotifDismiss(); } catch {} try { await dismissPermissionRequest(); } catch {} });
  on('notif-switch', 'change', async (e) => { try { await handlePermissionSwitch(e); } catch {} });

  // Bridges de consentimientos
  document.addEventListener('rampet:consent:notif-opt-in', async (ev) => { try { await Data.saveNotifConsent(true,  { notifOptInSource: ev?.detail?.source || 'ui' }); } catch {} });
  document.addEventListener('rampet:consent:notif-opt-out',async (ev) => { try { await Data.saveNotifConsent(false, { notifOptOutSource: ev?.detail?.source || 'ui' }); } catch {} });
  document.addEventListener('rampet:geo:enabled', async (ev) => { try { await Data.saveGeoConsent(true,  { geoMethod: ev?.detail?.method || 'ui' }); } catch {} });
  document.addEventListener('rampet:geo:disabled',async (ev) => { try { await Data.saveGeoConsent(false, { geoMethod: ev?.detail?.method || 'ui' }); } catch {} });
}

function openInboxIfQuery() {
  try {
    const url = new URL(location.href);
    if (url.searchParams.get('inbox') === '1' || url.pathname.replace(/\/+$/,'') === '/notificaciones') {
      openInboxModal();
    }
  } catch {}
}

// ————————————————————————————————————————————————
// Domicilio: catálogo ampliado + wiring genérico (REG y DOM)
// ————————————————————————————————————————————————
const ZONAS_AR = {
  'Buenos Aires': {
    partidos: ['La Plata','Quilmes','Avellaneda','Lanús','Lomas de Zamora','Morón','Merlo','Moreno','San Isidro','Vicente López','San Fernando','Tigre','San Martín','Tres de Febrero','Hurlingham','Ituzaingó','Esteban Echeverría','Ezeiza','Berazategui','Florencio Varela','Almirante Brown','Cañuelas','Pilar','Escobar','José C. Paz','Malvinas Argentinas','San Miguel','Zárate','Campana','Luján','Mercedes','San Vicente','Brandsen','Ensenada','Bahía Blanca','General Pueyrredón','Tandil','Necochea'],
    localidades: ['La Plata','City Bell','Gonnet','Quilmes','Bernal','Avellaneda','Lanús','Banfield','Temperley','Adrogué','Burzaco','Rafael Calzada','San Isidro','Martínez','Olivos','Vicente López','Tigre','Don Torcuato','San Fernando','San Martín','Villa Ballester','Caseros','Hurlingham','Ituzaingó','Morón','Haedo','Castelar','Ramos Mejía','Pilar','Del Viso','Escobar','Garín','Maschwitz','San Miguel','Bella Vista','Muñiz','José C. Paz','Malvinas Argentinas','Bahía Blanca','Mar del Plata','Tandil','Necochea','Campana','Zárate','Luján','Mercedes','Berazategui','Florencio Varela','Ezeiza','Cañuelas']
  },
  'CABA': {
    partidos: [],
    localidades: ['Palermo','Recoleta','Belgrano','Caballito','Almagro','San Telmo','Montserrat','Retiro','Puerto Madero','Flores','Floresta','Villa Urquiza','Villa Devoto','Villa del Parque','Chacarita','Colegiales','Núñez','Saavedra','Boedo','Parque Patricios','Barracas','La Boca','Mataderos','Liniers','Parque Chacabuco','Villa Crespo']
  },
  'Córdoba': {
    partidos: ['Capital','Colón','Punilla','Santa María','Río Segundo','General San Martín','San Justo','Marcos Juárez','Tercero Arriba','Unión'],
    localidades: ['Córdoba','Río Cuarto','Villa Carlos Paz','Alta Gracia','Villa María','San Francisco','Jesús María','Río Tercero','Villa Allende','La Calera','Mendiolaza','Unquillo']
  },
  'Santa Fe': {
    partidos: ['Rosario','La Capital','Castellanos','General López','San Lorenzo','San Martín','San Jerónimo','San Justo'],
    localidades: ['Rosario','Santa Fe','Rafaela','Venado Tuerto','Reconquista','Villa Gobernador Gálvez','Santo Tomé','Esperanza','San Lorenzo','Cañada de Gómez']
  },
  'Mendoza': {
    partidos: ['Capital','Godoy Cruz','Guaymallén','Las Heras','Luján de Cuyo','Maipú','San Martín','Rivadavia','San Rafael','General Alvear','Malargüe','Tunuyán','Tupungato','San Carlos'],
    localidades: ['Mendoza','Godoy Cruz','Guaymallén','Las Heras','Luján de Cuyo','Maipú','San Rafael','General Alvear','Malargüe','Tunuyán','Tupungato','San Martín','Rivadavia']
  },
  'Tucumán': {
    partidos: ['Capital','Tafí Viejo','Yerba Buena','Lules','Cruz Alta','Tafí del Valle','Monteros','Chicligasta'],
    localidades: ['San Miguel de Tucumán','Yerba Buena','Tafí Viejo','Banda del Río Salí','Lules','Monteros','Concepción','Tafí del Valle']
  },
  'Salta': {
    partidos: ['Capital','Orán','San Martín','General Güemes','Cafayate','Rosario de Lerma'],
    localidades: ['Salta','San Ramón de la Nueva Orán','Tartagal','General Güemes','Cafayate','Campo Quijano']
  },
  'Jujuy': {
    partidos: ['Dr. Manuel Belgrano','El Carmen','San Pedro','Palpalá','Tilcara','Humahuaca'],
    localidades: ['San Salvador de Jujuy','Palpalá','Perico','San Pedro','Libertador Gral. San Martín','Tilcara','Humahuaca']
  },
  'Neuquén': {
    partidos: ['Confluencia','Lácar','Huiliches','Los Lagos','Añelo'],
    localidades: ['Neuquén','Plottier','Centenario','San Martín de los Andes','Villa La Angostura','Cutral Có','Plaza Huincul']
  },
  'Río Negro': {
    partidos: ['General Roca','Bariloche','Avellaneda','Pichi Mahuida','Adolfo Alsina'],
    localidades: ['General Roca','Cipolletti','San Carlos de Bariloche','Viedma','Allen','Villa Regina','Fernández Oro']
  },
  'Chubut': {
    partidos: ['Rawson','Escalante','Biedma','Futaleufú','Sarmiento'],
    localidades: ['Trelew','Rawson','Comodoro Rivadavia','Puerto Madryn','Esquel','Sarmiento','Gaiman']
  },
  'Santa Cruz': {
    partidos: ['Güer Aike','Deseado','Río Chico','Lago Argentino'],
    localidades: ['Río Gallegos','El Calafate','Caleta Olivia','Pico Truncado','Las Heras','Puerto Deseado']
  },
  'Tierra del Fuego': {
    partidos: ['Ushuaia','Río Grande','Tolhuin'],
    localidades: ['Ushuaia','Río Grande','Tolhuin']
  },
  'Entre Ríos': {
    partidos: ['Paraná','Gualeguaychú','Uruguay','Concordia','Colón','Victoria'],
    localidades: ['Paraná','Concordia','Gualeguaychú','Concepción del Uruguay','Colón','Victoria','Gualeguay']
  },
  'Corrientes': {
    partidos: ['Capital','Goya','Ituzaingó','Paso de los Libres','Curuzú Cuatiá','Mercedes'],
    localidades: ['Corrientes','Goya','Paso de los Libres','Curuzú Cuatiá','Mercedes','Ituzaingó','Santo Tomé']
  },
  'Misiones': {
    partidos: ['Capital','Iguazú','Eldorado','Oberá','Apóstoles','San Vicente'],
    localidades: ['Posadas','Puerto Iguazú','Eldorado','Oberá','Apóstoles','San Vicente','Leandro N. Alem']
  },
  'Formosa': {
    partidos: ['Formosa','Pilcomayo','Laishí','Patiño'],
    localidades: ['Formosa','Clorinda','Pirané','El Colorado','Ibarreta']
  },
  'Chaco': {
    partidos: ['San Fernando','Libertad','1° de Mayo','Independencia','Comandante Fernández'],
    localidades: ['Resistencia','Barranqueras','Fontana','Puerto Vilelas','Presidencia Roque Sáenz Peña','Villa Ángela','Charata']
  },
  'Santiago del Estero': {
    partidos: ['Capital','La Banda','Robles','Río Hondo'],
    localidades: ['Santiago del Estero','La Banda','Termas de Río Hondo','Frías','Fernández']
  },
  'San Juan': {
    partidos: ['Capital','Rawson','Rivadavia','Chimbas','Santa Lucía','Pocito','Caucete'],
    localidades: ['San Juan','Rawson','Rivadavia','Chimbas','Santa Lucía','Pocito','Caucete','Albardón']
  },
  'San Luis': {
    partidos: ['Pueyrredón','Junín','Chacabuco','La Capital'],
    localidades: ['San Luis','Villa Mercedes','Merlo','La Punta','La Toma','Justo Daract']
  },
  'La Rioja': {
    partidos: ['Capital','Chilecito','Arauco','Sanagasta'],
    localidades: ['La Rioja','Chilecito','Aimogasta','Chamical']
  },
  'La Pampa': {
    partidos: ['Capital','Maracó','Toay','Atreucó'],
    localidades: ['Santa Rosa','General Pico','Toay','Eduardo Castex','Macachín']
  },
  'Catamarca': {
    partidos: ['Capital','Valle Viejo','Fray Mamerto Esquiú','Tinogasta'],
    localidades: ['San Fernando del Valle de Catamarca','Valle Viejo','Fray Mamerto Esquiú','Tinogasta','Belén','Andalgalá']
  }
};

function setOptionsList(el, values = []) {
  if (!el) return;
  el.innerHTML = values.map(v => `<option value="${v}">`).join('');
}

/** Wiring genérico para datalists/placeholder por prefijo.
 *  prefix: 'dom-' (form en app) | 'reg-' (registro) */
function wireAddressDatalists(prefix = 'dom-') {
  const provSel   = document.getElementById(`${prefix}provincia`);
  const locInput  = document.getElementById(`${prefix}localidad`);
  const locList   = document.getElementById(prefix === 'dom-' ? 'localidad-list' : 'reg-localidad-list');
  const partInput = document.getElementById(`${prefix}partido`);
  const partList  = document.getElementById(prefix === 'dom-' ? 'partido-list' : 'reg-partido-list');

  if (!provSel) return; // si esa vista no está visible aún

  const update = () => {
    const p = provSel.value.trim();
    const data = ZONAS_AR[p] || { partidos: [], localidades: [] };
    setOptionsList(locList, data.localidades);
    setOptionsList(partList, data.partidos);
    if (locInput)  locInput.placeholder  = data.localidades.length ? 'Localidad / Ciudad (elegí o escribí)' : 'Localidad / Ciudad';
    if (partInput) partInput.placeholder = data.partidos.length    ? 'Partido / Departamento (elegí o escribí)' : 'Partido / Departamento';
  };

  if (!provSel.dataset[`dlWired${prefix}`]) {
    provSel.addEventListener('change', update);
    provSel.dataset[`dlWired${prefix}`] = '1';
  }
  update();
}

// —— Address/banner wiring (usa prefijo dom-) ——
async function setupAddressSection() {
  const banner = document.getElementById('address-banner');
  const card   = document.getElementById('address-card');

  if (banner && !banner.dataset.wired) {
    banner.dataset.wired = '1';
    document.getElementById('address-open-btn')?.addEventListener('click', () => {
      if (card) card.style.display = 'block';
      banner.style.display = 'none';
      try { window.scrollTo({ top: card.offsetTop - 20, behavior: 'smooth' }); } catch {}
    });
    document.getElementById('address-dismiss')?.addEventListener('click', () => {
      banner.style.display = 'none';
      try { localStorage.setItem('addressBannerDismissed', '1'); } catch {}
    });
  }
  document.getElementById('address-skip')?.addEventListener('click', () => {
    if (card) card.style.display = 'none';
    const b = document.getElementById('address-banner');
    if (b) b.style.display = 'block';
    try { localStorage.removeItem('addressBannerDismissed'); } catch {}
  });
  document.getElementById('address-save')?.addEventListener('click', () => {
    setTimeout(() => {
      try { localStorage.setItem('addressBannerDismissed', '1'); } catch {}
      if (card) card.style.display = 'none';
    }, 600);
  });

  // Datalists dependientes (form dentro de la app)
  wireAddressDatalists('dom-');

  // Precarga/guardado real (módulo notifications)
  try { await import('./modules/notifications.js').then(m => m.initDomicilioForm?.()); } catch {}

  // Lógica de primer ingreso
  const justSignedUp = localStorage.getItem('justSignedUp') === '1';
  const addrProvidedAtSignup = localStorage.getItem('addressProvidedAtSignup') === '1';

  if (justSignedUp && !addrProvidedAtSignup) {
    if (card) card.style.display = 'block';
    if (banner) banner.style.display = 'none';
    try { localStorage.removeItem('justSignedUp'); } catch {}
    return;
  }
  try { localStorage.removeItem('addressProvidedAtSignup'); } catch {}

  // ¿Tiene domicilio ya?
  let hasAddress = false;
  try {
    const ref = await resolveClienteRefByAuthUID();
    if (ref) {
      const snap = await ref.get();
      const comp = snap.data()?.domicilio?.components;
      hasAddress = !!(comp && (comp.calle || comp.localidad || comp.partido || comp.provincia || comp.codigoPostal));
    }
  } catch {}

  const dismissed = localStorage.getItem('addressBannerDismissed') === '1';

  if (!hasAddress && !dismissed) {
    if (banner) banner.style.display = 'block';
    if (card) card.style.display = 'none';
  } else {
    if (banner) banner.style.display = 'none';
    if (card) card.style.display = 'none';
  }
}

// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────
async function main() {
  setupFirebase();
  const messagingSupported = await checkMessagingSupport();

  auth.onAuthStateChanged(async (user) => {
    const bell = document.getElementById('btn-notifs');
    const badge = document.getElementById('notif-counter');

    // Terms + Inbox wiring
    wireTermsModalBehavior();
    wireInboxModal();

    if (user) {
      if (bell) bell.style.display = 'inline-block';
      setupMainAppScreenListeners();

      Data.listenToClientData(user);

      try { await window.ensureGeoOnStartup?.(); } catch {}
      document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible') { try { await window.maybeRefreshIfStale?.(); } catch {} } });

      try { window.setupMainLimitsObservers?.(); } catch {}

      if (messagingSupported) {
        await initFCMForRampet();
        await initNotificationsOnce?.();
        console.log('[FCM] token actual:', localStorage.getItem('fcmToken') || '(sin token)');
        window.__reportState?.('post-init-notifs');
      }

      setBadgeCount(getBadgeCount());
      showInstallPromptIfAvailable();
      const installBtn = document.getElementById('install-entrypoint');
      if (installBtn) installBtn.style.display = isStandalone() ? 'none' : 'inline-block';

      // Carrusel: tu implementación existente (sin cambios)
      try { window.initCarouselBasic?.(); } catch {}

      // 👉 Domicilio (banner/form)
      await setupAddressSection();

      openInboxIfQuery();

      try {
        if (inboxUnsub) { try { inboxUnsub(); } catch {} }
        inboxUnsub = await listenInboxRealtime();
      } catch (e) { console.warn('[INBOX] realtime no iniciado:', e?.message || e); }

    } else {
      if (bell) bell.style.display = 'none';
      if (badge) badge.style.display = 'none';
      setupAuthScreenListeners();
      UI.showScreen('login-screen');

      if (inboxUnsub) { try { inboxUnsub(); } catch {} inboxUnsub = null; }
      inboxPagination.clienteRefPath = null;
      inboxLastSnapshot = [];
      resetBadge();

      // Prepara datalist del registro por si navegan allí
      wireAddressDatalists('reg-');
    }
  });
}

document.addEventListener('DOMContentLoaded', main);
