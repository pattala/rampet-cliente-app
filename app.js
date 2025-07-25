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
    safeAddEventListener('close-terms-modal', 'click', UI.closeTermsModal);
}

function setupMainAppScreenListeners() {
    safeAddEventListener('logout-btn', 'click', Auth.logout);
    safeAddEventListener('show-terms-link-banner', 'click', (e) => { e.preventDefault(); UI.openTermsModal(true); });
    safeAddEventListener('footer-terms-link', 'click', (e) => { e.preventDefault(); UI.openTermsModal(false); });
    safeAddEventListener('accept-terms-btn-modal', 'click', Data.acceptTerms);
}

function main() {
    setupFirebase();

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
