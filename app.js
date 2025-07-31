// app.js (PWA - VERSIÓN FINAL REESTRUCTURADA)

import { setupFirebase, checkMessagingSupport, auth } from './modules/firebase.js';
import * as UI from './modules/ui.js';
import * as Data from './modules/data.js';
import * as Auth from './modules/auth.js';
import * as Notifications from './modules/notifications.js';

/**
 * Función central que inicializa toda la aplicación y sus listeners.
 */
function initializeApp() {
    setupFirebase();

    // -- LISTENERS PANTALLA DE LOGIN/REGISTRO --
    document.getElementById('show-register-link')?.addEventListener('click', (e) => { e.preventDefault(); UI.showScreen('register-screen'); });
    document.getElementById('show-login-link')?.addEventListener('click', (e) => { e.preventDefault(); UI.showScreen('login-screen'); });
    document.getElementById('login-btn')?.addEventListener('click', Auth.login);
    document.getElementById('register-btn')?.addEventListener('click', Auth.registerNewAccount);
    document.getElementById('forgot-password-link')?.addEventListener('click', (e) => { e.preventDefault(); Auth.sendPasswordResetFromLogin(); });

    // -- LISTENERS PANTALLA PRINCIPAL DE LA APP --
    document.getElementById('logout-btn')?.addEventListener('click', Auth.logout);
    document.getElementById('change-password-btn')?.addEventListener('click', UI.openChangePasswordModal);
    document.getElementById('accept-terms-btn-modal')?.addEventListener('click', Data.acceptTerms);
    
    // -- LISTENERS MODALES --
    document.getElementById('show-terms-link')?.addEventListener('click', (e) => { e.preventDefault(); UI.openTermsModal(false); });
    document.getElementById('show-terms-link-banner')?.addEventListener('click', (e) => { e.preventDefault(); UI.openTermsModal(true); });
    document.getElementById('footer-terms-link')?.addEventListener('click', (e) => { e.preventDefault(); UI.openTermsModal(false); });
    document.getElementById('close-terms-modal')?.addEventListener('click', UI.closeTermsModal);
    document.getElementById('close-password-modal')?.addEventListener('click', UI.closeChangePasswordModal);
    document.getElementById('save-new-password-btn')?.addEventListener('click', Auth.changePassword);

    // -- LISTENER DE NOTIFICACIONES (si son compatibles) --
    checkMessagingSupport().then(isSupported => {
        if (isSupported) {
            document.getElementById('btn-activar-notif-prompt')?.addEventListener('click', Notifications.handlePermissionRequest);
            document.getElementById('btn-rechazar-notif-prompt')?.addEventListener('click', Notifications.dismissPermissionRequest);
            document.getElementById('notif-switch')?.addEventListener('change', Notifications.handlePermissionSwitch);
            Notifications.listenForInAppMessages();
        }
    });

    // --- MANEJADOR PRINCIPAL DEL ESTADO DE AUTENTICACIÓN ---
    auth.onAuthStateChanged(user => {
        if (user) {
            // Si hay un usuario, mostrar "Cargando..." y luego obtener sus datos.
            UI.showScreen('loading-screen');
            Data.listenToClientData(user);
        } else {
            // Si no hay usuario, mostrar la pantalla de login.
            Data.cleanupListener(); // Limpiar cualquier escucha de datos anterior.
            UI.showScreen('login-screen');
        }
    });
}

// Iniciar la aplicación cuando el DOM esté listo.
document.addEventListener('DOMContentLoaded', initializeApp);
