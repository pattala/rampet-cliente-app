// app.js (PWA del Cliente - VERSIÓN FINAL)
// Descripción: Orquesta el arranque de la aplicación de forma robusta.

import { setupFirebase, checkMessagingSupport, auth } from './modules/firebase.js';
import * as UI from './modules/ui.js';
import * as Data from './modules/data.js';
import * as Auth from './modules/auth.js';
import * as Notifications from './modules/notifications.js';

/**
 * Función principal asíncrona que inicializa la aplicación.
 */
async function main() {
    // 1. Inicializa Firebase (sin comprobar messaging aún)
    setupFirebase();
    
    // 2. Conecta los event listeners que NO dependen de notificaciones
    document.getElementById('show-register-link').addEventListener('click', (e) => { e.preventDefault(); UI.showScreen('register-screen'); });
    document.getElementById('show-login-link').addEventListener('click', (e) => { e.preventDefault(); UI.showScreen('login-screen'); });
    document.getElementById('login-btn').addEventListener('click', Auth.login);
    document.getElementById('register-btn').addEventListener('click', Auth.registerNewAccount);
    document.getElementById('logout-btn').addEventListener('click', Auth.logout);
    document.getElementById('show-terms-link').addEventListener('click', (e) => { e.preventDefault(); UI.openTermsModal(false); });
    document.getElementById('show-terms-link-banner').addEventListener('click', (e) => { e.preventDefault(); UI.openTermsModal(true); });
    document.getElementById('close-terms-modal').addEventListener('click', UI.closeTermsModal);
    document.getElementById('accept-terms-btn-modal').addEventListener('click', Data.acceptTerms);

    // 3. ESPERAMOS a que la comprobación de compatibilidad de messaging termine
    const isSupported = await checkMessagingSupport();
    
    console.log(`--- Chequeo Final de Notificaciones ---`);
    console.log(`¿Navegador compatible? (isMessagingSupported): ${isSupported}`);
    
    if (isSupported) {
        // Si es compatible, AHORA conectamos los botones y listeners de notificaciones
        document.getElementById('btn-activar-permiso').addEventListener('click', Notifications.handlePermissionRequest);
        document.getElementById('btn-ahora-no').addEventListener('click', Notifications.dismissPermissionRequest);
        Notifications.listenForInAppMessages();
    }

    // 4. El listener principal que reacciona a los cambios de estado del usuario
    auth.onAuthStateChanged(user => {
        if (user) {
            Data.listenToClientData(user);
        } else {
            Data.cleanupListener();
            UI.showScreen('login-screen');
        }
    });
}

// Punto de entrada de la aplicación
document.addEventListener('DOMContentLoaded', main);
