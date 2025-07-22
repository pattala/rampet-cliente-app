// modules/notifications.js (PWA)
// Gestiona los permisos y la recepción de notificaciones push.

import { auth, messaging, firebase, isMessagingSupported as supported } from './firebase.js';
import * as UI from './ui.js';

export const isMessagingSupported = supported;

async function obtenerYGuardarToken(clienteRef, clienteData) {
    if (!isMessagingSupported) return;
    try {
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
        console.error('Error al obtener token:', err);
        UI.showToast("No se pudieron activar las notificaciones.", "error");
    }
}

export function gestionarPermisoNotificaciones(clienteRef, clienteData) {
    if (!isMessagingSupported || !auth.currentUser) return;
    const popUpYaMostrado = localStorage.getItem(`popUpPermisoMostrado_${auth.currentUser.uid}`);
    
    if (Notification.permission === 'default' && !popUpYaMostrado) {
        document.getElementById('pre-permiso-overlay').style.display = 'flex';
    }
    
    document.getElementById('notif-card').style.display = 'block';
    const notifSwitch = document.getElementById('notif-switch');
    notifSwitch.checked = Notification.permission === 'granted';

    if (Notification.permission === 'granted') {
        obtenerYGuardarToken(clienteRef, clienteData);
    }
}

export function handlePermissionRequest() {
    localStorage.setItem(`popUpPermisoMostrado_${auth.currentUser.uid}`, 'true');
    document.getElementById('pre-permiso-overlay').style.display = 'none';
    Notification.requestPermission().then(() => gestionarPermisoNotificaciones());
}

export function dismissPermissionRequest() {
    localStorage.setItem(`popUpPermisoMostrado_${auth.currentUser.uid}`, 'true');
    document.getElementById('pre-permiso-overlay').style.display = 'none';
}

export function handlePermissionSwitch(event) {
    if (event.target.checked) {
        Notification.requestPermission().then(permission => {
            if (permission !== 'granted') {
                UI.showToast("Permiso no concedido. Actívalo en la configuración del navegador.", "warning");
                event.target.checked = false;
            } else {
                gestionarPermisoNotificaciones();
            }
        });
    }
}

export function listenForInAppMessages() {
    messaging.onMessage((payload) => {
        const notificacion = payload.notification || payload.data; 
        UI.showToast(`📢 ${notificacion.title}: ${notificacion.body}`, 'info', 10000);
    });
}