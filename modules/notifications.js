// pwa/modules/notifications.js (VERSIÓN FINAL CON LÓGICA DE POP-UP MEJORADA)

import { auth, db, messaging, firebase, isMessagingSupported } from './firebase.js';
import * as UI from './ui.js';

/**
 * Función principal que gestiona la UI de notificaciones.
 * Decide si mostrar el pop-up de bienvenida, el switch de control, o nada.
 */
export function gestionarPermisoNotificaciones() {
    if (!isMessagingSupported || !auth.currentUser) return;

    const notifCard = document.getElementById('notif-card');
    const notifSwitch = document.getElementById('notif-switch');
    const popUpYaGestionado = localStorage.getItem(`notifGestionado_${auth.currentUser.uid}`);

    // Si el permiso ya fue concedido, no mostramos nada. La decisión está tomada.
    if (Notification.permission === 'granted') {
        notifCard.style.display = 'none';
        obtenerYGuardarToken(); // Nos aseguramos de tener el token más reciente
        return;
    }

    // Si el permiso fue denegado, no hay nada que el usuario pueda hacer desde la UI.
    if (Notification.permission === 'denied') {
        notifCard.style.display = 'none';
        return;
    }

    // Si el permiso es 'default' y es la primera vez que entra, mostramos el pop-up.
    if (Notification.permission === 'default' && !popUpYaGestionado) {
        document.getElementById('pre-permiso-overlay').style.display = 'flex';
    } else {
        // Si ya interactuó con el pop-up (ej: click en "Ahora no") o es una visita posterior,
        // mostramos el switch como segunda oportunidad.
        notifCard.style.display = 'block';
        notifSwitch.checked = false;
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
        }
    } catch (err) {
        console.error('Error al obtener y guardar token:', err);
    }
}

// Handlers para los botones del pop-up y el switch
export function handlePermissionRequest() {
    localStorage.setItem(`notifGestionado_${auth.currentUser.uid}`, 'true');
    document.getElementById('pre-permiso-overlay').style.display = 'none';

    Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
            UI.showToast("¡Notificaciones activadas!", "success");
            document.getElementById('notif-card').style.display = 'none';
            obtenerYGuardarToken();
        } else {
            // Si el usuario deniega el permiso desde el navegador, mostramos el switch desactivado.
            document.getElementById('notif-card').style.display = 'block';
            document.getElementById('notif-switch').checked = false;
        }
    });
}

export function dismissPermissionRequest() {
    localStorage.setItem(`notifGestionado_${auth.currentUser.uid}`, 'true');
    document.getElementById('pre-permiso-overlay').style.display = 'none';
    // Mostramos el switch como opción para más tarde.
    document.getElementById('notif-card').style.display = 'block';
    document.getElementById('notif-switch').checked = false;
}

export function handlePermissionSwitch(event) {
    if (event.target.checked) {
        handlePermissionRequest(); // Reutilizamos la misma lógica del pop-up
    }
}

export function listenForInAppMessages() {
    if (messaging) {
        messaging.onMessage((payload) => {
            const notificacion = payload.notification || payload.data; 
            UI.showToast(`📢 ${notificacion.title}: ${notificacion.body}`, 'info', 10000);
        });
    }
}
