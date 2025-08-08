// modules/data.js (PWA - CON CORRECCIÓN EN CONSULTA DE CAMPAÑAS)

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

    // CORRECCIÓN: También reseteamos los premios para que se recarguen
    // si otro usuario inicia sesión.
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
            // Cargar premios si aún no se han cargado
            if (premiosData.length === 0) {
                const premiosSnapshot = await db.collection('premios').orderBy('puntos', 'asc').get();
                premiosData = premiosSnapshot.docs.map(p => ({ id: p.id, ...p.data() }));
            }

            // --- INICIO DE LA LÓGICA DE CAMPAÑAS CORREGIDA ---
            const hoy = new Date().toISOString().split('T')[0];
            
            // 1. Simplificamos la consulta: Traemos TODAS las campañas que están marcadas como activas.
            const campanasSnapshot = await db.collection('campanas')
                .where('estaActiva', '==', true)
                .get();
            
            // 2. Hacemos todo el filtrado de fechas en el código, que es más flexible.
            const campanasVisibles = campanasSnapshot.docs
                .map(doc => doc.data())
                .filter(campana => {
                    const esPublica = campana.visibilidad !== 'prueba';
                    const esTesterYVePrueba = clienteData.esTester === true && campana.visibilidad === 'prueba';
                    
                    const estaEnRangoDeFechas = hoy >= campana.fechaInicio && hoy <= campana.fechaFin;

                    // Una campaña es visible si:
                    // - Está en el rango de fechas correcto Y
                    // - Es pública O (el usuario es tester Y la campaña es de prueba)
                    return estaEnRangoDeFechas && (esPublica || esTesterYVePrueba);
                });
            // --- FIN DE LA LÓGICA DE CAMPAÑAS CORREGIDA ---

            // Pasamos todos los datos a la función de renderizado
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

// ... (El resto de las funciones como getFechaProximoVencimiento y getPuntosEnProximoVencimiento no cambian)
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
