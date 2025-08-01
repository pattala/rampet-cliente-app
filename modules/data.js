// pwa/modules/data.js (Versión Modular Correcta y Limpia)

import { db } from './firebase.js';
import * as UI from './ui.js';
import * as Auth from './auth.js';
import * as Notifications from './notifications.js';

let clienteRef = null;
let unsubscribeCliente = null;

export function cleanupListener() {
    if (unsubscribeCliente) unsubscribeCliente();
    clienteRef = null;
}

export async function listenToClientData(user) {
    if (unsubscribeCliente) unsubscribeCliente();

    const clienteQuery = db.collection('clientes').where("authUID", "==", user.uid).limit(1);
    
    unsubscribeCliente = clienteQuery.onSnapshot(async (snapshot) => {
        if (snapshot.empty) {
            UI.showToast("Error: Tu cuenta no está vinculada a una ficha de cliente.", "error");
            Auth.logout();
            return;
        }
        
        const clienteData = snapshot.docs[0].data();
        clienteRef = snapshot.docs[0].ref;

        try {
            // Obtenemos premios y campañas en paralelo para mayor eficiencia
            const [premiosSnapshot, campanasSnapshot] = await Promise.all([
                db.collection('premios').orderBy('puntos', 'asc').get(),
                db.collection('campanas')
                    .where('estaActiva', '==', true)
                    .where('fechaInicio', '<=', new Date().toISOString().split('T')[0])
                    .get()
            ]);

            const premiosData = premiosSnapshot.docs.map(p => p.data());
            
            const hoy = new Date().toISOString().split('T')[0];
            const campanasVisibles = campanasSnapshot.docs
                .map(doc => doc.data())
                .filter(campana => hoy <= campana.fechaFin);
            
            // Pasamos todos los datos a la UI para que los renderice
            UI.renderMainScreen(clienteData, premiosData, campanasVisibles);
            
            // Le decimos al módulo de notificaciones que revise los permisos
            Notifications.gestionarPermisoNotificaciones();

        } catch (e) {
            console.error("Error cargando datos adicionales (premios/campañas):", e);
            // Si algo falla (ej. el índice de Firebase), renderizamos la app sin esos datos
            UI.renderMainScreen(clienteData, [], []);
            Notifications.gestionarPermisoNotificaciones();
        }

    }, (error) => {
        console.error("Error en listener de cliente:", error);
        Auth.logout();
    });
}

export async function acceptTerms() {
    if (!clienteRef) return;
    const boton = document.getElementById('accept-terms-btn-modal');
    boton.disabled = true;
    try {
        await clienteRef.update({ terminosAceptados: true });
        UI.showToast("¡Gracias por aceptar los términos!", "success");
        UI.closeTermsModal();
    } catch (error) {
        UI.showToast("No se pudo actualizar. Inténtalo de nuevo.", "error");
    } finally {
        if (boton) boton.disabled = false;
    }
}```

---

### **Acción 5: Modificar `app.js`**

Finalmente, ajustamos `app.js` para que maneje el flujo de carga inicial correctamente.

1.  Abre tu archivo `app.js` original.
2.  **Reemplaza todo el contenido** con el siguiente código.

```javascript
// app.js (PWA - Versión Modular Correcta y Robusta)

import { setupFirebase, checkMessagingSupport, auth } from './modules/firebase.js';
import * as UI from './modules/ui.js';
import * as Data from './modules/data.js';
import * as Auth from './modules/auth.js';
import * as Notifications from './modules/notifications.js';

function initializeApp() {
    setupFirebase();

    // --- Listeners de Eventos ---
    document.getElementById('show-register-link')?.addEventListener('click', (e) => { e.preventDefault(); UI.showScreen('register-screen'); });
    document.getElementById('show-login-link')?.addEventListener('click', (e) => { e.preventDefault(); UI.showScreen('login-screen'); });
    document.getElementById('login-btn')?.addEventListener('click', Auth.login);
    document.getElementById('register-btn')?.addEventListener('click', Auth.registerNewAccount);
    document.getElementById('forgot-password-link')?.addEventListener('click', (e) => { e.preventDefault(); Auth.sendPasswordResetFromLogin(); });
    document.getElementById('logout-btn')?.addEventListener('click', Auth.logout);
    document.getElementById('change-password-btn')?.addEventListener('click', UI.openChangePasswordModal);
    document.getElementById('accept-terms-btn-modal')?.addEventListener('click', Data.acceptTerms);
    document.getElementById('show-terms-link')?.addEventListener('click', (e) => { e.preventDefault(); UI.openTermsModal(false); });
    document.getElementById('show-terms-link-banner')?.addEventListener('click', (e) => { e.preventDefault(); UI.openTermsModal(true); });
    document.getElementById('footer-terms-link')?.addEventListener('click', (e) => { e.preventDefault(); UI.openTermsModal(false); });
    document.getElementById('close-terms-modal')?.addEventListener('click', UI.closeTermsModal);
    document.getElementById('close-password-modal')?.addEventListener('click', UI.closeChangePasswordModal);
    document.getElementById('save-new-password-btn')?.addEventListener('click', Auth.changePassword);

    checkMessagingSupport().then(isSupported => {
        if (isSupported) {
            document.getElementById('btn-activar-notif-prompt')?.addEventListener('click', Notifications.handlePermissionRequest);
            document.getElementById('btn-rechazar-notif-prompt')?.addEventListener('click', Notifications.dismissPermissionRequest);
            document.getElementById('notif-switch')?.addEventListener('change', Notifications.handlePermissionSwitch);
            Notifications.listenForInAppMessages();
        }
    });

    // --- Manejador Principal de Autenticación (Flujo de Carga Corregido) ---
    auth.onAuthStateChanged(user => {
        if (user) {
            // Si Firebase detecta un usuario, mostramos "Cargando..."
            // y luego Data.listenToClientData se encargará de mostrar la app principal.
            UI.showScreen('loading-screen');
            Data.listenToClientData(user);
        } else {
            // Si no hay usuario, limpiamos cualquier dato residual y mostramos el Login.
            Data.cleanupListener();
            UI.showScreen('login-screen');
        }
    });
}

// Iniciar la app cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', initializeApp);
