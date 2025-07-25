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
 */
function setupMainAppScreenListeners() {
    safeAddEventListener('logout-btn', 'click', Auth.logout);
    safeAddEventListener('show-terms-link-banner', 'click', (e) => { e.preventDefault(); UI.openTermsModal(true); });
    safeAddEventListener('footer-terms-link', 'click', (e) => { e.preventDefault(); UI.openTermsModal(false); });
    safeAddEventListener('accept-terms-btn-modal', 'click', Data.acceptTerms);
}

/**
 * Función principal que orquesta el arranque de la aplicación.
 */
function main() {
    // 1. Inicializa Firebase.
    setupFirebase();

    // 2. El listener de Auth es el controlador principal de la UI.
    // Se ejecuta INMEDIATAMENTE, sin esperar a la comprobación de notificaciones.
    auth.onAuthStateChanged(user => {
        if (user) {
            // Si hay un usuario, escuchamos sus datos y configuramos la pantalla principal.
            setupMainAppScreenListeners();
            Data.listenToClientData(user);
        } else {
            // Si no hay usuario, configuramos la pantalla de login/registro.
            setupAuthScreenListeners();
            UI.showScreen('login-screen');
        }
    });

    // 3. Comprueba la compatibilidad de las notificaciones EN PARALELO (en segundo plano).
    checkMessagingSupport().then(isSupported => {
        console.log(`--- Chequeo de Notificaciones (en segundo plano) ---`);
        console.log(`¿Navegador compatible?: ${isSupported}`);
        if (isSupported) {
            // Una vez que sabemos el resultado, conectamos los listeners de la UI de notificaciones.
            safeAddEventListener('btn-activar-notif-prompt', 'click', Notifications.handlePermissionRequest);
            safeAddEventListener('btn-rechazar-notif-prompt', 'click', Notifications.dismissPermissionRequest);
            safeAddEventListener('notif-switch', 'change', Notifications.handlePermissionSwitch);
            Notifications.listenForInAppMessages();
        }
    });
}

// Punto de entrada de la aplicación.
document.addEventListener('DOMContentLoaded', main);
