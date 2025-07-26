// pwa/app.js - VERSIÓN FINAL CONSTRUIDA SOBRE EL DIAGNÓSTICO EXITOSO

// Importamos todos los módulos que la aplicación completa necesita
import { setupFirebase, checkMessagingSupport, auth } from './modules/firebase.js';
import * as UI from './modules/ui.js';
import * as Data from './modules/data.js';
import * as Auth from './modules/auth.js';
import * as Notifications from './modules/notifications.js';

/**
 * Esta es la función principal que se ejecuta cuando el HTML está listo.
 * Es la estructura que SÍ nos funcionó en el test.
 */
document.addEventListener('DOMContentLoaded', function() {
    
    // 1. Preparamos la conexión con Firebase
    setupFirebase();

    // 2. Conectamos nuestros "escuchadores" de eventos globales
    document.body.addEventListener('click', handleGlobalClick);
    document.body.addEventListener('change', handleGlobalChange);

    // 3. Verificamos el estado de autenticación del usuario
    auth.onAuthStateChanged(user => {
        if (user) {
            // Si el usuario está logueado, cargamos sus datos
            Data.listenToClientData(user);
        } else {
            // Si no, mostramos la pantalla de login
            UI.showScreen('login-screen');
        }
    });

    // 4. Preparamos el sistema para recibir notificaciones
    checkMessagingSupport().then(isSupported => {
        if (isSupported) {
            Notifications.listenForInAppMessages();
        }
    });
});


/**
 * Manejador central que decide qué hacer en cada clic.
 * @param {Event} e - El evento del clic.
 */
function handleGlobalClick(e) {
    const targetElement = e.target.closest('[id]');
    if (!targetElement) return;

    const targetId = targetElement.id;
    if (targetElement.tagName === 'A') {
        e.preventDefault();
    }

    // El switch que dirige el tráfico de clics
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

/**
 * Manejador central para eventos de cambio (como el switch de notificaciones).
 * @param {Event} e - El evento de cambio.
 */
function handleGlobalChange(e) {
    const targetId = e.target.id;
    if (!targetId) return;

    if (targetId === 'notif-switch') {
        Notifications.handlePermissionSwitch(e);
    }
}
