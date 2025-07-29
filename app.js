// app.js (PWA del Cliente - ARQUITECTURA FINAL Y ROBUSTA)

import { setupFirebase, checkMessagingSupport, auth } from './modules/firebase.js';
import * as UI from './modules/ui.js';
import * as Data from './modules/data.js';
import * as Auth from './modules/auth.js';
import * as Notifications from './modules/notifications.js';
import * as Campanas from './modules/campanas.js'; // <-- 1. NUEVA IMPORTACIÓN

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
    safeAddEventListener('close-terms-modal', 'click', UI.closeTermsModal);
    safeAddEventListener('forgot-password-link', 'click', (e) => { e.preventDefault(); Auth.sendPasswordResetFromLogin(); });
}

function setupMainAppScreenListeners() {
    safeAddEventListener('logout-btn', 'click', Auth.logout);
    safeAddEventListener('change-password-btn', 'click', UI.openChangePasswordModal); 
    safeAddEventListener('show-terms-link-banner', 'click', (e) => { e.preventDefault(); UI.openTermsModal(true); });
    safeAddEventListener('footer-terms-link', 'click', (e) => { e.preventDefault(); UI.openTermsModal(false); });
    safeAddEventListener('accept-terms-btn-modal', 'click', Data.acceptTerms);
    
    // LISTENERS PARA EL MODAL DE CONTRASEÑA
    safeAddEventListener('close-password-modal', 'click', UI.closeChangePasswordModal);
    safeAddEventListener('save-new-password-btn', 'click', Auth.changePassword);
}

function main() {
    setupFirebase();

    auth.onAuthStateChanged(user => {
        if (user) {
            setupMainAppScreenListeners();
            Data.listenToClientData(user);
            Campanas.cargarCampanasActivas(); // <-- 2. LLAMADA A LA NUEVA FUNCIÓN
        } else {
            setupAuthScreenListeners();
            UI.showScreen('login-screen');
        }
    });

    checkMessagingSupport().then(isSupported => {
        if (isSupported) {
            // Conectamos los 3 listeners de notificaciones
            safeAddEventListener('btn-activar-notif-prompt', 'click', Notifications.handlePermissionRequest);
            safeAddEventListener('btn-rechazar-notif-prompt', 'click', Notifications.dismissPermissionRequest);
            safeAddEventListener('notif-switch', 'change', Notifications.handlePermissionSwitch);
            Notifications.listenForInAppMessages();
        }
    });
}

document.addEventListener('DOMContentLoaded', main);
