// pwa/modules/notifications.js (VERSIÓN FINAL Y ROBUSTA)

import { auth, db, messaging, firebase, isMessagingSupported as supported } from './firebase.js';
import * as UI from './ui.js';

export const isMessagingSupported = supported;

/**
 * Función principal que decide si se debe solicitar el permiso de notificaciones.
 * Se llama cada vez que se cargan los datos del usuario.
 * @param {object} clienteData Los datos del cliente desde Firestore.
 */
export function gestionarPermisoNotificaciones(clienteData) {
    if (!isMessagingSupported || !auth.currentUser) return;

    const popUpYaGestionado = localStorage.getItem(`notifGestionado_${auth.currentUser.uid}`);
    const esUsuarioNuevo = clienteData.numeroSocio === null;

    // Mostramos el pop-up SÓLO SI:
    // 1. El permiso del navegador está en "default" (preguntar).
    // 2. Es un usuario nuevo (sin N° de Socio).
    // 3. No hemos gestionado antes este pop-up para él (flag en localStorage).
    if (Notification.permission === 'default' && esUsuarioNuevo && !popUpYaGestionado) {
        document.getElementById('pre-permiso-overlay').style.display = 'flex';
    }
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
