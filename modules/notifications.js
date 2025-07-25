// pwa/modules/notifications.js (VERSIÓN FINAL CON DIAGNÓSTICO)

import { auth, db, messaging, firebase, isMessagingSupported as supported } from './firebase.js';
import * as UI from './ui.js';

export const isMessagingSupported = supported;

/**
 * Función principal que decide si se debe solicitar el permiso de notificaciones.
 * @param {object} clienteData Los datos del cliente desde Firestore.
 */
export function gestionarPermisoNotificaciones(clienteData) {
    // --- INICIO DE DIAGNÓSTICO ---
    console.log("--- Chequeo de Notificaciones ---");
    console.log(`¿Navegador compatible? (isMessagingSupported): ${isMessagingSupported}`);
    if (!isMessagingSupported) {
        console.log("-> Fin del chequeo: El navegador no es compatible con Firebase Messaging.");
        return;
    }
    console.log(`¿Usuario autenticado? (auth.currentUser): ${!!auth.currentUser}`);
    console.log(`Estado del permiso (Notification.permission): "${Notification.permission}"`);
    // --- FIN DE DIAGNÓSTICO ---

    // CORRECCIÓN: Hacemos visible la tarjeta del switch
    document.getElementById('notif-card').style.display = 'block';
    const notifSwitch = document.getElementById('notif-switch');
    notifSwitch.checked = Notification.permission === 'granted';

    const popUpYaGestionado = localStorage.getItem(`notifGestionado_${auth.currentUser.uid}`);
    const esUsuarioNuevo = clienteData.numeroSocio === null;

    // --- MÁS DIAGNÓSTICO ---
    console.log(`¿Es usuario nuevo? (numeroSocio === null): ${esUsuarioNuevo}`);
    console.log(`¿Pop-up ya gestionado? (localStorage): ${!!popUpYaGestionado}`);
    
    if (Notification.permission === 'default' && esUsuarioNuevo && !popUpYaGestionado) {
        console.log("-> DECISIÓN: ¡Mostrando pop-up de permiso!");
        document.getElementById('pre-permiso-overlay').style.display = 'flex';
    } else {
        console.log("-> DECISIÓN: No se cumplen las condiciones para mostrar el pop-up.");
    }
    console.log("---------------------------------");
}

async function obtenerYGuardarToken() {
    if (!isMessagingSupported || !auth.currentUser) return;
    try {
        const querySnapshot = await db.collection('clientes').where('authUID', '==', auth.currentUser.uid).limit(1).get();
        if (querySnapshot.empty) return;
        const clienteRef = querySnapshot.docs[0].ref;

        const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        await navigator.serviceWorker.ready;
        const vapidKey = "BN12Kv7QI7PpxwGfpanJUQ55Uci7KXZmEscTwlE7MIbhI0TzvoXTUOaSSesxFTUbxWsYZUubK00xnLePMm_rtOA";
        const currentToken = await messaging.getToken({ vapidKey, serviceWorkerRegistration: registration });
        
        if (currentToken) {
            await clienteRef.update({ fcmTokens: firebase.firestore.FieldValue.arrayUnion(currentToken) });
            UI.showToast("¡Notificaciones activadas!", "success");
        }
    } catch (err) {
        console.error('Error al obtener y guardar token:', err);
        UI.showToast("No se pudieron activar las notificaciones.", "error");
    }
}

// Handlers para los botones del pop-up
export function handlePermissionRequest() {
    localStorage.setItem(`notifGestionado_${auth.currentUser.uid}`, 'true');
    document.getElementById('pre-permiso-overlay').style.display = 'none';
    Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
            document.getElementById('notif-switch').checked = true;
            obtenerYGuardarToken();
        }
    });
}

export function dismissPermissionRequest() {
    localStorage.setItem(`notifGestionado_${auth.currentUser.uid}`, 'true');
    document.getElementById('pre-permiso-overlay').style.display = 'none';
}

// Función para mensajes en la app (no cambia)
export function listenForInAppMessages() {
    if (!isMessagingSupported) return;
    messaging.onMessage((payload) => {
        const notificacion = payload.notification || payload.data; 
        UI.showToast(`📢 ${notificacion.title}: ${notificacion.body}`, 'info', 10000);
    });
}
