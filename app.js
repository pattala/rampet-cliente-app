// app.js (PWA del Cliente – instalación + notifs + INBOX modal con grupos y paginado)
// + Carrusel: autoplay 2.5s con setTimeout, drag desktop, snap estable en Edge, cursor grab, bloqueo drag de imágenes

import { setupFirebase, checkMessagingSupport, auth, db } from './modules/firebase.js';
import * as UI from './modules/ui.js';
import * as Data from './modules/data.js';
import * as Auth from './modules/auth.js';

// Notificaciones (módulo de la PWA)
import {
  gestionarPermisoNotificaciones,
  listenForInAppMessages,
  handlePermissionRequest,
  dismissPermissionRequest,
  handlePermissionSwitch,
  initNotificationChannel,
  handleBellClick,
  ensureSingleToken,
  handleSignOutCleanup
} from './modules/notifications.js';

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
function getInstallInstructionsHTML() {
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
// ==== [RAMPET][HOME LIMITS] Límite de historial y vencimientos + 'Ver todo' ====
const UI_LIMITS = {
  HISTORIAL_MAX: 8,   // muestra solo últimos 8 movimientos en Home
  VENC_FECHAS_MAX: 3, // mantiene 3 fechas de próximos vencimientos en Home
};

const _rampetUiObservers = [];
function registerObserver(mo){ _rampetUiObservers.push(mo); }
function cleanupUiObservers(){
  while (_rampetUiObservers.length) {
    const mo = _rampetUiObservers.pop();
    try { mo.disconnect(); } catch {}
  }
}

// Crea (si no existe) un link 'Ver todo' en el contenedor dado
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

// Limita la lista de historial reciente en Home (#lista-historial)
async function limitHistorialReciente() {
  const ul = document.getElementById('lista-historial');
  if (!ul) return;
  // Oculta ítems extra para mantener la Home liviana
  const items = Array.from(ul.querySelectorAll('li'));
  if (items.length > UI_LIMITS.HISTORIAL_MAX) {
    items.slice(UI_LIMITS.HISTORIAL_MAX).forEach(li => { li.style.display = 'none'; });
    // Agrega 'Ver todo' al final de la tarjeta/lista
    const container = ul.parentElement || ul;
    ensureVerTodoLink(container, 'ver-historial-link', 'Ver todo el historial', async () => {
      // Abre el modal extendido (por ahora sin filtro por categoría; eso llega en el Paso 2)
      await openInboxModal();
    });
  }
}

// Limita la lista de próximas fechas de vencimiento (.venc-list) a 3
async function limitVencimientos() {
  const list = document.querySelector('.venc-list');
  if (!list) return;
  const items = Array.from(list.querySelectorAll('li')).filter(li => !li.classList.contains('venc-empty'));
  if (items.length > UI_LIMITS.VENC_FECHAS_MAX) {
    items.slice(UI_LIMITS.VENC_FECHAS_MAX).forEach(li => { li.style.display = 'none'; });
    const container = list.parentElement || list;
    ensureVerTodoLink(container, 'ver-venc-link', 'Ver todos los vencimientos', async () => {
      await openInboxModal();
      // (Paso 2: aplicaremos filtro a 'puntos/vencimientos' en el modal)
    });
  }
}

// Observa los contenedores para aplicar el límite cada vez que se actualicen desde Firestore
function setupMainLimitsObservers() {
  const hist = document.getElementById('lista-historial');
  if (hist) {
    const mo = new MutationObserver(() => limitHistorialReciente());
    mo.observe(hist, { childList: true });
    registerObserver(mo);
    // Primer pase por si ya hay elementos
    limitHistorialReciente();
  }
  const venc = document.querySelector('.venc-list');
  if (venc) {
    const mo2 = new MutationObserver(() => limitVencimientos());
    mo2.observe(venc, { childList: true });
    registerObserver(mo2);
    // Primer pase
    limitVencimientos();
  }
}

// ──────────────────────────────────────────────────────────────
/** INBOX MODAL — agrupado No leídas / Leídas + paginado */
// ──────────────────────────────────────────────────────────────
let inboxPagination = { lastReadDoc: null, clienteRefPath: null };

function ensureInboxModal() {
  if (document.getElementById('inbox-modal')) return;

  const overlay = document.createElement('div');
  overlay.id = 'inbox-modal';
  overlay.className = 'modal-overlay';
  overlay.style.display = 'none';

  overlay.innerHTML = `
    <div class="modal-content" style="max-width: 560px;">
      <span id="close-inbox-modal" class="modal-close-btn">×</span>
      <h2 style="margin-bottom:12px;">Notificaciones</h2>

      <div id="inbox-section-unread" class="card" style="padding:14px;">
        <h3 style="margin:0 0 8px 0; border:none;">No leídas</h3>
        <div id="inbox-list-unread"></div>
      </div>

      <div id="inbox-section-read" class="card" style="padding:14px;">
        <h3 style="margin:0 0 8px 0; border:none;">Leídas</h3>
        <div id="inbox-list-read"></div>
        <div style="text-align:center; margin-top:10px;">
          <button id="inbox-load-more" class="secondary-btn">Cargar más</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // === Agregado: barra de filtros ===
  ensureInboxFilters();

  document.getElementById('close-inbox-modal').addEventListener('click', () => {
    overlay.style.display = 'none';
  });

  document.getElementById('inbox-load-more').addEventListener('click', async () => {
    await fetchInboxBatch({ more: true });
  });
}

// ==== [RAMPET][INBOX FILTERS] Barra de filtros + helpers ====

let inboxFilter = 'all'; // 'all' | 'puntos' | 'promos' | 'otros'

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

function ensureInboxFilters(){
  const modal = document.getElementById('inbox-modal');
  if (!modal) return;

  // --- Helpers locales ---
  const labelToKey = (txt) => {
    const t = (txt || '').trim().toLowerCase();
    if (t === 'todos') return 'all';
    if (t === 'puntos') return 'puntos';
    if (t === 'promos') return 'promos';
    if (t === 'otros')  return 'otros';
    return '';
  };
  const isFilterBtn = (el) => {
    if (!el) return false;
    if (el.hasAttribute && el.hasAttribute('data-filter')) {
      const v = (el.getAttribute('data-filter') || '').toLowerCase();
      return ['all','puntos','promos','otros'].includes(v);
    }
    // si no tiene data-filter, miramos el texto
    const k = labelToKey(el.textContent);
    return !!k;
  };
  const containerHasFilterButtons = (el) => {
    if (!el || !el.querySelectorAll) return false;
    const candidates = Array.from(el.querySelectorAll('button, a'));
    const hits = candidates.filter(isFilterBtn);
    // al menos 2 botones válidos para considerarlo barra de filtros
    return hits.length >= 2;
  };

  // 1) Buscar todas las barras candidatas dentro del modal (muy amplio a propósito)
  let candidates = Array.from(modal.querySelectorAll('*'))
    .filter(containerHasFilterButtons);

  let filters = null;
  if (candidates.length > 0) {
    // 2) Quedarnos con la primera, eliminar duplicadas
    filters = candidates[0];
    candidates.slice(1).forEach(n => n.remove());
  } else {
    // 3) No existe ninguna: crear una sola barra propia
    filters = document.createElement('div');
    filters.className = 'inbox-filters';
    filters.innerHTML = `
      <button class="inbox-filter-btn" data-filter="all">Todos</button>
      <button class="inbox-filter-btn" data-filter="puntos">Puntos</button>
      <button class="inbox-filter-btn" data-filter="promos">Promos</button>
      <button class="inbox-filter-btn" data-filter="otros">Otros</button>
    `;
    const h2 = modal.querySelector('h2');
    if (h2 && h2.parentElement) {
      h2.insertAdjacentElement('afterend', filters);
    } else {
      modal.querySelector('.modal-content')?.prepend(filters);
    }
  }

  // 4) Normalizar/estilizar botones dentro de la barra elegida
  const btns = Array.from(filters.querySelectorAll('button, a'));
  btns.forEach(btn => {
    // Asegurar data-filter según texto si falta
    if (!btn.hasAttribute('data-filter')) {
      const key = labelToKey(btn.textContent);
      if (key) btn.setAttribute('data-filter', key);
    }
    // Asegurar clases básicas para estilo (no rompe si ya están)
    btn.classList.add('inbox-filter-btn');
  });

  // 5) Filtrar a los válidos y cablear eventos (evitando duplicados)
  const filterBtns = btns.filter(b =>
    ['all','puntos','promos','otros'].includes(
      (b.getAttribute('data-filter') || '').toLowerCase()
    )
  );

  filterBtns.forEach(btn => {
    if (btn._rampetBound) btn.removeEventListener('click', btn._rampetBound);
    btn._rampetBound = async (e) => {
      e?.preventDefault?.();
      inboxFilter = (btn.getAttribute('data-filter') || 'all').toLowerCase();
      updateInboxFilterButtons();
      inboxPagination.lastReadDoc = null;
      await fetchInboxBatch({ more: false });
    };
    btn.addEventListener('click', btn._rampetBound);
  });

  // 6) Sincronizar visualmente el activo
  updateInboxFilterButtons();
}




function updateInboxFilterButtons(){
  const modal = document.getElementById('inbox-modal');
  if (!modal) return;
  modal.querySelectorAll('.inbox-filter-btn').forEach(b=>{
    const f = b.getAttribute('data-filter');
    b.classList.toggle('active', f === inboxFilter);
    b.setAttribute('aria-pressed', f === inboxFilter ? 'true' : 'false');
  });
}


function renderList(containerId, items) {
  const list = document.getElementById(containerId);
  if (!list) return;
  if (!items.length) {
    list.innerHTML = `<p class="info-message">Sin elementos.</p>`;
    return;
  }
  const html = items.map(it => {
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
  list.innerHTML = html;

  list.querySelectorAll('.card[data-url]').forEach(el => {
    el.addEventListener('click', () => {
      const goto = el.getAttribute('data-url') || '/notificaciones';
      window.location.href = goto;
    });
  });
}

async function resolveClienteRef() {
  if (inboxPagination.clienteRefPath) {
    return db.doc(inboxPagination.clienteRefPath);
  }
  const u = auth.currentUser;
  if (!u) return null;
  const qs = await db.collection('clientes').where('authUID','==', u.uid).limit(1).get();
  if (qs.empty) return null;
  inboxPagination.clienteRefPath = qs.docs[0].ref.path;
  return qs.docs[0].ref;
}

async function fetchInboxBatch({ more = false } = {}) {
  const clienteRef = await resolveClienteRef();
  if (!clienteRef) {
    renderList('inbox-list-unread', []);
    renderList('inbox-list-read', []);
    return;
  }

  if (!more) {
    // ------- No leídas -------
    let unread = [];
    try {
      const unreadSnap = await clienteRef.collection('inbox')
        .where('status', 'in', ['sent','delivered'])
        .orderBy('sentAt', 'desc')
        .limit(50)
        .get();

      unread = unreadSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      // aplicar filtro seleccionado
      unread = unread.filter(itemMatchesFilter);
    } catch (e) {
      console.warn('[INBOX] unread error (creá índice si lo pide):', e?.message || e);
    }
    renderList('inbox-list-unread', unread);

    // ------- Leídas (primer page) -------
    try {
      const readSnap = await clienteRef.collection('inbox')
        .where('status', '==', 'read')
        .orderBy('sentAt', 'desc')
        .limit(20)
        .get();

      const readItems = readSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const readFiltered = readItems.filter(itemMatchesFilter);
      renderList('inbox-list-read', readFiltered);

      // Paginación
      inboxPagination.lastReadDoc = readSnap.docs.length
        ? readSnap.docs[readSnap.docs.length - 1]
        : null;

      const moreBtn = document.getElementById('inbox-load-more');
      if (moreBtn) moreBtn.style.display = readFiltered.length < 20 ? 'none' : 'inline-block';
    } catch (e) {
      console.warn('[INBOX] read error (creá índice si lo pide):', e?.message || e);
      renderList('inbox-list-read', []);
      const moreBtn = document.getElementById('inbox-load-more');
      if (moreBtn) moreBtn.style.display = 'none';
    }

  } else {
    // ------- “Cargar más” (Leídas) -------
    if (!inboxPagination.lastReadDoc) {
      const moreBtn = document.getElementById('inbox-load-more');
      if (moreBtn) moreBtn.style.display = 'none';
      return;
    }

    try {
      const nextSnap = await clienteRef.collection('inbox')
        .where('status', '==', 'read')
        .orderBy('sentAt', 'desc')
        .startAfter(inboxPagination.lastReadDoc)
        .limit(20)
        .get();

      const nextItems = nextSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const nextFiltered = nextItems.filter(itemMatchesFilter);

      const container = document.getElementById('inbox-list-read');
      if (container && nextFiltered.length) {
        const tmp = document.createElement('div');
        tmp.innerHTML = nextFiltered.map(it => {
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
        Array.from(tmp.children).forEach(n => container.appendChild(n));
        container.querySelectorAll('.card[data-url]').forEach(el => {
          el.addEventListener('click', () => {
            const goto = el.getAttribute('data-url') || '/notificaciones';
            window.location.href = goto;
          });
        });
      }

      // avanzar paginación
      inboxPagination.lastReadDoc = nextSnap.docs.length
        ? nextSnap.docs[nextSnap.docs.length - 1]
        : null;

      const moreBtn = document.getElementById('inbox-load-more');
      if (moreBtn) moreBtn.style.display = nextFiltered.length < 20 ? 'none' : 'inline-block';
    } catch (e) {
      console.warn('[INBOX] read more error:', e?.message || e);
      const moreBtn = document.getElementById('inbox-load-more');
      if (moreBtn) moreBtn.style.display = 'none';
    }
  }
}


async function openInboxModal() {
  ensureInboxModal();
  inboxPagination.lastReadDoc = null;
  // Filtro por defecto al abrir
  inboxFilter = 'all';
  ensureInboxFilters();
  updateInboxFilterButtons();
  
  await fetchInboxBatch({ more: false });
  const overlay = document.getElementById('inbox-modal');
  if (overlay) overlay.style.display = 'flex';
}

// ──────────────────────────────────────────────────────────────
// CARRUSEL (simple): autoplay 2.5s + drag desktop + snap al centro
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

  // Bloquear arrastre nativo de imágenes (evita “sacarlas” del carrusel)
  root.querySelectorAll('img').forEach(img => img.setAttribute('draggable','false'));

  // Helper para Edge: alternar scroll-behavior durante drag
  function setScrollBehaviorSmooth(enable){ root.style.scrollBehavior = enable ? 'smooth' : 'auto'; }

  // Estados
  let isDown = false;
  let startX = 0;
  let startScroll = 0;
  let raf = null;

  // Autoplay (setTimeout basado, no setInterval)
  const AUTOPLAY = 2500;
  const RESUME_DELAY = 1200;
  let autoplayTimer = null;

  function clearAutoplay(){
    if (autoplayTimer){ clearTimeout(autoplayTimer); autoplayTimer = null; }
  }
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
      // reprogramar
      scheduleAutoplay(AUTOPLAY);
    }, delay);
  }
  function pauseAutoplay(){ clearAutoplay(); }
  function resumeAutoplaySoon(delay = AUTOPLAY){ clearAutoplay(); autoplayTimer = setTimeout(()=> scheduleAutoplay(), delay); }

  // Drag con mouse/pointer
  const onDown = (e)=>{
    isDown = true;
    startX = e.clientX;
    startScroll = root.scrollLeft;
    root.classList.add('arrastrando');
    try{ root.setPointerCapture(e.pointerId);}catch{}
    // Desactivar smooth durante el drag para evitar pelea con snap (Edge)
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
    // Snap al terminar el drag
    const idx = carruselIdxCercano(root);
    // Rehabilitar smooth para el snap
    setScrollBehaviorSmooth(true);
    carruselScrollTo(root, idx, true);
    resumeAutoplaySoon(RESUME_DELAY);
  };

  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove, { passive:true });
  root.addEventListener('pointerup', finishDrag, { passive:true });
  root.addEventListener('pointercancel', finishDrag, { passive:true });
  root.addEventListener('mouseleave', ()=>{ if(isDown) finishDrag({}); }, { passive:true });

  // Hover pausa/reanuda (desktop)
  root.addEventListener('mouseenter', pauseAutoplay, { passive:true });
  root.addEventListener('mouseleave', ()=> resumeAutoplaySoon(RESUME_DELAY), { passive:true });

  // Scroll → actualizar puntos + pausar autoplay
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

  // Cualquier click dentro del carrusel → reanudar a los 1200ms
  root.addEventListener('click', () => resumeAutoplaySoon(RESUME_DELAY), true);

  // Dots
  carruselWireDots(root, dotsRoot, pauseAutoplay, resumeAutoplaySoon);
  carruselUpdateDots(root, dotsRoot);
  if (dotsRoot){
    dotsRoot.addEventListener('click', () => resumeAutoplaySoon(RESUME_DELAY));
  }

  // Re-snap suave al terminar de moverse (debounced)
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

  // Inicialización: alinear al primero y arrancar autoplay
  setScrollBehaviorSmooth(false);
  carruselScrollTo(root, 0, false);
  setScrollBehaviorSmooth(true);
  scheduleAutoplay(AUTOPLAY);

  // Visibilidad de pestaña
  document.addEventListener('visibilitychange', ()=>{
    if (document.hidden) pauseAutoplay();
    else resumeAutoplaySoon(AUTOPLAY);
  });

  // Si más tarde el DOM agrega slides, re-wirear lo necesario
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

  on('show-terms-link', 'click', (e) => { e.preventDefault(); UI.openTermsModal(false); });
  on('forgot-password-link', 'click', (e) => { e.preventDefault(); Auth.sendPasswordResetFromLogin(); });

  on('close-terms-modal', 'click', UI.closeTermsModal);
}

function setupMainAppScreenListeners() {
  
  on('logout-btn', 'click', async () => {
    await handleSignOutCleanup();
    const c = document.getElementById('carrusel-campanas');
    if (c && c._rampetObs) { try { c._rampetObs.disconnect(); } catch {} }
    
      // Limpia observadores de UI (Home limits)
  cleanupUiObservers();

    Auth.logout();
  });

  on('change-password-btn', 'click', UI.openChangePasswordModal);
  on('save-new-password-btn', 'click', Auth.changePassword);
  on('close-password-modal', 'click', UI.closeChangePasswordModal);

  on('show-terms-link-banner', 'click', (e) => { e.preventDefault(); UI.openTermsModal(true); });
  on('footer-terms-link', 'click', (e) => { e.preventDefault(); UI.openTermsModal(false); });
  on('accept-terms-btn-modal', 'click', Data.acceptTerms);

  on('btn-install-pwa', 'click', handleInstallPrompt);
  on('btn-dismiss-install', 'click', handleDismissInstall);

  on('btn-notifs', 'click', async () => {
    await openInboxModal();
    await handleBellClick();
    await fetchInboxBatch({ more: false });
  });

  on('install-entrypoint', 'click', async () => {
    if (deferredInstallPrompt) {
      try { await handleInstallPrompt(); return; } catch (e) { console.warn('Error prompt nativo:', e); }
    }
    const modal = document.getElementById('install-help-modal');
    const instructions = document.getElementById('install-instructions');
    if (instructions) instructions.innerHTML = getInstallInstructionsHTML();
    if (modal) modal.style.display = 'block';
  });
  on('close-install-help', 'click', () => {
    const modal = document.getElementById('install-help-modal');
    if (modal) modal.style.display = 'none';
  });

  on('btn-activar-notif-prompt', 'click', handlePermissionRequest);
  on('btn-rechazar-notif-prompt', 'click', dismissPermissionRequest);
  on('notif-switch', 'change', handlePermissionSwitch);
}

// ──────────────────────────────────────────────────────────────
async function main() {
  setupFirebase();
  const messagingSupported = await checkMessagingSupport();

  auth.onAuthStateChanged(async (user) => {
    const bell = document.getElementById('btn-notifs');
    const badge = document.getElementById('notif-counter');

    ensureInboxModal();

    if (user) {
      if (bell) bell.style.display = 'inline-block';
      setupMainAppScreenListeners();

      Data.listenToClientData(user);
// Limitar Home (historial reciente + vencimientos) y agregar 'Ver todo'
setupMainLimitsObservers();
      if (messagingSupported) {
        await gestionarPermisoNotificaciones();
        await ensureSingleToken();
        initNotificationChannel();
        listenForInAppMessages();
      }

      showInstallPromptIfAvailable();

      const installBtn = document.getElementById('install-entrypoint');
      if (installBtn) {
        installBtn.style.display = isStandalone() ? 'none' : 'inline-block';
      }

      // Inicializar carrusel (simple y estable)
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






