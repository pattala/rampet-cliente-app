// app.js (PWA del Cliente – instalación persistente + notificaciones con contador)

import { setupFirebase, checkMessagingSupport, auth, db } from './modules/firebase.js';
import * as UI from './modules/ui.js';
import * as Data from './modules/data.js';
import * as Auth from './modules/auth.js';
import {
  gestionarPermisoNotificaciones,
  listenForInAppMessages,
  handlePermissionRequest,
  dismissPermissionRequest,
  handlePermissionSwitch,
  initNotificationChannel,
  handleBellClick
} from './modules/notifications.js';

// ------------------- Lógica de instalación -------------------
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
});

window.addEventListener('appinstalled', async () => {
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
    if (!snap.empty) {
      const ref = snap.docs[0].ref;
      const ua = navigator.userAgent || '';
      const platform = /iPhone|iPad|iPod/i.test(ua) ? 'iOS' :
                       /Android/i.test(ua) ? 'Android' : 'Desktop';
      await ref.set({
        pwaInstalled: true,
        pwaInstalledAt: new Date().toISOString(),
        pwaInstallPlatform: platform
      }, { merge: true });
    }
  } catch (e) {
    console.warn('No se pudo registrar instalación:', e);
  }
});

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

async function handleInstallPrompt() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  document.getElementById('install-prompt-card')?.style?.setProperty('display','none');
}

async function handleDismissInstall() {
  localStorage.setItem('installDismissed', 'true');
  document.getElementById('install-prompt-card')?.style?.setProperty('display','none');
}

// ------------------- Eventos UI -------------------
function on(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}

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
  on('btn-install-pwa', 'click', handleInstallPrompt);
  on('btn-dismiss-install', 'click', handleDismissInstall);
  on('btn-notifs', 'click', handleBellClick);
  on('btn-activar-notif-prompt', 'click', handlePermissionRequest);
  on('btn-rechazar-notif-prompt', 'click', dismissPermissionRequest);
  on('notif-switch', 'change', handlePermissionSwitch);
}

// ------------------- Notificaciones -------------------
function initNotificationChannel() {
  if (!navigator.serviceWorker) return;
  navigator.serviceWorker.addEventListener("message", (event) => {
    const { type, data } = event.data || {};
    if (!type) return;

    if (type === "PUSH_DELIVERED") {
      const counter = document.getElementById("notif-counter");
      if (counter) {
        let n = parseInt(counter.textContent || "0", 10);
        counter.textContent = n + 1;
        counter.style.display = "inline-block";
      }
      if (data.id && auth.currentUser) {
        db.collection("clientes")
          .doc(auth.currentUser.uid)
          .collection("inbox")
          .doc(data.id)
          .set({ deliveredAt: new Date().toISOString() }, { merge: true });
      }
    }

    if (type === "PUSH_READ") {
      const counter = document.getElementById("notif-counter");
      if (counter) {
        counter.textContent = "";
        counter.style.display = "none";
      }
      if (data.id && auth.currentUser) {
        db.collection("clientes")
          .doc(auth.currentUser.uid)
          .collection("inbox")
          .doc(data.id)
          .set({ readAt: new Date().toISOString() }, { merge: true });
      }
    }
  });
}

// ------------------- MAIN -------------------
async function main() {
  setupFirebase();
  const messagingSupported = await checkMessagingSupport();

  auth.onAuthStateChanged(async (user) => {
    if (user) {
      setupMainAppScreenListeners();
      Data.listenToClientData(user);

      if (messagingSupported) {
        gestionarPermisoNotificaciones();
        initNotificationChannel();
        listenForInAppMessages();
      }

      if (!isStandalone()) {
        document.getElementById('install-entrypoint')?.style?.setProperty('display','inline-block');
      }
    } else {
      setupAuthScreenListeners();
      UI.showScreen('login-screen');
    }
  });
}

document.addEventListener('DOMContentLoaded', main);
