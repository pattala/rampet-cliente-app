// pwa/app.js - VERSIÓN FINAL Y CORREGIDA

import { setupFirebase, checkMessagingSupport, auth } from './modules/firebase.js';
import * as UI from './modules/ui.js';
import * as Data from './modules/data.js';
import * as Auth from './modules/auth.js';
import * as Notifications from './modules/notifications.js';

function safeAddEventListener(id, event, handler) {
    const element = document.getElementById(id);
    if (element) {
        element.addEventListener(event, handler);
    } else {
        // En la versión final, es mejor que los errores no se muestren al usuario, solo en consola.
        console.error(`Elemento con ID "${id}" NO fue encontrado en el DOM.`);
    }
}

// Esta función ahora SOLO se encarga de los elementos de la pantalla de login/registro
function setupAuthScreenListeners() {
    safeAddEventListener('show-register-link', 'click', (e) => { e.preventDefault(); UI.showScreen('register-screen'); });
    safeAddEventListener('show-login-link', 'click', (e) => { e.preventDefault(); UI.showScreen('login-screen'); });
    safeAddEventListener('login-btn', 'click', Auth.login);
    safeAddEventListener('register-btn', 'click', Auth.registerNewAccount);
    safeAddEventListener('forgot-password-link', 'click', (e) => { e.preventDefault(); UI.openForgotPasswordModal(); });
}

// Esta función solo se encarga de los elementos de la app principal
function setupMainAppScreenListeners() {
    safeAddEventListener('logout-btn', 'click', Auth.logout);
    safeAddEventListener('change-password-btn', 'click', UI.openChangePasswordModal);
    safeAddEventListener('show-terms-link-banner', 'click', (e) => { e.preventDefault(); UI.openTermsModal(true); });
    safeAddEventListener('footer-terms-link', 'click', (e) => { e.preventDefault(); UI.openTermsModal(false); });
    safeAddEventListener('accept-terms-btn-modal', 'click', Data.acceptTerms);
}

// La función principal que arranca todo
function main() {
    setupFirebase();

    // --- CAMBIO CLAVE: CONECTAMOS LOS LISTENERS DE LOS MODALES DE FORMA GLOBAL ---
    // Estos botones siempre existirán en el DOM, así que los conectamos una sola vez al inicio.
    // Esto soluciona el error de que no se encontraban.
    safeAddEventListener('close-terms-modal', 'click', UI.closeTermsModal);
    safeAddEventListener('close-password-modal', 'click', UI.closeChangePasswordModal);
    safeAddEventListener('save-new-password-btn', 'click', Auth.changePassword);
    safeAddEventListener('close-forgot-modal', 'click', UI.closeForgotPasswordModal);
    safeAddEventListener('send-reset-email-btn', 'click', Auth.sendPasswordResetFromLogin);

    // El resto de la lógica de autenticación no cambia
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

// El punto de entrada de la aplicación
document.addEventListener('DOMContentLoaded', main);
