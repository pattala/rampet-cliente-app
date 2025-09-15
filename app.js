// app.js — PWA del Cliente (instalación, notifs foreground + badge local, INBOX destacar/borrar + opt-in persistente)
import { setupFirebase, checkMessagingSupport, auth, db } from './modules/firebase.js';
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
window.__BUILD_ID = 'pwa-2025-09-07-2'; // bump
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
// FCM (foreground): asegurar token + handlers
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

/** Badge campanita — solo local (suma al llegar, se limpia al abrir INBOX) */
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

/** onMessage foreground → notificación + badge + refrescar inbox si visible */
async function registerForegroundFCMHandlers() {
  await ensureMessagingCompatLoaded();
  const messaging = firebase.messaging();

  messaging.onMessage(async (payload) => {
    const d = (()=>{
      const dd = payload?.data || {};
      const id  = dd.id ? String(dd.id) : undefined;
      const tag = dd.tag ? String(dd.tag) : (id ? `push-${id}` : undefined);
      return {
        id,
        title: String(dd.title || dd.titulo || 'RAMPET'),
        body:  String(dd.body  || dd.cuerpo || ''),
        icon:  String(dd.icon  || 'https://rampet.vercel.app/images/mi_logo_192.png'),
        badge: dd.badge ? String(dd.badge) : undefined,
        url:   String(dd.url   || dd.click_action || '/?inbox=1'),
        tag
      };
    })();

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
      if (t === 'PUSH_DELIVERED') {
        bumpBadge();
      } else if (t === 'OPEN_INBOX') {
        await openInboxModal();
      }
    });
  }
}

/** Garantiza token si perm=granted (no fuerza prompt aquí) */
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
    if (tok) {
      await guardarTokenEnMiDoc(tok);
      console.log('[FCM] token actual:', tok);
    } else {
      console.warn('[FCM] getToken devolvió vacío.');
    }
  } catch (e) {
    console.warn('[FCM] init error:', e?.message || e);
  }

  await registerForegroundFCMHandlers();
}

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

// Utilidad: addEventListener seguro por id
function on(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}

// ──────────────────────────────────────────────────────────────
// INBOX (click = destacar/normal, borrar, filtros)
// ──────────────────────────────────────────────────────────────
let inboxFilter = 'all';
let inboxLastSnapshot = [];
let inboxPagination = { clienteRefPath:null };
let inboxUnsub = null; // listener realtime opcional

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

  // Click/Enter/Espacio → toggle destacado
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
    card.addEventListener('click', async (e)=>{
      if ((e.target instanceof HTMLElement) && e.target.closest('.inbox-actions')) return;
      await toggle();
    });
    card.addEventListener('keydown', async (e)=>{
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); await toggle(); }
    });
  });

  // Borrar individual
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
    const snap = await clienteRef.collection('inbox')
      .orderBy('sentAt','desc')
      .limit(50)
      .get();

    const items = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    inboxLastSnapshot = items;
    renderInboxList(items);
    // Badge local se maneja aparte (no depende de read/unread)
  } catch (e) {
    console.warn('[INBOX] fetch error:', e?.message || e);
    inboxLastSnapshot = [];
    renderInboxList([]);
  }
}

// Listener tiempo real (opcional)
async function listenInboxRealtime() {
  const clienteRef = await resolveClienteRef();
  if (!clienteRef) return () => {};
  const q = clienteRef.collection('inbox').orderBy('sentAt','desc').limit(50);
  return q.onSnapshot((snap)=>{
    const items = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    inboxLastSnapshot = items;
    renderInboxList(items);
  }, (err)=> {
    console.warn('[INBOX] onSnapshot error:', err?.message || err);
  });
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
  resetBadge(); // limpiamos badge al abrir
  const modal = document.getElementById('inbox-modal');
  if (modal) modal.style.display = 'flex';
}

