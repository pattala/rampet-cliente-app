// app.js (PWA del Cliente - VERSIÓN CON DIAGNÓSTICO PROFUNDO)

import { setupFirebase, checkMessagingSupport, auth } from './modules/firebase.js';
import * as UI from './modules/ui.js';
import * as Data from './modules/data.js';
import * as Auth from './modules/auth.js';
import * as Notifications from './modules/notifications.js';

console.log("PASO 1: app.js - Módulo cargado.");

function safeAddEventListener(id, event, handler) {
    const element = document.getElementById(id);
    if (element) {
        element.addEventListener(event, handler);
    }
}

function setupAuthScreenListeners() {
    console.log("PASO 5a: Conectando listeners de Autenticación...");
    safeAddEventListener('show-register-link', 'click', (e) => { e.preventDefault(); UI.showScreen('register-screen'); });
    safeAddEventListener('show-login-link', 'click', (e) => { e.preventDefault(); UI.showScreen('login-screen'); });
    safeAddEventListener('login-btn', 'click', Auth.login);
    safeAddEventListener('register-btn', 'click', Auth.registerNewAccount);
    safeAddEventListener('show-terms-link', 'click', (e) => { e.preventDefault(); UI.openTermsModal(false); });
    safeAddEventListener('close-terms-modal', 'click', UI.closeTermsModal);
}

function setupMainAppScreenListeners() {
    console.log("PASO 5b: Conectando listeners de App Principal...");
    safeAddEventListener('logout-btn', 'click', Auth.logout);
    safeAddEventListener('show-terms-link-banner', 'click', (e) => { e.preventDefault(); UI.openTermsModal(true); });
    safeAddEventListener('footer-terms-link', 'click', (e) => { e.preventDefault(); UI.openTermsModal(false); });
    safeAddEventListener('accept-terms-btn-modal', 'click', Data.acceptTerms);
}

function main() {
    console.log("PASO 3: main() - Función iniciada.");
    setupFirebase();
    console.log("PASO 4: main() - setupFirebase() completado.");

    auth.onAuthStateChanged(user => {
        console.log("PASO 6: onAuthStateChanged - Callback disparado.", { user: user ? user.uid : 'null' });
        if (user) {
            console.log("PASO 7b: onAuthStateChanged - Usuario detectado. Configurando pantalla principal.");
            setupMainAppScreenListeners();
            Data.listenToClientData(user);
        } else {
            console.log("PASO 7a: onAuthStateChanged - No hay usuario. Configurando pantalla de login.");
            setupAuthScreenListeners();
            UI.showScreen('login-screen');
        }
    });

    checkMessagingSupport().then(isSupported => {
        console.log(`PASO 8: Chequeo de Notificaciones completado. Soportado: ${isSupported}`);
        if (isSupported) {
            safeAddEventListener('btn-activar-notif-prompt', 'click', Notifications.handlePermissionRequest);
            safeAddEventListener('btn-rechazar-notif-prompt', 'click', Notifications.dismissPermissionRequest);
            safeAddEventListener('notif-switch', 'change', Notifications.handlePermissionSwitch);
            Notifications.listenForInAppMessages();
        }
    });
}

console.log("PASO 2: app.js - Añadiendo listener para DOMContentLoaded.");
document.addEventListener('DOMContentLoaded', main);
