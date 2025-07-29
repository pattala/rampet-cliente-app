// modules/data.js (PWA)
// Gestiona el estado de la app y la comunicación con Firestore.

import { db } from './firebase.js';
import * as UI from './ui.js';
import * as Auth from './auth.js';
import * as Notifications from './notifications.js';

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

    // ▼▼▼ CAMBIO PRINCIPAL AQUÍ ▼▼▼
    // En lugar de buscar en la colección, accedemos directamente al documento del usuario
    // usando su UID, que es como lo definen las nuevas reglas de seguridad.
    clienteRef = db.collection('clientes').doc(user.uid);
    // ▲▲▲ FIN DEL CAMBIO PRINCIPAL ▲▲▲
    
    unsubscribeCliente = clienteRef.onSnapshot(async (doc) => {
        // Ahora trabajamos con un 'doc' individual, no con un 'snapshot' de varios documentos.
        if (!doc.exists) {
            UI.showToast("Error: Tu cuenta no está vinculada a ninguna ficha de cliente.", "error");
            console.error("No se encontró el documento del cliente para el UID:", user.uid);
            Auth.logout();
            return;
        }
        
        clienteData = doc.data();

        // La lógica para cargar los premios se mantiene igual.
        if (premiosData.length === 0) {
            try {
                const premiosSnapshot = await db.collection('premios').orderBy('puntos', 'asc').get();
                premiosData = premiosSnapshot.docs.map(p => p.data());
            } catch (e) {
                console.error("Error cargando premios:", e);
            }
        }

        UI.renderMainScreen(clienteData, premiosData);
        Notifications.gestionarPermisoNotificaciones(clienteData); 

    }, (error) => {
        console.error("Error en listener de cliente:", error);
        UI.showToast("Error al cargar tus datos.", "error");
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

// Funciones de cálculo (SIN CAMBIOS)
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
                fechaMasProxima = fechaCaducidad;
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
