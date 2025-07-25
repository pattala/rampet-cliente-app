// pwa/modules/notifications.js (VERSIÓN FINAL)

import { auth, db, messaging, firebase } from './firebase.js';
import * as UI from './ui.js';

export function gestionarPermisoNotificaciones(clienteData) {
    // La comprobación de compatibilidad ya se hizo en app.js, así que esta función
    // solo se llama si las notificaciones son compatibles.
    document.getElementById('notif-card').style.display = 'block';
    const notifSwitch = document.getElementById('notif-switch');
    notifSwitch.checked = Notification.permission === 'granted';

    const popUpYaGestionado = localStorage.getItem(`notifGestionado_${auth.currentUser.uid}`);
    const esUsuarioNuevo = clienteData.numeroSocio === null;

    if (Notification.permission === 'default' && esUsuarioNuevo && !popUpYaGestionado) {
        document.getElementById('pre-permiso-overlay').style.display = 'flex';
    }
}

async function obtenerYGuardarToken() {
    if (!auth.currentUser) return;
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

export function listenForInAppMessages() {
    if (messaging) {
        messaging.onMessage((payload) => {
            const notificacion = payload.notification || payload.data; 
            UI.showToast(`📢 ${notificacion.title}: ${notificacion.body}`, 'info', 10000);
        });
    }
}
