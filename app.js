// app.js (PWA del Cliente – versión integrada con instalación persistente + inbox modal)

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
  initNotificationChannel,          // ← canal SW → app para delivered/read
  handleBellClick,                  // ← click campanita en header (marca leídos)
  ensureSingleToken,                // ← dedupe defensivo de fcmTokens
  handleSignOutCleanup              // ← limpieza de token al salir
} from './modules/notifications.js';

// ──────────────────────────────────────────────────────────────
// LÓGICA DE INSTALACIÓN PWA (MEJORADA + fallback)
// ──────────────────────────────────────────────────────────────
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  console.log('✅ Evento "beforeinstallprompt" capturado. La app es instalable.');
});

window.addEventListener('appinstalled', async () => {
  console.log('✅ App instalada');

  // UI: ocultar superficies de instalación
  localStorage.removeItem('installDismissed');
  deferredInstallPrompt = null;
  document.getElementById('install-prompt-card')?.style?.setProperty('display','none');
  document.getElementById('install-entrypoint')?.style?.setProperty('display','none');
  document.getElementById('install-help-modal')?.style?.setProperty('display','none');

  // Persistencia local (opcional)
  localStorage.setItem('pwaInstalled', 'true');

  // Métrica en Firestore: marcar que instaló (por cliente autenticado)
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

    console.log('📌 Firestore: pwaInstalled=true guardado');
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

// (ÚNICA) función de dismiss con métrica en Firestore
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

// Instrucciones según plataforma (fallback cuando no hay prompt)
function getInstallInstructionsHTML() {
  const ua = navigator.userAgent.toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isAndroid = /android/.test(ua);

  if (isIOS) {
    return `
      <p>En iPhone/iPad:</p>
      <ol>
        <li>Tocá el botón <strong>Compartir</strong> (cuadrado con flecha hacia arriba).</li>
        <li>Elegí <strong>Añadir a pantalla de inicio</strong>.</li>
        <li>Confirmá con <strong>Añadir</strong>.</li>
      </ol>`;
  }

  if (isAndroid) {
    return `
      <p>En Android (Chrome/Edge):</p>
      <ol>
        <li>Abrí el menú <strong>⋮</strong> del navegador.</li>
        <li>Tocá <strong>Instalar app</strong> o <strong>Añadir a pantalla principal</strong>.</li>
        <li>Confirmá.</li>
      </ol>`;
  }

  return `
    <p>En escritorio (Chrome/Edge):</p>
    <ol>
      <li>Mirá en la barra de direcciones: icono <strong>Instalar</strong> o el menú del navegador.</li>
      <li>Elegí <strong>Instalar app</strong>.</li>
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
// INBOX MODAL (UI)
// ──────────────────────────────────────────────────────────────
function ensureInboxModal() {
  if (document.getElementById('inbox-modal')) return;
  const overlay = document.createElement('div');
  overlay.id = 'inbox-modal';
  overlay.className = 'modal-overlay';
  overlay.style.display = 'none';

  overlay.innerHTML = `
    <div class="modal-content" style="max-width: 520px;">
      <span id="close-inbox-modal" class="modal-close-btn">×</span>
      <h2>Notificaciones</h2>
      <div id="inbox-list" style="overflow-y:auto; max-height:60vh;"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('close-inbox-modal').addEventListener('click', () => {
    overlay.style.display = 'none';
  });
}

function renderInboxItems(items) {
  const list = document.getElementById('inbox-list');
  if (!list) return;
  if (!items.length) {
    list.innerHTML = `<p class="info-message">No tenés notificaciones.</p>`;
    return;
  }

  const html = items.map(it => {
    const sentAt = it.sentAt ? (it.sentAt.toDate ? it.sentAt.toDate() : new Date(it.sentAt)) : null;
    const dateTxt = sentAt ? sentAt.toLocaleString() : '';
    const status = it.status || 'sent';
    const url = it.url || '/notificaciones';
    return `
      <div class="card" style="margin:10px 0; cursor:pointer;" data-url="${url}">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
          <div style="flex:1 1 auto;">
            <div style="font-weight:700;">${it.title || 'Mensaje'}</div>
            <div style="color:#555; margin-top:6px;">${it.body || ''}</div>
            <div style="color:#999; font-size:12px; margin-top:8px;">${dateTxt} · ${status}</div>
          </div>
          <div style="flex:0 0 auto;">➡️</div>
        </div>
      </div>
    `;
  }).join('');
  list.innerHTML = html;

  // Click en item → navegar a su URL
  list.querySelectorAll('.card[data-url]').forEach(el => {
    el.addEventListener('click', () => {
      const goto = el.getAttribute('data-url') || '/notificaciones';
      window.location.href = goto;
    });
  });
}

async function openInboxModal() {
  ensureInboxModal();

  // Cargar últimos 30 items del inbox del cliente
  const u = auth.currentUser;
  if (!u) return;
  const qs = await db.collection('clientes').where('authUID','==', u.uid).limit(1).get();
  if (qs.empty) {
    renderInboxItems([]);
  } else {
    const inboxSnap = await qs.docs[0].ref.collection('inbox')
      .orderBy('sentAt', 'desc')
      .limit(30)
      .get();
    const items = inboxSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderInboxItems(items);
  }

  // Mostrar modal
  const overlay = document.getElementById('inbox-modal');
  if (overlay) overlay.style.display = 'flex';
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
  // Logout con limpieza de token
  on('logout-btn', 'click', async () => {
    await handleSignOutCleanup(); // limpia token FCM de Firestore y local
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

  // Botón de campanita en header → abre modal y marca leídos
  on('btn-notifs', 'click', async () => {
    await openInboxModal();   // 1) ver mensajes
    await handleBellClick();  // 2) marcar entregados como leídos (y reset badge)
  });

  // Entrada fija de instalación (botón opcional en header si lo usás)
  on('install-entrypoint', 'click', async () => {
    if (deferredInstallPrompt) {
      try {
        await handleInstallPrompt();
        return;
      } catch (e) {
        console.warn('Error al mostrar prompt nativo:', e);
      }
    }
    // Fallback a instrucciones
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
}

// ──────────────────────────────────────────────────────────────
async function main() {
  // Firebase base
  setupFirebase();

  // ¿Hay soporte real de Messaging en este navegador?
  const messagingSupported = await checkMessagingSupport();

  // Escucha auth: cuando entra a la app, conectamos todo lo necesario
  auth.onAuthStateChanged(async (user) => {
    const bell = document.getElementById('btn-notifs');
    const badge = document.getElementById('notif-counter');

    // asegurar que el modal exista en todo el ciclo
    ensureInboxModal();

    if (user) {
      if (bell) bell.style.display = 'inline-block';
      setupMainAppScreenListeners();

      // Datos en tiempo real del cliente
      Data.listenToClientData(user);

      // Notificaciones: si hay soporte, gestionamos permisos/token y onMessage
      if (messagingSupported) {
        await gestionarPermisoNotificaciones(); // solicita token y guarda
        await ensureSingleToken();              // dedupe defensivo (1 solo token)
        initNotificationChannel();              // canal SW → app para delivered/read y contador
        listenForInAppMessages();               // toasts en foreground
      }

      // Mostrar banner de instalación si aplica
      showInstallPromptIfAvailable();

      // Mostrar/ocultar botón fijo de instalación según estado
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
