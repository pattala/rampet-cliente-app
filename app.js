// app.js (PWA del Cliente – versión integrada con instalación persistente)

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
  handleBellClick                   // ← click campanita en header
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
  on('logout-btn', 'click', Auth.logout);
  on('change-password-btn', 'click', UI.openChangePasswordModal);
  on('save-new-password-btn', 'click', Auth.changePassword);
  on('close-password-modal', 'click', UI.closeChangePasswordModal);

  on('show-terms-link-banner', 'click', (e) => { e.preventDefault(); UI.openTermsModal(true); });
  on('footer-terms-link', 'click', (e) => { e.preventDefault(); UI.openTermsModal(false); });
  on('accept-terms-btn-modal', 'click', Data.acceptTerms);

  // Instalación (prompt card)
  on('btn-install-pwa', 'click', handleInstallPrompt);
  on('btn-dismiss-install', 'click', handleDismissInstall);

  // Botón de campanita en header (abre la bandeja / marca leídos)
  on('btn-notifs', 'click', handleBellClick);

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
    if (user) {
      setupMainAppScreenListeners();

      // Datos en tiempo real del cliente
      Data.listenToClientData(user);

      // Notificaciones: si hay soporte, gestionamos permisos/token y onMessage
      if (messagingSupported) {
        gestionarPermisoNotificaciones(); // solicita token y guarda en fcmTokens[]
        initNotificationChannel();        // canal SW → app para delivered/read y contador
        listenForInAppMessages();         // toasts en foreground
      }

      // Mostrar banner de instalación si aplica
      showInstallPromptIfAvailable();

      // Mostrar/ocultar botón fijo de instalación según estado
      const installBtn = document.getElementById('install-entrypoint');
      if (installBtn) {
        installBtn.style.display = isStandalone() ? 'none' : 'inline-block';
      }
    } else {
      setupAuthScreenListeners();
      UI.showScreen('login-screen');
    }
  });
}

document.addEventListener('DOMContentLoaded', main);
