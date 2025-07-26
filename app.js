// pwa/app.js - VERSIÓN DE DEPURACIÓN

import { setupFirebase, checkMessagingSupport, auth } from './modules/firebase.js';
import * as UI from './modules/ui.js';
import * as Data from './modules/data.js';
import * as Auth from './modules/auth.js';
import * as Notifications from './modules/notifications.js';

// --- Función safeAddEventListener con CONSOLE.LOGS para depurar ---
function safeAddEventListener(id, event, handler) {
    console.log(`Intentando conectar listener para el ID: "${id}"`); // Mensaje de intento
    const element = document.getElementById(id);
    if (element) {
        console.log(`✔️ Éxito: Elemento "${id}" encontrado. Conectando evento '${event}'.`); // Mensaje de éxito
        element.addEventListener(event, handler);
    } else {
        console.error(`❌ ERROR: Elemento con ID "${id}" NO fue encontrado en el DOM.`); // Mensaje de ERROR
    }
}

function setupAuthScreenListeners() {
    console.log("--- Configurando listeners para la pantalla de LOGIN ---");
    safeAddEventListener('show-register-link', 'click', (e) => { e.preventDefault(); UI.showScreen('register-screen'); });
    safeAddEventListener('show-login-link', 'click', (e) => { e.preventDefault(); UI.showScreen('login-screen'); });
    safeAddEventListener('login-btn', 'click', Auth.login);
    safeAddEventListener('register-btn', 'click', Auth.registerNewAccount);
    safeAddEventListener('show-terms-link', 'click', (e) => { e.preventDefault(); UI.openTermsModal(false); });
    safeAddEventListener('close-terms-modal', 'click', UI.closeTermsModal);
    
    // Listeners del flujo de "olvidé mi contraseña"
    safeAddEventListener('forgot-password-link', 'click', (e) => { e.preventDefault(); UI.openForgotPasswordModal(); });
    safeAddEventListener('close-forgot-modal', 'click', UI.closeForgotPasswordModal);
    safeAddEventListener('send-reset-email-btn', 'click', Auth.sendPasswordResetFromLogin);
}

function setupMainAppScreenListeners() {
    console.log("--- Configurando listeners para la pantalla PRINCIPAL ---");
    safeAddEventListener('logout-btn', 'click', Auth.logout);
    safeAddEventListener('change-password-btn', 'click', UI.openChangePasswordModal); 
    safeAddEventListener('show-terms-link-banner', 'click', (e) => { e.preventDefault(); UI.openTermsModal(true); });
    safeAddEventListener('footer-terms-link', 'click', (e) => { e.preventDefault(); UI.openTermsModal(false); });
    safeAddEventListener('accept-terms-btn-modal', 'click', Data.acceptTerms);
    
    // LISTENERS PARA EL MODAL DE CONTRASEÑA
    safeAddEventListener('close-password-modal', 'click', UI.closeChangePasswordModal);
    safeAddEventListener('save-new-password-btn', 'click', Auth.changePassword);
}

function main() {
    console.log("Iniciando aplicación...");
    setupFirebase();

    auth.onAuthStateChanged(user => {
        if (user) {
            console.log("Usuario AUTENTICADO. Configurando app principal.");
            setupMainAppScreenListeners();
            Data.listenToClientData(user);
        } else {
            console.log("Usuario NO autenticado. Configurando pantalla de login.");
            setupAuthScreenListeners();
            UI.showScreen('login-screen');
        }
    });

    checkMessagingSupport().then(isSupported => {
        if (isSupported) {
            console.log("Notificaciones PUSH soportadas. Conectando listeners de notificaciones.");
            safeAddEventListener('btn-activar-notif-prompt', 'click', Notifications.handlePermissionRequest);
            safeAddEventListener('btn-rechazar-notif-prompt', 'click', Notifications.dismissPermissionRequest);
            safeAddEventListener('notif-switch', 'change', Notifications.handlePermissionSwitch);
            Notifications.listenForInAppMessages();
        } else {
            console.warn("Notificaciones PUSH no son soportadas en este navegador.");
        }
    });
}

document.addEventListener('DOMContentLoaded', main);