// ──────────────────────────────────────────────────────────────
// Carrusel (igual que antes)
// ──────────────────────────────────────────────────────────────
function carruselSlides(root){ return root ? Array.from(root.querySelectorAll('.banner-item, .banner-item-texto')) : []; }
function carruselIdxCercano(root){
  const slides = carruselSlides(root);
  if (!slides.length) return 0;
  const mid = root.scrollLeft + root.clientWidth/2;
  let best = 0, dmin = Infinity;
  slides.forEach((s,i)=>{ const c = s.offsetLeft + s.offsetWidth/2; const d = Math.abs(c - mid); if (d < dmin){ dmin = d; best = i; }});
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

  const onDown = (e)=>{ isDown = true; startX = e.clientX; startScroll = root.scrollLeft; root.classList.add('arrastrando'); try{ root.setPointerCapture(e.pointerId);}catch{} setScrollBehaviorSmooth(false); pauseAutoplay(); };
  const onMove = (e)=>{ if(!isDown) return; root.scrollLeft = startScroll - (e.clientX - startX); if (e.cancelable) e.preventDefault(); };
  const finishDrag = (e)=>{ if(!isDown) return; isDown = false; root.classList.remove('arrastrando'); try{ if(e?.pointerId!=null) root.releasePointerCapture(e.pointerId);}catch{} const idx = carruselIdxCercano(root); setScrollBehaviorSmooth(true); carruselScrollTo(root, idx, true); resumeAutoplaySoon(RESUME_DELAY); };

  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove, { passive:true });
  root.addEventListener('pointerup', finishDrag, { passive:true });
  root.addEventListener('pointercancel', finishDrag, { passive:true });
  root.addEventListener('mouseleave', ()=>{ if(isDown) finishDrag({}); }, { passive:true });

  root.addEventListener('mouseenter', pauseAutoplay, { passive:true });
  root.addEventListener('mouseleave', ()=> resumeAutoplaySoon(RESUME_DELAY), { passive:true });

  const onScroll = ()=>{ if (raf) return; raf = requestAnimationFrame(()=>{ carruselUpdateDots(root, dotsRoot); raf = null; }); pauseAutoplay(); resumeAutoplaySoon(RESUME_DELAY); };
  root.addEventListener('scroll', onScroll, { passive:true });

  root.addEventListener('click', () => resumeAutoplaySoon(RESUME_DELAY), true);

  carruselWireDots(root, dotsRoot, pauseAutoplay, resumeAutoplaySoon);
  carruselUpdateDots(root, dotsRoot);
  if (dotsRoot){ dotsRoot.addEventListener('click', () => resumeAutoplaySoon(RESUME_DELAY)); }

  let snapT = null;
  function snapSoon(delay=90){ clearTimeout(snapT); snapT = setTimeout(()=>{ const idx = carruselIdxCercano(root); setScrollBehaviorSmooth(true); carruselScrollTo(root, idx, true); }, delay); }
  window.addEventListener('resize', ()=> snapSoon(150));

  setScrollBehaviorSmooth(false);
  carruselScrollTo(root, 0, false);
  setScrollBehaviorSmooth(true);
  scheduleAutoplay(AUTOPLAY);

  document.addEventListener('visibilitychange', ()=>{ if (document.hidden) pauseAutoplay(); else resumeAutoplaySoon(AUTOPLAY); });

  const mo = new MutationObserver(()=>{ root.querySelectorAll('img').forEach(img => img.setAttribute('draggable','false')); carruselUpdateDots(root, dotsRoot); });
  mo.observe(root, { childList:true });
  root._rampetObs = mo;
}

