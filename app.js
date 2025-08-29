// app.js (PWA del Cliente – instalación + notifs + INBOX modal + carrusel mejorado)

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
  initNotificationChannel,          // canal SW → app
  handleBellClick,                  // marca entregados como leídos
  ensureSingleToken,                // dedupe tokens
  handleSignOutCleanup              // limpieza token al salir
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

  document.getElementById('close-inbox-modal').addEventListener('click', () => {
    overlay.style.display = 'none';
  });

  document.getElementById('inbox-load-more').addEventListener('click', async () => {
    await fetchInboxBatch({ more: true });
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

/**
 * Trae inbox:
 *  - Primer carga: No leídas (status in ['sent','delivered']) + primeras 20 leídas.
 *  - more=true: trae 20 leídas más continuando desde el último doc (paginación).
 */
async function fetchInboxBatch({ more = false } = {}) {
  const clienteRef = await resolveClienteRef();
  if (!clienteRef) {
    renderList('inbox-list-unread', []);
    renderList('inbox-list-read', []);
    return;
  }

  if (!more) {
    // No leídas
    let unread = [];
    try {
      const unreadSnap = await clienteRef.collection('inbox')
        .where('status', 'in', ['sent','delivered'])
        .orderBy('sentAt', 'desc')
        .limit(50)
        .get();
      unread = unreadSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      console.warn('[INBOX] unread error (creá índice si lo pide):', e?.message || e);
    }
    renderList('inbox-list-unread', unread);

    // Leídas (primer página)
    try {
      const readSnap = await clienteRef.collection('inbox')
        .where('status', '==', 'read')
        .orderBy('sentAt', 'desc')
        .limit(20)
        .get();

      const read = readSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderList('inbox-list-read', read);
      inboxPagination.lastReadDoc = readSnap.docs.length ? readSnap.docs[readSnap.docs.length - 1] : null;

      const moreBtn = document.getElementById('inbox-load-more');
      if (moreBtn) moreBtn.style.display = readSnap.size < 20 ? 'none' : 'inline-block';
    } catch (e) {
      console.warn('[INBOX] read error (creá índice si lo pide):', e?.message || e);
      renderList('inbox-list-read', []);
      const moreBtn = document.getElementById('inbox-load-more');
      if (moreBtn) moreBtn.style.display = 'none';
    }
  } else {
    // Paginado de leídas
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

      const next = nextSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const container = document.getElementById('inbox-list-read');
      if (container && next.length) {
        const tmp = document.createElement('div');
        tmp.innerHTML = next.map(it => {
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

      inboxPagination.lastReadDoc = nextSnap.docs.length ? nextSnap.docs[nextSnap.docs.length - 1] : null;

      const moreBtn = document.getElementById('inbox-load-more');
      if (moreBtn) moreBtn.style.display = nextSnap.size < 20 ? 'none' : 'inline-block';
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
  await fetchInboxBatch({ more: false });
  const overlay = document.getElementById('inbox-modal');
  if (overlay) overlay.style.display = 'flex';
}

// ──────────────────────────────────────────────────────────────
// CARRUSEL RAMPET – auto-init, indicadores, drag, autoplay
// ──────────────────────────────────────────────────────────────
let carruselWired = false;
let carruselAutoTimer = null;
const AUTOPLAY_MS = 5500;

function getSlides(container) {
  // Cualquier hijo directo es un slide (tu render puede variar)
  return Array.from(container.children).filter(n => n.nodeType === 1);
}

function buildIndicators(container, dotsBox) {
  const slides = getSlides(container);
  if (!dotsBox) return;
  dotsBox.innerHTML = '';
  slides.forEach((_, i) => {
    const dot = document.createElement('span');
    dot.className = 'indicador' + (i === 0 ? ' activo' : '');
    dot.dataset.index = String(i);
    dot.addEventListener('click', () => scrollToIndex(container, i));
    dotsBox.appendChild(dot);
  });
}

function markActive(container, dotsBox) {
  if (!dotsBox) return;
  const slides = getSlides(container);
  if (!slides.length) return;

  // El "activo" es el slide cuyo centro está más cerca del centro del viewport del carrusel
  const mid = container.scrollLeft + container.clientWidth / 2;
  let best = 0;
  let bestDist = Infinity;
  slides.forEach((s, i) => {
    const center = s.offsetLeft + s.offsetWidth / 2;
    const dist = Math.abs(center - mid);
    if (dist < bestDist) { bestDist = dist; best = i; }
  });

  dotsBox.querySelectorAll('.indicador').forEach((d, j) => {
    d.classList.toggle('activo', j === best);
  });
}

function scrollToIndex(container, index) {
  const slides = getSlides(container);
  if (!slides[index]) return;
  container.scrollTo({ left: slides[index].offsetLeft, behavior: 'smooth' });
}

function nextIndex(container) {
  const dotsBox = document.getElementById('carrusel-indicadores');
  const slides = getSlides(container);
  if (!slides.length) return 0;
  const mid = container.scrollLeft + container.clientWidth / 2;
  let best = 0, bestDist = Infinity;
  slides.forEach((s, i) => {
    const center = s.offsetLeft + s.offsetWidth / 2;
    const dist = Math.abs(center - mid);
    if (dist < bestDist) { bestDist = dist; best = i; }
  });
  return (best + 1) % slides.length;
}

function startAutoplay(container) {
  stopAutoplay();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const slides = getSlides(container);
  if (slides.length < 2) return;

  carruselAutoTimer = setInterval(() => {
    const idx = nextIndex(container);
    scrollToIndex(container, idx);
  }, AUTOPLAY_MS);
}
function stopAutoplay() {
  if (carruselAutoTimer) clearInterval(carruselAutoTimer);
  carruselAutoTimer = null;
}

function wireDrag(container) {
  let isDown = false;
  let startX = 0;
  let startScroll = 0;

  const onPointerDown = (e) => {
    if (e.button !== 0) return; // solo click izq
    isDown = true;
    container.classList.add('arrastrando');
    startX = e.clientX;
    startScroll = container.scrollLeft;
    container.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!isDown) return;
    const dx = e.clientX - startX;
    container.scrollLeft = startScroll - dx;
  };
  const onPointerUp = (e) => {
    isDown = false;
    container.classList.remove('arrastrando');
    try { container.releasePointerCapture(e.pointerId); } catch {}
  };

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerUp);
  container.addEventListener('pointerleave', onPointerUp);
}

function initCarouselOnce() {
  if (carruselWired) return;

  const container = document.getElementById('carrusel-campanas');
  const dotsBox   = document.getElementById('carrusel-indicadores');
  const wrapper   = document.getElementById('carrusel-campanas-container');

  if (!container || getSlides(container).length === 0) return;

  // Mostrar wrapper si tiene contenido
  if (wrapper) wrapper.style.display = 'block';

  buildIndicators(container, dotsBox);
  markActive(container, dotsBox);

  // Eventos
  let rafId = null;
  container.addEventListener('scroll', () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => markActive(container, dotsBox));
  });

  // Autoplay con pausa
  startAutoplay(container);
  container.addEventListener('mouseenter', () => stopAutoplay());
  container.addEventListener('mouseleave', () => startAutoplay(container));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopAutoplay(); else startAutoplay(container);
  });
  container.addEventListener('touchstart', () => stopAutoplay(), { passive: true });
  container.addEventListener('touchend', () => startAutoplay(container), { passive: true });

  // Drag en desktop
  wireDrag(container);

  // Recalcular indicadores ante cambios de tamaño
  const ro = new ResizeObserver(() => markActive(container, dotsBox));
  ro.observe(container);

  carruselWired = true;
}

