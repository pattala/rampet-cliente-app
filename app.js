// app.js (PWA del Cliente - VERSIÓN FINAL)

import { setupFirebase, checkMessagingSupport, auth } from './modules/firebase.js';
import * as UI from './modules/ui.js';
import * as Data from './modules/data.js';
import * as Auth from './modules/auth.js';
import * as Notifications from './modules/notifications.js';

async function main() {
    setupFirebase();
    
    // Conectamos listeners generales
    document.getElementById('show-register-link').addEventListener('click', (e) => { e.preventDefault(); UI.showScreen('register-screen'); });
    document.getElementById('show-login-link').addEventListener('click', (e) => { e.preventDefault(); UI.showScreen('login-screen'); });
    document.getElementById('login-btn').addEventListener('click', Auth.login);
    document.getElementById('register-btn').addEventListener('click', Auth.registerNewAccount);
    document.getElementById('logout-btn').addEventListener('click', Auth.logout);
    
    // Conectamos todos los enlaces de T&C
    document.getElementById('show-terms-link').addEventListener('click', (e) => { e.preventDefault(); UI.openTermsModal(false); });
    document.getElementById('show-terms-link-banner').addEventListener('click', (e) => { e.preventDefault(); UI.openTermsModal(true); });
    document.getElementById('footer-terms-link').addEventListener('click', (e) => { e.preventDefault(); UI.openTermsModal(false); }); // NUEVO
    document.getElementById('close-terms-modal').addEventListener('click', UI.closeTermsModal);
    document.getElementById('accept-terms-btn-modal').addEventListener('click', Data.acceptTerms);

    const isSupported = await checkMessagingSupport();
    
    if (isSupported) {
        document.getElementById('btn-activar-permiso').addEventListener('click', Notifications.handlePermissionRequest);
        document.getElementById('btn-ahora-no').addEventListener('click', Notifications.dismissPermissionRequest);
        document.getElementById('notif-switch').addEventListener('change', Notifications.handlePermissionSwitch); // NUEVO
        Notifications.listenForInAppMessages();
    }

    auth.onAuthStateChanged(user => {
        if (user) {
            Data.listenToClientData(user);
        } else {
            Data.cleanupListener();
            UI.showScreen('login-screen');
        }
    });
}

document.addEventListener('DOMContentLoaded', main);
