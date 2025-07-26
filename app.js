// pwa/app.js - VERSIÓN FINAL Y FUNCIONAL

// Importamos todos los módulos necesarios
import { setupFirebase, checkMessagingSupport, auth } from './modules/firebase.js';
import * as UI from './modules/ui.js';
import * as Data from './modules/data.js';
import * as Auth from './modules/auth.js';
import * as Notifications from './modules/notifications.js';

// --- El punto de entrada principal de la aplicación ---
document.addEventListener('DOMContentLoaded', function() {
    
    // 1. Inicializamos Firebase
    setupFirebase();

    // 2. Conectamos los manejadores de eventos a todo el documento
    document.body.addEventListener('click', handleGlobalClick);
    document.body.addEventListener('change', handleGlobalChange);

    // 3. Reaccionamos a los cambios de estado del usuario (login/logout)
    auth.onAuthStateChanged(user => {
        if (user) {
            // Si hay un usuario, escuchamos sus datos y mostramos la app
            Data.listenToClientData(user);
        } else {
            // Si no hay usuario, mostramos la pantalla de login
            UI.showScreen('login-screen');
        }
    });

    // 4. Verificamos si las notificaciones push son compatibles
    checkMessagingSupport().then(isSupported => {
        if (isSupported) {
            Notifications.listenForInAppMessages();
        }
    });
});

/**
 * Manejador global de clics para toda la aplicación.
 * @param {Event} e - El objeto del evento de clic.
 */
function handleGlobalClick(e) {
    const targetId = e.target.id;
    if (!targetId) return;

    if (e.target.tagName === 'A') {
        e.preventDefault();
    }

    switch (targetId) {
        // --- Autenticación ---
        case 'show-register-link': UI.showScreen('register-screen'); break;
        case 'show-login-link': UI.showScreen('login-screen'); break;
        case 'login-btn': Auth.login(); break;
        case 'register-btn': Auth.registerNewAccount(); break;
        case 'forgot-password-link': UI.openForgotPasswordModal(); break;
        case 'send-reset-email-btn': Auth.sendPasswordResetFromLogin(); break;

        // --- App Principal ---
        case 'logout-btn': Auth.logout(); break;
        case 'change-password-btn': UI.openChangePasswordModal(); break;
        case 'save-new-password-btn': Auth.changePassword(); break;
        
        // --- Notificaciones ---
        case 'btn-activar-notif-prompt': Notifications.handlePermissionRequest(); break;
        case 'btn-rechazar-notif-prompt': Notifications.dismissPermissionRequest(); break;

        // --- Modales y Términos ---
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

/**
 * Manejador global de cambios para switches y checkboxes.
 * @param {Event} e - El objeto del evento de cambio.
 */
function handleGlobalChange(e) {
    if (!e.target.id) return;
    if (e.target.id === 'notif-switch') {
        Notifications.handlePermissionSwitch(e);
    }
}
