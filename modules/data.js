// modules/data.js (PWA - VERSIÓN FINAL, COMPLETA Y CORREGIDA)
// Gestiona el estado de la app y la comunicación con Firestore.

import { db } from './firebase.js';
import * as UI from './ui.js';
import * as Auth from './auth.js';
import * as Notifications from './notifications.js';
import { setupFirebase, checkMessagingSupport, auth } from './modules/firebase.js'; // Importación añadida que podría faltar

let clienteData = null;
let clienteRef = null;
let premiosData = [];
let unsubscribeCliente = null;

export function cleanupListener() {
    if (unsubscribeCliente) unsubscribeCliente();
    clienteData = null;
    clienteRef = null;
    premiosData = [];
}

export async function listenToClientData(user) {
    UI.showScreen('loading-screen');
    if (unsubscribeCliente) unsubscribeCliente();

    const clienteQuery = db.collection('clientes').where("authUID", "==", user.uid).limit(1);
    
    unsubscribeCliente = clienteQuery.onSnapshot(async (snapshot) => {
        if (snapshot.empty) {
            UI.showToast("Error: Tu cuenta no está vinculada a ninguna ficha de cliente.", "error");
            Auth.logout();
            return;
        }
        
        const doc = snapshot.docs[0];
        clienteData = doc.data();
        clienteRef = doc.ref;

        try {
            if (premiosData.length === 0) {
                const premiosSnapshot = await db.collection('premios').orderBy('puntos', 'asc').get();
                premiosData = premiosSnapshot.docs.map(p => p.data());
            }

            // --- INICIO DE LA LÓGICA DE VISIBILIDAD (CORREGIDA) ---
            const hoy = new Date().toISOString().split('T')[0];
            
            let campanasQuery = db.collection('campanas')
                .where('estaActiva', '==', true)
                .where('fechaInicio', '<=', hoy);

            if (!clienteData.esTester) {
                campanasQuery = campanasQuery.where('visibilidad', '==', 'publica');
            }
            
            const campanasSnapshot = await campanasQuery.get();
            
            const campanasVisibles = campanasSnapshot.docs
                .map(doc => doc.data())
                .filter(campana => hoy <= campana.fechaFin);
            // --- FIN DE LA LÓGICA DE VISIBILIDAD (CORREGIDA) ---

            UI.renderMainScreen(clienteData, premiosData, campanasVisibles);

        } catch (e) {
            console.error("Error cargando datos adicionales (premios/campañas):", e);
            UI.renderMainScreen(clienteData, premiosData, []);
        }

        Notifications.gestionarPermisoNotificaciones(clienteData); 

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
        console.error("Error aceptando términos:", error);
    } finally {
        boton.disabled = false;
    }
}

// Funciones de cálculo
export function getFechaProximoVencimiento(cliente) {
    if (!cliente.historialPuntos || cliente.historialPuntos.length === 0) return null;
    let fechaMasProxima = null;
    const hoy = new Date();
    hoy.setUTCHours(0, 0, 0, 0);
    cliente.historialPuntos.forEach(grupo => {
        if (grupo.puntosDisponibles > 0 && grupo.estado !== 'Caducado') {
            const fechaObtencion = new Date(grupo.fechaObtencion.split('T')[0] + 'T00:00:00Z');
            const fechaCaducidad = new Date(fechaObtencion);
            fechaCaducidad.setUTCDate(fechaCaducidad.getUTCDate() + (grupo.diasCaducidad || 90));
            if (fechaCaducidad >= hoy && (fechaMasProxima === null || fechaCaducidad < fechaMasProxima)) {
                // --- ¡AQUÍ ESTABA EL ERROR! ---
                fechaMasProxima = fechaCaducidad; // CORREGIDO
                // --- FIN DE LA CORRECCIÓN ---
            }
        }
    });
    return fechaMasProxima;
}

export function getPuntosEnProximoVencimiento(cliente) {
    const fechaProximoVencimiento = getFechaProximoVencimiento(cliente);
    if (!fechaProximoVencimiento) return 0;
    let puntosAVencer = 0;
    cliente.historialPuntos.forEach(grupo => {
        if (grupo.puntosDisponibles > 0 && grupo.estado !== 'Caducado') {
            const fechaObtencion = new Date(grupo.fechaObtencion.split('T')[0] + 'T00:00:00Z');
            const fechaCaducidad = new Date(fechaObtencion);
            fechaCaducidad.setUTCDate(fechaCaducidad.getUTCDate() + (grupo.diasCaducidad || 90));
            if (fechaCaducidad.getTime() === fechaProximoVencimiento.getTime()) {
                puntosAVencer += grupo.puntosDisponibles;
            }
        }
    });
    return puntosAVencer;
}

// --- El resto de las funciones que estaban en tu archivo original ---
function safeAddEventListener(id, event, handler) {
    const element = document.getElementById(id);
    if (element) {
        element.addEventListener(event, handler);
    }
}

function setupAuthScreenListeners() {
    safeAddEventListener('show-register-link', 'click', (e) => { e.preventDefault(); UI.showScreen('register-screen'); });
    safeAddEventListener('show-login-link', 'click', (e) => { e.preventDefault(); UI.showScreen('login-screen'); });
    safeAddEventListener('login-btn', 'click', Auth.login);
    safeAddEventListener('register-btn', 'click', Auth.registerNewAccount);
    safeAddEventListener('show-terms-link', 'click', (e) => { e.preventDefault(); UI.openTermsModal(false); });
    safeAddEventListener('close-terms-modal', 'click', UI.closeTermsModal);
    safeAddEventListener('forgot-password-link', 'click', (e) => { e.preventDefault(); Auth.sendPasswordResetFromLogin(); });
}

function setupMainAppScreenListeners() {
    safeAddEventListener('logout-btn', 'click', Auth.logout);
    safeAddEventListener('change-password-btn', 'click', UI.openChangePasswordModal); 
    safeAddEventListener('show-terms-link-banner', 'click', (e) => { e.preventDefault(); UI.openTermsModal(true); });
    safeAddEventListener('footer-terms-link', 'click', (e) => { e.preventDefault(); UI.openTermsModal(false); });
    safeAddEventListener('accept-terms-btn-modal', 'click', acceptTerms); // Corregido para llamar a la función local
    
    // LISTENERS PARA EL MODAL DE CONTRASEÑA
    safeAddEventListener('close-password-modal', 'click', UI.closeChangePasswordModal);
    safeAddEventListener('save-new-password-btn', 'click', Auth.changePassword);
}

function main() {
    setupFirebase();

    auth.onAuthStateChanged(user => {
        if (user) {
            setupMainAppScreenListeners();
            listenToClientData(user); // Corregido para llamar a la función local
        } else {
            setupAuthScreenListeners();
            UI.showScreen('login-screen');
        }
    });

    checkMessagingSupport().then(isSupported => {
        if (isSupported) {
            safeAddEventListener('btn-activar-notif-prompt', 'click', Notifications.handlePermissionRequest);
            safeAddEventListener('btn-rechazar-notif-prompt', 'click', Notifications.dismissPermissionRequest);
            safeAddEventListener('notif-switch', 'change', Notifications.handlePermissionSwitch);
            Notifications.listenForInAppMessages();
        }
    });
}

document.addEventListener('DOMContentLoaded', main);
