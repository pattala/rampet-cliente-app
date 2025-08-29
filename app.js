// app.js (PWA del Cliente – instalación + notifs + INBOX modal con grupos y paginado)
// + Carrusel: drag desktop + snap al soltar + indicadores + autoplay

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
// CARRUSEL: helpers + drag + snap + indicadores + autoplay
// ──────────────────────────────────────────────────────────────

function getSlides(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll('.banner-item, .banner-item-texto'));
}

function scrollToIndex(container, idx) {
  const slides = getSlides(container);
  if (!slides.length) return;
  const i = Math.max(0, Math.min(idx, slides.length - 1));
  const target = slides[i];
  const left = target.offsetLeft - (container.clientWidth - target.offsetWidth) / 2;
  container.scrollTo({ left, behavior: 'smooth' });
}

function nearestIndex(container) {
  const slides = getSlides(container);
  if (!slides.length) return 0;
  const mid = container.scrollLeft + container.clientWidth / 2;
  let best = 0, bestDist = Infinity;
  slides.forEach((s, i) => {
    const center = s.offsetLeft + s.offsetWidth / 2;
    const d = Math.abs(center - mid);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
}

function updateActiveIndicator(container, indicadoresRoot) {
  if (!indicadoresRoot) return;
  const dots = Array.from(indicadoresRoot.querySelectorAll('.indicador'));
  if (!dots.length) return;
  const idx = nearestIndex(container);
  dots.forEach((dot, i) => {
    if (i === idx) dot.classList.add('activo');
    else dot.classList.remove('activo');
  });
}

function wireIndicators(container, indicadoresRoot) {
  if (!container || !indicadoresRoot) return;
  const dots = Array.from(indicadoresRoot.querySelectorAll('.indicador'));
  dots.forEach((dot, i) => {
    dot.onclick = () => scrollToIndex(container, i);
  });
}

// Evita que el navegador “agarre” la imagen y la mueva afuera del carrusel
function disableNativeImageDrag() {
  const imgs = document.querySelectorAll('#carrusel-campanas img');
  imgs.forEach(img => {
    img.setAttribute('draggable', 'false');
    img.addEventListener('dragstart', (e) => e.preventDefault(), { passive: false });
  });
}

function wireDrag(container) {
  if (!container || container.dataset.dragWired === '1') return;
  container.dataset.dragWired = '1';

  let isDown = false;
  let startX = 0;
  let startScroll = 0;
  let raf = null;

  const onPointerDown = (e) => {
    isDown = true;
    stopAutoplay(); // pausa autoplay al tocar/arrastrar
    startX = e.clientX;
    startScroll = container.scrollLeft;
    container.classList.add('arrastrando');
    try { container.setPointerCapture(e.pointerId); } catch {}
  };
  const onPointerMove = (e) => {
    if (!isDown) return;
    const dx = e.clientX - startX;
    container.scrollLeft = startScroll - dx;
    if (e.cancelable) e.preventDefault();
  };
  const onPointerUp = (e) => {
    isDown = false;
    container.classList.remove('arrastrando');
    try { container.releasePointerCapture(e.pointerId); } catch {}
    const idx = nearestIndex(container);
    scrollToIndex(container, idx);
    restartAutoplaySoon(); // retomar autoplay luego de una breve pausa
  };

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerUp);
  container.addEventListener('pointercancel', onPointerUp);
  container.addEventListener('pointerleave', () => { if (isDown) onPointerUp({ pointerId: 0 }); });

  // feedback de indicador activo durante el scroll
  const indicadores = document.getElementById('carrusel-indicadores');
  const onScroll = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      updateActiveIndicator(container, indicadores);
      raf = null;
    });
  };
  container.addEventListener('scroll', onScroll, { passive: true });

  // UX: en desktop, al pasar el mouse por arriba pausamos/retomamos autoplay
  container.addEventListener('mouseenter', stopAutoplay);
  container.addEventListener('mouseleave', restartAutoplaySoon);
}

