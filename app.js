// pwa/app.js - VERSIÓN FINAL CON DELEGACIÓN DE EVENTOS

import { setupFirebase, checkMessagingSupport, auth } from './modules/firebase.js';
import * as UI from './modules/ui.js';
import * as Data from './modules/data.js';
import * as Auth from './modules/auth.js';
import * as Notifications from './modules/notifications.js';

/**
 * Manejador global de clics para toda la aplicación.
 * Utiliza la delegación de eventos para determinar qué acción realizar.
 * @param {Event} e - El objeto del evento de clic.
 */
function handleGlobalClick(e) {
    // Si el elemento clickeado no tiene un ID, no hacemos nada.
    if (!e.target.id) return;

    // Prevenimos el comportamiento por defecto para los enlaces <a>
    if (e.target.tagName === 'A') {
        e.preventDefault();
    }

    // Decidimos qué función llamar basándonos en el ID del elemento clickeado.
    switch (e.target.id) {
        // --- Flujo de Autenticación ---
        case 'show-register-link':
            UI.showScreen('register-screen');
            break;
        case 'show-login-link':
            UI.showScreen('login-screen');
            break;
        case 'login-btn':
            Auth.login();
            break;
        case 'register-btn':
            Auth.registerNewAccount();
            break;
        case 'forgot-password-link':
            UI.openForgotPasswordModal();
            break;
        case 'send-reset-email-btn':
            Auth.sendPasswordResetFromLogin();
            break;

        // --- Flujo Principal de la App ---
        case 'logout-btn':
            Auth.logout();
            break;
        case 'change-password-btn':
            UI.openChangePasswordModal();
            break;
        case 'save-new-password-btn':
            Auth.changePassword();
            break;
        
        // --- Flujo de Notificaciones ---
        case 'btn-activar-notif-prompt':
            Notifications.handlePermissionRequest();
            break;
        case 'btn-rechazar-notif-prompt':
            Notifications.dismissPermissionRequest();
            break;

        // --- Modales ---
        case 'close-terms-modal':
        case 'footer-terms-link':
        case 'show-terms-link-banner':
        case 'show-terms-link':
            UI.openTermsModal(e.target.id === 'show-terms-link-banner');
            break;
        case 'close-password-modal':
            UI.closeChangePasswordModal();
            break;
        case 'close-forgot-modal':
            UI.closeForgotPasswordModal();
            break;
        
        // --- Aceptar Términos ---
        case 'accept-terms-btn-modal':
            Data.acceptTerms();
            break;
    }
}

/**
 * Manejador global de cambios para elementos como checkboxes o switches.
 * @param {Event} e - El objeto del evento de cambio.
 */
function handleGlobalChange(e) {
    if (!e.target.id) return;

    switch (e.target.id) {
        case 'notif-switch':
            Notifications.handlePermissionSwitch(e);
            break;
    }
}

// La función principal que arranca todo
function main() {
    setupFirebase();

    // Conectamos nuestros manejadores globales al cuerpo del documento.
    document.body.addEventListener('click', handleGlobalClick);
    document.body.addEventListener('change', handleGlobalChange);

    auth.onAuthStateChanged(user => {
        if (user) {
            Data.listenToClientData(user);
        } else {
            UI.showScreen('login-screen');
        }
    });

    checkMessagingSupport();
}

// El punto de entrada de la aplicación
document.addEventListener('DOMContentLoaded', main);
