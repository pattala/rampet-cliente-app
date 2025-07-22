// app.js (PWA del Cliente - Refactorizado)

import { setupFirebase, auth } from './modules/firebase.js';
import * as UI from './modules/ui.js';
import * as Data from './modules/data.js';
import * as Auth from './modules/auth.js';
import * as Notifications from './modules/notifications.js';

/**
 * Configura todos los event listeners de la aplicación.
 */
function setupEventListeners() {
    // Formularios de acceso
    document.getElementById('show-register-link').addEventListener('click', (e) => { e.preventDefault(); UI.showScreen('register-screen'); });
    document.getElementById('show-login-link').addEventListener('click', (e) => { e.preventDefault(); UI.showScreen('login-screen'); });
    document.getElementById('login-btn').addEventListener('click', Auth.login);
    document.getElementById('register-btn').addEventListener('click', Auth.registerNewAccount);
    document.getElementById('logout-btn').addEventListener('click', Auth.logout);

    // Modal de Términos y Condiciones
    document.getElementById('show-terms-link').addEventListener('click', (e) => { e.preventDefault(); UI.openTermsModal(false); });
    document.getElementById('show-terms-link-banner').addEventListener('click', (e) => { e.preventDefault(); UI.openTermsModal(true); });
    document.getElementById('close-terms-modal').addEventListener('click', UI.closeTermsModal);
    document.getElementById('accept-terms-btn-modal').addEventListener('click', Data.acceptTerms);

    // Lógica de Notificaciones
    if (Notifications.isMessagingSupported) {
        // Pop-up de pre-permiso
        document.getElementById('btn-activar-permiso').addEventListener('click', Notifications.handlePermissionRequest);
        document.getElementById('btn-ahora-no').addEventListener('click', Notifications.dismissPermissionRequest);

        // Switch en la pantalla principal
        document.getElementById('notif-switch').addEventListener('change', Notifications.handlePermissionSwitch);

        // Escuchar mensajes entrantes cuando la PWA está activa
        Notifications.listenForInAppMessages();
    }
}

/**
 * Función principal que inicializa la aplicación.
 */
function main() {
    setupFirebase();
    setupEventListeners();

    // El listener principal que reacciona a los cambios de estado del usuario (login/logout)
    auth.onAuthStateChanged(user => {
        if (user) {
            // Si el usuario ha iniciado sesión, empezamos a escuchar sus datos
            Data.listenToClientData(user);
        } else {
            // Si el usuario ha cerrado sesión, limpiamos los datos y mostramos la pantalla de login
            Data.cleanupListener();
            UI.showScreen('login-screen');
        }
    });
}

// Punto de entrada de la aplicación
document.addEventListener('DOMContentLoaded', main);