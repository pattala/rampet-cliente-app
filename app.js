// app.js (PWA del Cliente - ARQUITECTURA FINAL Y ROBUSTA)

import { setupFirebase, checkMessagingSupport, auth } from './modules/firebase.js';
import * as UI from './modules/ui.js';
import * as Data from './modules/data.js';
import * as Auth from './modules/auth.js';
import * as Notifications from './modules/notifications.js';

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
    // CORRECCIÓN BUG MODAL: La línea de 'close-terms-modal' se movió a main()
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

    // --- CORRECCIÓN DEL BUG DEL MODAL ---
    // Este listener se añade aquí para que el botón de cerrar los términos
    // funcione siempre, sin importar si el usuario ha iniciado sesión o no.
    safeAddEventListener('close-terms-modal', 'click', UI.closeTermsModal);
    // --- FIN DE LA CORRECCIÓN ---

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
            // Conectamos los 3 listeners de notificaciones
            safeAddEventListener('btn-activar-notif-prompt', 'click', Notifications.handlePermissionRequest);
            safeAddEventListener('btn-rechazar-notif-prompt', 'click', Notifications.dismissPermissionRequest);
            safeAddEventListener('notif-switch', 'change', Notifications.handlePermissionSwitch);
            Notifications.listenForInAppMessages();
        }
    });
}

document.addEventListener('DOMContentLoaded', main);
