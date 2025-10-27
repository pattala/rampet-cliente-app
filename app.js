// app.js — PWA del Cliente

import { setupFirebase, checkMessagingSupport, auth, db, firebase } from './modules/firebase.js';
import * as UI from './modules/ui.js';
try { window.UI = UI; } catch {}
import * as Data from './modules/data.js';
import * as Auth from './modules/auth.js';

// Notificaciones (único import desde notifications.js)
import {
  initNotificationsOnce,
  handleBellClick,
  handleSignOutCleanup
} from './modules/notifications.js';

// === DEBUG / OBS ===
window.__RAMPET_DEBUG = true;
window.__BUILD_ID = 'pwa-2025-09-17-b';
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
// Badge campanita (se usa con mensajes del SW)
// ──────────────────────────────────────────────────────────────
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

// Canal SW → APP: solo para contar/botón (no registramos otro onMessage)
function wireSwMessageChannel(){
  if (!('serviceWorker' in navigator)) return;
  if (window.__wiredSwMsg) return;
  window.__wiredSwMsg = true;
  navigator.serviceWorker.addEventListener('message', async (ev) => {
    const t = ev?.data?.type;
    if (t === 'PUSH_DELIVERED') bumpBadge();
    else if (t === 'OPEN_INBOX') {
      try { await openInboxModal(); } catch {}
    }
  });
}

// ──────────────────────────────────────────────────────────────
// INBOX (igual que antes)
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

  document.getElementById('inbox-tab-todos')?.addEventListener('click', async ()=>{ inboxFilter='all';   setActive('inbox-tab-todos');  renderInboxList(inboxLastSnapshot); });
  document.getElementById('inbox-tab-promos')?.addEventListener('click',async ()=>{ inboxFilter='promos'; setActive('inbox-tab-promos'); renderInboxList(inboxLastSnapshot); });
  document.getElementById('inbox-tab-puntos')?.addEventListener('click',async ()=>{ inboxFilter='puntos'; setActive('inbox-tab-puntos'); renderInboxList(inboxLastSnapshot); });
  document.getElementById('inbox-tab-otros')?.addEventListener('click', async ()=>{ inboxFilter='otros';  setActive('inbox-tab-otros');  renderInboxList(inboxLastSnapshot); });

  document.getElementById('close-inbox-modal')?.addEventListener('click', ()=> modal.style.display='none');
  document.getElementById('inbox-close-btn')?.addEventListener('click', ()=> modal.style.display='none');
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
// Términos & Condiciones (helpers)
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
// PERFIL: reordenar tarjetas (Domicilio arriba / Preferencias último)
// ──────────────────────────────────────────────────────────────
function reorderProfileCards(){
  const modal = document.getElementById('profile-modal');
  if (!modal) return;
  const domicilioCard = modal.querySelector('#prof-edit-address-btn')?.closest('.prefs-card');
  const preferenciasCard = modal.querySelector('#prof-consent-notif')?.closest('.prefs-card');
  const actions = modal.querySelector('.modal-actions');

  if (!domicilioCard || !preferenciasCard) return;
  const container = preferenciasCard.parentElement;
  if (!container) return;

  // 1) Domicilio antes que Preferencias
  if (domicilioCard.nextSibling !== preferenciasCard) {
    container.insertBefore(domicilioCard, preferenciasCard);
  }
  // 2) Preferencias como última tarjeta, pero antes de los botones
  if (actions) {
    container.insertBefore(preferenciasCard, actions);
  }
}
// ──────────────────────────────────────────────────────────────
// Instalación PWA (helpers + wiring)
// ──────────────────────────────────────────────────────────────
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  console.log('✅ beforeinstallprompt');
   // ⬇️ NUEVO: si el usuario no lo descartó antes, mostramos el card
  try { showInstallPromptIfAvailable(); } catch {}
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
    await snap.docs[0].ref.set({ pwaInstallDismissedAt: new Date().toISOString() }, { merge: true });
  } catch (e) {
    console.warn('No se pudo registrar el dismiss en Firestore:', e);
  }
}

function getInstallInstructions() {
  const ua = navigator.userAgent.toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isAndroid = /android/.test(ua);
  if (isIOS) {
    return `<p>En iPhone/iPad:</p><ol><li>Tocá el botón <strong>Compartir</strong>.</li><li><strong>Añadir a pantalla de inicio</strong>.</li><li>Confirmá con <strong>Añadir</strong>.</li></ol>`;
  }
  if (isAndroid) {
    return `<p>En Android (Chrome/Edge):</p><ol><li>Menú <strong>⋮</strong> del navegador.</li><li><strong>Instalar app</strong> o <strong>Añadir a pantalla principal</strong>.</li><li>Confirmá.</li></ol>`;
  }
  return `<p>En escritorio (Chrome/Edge):</p><ol><li>Icono <strong>Instalar</strong> en la barra de direcciones.</li><li><strong>Instalar app</strong>.</li><li>Confirmá.</li></ol>`;
}

