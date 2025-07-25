// app.js (PWA del Cliente - VERSIÓN FINAL)

import { setupFirebase, checkMessagingSupport, auth } from './modules/firebase.js';
import * as UI from './modules/ui.js';
import * as Data from './modules/data.js';
import * as Auth from './modules/auth.js';
import * as Notifications from './modules/notifications.js';

/**
 * Función auxiliar que añade un event listener de forma segura,
 * evitando errores si el elemento no existe en el DOM.
 * @param {string} id - El ID del elemento HTML.
 * @param {string} event - El tipo de evento (ej: 'click').
 * @param {function} handler - La función a ejecutar.
 */
function safeAddEventListener(id, event, handler) {
    const element = document.getElementById(id);
    if (element) {
        element.addEventListener(event, handler);
    } else {
        // Esta advertencia te ayudará a saber si te falta algún elemento en tu HTML.
        console.warn(`Elemento con ID "${id}" no encontrado. El listener no fue añadido.`);
    }
}

async function main() {
    setupFirebase();
    
    // Conectamos listeners generales de forma segura
    safeAddEventListener('show-register-link', 'click', (e) => { e.preventDefault(); UI.showScreen('register-screen'); });
    safeAddEventListener('show-login-link', 'click', (e) => { e.preventDefault(); UI.showScreen('login-screen'); });
    safeAddEventListener('login-btn', 'click', Auth.login);
    safeAddEventListener('register-btn', 'click', Auth.registerNewAccount);
    safeAddEventListener('logout-btn', 'click', Auth.logout);
    
    // Conectamos todos los enlaces de T&C de forma segura
    safeAddEventListener('show-terms-link', 'click', (e) => { e.preventDefault(); UI.openTermsModal(false); });
    safeAddEventListener('show-terms-link-banner', 'click', (e) => { e.preventDefault(); UI.openTermsModal(true); });
    safeAddEventListener('footer-terms-link', 'click', (e) => { e.preventDefault(); UI.openTermsModal(false); });
    safeAddEventListener('close-terms-modal', 'click', UI.closeTermsModal);
    safeAddEventListener('accept-terms-btn-modal', 'click', Data.acceptTerms);

    const isSupported = await checkMessagingSupport();
    
    if (isSupported) {
        safeAddEventListener('btn-activar-permiso', 'click', Notifications.handlePermissionRequest);
        safeAddEventListener('btn-ahora-no', 'click', Notifications.dismissPermissionRequest);
        safeAddEventListener('notif-switch', 'change', Notifications.handlePermissionSwitch);
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
