// pwa/modules/notifications.js (VERSIÓN CORREGIDA)

import { auth, messaging, firebase, isMessagingSupported as supported } from './firebase.js';
import * as UI from './ui.js';

export const isMessagingSupported = supported;

async function obtenerYGuardarToken() {
    if (!isMessagingSupported || !auth.currentUser) return;

    try {
        // Obtenemos la referencia al documento del cliente recién creado
        const querySnapshot = await db.collection('clientes').where('authUID', '==', auth.currentUser.uid).limit(1).get();
        if (querySnapshot.empty) return;
        const clienteRef = querySnapshot.docs[0].ref;
        const clienteData = querySnapshot.docs[0].data();

        const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        await navigator.serviceWorker.ready;
        const vapidKey = "BN12Kv7QI7PpxwGfpanJUQ55Uci7KXZmEscTwlE7MIbhI0TzvoXTUOaSSesxFTUbxWsYZUubK00xnLePMm_rtOA";
        const currentToken = await messaging.getToken({ vapidKey, serviceWorkerRegistration: registration });
        
        if (currentToken) {
            const tokensEnDb = clienteData.fcmTokens || [];
            if (!tokensEnDb.includes(currentToken)) {
                await clienteRef.update({ fcmTokens: firebase.firestore.FieldValue.arrayUnion(currentToken) });
                UI.showToast("¡Notificaciones activadas!", "success");
            }
        }
    } catch (err) {
        console.error('Error al obtener y guardar token:', err);
        UI.showToast("No se pudieron activar las notificaciones.", "error");
    }
}

/**
 * Muestra el pop-up de pre-permiso para solicitar la activación de notificaciones.
 * Esta función ahora se llama explícitamente después del registro.
 */
export function solicitarPermisoNotificaciones() {
    if (!isMessagingSupported) return;
    
    // Solo mostramos el pop-up si el permiso aún no ha sido concedido o denegado.
    if (Notification.permission === 'default') {
        document.getElementById('pre-permiso-overlay').style.display = 'flex';
    }
}

export function handlePermissionRequest() {
    document.getElementById('pre-permiso-overlay').style.display = 'none';
    Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
            obtenerYGuardarToken();
        }
    });
}

export function dismissPermissionRequest() {
    document.getElementById('pre-permiso-overlay').style.display = 'none';
}

export function listenForInAppMessages() {
    if (!isMessagingSupported) return;
    messaging.onMessage((payload) => {
        const notificacion = payload.notification || payload.data; 
        UI.showToast(`📢 ${notificacion.title}: ${notificacion.body}`, 'info', 10000);
    });
}