function observeCarouselMount() {
  const container = document.getElementById('carrusel-campanas');
  if (!container) return;

  // Si ya llegaron los hijos, inicializamos
  if (getSlides(container).length) {
    initCarouselOnce();
  }

  // Observamos si tu módulo agrega los slides más tarde
  const mo = new MutationObserver(() => {
    if (getSlides(container).length) {
      initCarouselOnce();
    }
  });
  mo.observe(container, { childList: true });
}

// Exponer un refresco manual por si tu módulo lo quiere llamar
window.rampetRefreshCarousel = function rampetRefreshCarousel() {
  carruselWired = false;
  initCarouselOnce();
};

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
  // Logout con limpieza de token
  on('logout-btn', 'click', async () => {
    await handleSignOutCleanup();
    Auth.logout();
  });

  on('change-password-btn', 'click', UI.openChangePasswordModal);
  on('save-new-password-btn', 'click', Auth.changePassword);
  on('close-password-modal', 'click', UI.closeChangePasswordModal);

  on('show-terms-link-banner', 'click', (e) => { e.preventDefault(); UI.openTermsModal(true); });
  on('footer-terms-link', 'click', (e) => { e.preventDefault(); UI.openTermsModal(false); });
  on('accept-terms-btn-modal', 'click', Data.acceptTerms);

  // Instalación (prompt card)
  on('btn-install-pwa', 'click', handleInstallPrompt);
  on('btn-dismiss-install', 'click', handleDismissInstall);

  // Campanita → abre modal + marca leídos
  on('btn-notifs', 'click', async () => {
    await openInboxModal();
    await handleBellClick();
    await fetchInboxBatch({ more: false });
  });

  // Entrada fija de instalación (opcional)
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

  // Notificaciones (banner/switch)
  on('btn-activar-notif-prompt', 'click', handlePermissionRequest);
  on('btn-rechazar-notif-prompt', 'click', dismissPermissionRequest);
  on('notif-switch', 'change', handlePermissionSwitch);

  // Carrusel: observar y auto-inicializar cuando lleguen los slides
  observeCarouselMount();
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

      // Datos + carrusel
      Data.listenToClientData(user);
      // Por si tu render de campañas llama manualmente:
      // window.rampetRefreshCarousel();

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
    } else {
      if (bell) bell.style.display = 'none';
      if (badge) badge.style.display = 'none';
      setupAuthScreenListeners();
      UI.showScreen('login-screen');
    }
  });
}

document.addEventListener('DOMContentLoaded', main);
