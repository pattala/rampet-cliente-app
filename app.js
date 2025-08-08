// app.js (PWA del Cliente - CON LÓGICA DE INSTALACIÓN)

import { setupFirebase, checkMessagingSupport, auth } from './modules/firebase.js';
import * as UI from './modules/ui.js';
import * as Data from './modules/data.js';
import * as Auth from './modules/auth.js';
import * as Notifications from './modules/notifications.js';

// == INICIO: LÓGICA DE INSTALACIÓN PWA ==
// Variable global para guardar el evento que nos permitirá mostrar el prompt de instalación.
let deferredInstallPrompt = null;

// Escuchamos el evento que dispara el navegador cuando la PWA es instalable.
window.addEventListener('beforeinstallprompt', (e) => {
    // Prevenimos que el navegador muestre su propio mini-banner.
    e.preventDefault();
    // Guardamos el evento para poder usarlo más tarde.
    deferredInstallPrompt = e;
    console.log('✅ Evento "beforeinstallprompt" capturado. La app es instalable.');
});

// Función para mostrar el prompt de instalación.
async function handleInstallPrompt() {
    if (!deferredInstallPrompt) {
        console.log('El evento de instalación no está disponible.');
        return;
    }
    // Mostramos el diálogo de instalación nativo del sistema operativo.
    deferredInstallPrompt.prompt();
    // Esperamos a que el usuario tome una decisión.
    const { outcome } = await deferredInstallPrompt.userChoice;
    console.log(`El usuario ha elegido: ${outcome}`);
    // Limpiamos la variable, ya que el prompt solo se puede usar una vez.
    deferredInstallPrompt = null;
    // Ocultamos nuestro banner personalizado.
    document.getElementById('install-prompt-card').style.display = 'none';
}

// Función para ocultar el banner si el usuario no quiere instalar.
function handleDismissInstall() {
    deferredInstallPrompt = null;
    document.getElementById('install-prompt-card').style.display = 'none';
    console.log('El usuario ha descartado la instalación.');
}

// Exportamos la variable para que otros módulos puedan comprobar si la app es instalable.
export function isInstallable() {
    return deferredInstallPrompt !== null;
}
// == FIN: LÓGICA DE INSTALACIÓN PWA ==


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

    // Conectamos los listeners para los botones del nuevo banner de instalación.
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
