// pwa/app.js - VERSIÓN FINAL (5)

import { setupFirebase, checkMessagingSupport, auth } from './modules/firebase.js';
import * as UI from './modules/ui.js';
import * as Data from './modules/data.js';
import * as Auth from './modules/auth.js';
import * as Notifications from './modules/notifications.js';

document.addEventListener('DOMContentLoaded', function() {
    setupFirebase();
    document.body.addEventListener('click', handleGlobalClick);
    document.body.addEventListener('change', handleGlobalChange);

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


function handleGlobalClick(e) {
    // La causa de todo el problema se soluciona con este simple cambio:
    // Leer el ID directamente del event.target.
    const targetId = e.target.id;
    
    // Si el elemento clickeado no tiene un ID, no hacemos nada.
    if (!targetId) return;

    // Solo prevenimos el comportamiento por defecto si es necesario
    if (e.target.tagName === 'A') {
        e.preventDefault();
    }
    
    switch (targetId) {
        case 'show-register-link': UI.showScreen('register-screen'); break;
        case 'show-login-link': UI.showScreen('login-screen'); break;
        case 'login-btn': Auth.login(); break;
        case 'register-btn': Auth.registerNewAccount(); break;
        case 'forgot-password-link': UI.openForgotPasswordModal(); break;
        case 'send-reset-email-btn': Auth.sendPasswordResetFromLogin(); break;
        case 'logout-btn': Auth.logout(); break;
        case 'change-password-btn': UI.openChangePasswordModal(); break;
        case 'save-new-password-btn': Auth.changePassword(); break;
        case 'btn-activar-notif-prompt': Notifications.handlePermissionRequest(); break;
        case 'btn-rechazar-notif-prompt': Notifications.dismissPermissionRequest(); break;
        case 'show-terms-link':
        case 'footer-terms-link':
        case 'show-terms-link-banner':
            UI.openTermsModal(targetId === 'show-terms-link-banner');
            break;
        case 'close-terms-modal': UI.closeTermsModal(); break;
        case 'close-password-modal': UI.closeChangePasswordModal(); break;
        case 'close-forgot-modal': UI.closeForgotPasswordModal(); break;
        case 'accept-terms-btn-modal': Data.acceptTerms(); break;
    }
}


function handleGlobalChange(e) {
    const targetId = e.target.id;
    if (!targetId) return;

    if (targetId === 'notif-switch') {
        Notifications.handlePermissionSwitch(e);
    }
}
