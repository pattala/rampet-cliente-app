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

        // La carga de premios se mantiene igual
        if (premiosData.length === 0) {
            try {
                const premiosSnapshot = await db.collection('premios').orderBy('puntos', 'asc').get();
                premiosData = premiosSnapshot.docs.map(p => p.data());
            } catch (e) {
                console.error("Error cargando premios:", e);
            }
        }

        // --> INICIO DE LA NUEVA LÓGICA DE CAMPAÑAS
        try {
            const hoy = new Date();
            const hoyString = hoy.toISOString().split('T')[0]; // Formato 'YYYY-MM-DD'
            
            // 1. Hacemos una consulta inicial a Firestore
            const campañasSnapshot = await db.collection('campañas')
                .where('habilitada', '==', true)
                .where('fechaFin', '>=', hoyString) // Filtramos campañas cuyo fin es hoy o futuro
                .get();

            // 2. Filtramos los resultados en el cliente para la fecha de inicio y la URL del banner
            const campañasActivas = campañasSnapshot.docs
                .map(doc => doc.data())
                .filter(campana => hoyString >= campana.fechaInicio); 
                });
            
            // 3. Llamamos a la función de la UI para que renderice los banners
            UI.renderCampaigns(campañasActivas);

        } catch (error) {
            console.error("Error al cargar las campañas:", error);
            // Si falla, simplemente no mostramos banners, pero la app sigue funcionando
            UI.renderCampaigns([]);
        }
        // --> FIN DE LA NUEVA LÓGICA DE CAMPAÑAS

        UI.renderMainScreen(clienteData, premiosData);
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
