// modules/data.js (PWA - VERSIÓN FINAL CON LISTENERS EN TIEMPO REAL)

import { db } from './firebase.js';
import * as UI from './ui.js';
import * as Auth from './auth.js';
import * as Notifications from './notifications.js';

let clienteData = null;
let clienteRef = null;
let premiosData = [];
let campanasData = []; // Guardaremos las campañas aquí para que ambos listeners las usen

let unsubscribeCliente = null;
let unsubscribeCampanas = null; // Listener para las campañas

export function cleanupListener() {
    if (unsubscribeCliente) unsubscribeCliente();
    if (unsubscribeCampanas) unsubscribeCampanas(); // Limpiamos el nuevo listener
    clienteData = null;
    clienteRef = null;
    premiosData = [];
    campanasData = [];
}

function renderizarPantallaPrincipal() {
    // Esta función auxiliar se encarga de renderizar la UI
    // cada vez que los datos del cliente O de las campañas cambian.
    if (!clienteData) return;

    const hoy = new Date().toISOString().split('T')[0];
    
    const campanasVisibles = campanasData.filter(campana => {
        const esPublica = campana.visibilidad !== 'prueba';
        const esTesterYVePrueba = clienteData.esTester === true && campana.visibilidad === 'prueba';
        if (!(esPublica || esTesterYVePrueba)) return false;

        const fechaInicio = campana.fechaInicio;
        const fechaFin = campana.fechaFin;
        
        if (!fechaInicio || hoy < fechaInicio) return false;
        if (fechaFin && fechaFin !== '2100-01-01' && hoy > fechaFin) return false;

        return true;
    });

    UI.renderMainScreen(clienteData, premiosData, campanasVisibles);
}

export async function listenToClientData(user) {
    UI.showScreen('loading-screen');
    
    // Limpiamos listeners anteriores por si acaso
    if (unsubscribeCliente) unsubscribeCliente();
    if (unsubscribeCampanas) unsubscribeCampanas();

    // Cargamos los premios una sola vez, ya que no cambian a menudo.
    if (premiosData.length === 0) {
        try {
            const premiosSnapshot = await db.collection('premios').orderBy('puntos', 'asc').get();
            premiosData = premiosSnapshot.docs.map(p => ({ id: p.id, ...p.data() }));
        } catch (e) {
            console.error("Error cargando premios:", e);
        }
    }

    // --- INICIO: LISTENER EN TIEMPO REAL PARA CAMPAÑAS ---
    const campanasQuery = db.collection('campanas').where('estaActiva', '==', true);
    unsubscribeCampanas = campanasQuery.onSnapshot(snapshot => {
        campanasData = snapshot.docs.map(doc => doc.data());
        console.log("Campañas actualizadas en tiempo real:", campanasData.length);
        renderizarPantallaPrincipal(); // Re-renderizamos con las nuevas campañas
    }, error => {
        console.error("Error escuchando campañas:", error);
    });
    // --- FIN: LISTENER EN TIEMPO REAL PARA CAMPAÑAS ---

    // --- LISTENER EN TIEMPO REAL PARA EL CLIENTE ---
    const clienteQuery = db.collection('clientes').where("authUID", "==", user.uid).limit(1);
    unsubscribeCliente = clienteQuery.onSnapshot(snapshot => {
        if (snapshot.empty) {
            UI.showToast("Error: Tu cuenta no está vinculada a ninguna ficha de cliente.", "error");
            Auth.logout();
            return;
        }
        
        clienteData = snapshot.docs[0].data();
        clienteRef = snapshot.docs[0].ref;
        
        console.log("Datos del cliente actualizados en tiempo real.");
        renderizarPantallaPrincipal(); // Re-renderizamos con los nuevos datos del cliente
        
        Notifications.gestionarPermisoNotificaciones(clienteData); 

    }, (error) => {
        console.error("Error en listener de cliente:", error);
        Auth.logout();
    });
}


// ... (El resto del archivo data.js permanece igual)
export async function acceptTerms() { /* ... */ }
export function getFechaProximoVencimiento(cliente) { /* ... */ }
export function getPuntosEnProximoVencimiento(cliente) { /* ... */ }