// ──────────────────────────────────────────────────────────────
// LISTENERS Auth/Main
// ──────────────────────────────────────────────────────────────
function setupAuthScreenListeners() {
  const on = (id, event, handler) => { const el = document.getElementById(id); if (el) el.addEventListener(event, handler); };

  on('show-register-link', 'click', (e) => { 
    e.preventDefault(); 
    UI.showScreen('register-screen'); 
    setTimeout(()=> { 
      wireAddressDatalists('reg-'); 
      reorderAddressFields('reg-'); 
    }, 0); 
  });
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
  reorderAddressFields('reg-');
}

function setupMainAppScreenListeners() {
  const on = (id, event, handler) => { const el = document.getElementById(id); if (el) el.addEventListener(event, handler); };
  if (window.__RAMPET__?.mainListenersWired) return;
  (window.__RAMPET__ ||= {}).mainListenersWired = true;

  // Perfil
  on('edit-profile-btn', 'click', () => { reorderProfileCards(); UI.openProfileModal(); });
  on('prof-edit-address-btn', 'click', () => {
    UI.closeProfileModal();
    const card = document.getElementById('address-card');
    const banner = document.getElementById('address-banner');
    if (banner) banner.style.display = 'none';
    if (card) {
      card.style.display = 'block';
      try { window.scrollTo({ top: card.offsetTop - 12, behavior: 'smooth' }); } catch {}
    }
  });

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

  // Notificaciones UI
  on('btn-notifs', 'click', async () => { try { await openInboxModal(); } catch {} try { await handleBellClick(); } catch {} });
 
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
// Domicilio: BA/CABA inteligente + placeholders
// ————————————————————————————————————————————————
const BA_LOCALIDADES_BY_PARTIDO = {
  "San Isidro": ["Béccar","Acassuso","Martínez","San Isidro","Villa Adelina","Boulogne Sur Mer","La Horqueta"],
  "Vicente López": ["Olivos","Florida","Florida Oeste","La Lucila","Munro","Villa Martelli","Carapachay","Vicente López"],
  "Tigre": ["Tigre","Don Torcuato","General Pacheco","El Talar","Benavídez","Rincón de Milberg","Dique Luján","Nordelta"],
  "San Fernando": ["San Fernando","Victoria","Virreyes","Islas"],
  "San Martín": ["San Martín","Villa Ballester","José León Suárez","Villa Lynch","Villa Maipú","Billinghurst","Chilavert","Loma Hermosa"],
  "Tres de Febrero": ["Caseros","Ciudad Jardín","Santos Lugares","Villa Bosch","Loma Hermosa","Ciudadela","José Ingenieros","Saénz Peña"],
  "Hurlingham": ["Hurlingham","William C. Morris","Villa Tesei"],
  "Ituzaingó": ["Ituzaingó","Villa Udaondo"],
  "Morón": ["Morón","Haedo","El Palomar","Castelar"],
  "La Matanza": ["San Justo","Ramos Mejía","Lomas del Mirador","La Tablada","Isidro Casanova","González Catán","Ciudad Evita","Virrey del Pino"],
  "Lanús": ["Lanús Oeste","Lanús Este","Remedios de Escalada","Monte Chingolo"],
  "Lomas de Zamora": ["Lomas de Zamora","Banfield","Temperley","Turdera","Llavallol"],
  "Avellaneda": ["Avellaneda","Dock Sud","Sarandí","Wilde","Gerli","Villa Domínico","Piñeyro"],
  "Quilmes": ["Quilmes","Bernal","Don Bosco","Ezpeleta","Villa La Florida","San Francisco Solano"],
  "Berazategui": ["Berazategui","Ranelagh","Sourigues","Hudson","Gutiérrez"],
  "Florencio Varela": ["Florencio Varela","Bosques","Zeballos","Villa Vatteone"],
  "Almirante Brown": ["Adrogué","Burzaco","Rafael Calzada","Longchamps","Glew","San José","Claypole","Malvinas Argentinas (AB)"],
  "Pilar": ["Pilar","Del Viso","Manzanares","Presidente Derqui","Fátima","Villa Rosa","Champagnat"],
  "Escobar": ["Belén de Escobar","Ingeniero Maschwitz","Garín","Maquinista Savio","Loma Verde"],
  "José C. Paz": ["José C. Paz","Tortuguitas (comp.)","Sol y Verde"],
  "Malvinas Argentinas": ["Los Polvorines","Grand Bourg","Tortuguitas","Ing. Pablo Nogués","Villa de Mayo"],
  "San Miguel": ["San Miguel","Bella Vista","Muñiz"],
  "Zárate": ["Zárate","Lima"],
  "Campana": ["Campana"],
  "Luján": ["Luján","Open Door","Torres","Cortínez"],
  "Mercedes": ["Mercedes","Gowland","Altamira"],
  "Bahía Blanca": ["Bahía Blanca","Ingeniero White","Cabildo","Cerri"],
  "Gral. Pueyrredón": ["Mar del Plata","Batán","Sierra de los Padres"],
  "Tandil": ["Tandil","Gardey","María Ignacia (Vela)"],
  "Necochea": ["Necochea","Quequén"]
};
const CABA_BARRIOS = [
  "Palermo","Recoleta","Belgrano","Caballito","Almagro","San Telmo","Montserrat","Retiro","Puerto Madero","Flores",
  "Floresta","Villa Urquiza","Villa Devoto","Villa del Parque","Chacarita","Colegiales","Núñez","Saavedra",
  "Boedo","Parque Patricios","Barracas","La Boca","Mataderos","Liniers","Parque Chacabuco","Villa Crespo"
];
const ZONAS_AR = {
  'Buenos Aires': { partidos: Object.keys(BA_LOCALIDADES_BY_PARTIDO).sort(), localidades: [] },
  'CABA': { partidos: [], localidades: CABA_BARRIOS },
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
  }
};

