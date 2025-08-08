// app.js (PWA del Cliente - CON LÓGICA DE INSTALACIÓN ROBUSTA)

import { setupFirebase, checkMessagingSupport, auth } from './modules/firebase.js';
import * as UI from './modules/ui.js';
import * as Data from './modules/data.js';
import * as Auth from './modules/auth.js';
import * as Notifications from './modules/notifications.js';

// --- LÓGICA DE INSTALACIÓN PWA (VERSIÓN MEJORADA) ---
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    console.log('✅ Evento "beforeinstallprompt" capturado. La app es instalable.');
});

// Función para mostrar el banner de instalación si corresponde.
function showInstallPromptIfAvailable() {
    // Comprobamos si la app es instalable Y si el usuario no lo ha rechazado antes.
    if (deferredInstallPrompt && !localStorage.getItem('installDismissed')) {
        const installCard = document.getElementById('install-prompt-card');
        if (installCard) {
            installCard.style.display = 'block';
        }
    }
}

async function handleInstallPrompt() {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    console.log(`El usuario ha elegido: ${outcome}`);
    deferredInstallPrompt = null;
    document.getElementById('install-prompt-card').style.display = 'none';
}

// Si el usuario rechaza, lo guardamos para no volver a preguntar.
function handleDismissInstall() {
    localStorage.setItem('installDismissed', 'true');
    document.getElementById('install-prompt-card').style.display = 'none';
    console.log('El usuario ha descartado la instalación.');
}
// --- FIN LÓGICA DE INSTALACIÓN ---


function safeAddEventListener(id, event, handler) {
    const element = document.getElementById(id);
    if (element) {
        element.addEventListener(event, handler);
    }
}

function setupAuthScreenListeners() {
    safeAddEventListener('show-register-link', 'click', (e) => { e.preventDefault(); UI.showScreen('register-screen'); });
    safeAddEventListener('show-login-link', 'click', (e) => { e.preventDefault(); UI.showScreen('login-screen'); });
    safeAddEventListener('login-btn', 'click', Auth.login);
    safeAddEventListener('register-btn', 'click', Auth.registerNewAccount);
    safeAddEventListener('show-terms-link', 'click', (e) => { e.preventDefault(); UI.openTermsModal(false); });
    safeAddEventListener('forgot-password-link', 'click', (e) => { e.preventDefault(); Auth.sendPasswordResetFromLogin(); });
}

function setupMainAppScreenListeners() {
    safeAddEventListener('logout-btn', 'click', Auth.logout);
    safeAddEventListener('change-password-btn', 'click', UI.openChangePasswordModal); 
    safeAddEventListener('show-terms-link-banner', 'click', (e) => { e.preventDefault(); UI.openTermsModal(true); });
    safeAddEventListener('footer-terms-link', 'click', (e) => { e.preventDefault(); UI.openTermsModal(false); });
    safeAddEventListener('accept-terms-btn-modal', 'click', Data.acceptTerms);
    
    safeAddEventListener('close-password-modal', 'click', UI.closeChangePasswordModal);
    safeAddEventListener('save-new-password-btn', 'click', Auth.changePassword);

    safeAddEventListener('btn-install-pwa', 'click', handleInstallPrompt);
    safeAddEventListener('btn-dismiss-install', 'click', handleDismissInstall);
}

function main() {
    setupFirebase();
    safeAddEventListener('close-terms-modal', 'click', UI.closeTermsModal);

    auth.onAuthStateChanged(user => {
        if (user) {
            setupMainAppScreenListeners();
            Data.listenToClientData(user);
            // == ¡NUEVA LÍNEA CLAVE! Mostramos el prompt de instalación al iniciar sesión. ==
            showInstallPromptIfAvailable(); 
        } else {
            setupAuthScreenListeners();
            UI.showScreen('login-screen');
        }
    });

    checkMessagingSupport().then(isSupported => {
        if (isSupported) {
            safeAddEventListener('btn-activar-notif-prompt', 'click', Notifications.handlePermissionRequest);
            safeAddEventListener('btn-rechazar-notif-prompt', 'click', Notifications.dismissPermissionRequest);
            safeAddEventListener('notif-switch', 'change', Notifications.handlePermissionSwitch);
            Notifications.listenForInAppMessages();
        }
    });
}

document.addEventListener('DOMContentLoaded', main);
