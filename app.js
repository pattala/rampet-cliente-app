// pwa/app.js - VERSIÓN FINAL CON INSTRUCCIÓN NATIVA

import { setupFirebase, checkMessagingSupport, auth } from './modules/firebase.js';
import * as UI from './modules/ui.js';
import * as Data from './modules/data.js';
import * as Auth from './modules/auth.js';
import * as Notifications from './modules/notifications.js';

// --- FUNCIÓN GLOBAL PARA EL ONCLICK ---
// Hacemos la función accesible globalmente asignándola al objeto "window"
window.handleForgotPasswordClick = function(event) {
    event.preventDefault(); // Prevenimos que el enlace recargue la página
    UI.openForgotPasswordModal();
}

// --- El resto de la aplicación funciona como antes ---

function safeAddEventListener(id, event, handler) {
    const element = document.getElementById(id);
    if (element) {
        element.addEventListener(event, handler);
    }
}

document.addEventListener('DOMContentLoaded', function() {
    setupFirebase();

    // Conectamos todos los demás listeners de forma normal
    safeAddEventListener('show-register-link', 'click', (e) => { e.preventDefault(); UI.showScreen('register-screen'); });
    safeAddEventListener('show-login-link', 'click', (e) => { e.preventDefault(); UI.showScreen('login-screen'); });
    safeAddEventListener('login-btn', 'click', Auth.login);
    safeAddEventListener('register-btn', 'click', Auth.registerNewAccount);
    safeAddEventListener('send-reset-email-btn', 'click', Auth.sendPasswordResetFromLogin);
    safeAddEventListener('logout-btn', 'click', Auth.logout);
    safeAddEventListener('change-password-btn', 'click', UI.openChangePasswordModal);
    safeAddEventListener('save-new-password-btn', 'click', Auth.changePassword);
    safeAddEventListener('btn-activar-notif-prompt', 'click', Notifications.handlePermissionRequest);
    safeAddEventListener('btn-rechazar-notif-prompt', 'click', Notifications.dismissPermissionRequest);
    safeAddEventListener('notif-switch', 'change', Notifications.handlePermissionSwitch);
    safeAddEventListener('close-terms-modal', 'click', UI.closeTermsModal);
    safeAddEventListener('footer-terms-link', 'click', (e) => { e.preventDefault(); UI.openTermsModal(false); });
    safeAddEventListener('show-terms-link-banner', 'click', (e) => { e.preventDefault(); UI.openTermsModal(true); });
    safeAddEventListener('close-password-modal', 'click', UI.closeChangePasswordModal);
    safeAddEventListener('close-forgot-modal', 'click', UI.closeForgotPasswordModal);
    safeAddEventListener('accept-terms-btn-modal', 'click', Data.acceptTerms);

    auth.onAuthStateChanged(user => {
        if (user) {
            Data.listenToClientData(user);
        } else {
            UI.showScreen('login-screen');
        }
    });

    checkMessagingSupport().then(isSupported => {
        if (isSupported) {
            Notifications.listenForInAppMessages();
        }
    });
});