function setOptionsList(el, values = []) {
  if (!el) return;
  el.innerHTML = values.map(v => `<option value="${v}">`).join('');
}
function reorderAddressFields(prefix = 'dom-'){
  const grid = (prefix === 'dom-')
    ? document.querySelector('#address-card .grid-2')
    : document.querySelector('#register-form .grid-2') || document.querySelector('#register-screen .grid-2');
  if (!grid) return;
  const provincia = document.getElementById(`${prefix}provincia`);
  const depto = document.getElementById(`${prefix}depto`);
  const barrio = document.getElementById(`${prefix}barrio`);
  const loc    = document.getElementById(`${prefix}localidad`);
  const part   = document.getElementById(`${prefix}partido`);
  if (!provincia || !depto) return;
  const nextRef = barrio || loc || part || depto.nextSibling;
  if (nextRef && provincia !== nextRef.previousSibling) {
    try { grid.insertBefore(provincia, nextRef); } catch {}
  }
}
function wireAddressDatalists(prefix = 'dom-') {
  const provSel   = document.getElementById(`${prefix}provincia`);
  const locInput  = document.getElementById(`${prefix}localidad`);
  const partInput = document.getElementById(`${prefix}partido`);

  const locListId  = (prefix === 'dom-') ? 'localidad-list' : 'reg-localidad-list';
  const partListId = (prefix === 'dom-') ? 'partido-list'   : 'reg-partido-list';

  const locList  = document.getElementById(locListId);
  const partList = document.getElementById(partListId);

  if (!provSel) return;

  const setPlaceholders = (prov) => {
    if (/^CABA|Capital/i.test(prov)) {
      if (locInput)  locInput.placeholder  = 'Barrio';
      if (partInput) partInput.placeholder = '—';
      return;
    }
    if (/^Buenos Aires$/i.test(prov)) {
      if (partInput) partInput.placeholder = 'Partido';
      if (locInput)  locInput.placeholder  = 'Localidad / Barrio';
      return;
    }
    if (partInput) partInput.placeholder = 'Departamento / Partido (opcional)';
    if (locInput)  locInput.placeholder  = 'Localidad / Barrio';
  };

  const refreshLocalidades = () => {
    const prov = (provSel.value || '').trim();
    setPlaceholders(prov);

    if (/^CABA|Capital/i.test(prov)) {
      setOptionsList(locList, CABA_BARRIOS);
      if (partInput) partInput.value = '';
      return;
    }

    if (/^Buenos Aires$/i.test(prov) && partInput) {
      const partido = (partInput.value || '').trim();
      const arr = BA_LOCALIDADES_BY_PARTIDO[partido] || [];
      setOptionsList(locList, arr);
      return;
    }

    const data = ZONAS_AR[prov] || { localidades: [] };
    setOptionsList(locList, data.localidades || []);
  };

  const refreshPartidos = () => {
    const prov = (provSel.value || '').trim();
    setPlaceholders(prov);

    if (/^Buenos Aires$/i.test(prov)) {
      setOptionsList(partList, Object.keys(BA_LOCALIDADES_BY_PARTIDO).sort());
    } else {
      setOptionsList(partList, []);
      if (partInput) partInput.value = '';
    }
    refreshLocalidades();
  };

  if (!provSel.dataset[`wired_${prefix}`]) {
    provSel.addEventListener('change', () => {
      refreshPartidos();
      refreshLocalidades();
    });
    partInput?.addEventListener('input', refreshLocalidades);
    provSel.dataset[`wired_${prefix}`] = '1';
  }

  refreshPartidos();
  refreshLocalidades();
  reorderAddressFields(prefix);
}