/* ===== Autoplay ===== */
const AUTOPLAY_MS = 2500;
let autoplayTimer = null;
let autoplayRestartTimer = null;

function startAutoplay(container) {
  stopAutoplay();
  const slides = getSlides(container);
  if (slides.length < 2) return;
  autoplayTimer = setInterval(() => {
    const i = nearestIndex(container);
    const next = (i + 1) % slides.length;
    scrollToIndex(container, next);
  }, AUTOPLAY_MS);
}

function stopAutoplay() {
  if (autoplayTimer) { clearInterval(autoplayTimer); autoplayTimer = null; }
  if (autoplayRestartTimer) { clearTimeout(autoplayRestartTimer); autoplayRestartTimer = null; }
}

function restartAutoplaySoon(container = document.getElementById('carrusel-campanas')) {
  if (!container) return;
  if (autoplayRestartTimer) clearTimeout(autoplayRestartTimer);
  autoplayRestartTimer = setTimeout(() => startAutoplay(container), 1200);
}

/** Inicializa y re-vincula el carrusel cuando cambian los slides por JS */
function initCarouselWiring() {
  const container = document.getElementById('carrusel-campanas');
  const indicadores = document.getElementById('carrusel-indicadores');
  if (!container) return;

  const tryWire = () => {
    const slides = getSlides(container);
    if (!slides.length) return;
    wireDrag(container);
    wireIndicators(container, indicadores);
    updateActiveIndicator(container, indicadores);
    disableNativeImageDrag();
    // Autoplay: inicia / reinicia cada vez que hay contenido
    startAutoplay(container);
  };

  tryWire();

  const obs = new MutationObserver(() => tryWire());
  obs.observe(container, { childList: true });
  container._rampetObs = obs;

  // Pausar autoplay cuando la pestaña no está visible
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopAutoplay();
    else restartAutoplaySoon(container);
  });
}

/* ===== Snap “real” en Edge/desktop: centra la slide más cercana al terminar el scroll ===== */
(function initCarouselSnapFix(){
  const container = document.getElementById('carrusel-campanas');
  if (!container) return;

  const ensure = () => {
    const slides = container.querySelectorAll('.banner-item, .banner-item-texto');
    return slides && slides.length;
  };

  const centerNearest = () => {
    if (!ensure()) return;
    const slides = Array.from(container.querySelectorAll('.banner-item, .banner-item-texto'));
    const viewportCenter = container.scrollLeft + container.clientWidth / 2;

    let best = slides[0], min = Number.POSITIVE_INFINITY;
    for (const s of slides) {
      const center = s.offsetLeft + s.clientWidth / 2;
      const d = Math.abs(center - viewportCenter);
      if (d < min) { min = d; best = s; }
    }
    const targetLeft = best.offsetLeft - (container.clientWidth - best.clientWidth) / 2;
    container.scrollTo({ left: targetLeft, behavior: 'smooth' });
  };

  let t = null, pointerDown = false;
  container.addEventListener('pointerdown', () => { pointerDown = true; stopAutoplay(); });
  container.addEventListener('pointerup',   () => { pointerDown = false; centerNearest(); restartAutoplaySoon(container); });

  container.addEventListener('scroll', () => {
    if (pointerDown) return;
    clearTimeout(t);
    t = setTimeout(centerNearest, 90);
  }, { passive: true });

  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(centerNearest, 120);
  });

  const mo = new MutationObserver(() => { if (ensure()) centerNearest(); });
  mo.observe(container, { childList: true });
})();

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
    stopAutoplay();
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

      // Wiring del carrusel (y autoplay)
      initCarouselWiring();
    } else {
      if (bell) bell.style.display = 'none';
      if (badge) badge.style.display = 'none';
      setupAuthScreenListeners();
      UI.showScreen('login-screen');

      const c = document.getElementById('carrusel-campanas');
      if (c && c._rampetObs) { try { c._rampetObs.disconnect(); } catch {} }
      stopAutoplay();
    }
  });
}

document.addEventListener('DOMContentLoaded', main);