// ──────────────────────────────────────────────────────────────
// TÉRMINOS & CONDICIONES (modal existente en HTML) — helpers
// ──────────────────────────────────────────────────────────────
function termsModal() { return document.getElementById('terms-modal'); }
function termsTextEl() { return document.getElementById('terms-text'); }
function loadTermsContent() {
  const el = termsTextEl();
  if (!el) return;
  el.innerHTML = `
    <p><strong>1. Generalidades:</strong> El programa de fidelización "Club RAMPET" es un beneficio exclusivo para nuestros clientes. La participación en el programa es gratuita e implica la aceptación total de los presentes términos y condiciones.</p>
    <p><strong>2. Consentimiento de Comunicaciones:</strong> Al registrarte y/o aceptar los términos en la aplicación, otorgas tu consentimiento explícito para recibir comunicaciones transaccionales y promocionales del Club RAMPET a través de correo electrónico y notificaciones push. Estas comunicaciones son parte integral del programa de fidelización e incluyen, entre otros, avisos sobre puntos ganados, premios canjeados, promociones especiales y vencimiento de puntos. Puedes gestionar tus preferencias de notificaciones en cualquier momento.</p>
    <p><strong>3. Beneficios cerca tuyo:</strong> Para mostrarte promociones disponibles en tu zona, la app puede usar la capacidad del dispositivo para detectar tu proximidad a nuestras tiendas. Esta función es opcional y sólo se activa si vos la habilitás desde la app. Podés desactivarla en cualquier momento desde la misma sección.</p>
    <p><strong>4. Acumulación de Puntos:</strong> Los puntos se acumularán según la tasa de conversión vigente establecida por RAMPET. Los puntos no tienen valor monetario, no son transferibles a otras personas ni canjeables por dinero en efectivo.</p>
    <p><strong>5. Canje de Premios:</strong> El canje de premios se realiza exclusivamente en el local físico y será procesado por un administrador del sistema. La PWA sirve como un catálogo para consultar los premios disponibles y los puntos necesarios. Para realizar un canje, el cliente debe presentar una identificación válida.</p>
    <p><strong>6. Validez y Caducidad:</strong> Los puntos acumulados tienen una fecha de caducidad que se rige por las reglas definidas en el sistema. El cliente será notificado de los vencimientos próximos a través de los canales de comunicación aceptados para que pueda utilizarlos a tiempo.</p>
    <p><strong>7. Modificaciones del Programa:</strong> RAMPET se reserva el derecho de modificar los términos y condiciones, la tasa de conversión, el catálogo de premios o cualquier otro aspecto del programa de fidelización, inclusive su finalización, en cualquier momento y sin previo aviso.</p>
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
// LISTENERS de app principal
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

function setupMainAppScreenListeners() {
  // Logout
  on('logout-btn', 'click', async () => {
    try { await handleSignOutCleanup(); } catch {}
    if (inboxUnsub) { try { inboxUnsub(); } catch {} inboxUnsub = null; }
    const c = document.getElementById('carrusel-campanas');
    if (c && c._rampetObs) { try { c._rampetObs.disconnect(); } catch {} }
    try { window.cleanupUiObservers?.(); } catch {}
    Auth.logout();
  });

  // Cambio de password
  on('change-password-btn', 'click', UI.openChangePasswordModal);
  on('save-new-password-btn', 'click', Auth.changePassword);
  on('close-password-modal', 'click', UI.closeChangePasswordModal);

  // T&C
  on('show-terms-link-banner', 'click', (e) => { e.preventDefault(); openTermsModal(); });
  on('footer-terms-link', 'click',       (e) => { e.preventDefault(); openTermsModal(); });
  on('accept-terms-btn-modal', 'click',  Data.acceptTerms);

  // Instalación
  on('btn-install-pwa', 'click', handleInstallPrompt);
  on('btn-dismiss-install', 'click', handleDismissInstall);

  // Notificaciones → abre INBOX y deja a notifications.js su parte
  on('btn-notifs', 'click', async () => {
    try { await openInboxModal(); } catch {}
    try { await handleBellClick(); } catch {}
  });

  // Entrada alternativa a instalación
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

  // Permisos de notificaciones (tarjeta)
  on('btn-activar-notif-prompt', 'click', async () => {
    // Delega en notifications.js
    try { await handlePermissionRequest(); } catch {}
  });
  on('btn-rechazar-notif-prompt', 'click', async () => {
    // Guardar dismiss para no insistir de inmediato
    try { await Data.saveNotifDismiss(); } catch {}
    try { await dismissPermissionRequest(); } catch {}
  });
  on('notif-switch', 'change', async (e) => {
    // Delega UI de switch a notifications.js pero persiste opt-in/out en Data (vía eventos o directo)
    try { await handlePermissionSwitch(e); } catch {}
  });

  // Puente de eventos de notifications.js → persistencia en Firestore
  // (si notifications.js dispara estos eventos, acá los persistimos como respaldo)
  document.addEventListener('rampet:consent:notif-opt-in', async (ev) => {
    try { await Data.saveNotifConsent(true, { notifOptInSource: ev?.detail?.source || 'ui' }); } catch {}
  });
  document.addEventListener('rampet:consent:notif-opt-out', async (ev) => {
    try { await Data.saveNotifConsent(false, { notifOptOutSource: ev?.detail?.source || 'ui' }); } catch {}
  });

  // Geolocalización (si la capa de geo dispara eventos, también persistimos)
  document.addEventListener('rampet:geo:enabled', async (ev) => {
    try { await Data.saveGeoConsent(true, { geoMethod: ev?.detail?.method || 'ui' }); } catch {}
  });
  document.addEventListener('rampet:geo:disabled', async (ev) => {
    try { await Data.saveGeoConsent(false, { geoMethod: ev?.detail?.method || 'ui' }); } catch {}
  });
}

// Abrir INBOX si viene ?inbox=1 o /notificaciones (deep link del SW)
function openInboxIfQuery() {
  try {
    const url = new URL(location.href);
    if (url.searchParams.get('inbox') === '1' || url.pathname.replace(/\/+$/,'') === '/notificaciones') {
      openInboxModal();
    }
  } catch {}
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

      // GEO inicio (si existe en este bundle)
      try { await window.ensureGeoOnStartup?.(); } catch {}

      document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible') {
          try { await window.maybeRefreshIfStale?.(); } catch {}
        }
      });

      // Carrusel y límites de UI (si existen)
      try { window.setupMainLimitsObservers?.(); } catch {}

      // Notifs
      if (messagingSupported) {
        await initFCMForRampet();        // asegura token y onMessage
        await initNotificationsOnce?.();  // inicializador original (prompts, switches, etc.)
        console.log('[FCM] token actual:', localStorage.getItem('fcmToken') || '(sin token)');
        window.__reportState?.('post-init-notifs');
      }

      // Mostrar badge previo (si había)
      setBadgeCount(getBadgeCount());

      // Instalación PWA
      showInstallPromptIfAvailable();
      const installBtn = document.getElementById('install-entrypoint');
      if (installBtn) installBtn.style.display = isStandalone() ? 'none' : 'inline-block';

      initCarouselBasic();

      // Deep link a INBOX si viene desde el click de la notificación
      openInboxIfQuery();

      // (Opcional) activar tiempo real en INBOX
      try {
        if (inboxUnsub) { try { inboxUnsub(); } catch {} }
        inboxUnsub = await listenInboxRealtime();
      } catch (e) {
        console.warn('[INBOX] realtime no iniciado:', e?.message || e);
      }
    } else {
      if (bell) bell.style.display = 'none';
      if (badge) badge.style.display = 'none';
      setupAuthScreenListeners();
      UI.showScreen('login-screen');

      const c = document.getElementById('carrusel-campanas');
      if (c && c._rampetObs) { try { c._rampetObs.disconnect(); } catch {} }

      if (inboxUnsub) { try { inboxUnsub(); } catch {} inboxUnsub = null; }
      inboxPagination.clienteRefPath = null;
      inboxLastSnapshot = [];
      resetBadge();
    }
  });
}

document.addEventListener('DOMContentLoaded', main);