// —— Address/banner wiring
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

  wireAddressDatalists('dom-');

  try { await import('./modules/notifications.js').then(m => m.initDomicilioForm?.()); } catch {}

  const justSignedUp = localStorage.getItem('justSignedUp') === '1';
  const addrProvidedAtSignup = localStorage.getItem('addressProvidedAtSignup') === '1';

  if (justSignedUp && !addrProvidedAtSignup) {
    if (card) card.style.display = 'block';
    if (banner) banner.style.display = 'none';
    try { localStorage.removeItem('justSignedUp'); } catch {}
    return;
  }
  try { localStorage.removeItem('addressProvidedAtSignup'); } catch {}

  let hasAddress = false;
  try {
    const u = auth.currentUser;
    if (u) {
      const qs = await db.collection('clientes').where('authUID','==', u.uid).limit(1).get();
      if (!qs.empty) {
        const snap = await qs.docs[0].ref.get();
        const comp = snap.data()?.domicilio?.components;
        hasAddress = !!(comp && (comp.calle || comp.localidad || comp.partido || comp.provincia || comp.codigoPostal));
      }
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

      // 🔹 Registrar SW + token si ya hay permiso (solo una vez, desde notifications.js)
      try { await initNotificationsOnce(); } catch (e) { console.warn('[PWA] initNotificationsOnce error:', e); }

      // ⚡ escuchar mensajes del SW para badge (sin duplicar onMessage)
      wireSwMessageChannel();

      Data.listenToClientData(user);
      document.addEventListener('rampet:cliente-updated', (e) => {
        try { window.clienteData = e.detail?.cliente || window.clienteData || {}; } catch {}
      });

      try { await window.ensureGeoOnStartup?.(); } catch {}
      document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible') { try { await window.maybeRefreshIfStale?.(); } catch {} }
      });

      try { window.setupMainLimitsObservers?.(); } catch {}

      if (messagingSupported) {
        console.log('[FCM] token actual:', localStorage.getItem('fcmToken') || '(sin token)');
        window.__reportState?.('post-init-notifs');
      }

      setBadgeCount(getBadgeCount());
      const installBtn = document.getElementById('install-entrypoint');
      if (installBtn) installBtn.style.display = (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone) ? 'none' : 'inline-block';

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

      wireAddressDatalists('reg-');
      reorderAddressFields('reg-');
    }
  });
}

// ──────────────────────────────────────────────────────────────
// T&C: interceptar links y abrir modal
// ──────────────────────────────────────────────────────────────
function ensureTermsModalPresent() {
  let modal = document.getElementById('terms-modal');
  if (modal) return modal;
  console.warn('[T&C] #terms-modal no encontrado. Creando modal básico on-the-fly.');
  modal = document.createElement('div');
  modal.id = 'terms-modal';
  modal.style.cssText = `
    position:fixed; inset:0; display:none; align-items:center; justify-content:center;
    background:rgba(0,0,0,.5); z-index:10000; padding:16px;
  `;
  modal.innerHTML = `
    <div style="max-width:720px; width:100%; background:#fff; border-radius:12px; padding:16px; max-height:80vh; overflow:auto;">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
        <h3 style="margin:0;">Términos y Condiciones</h3>
        <button id="close-terms-modal" class="secondary-btn" aria-label="Cerrar">✕</button>
      </div>
      <div id="terms-text" style="margin-top:12px;">
        <p>Cargando…</p>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.addEventListener('click', (ev) => { if (ev.target === modal) modal.style.display = 'none'; });
  document.getElementById('close-terms-modal')?.addEventListener('click', () => { modal.style.display = 'none'; });

  try { loadTermsContent?.(); } catch {}
  try { wireTermsModalBehavior?.(); } catch {}

  return modal;
}
function openTermsModalCatchAll() {
  const modal = ensureTermsModalPresent();
  try { openTermsModal?.(); }
  catch {
    try { UI.openTermsModal?.(true); } catch { modal.style.display = 'flex'; }
  }
  try { wireTermsModalBehavior?.(); } catch {}
}

document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const trigger = e.target.closest(
    '#show-terms-link, #show-terms-link-banner, #footer-terms-link,' +
    '[data-open-terms], a[href="#terminos"], a[href="#terms"], a[href="/terminos"], a[href*="terminos-y-condiciones"]'
  );
  if (!trigger) return;
  e.preventDefault();
  e.stopPropagation();
  openTermsModalCatchAll();
}, true);

// arranque de la app
document.addEventListener('DOMContentLoaded', () => {
  try { reorderProfileCards(); } catch {}
  try { reorderAddressFields('dom-'); } catch {}
  try { reorderAddressFields('reg-'); } catch {}
  main();
});



