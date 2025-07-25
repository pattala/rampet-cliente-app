// app.js (PWA del Cliente - VERSIÓN REESTRUCTURADA Y ROBUSTA)

// Importamos las funciones de inicialización y los módulos
import { setupFirebase, checkMessagingSupport, auth } from './modules/firebase.js';
import * as UI from './modules/ui.js';
import * as Data from './modules/data.js';
import * as Auth from './modules/auth.js';
import * as Notifications from './modules/notifications.js';

// Función auxiliar para añadir listeners de forma segura
function safeAddEventListener(id, event, handler) {
    const element = document.getElementById(id);
    if (element) {
        element.addEventListener(event, handler);
    }
    // Ya no es necesario un warning, porque solo añadiremos listeners a elementos visibles.
}

/**
 * Conecta los listeners para la pantalla de autenticación (Login/Registro).
 */
function setupAuthScreenListeners() {
    safeAddEventListener('show-register-link', 'click', (e) => { e.preventDefault(); UI.showScreen('register-screen'); });
    safeAddEventListener('show-login-link', 'click', (e) => { e.preventDefault(); UI.showScreen('login-screen'); });
    safeAddEventListener('login-btn', 'click', Auth.login);
    safeAddEventListener('register-btn', 'click', Auth.registerNewAccount);
    safeAddEventListener('show-terms-link', 'click', (e) => { e.preventDefault(); UI.openTermsModal(false); });
    safeAddEventListener('close-terms-modal', 'click', UI.closeTermsModal);
}

/**
 * Conecta los listeners para la pantalla principal de la aplicación.
 * @param {boolean} notificationsSupported - Indica si las notificaciones son compatibles.
 */
function setupMainAppScreenListeners(notificationsSupported) {
    safeAddEventListener('logout-btn', 'click', Auth.logout);
    safeAddEventListener('show-terms-link-banner', 'click', (e) => { e.preventDefault(); UI.openTermsModal(true); });
    safeAddEventListener('footer-terms-link', 'click', (e) => { e.preventDefault(); UI.openTermsModal(false); });
    safeAddEventListener('accept-terms-btn-modal', 'click', Data.acceptTerms);

    if (notificationsSupported) {
        safeAddEventListener('btn-activar-notif-prompt', 'click', Notifications.handlePermissionRequest);
        safeAddEventListener('btn-rechazar-notif-prompt', 'click', Notifications.dismissPermissionRequest);
        safeAddEventListener('notif-switch', 'change', Notifications.handlePermissionSwitch);
        Notifications.listenForInAppMessages();
    }
}

/**
 * Función principal que orquesta el arranque de la aplicación.
 */
async function main() {
    // 1. Inicializa Firebase.
    setupFirebase();

    // 2. Comprueba la compatibilidad de las notificaciones.
    const notificationsSupported = await checkMessagingSupport();
    console.log(`--- Chequeo de Notificaciones ---`);
    console.log(`¿Navegador compatible?: ${notificationsSupported}`);

    // 3. El listener de Auth es el controlador principal de la UI.
    auth.onAuthStateChanged(user => {
        if (user) {
            // Si hay un usuario, escuchamos sus datos y configuramos la pantalla principal.
            Data.listenToClientData(user);
            setupMainAppScreenListeners(notificationsSupported);
        } else {
            // Si no hay usuario, configuramos la pantalla de login/registro.
            setupAuthScreenListeners();
            UI.showScreen('login-screen'); // Mostramos la pantalla de login por defecto
        }
    });
}

// Punto de entrada de la aplicación.
document.addEventListener('DOMContentLoaded', main);
