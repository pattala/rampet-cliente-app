// pwa/modules/notifications.js (LÓGICA FINAL Y COMPLETA)

import { auth, db, messaging, firebase, isMessagingSupported } from './firebase.js';
import * as UI from './ui.js';

/**
 * Función principal que gestiona la UI de notificaciones.
 * Decide si mostrar el panel de bienvenida, el switch de control, o la advertencia de bloqueo.
 */
export function gestionarPermisoNotificaciones() {
    if (!isMessagingSupported || !auth.currentUser) return;

    const promptCard = document.getElementById('notif-prompt-card');
    const switchCard = document.getElementById('notif-card');
    const blockedWarning = document.getElementById('notif-blocked-warning');
    const popUpYaGestionado = localStorage.getItem(`notifGestionado_${auth.currentUser.uid}`);

    // Ocultamos todos los paneles por defecto para empezar de cero.
    promptCard.style.display = 'none';
    switchCard.style.display = 'none';
    blockedWarning.style.display = 'none';

    // CASO 1: El usuario ya concedió el permiso. No mostramos nada.
    if (Notification.permission === 'granted') {
        obtenerYGuardarToken(); // Nos aseguramos de tener el token más reciente
        return;
    }

    // CASO 3: El usuario bloqueó las notificaciones en el navegador. Le informamos.
    if (Notification.permission === 'denied') {
        blockedWarning.style.display = 'block';
        return;
    }

    // CASO 2: El permiso es 'default' (aún no ha decidido).
    // Si es la primera vez que ve la opción, mostramos el panel de bienvenida.
    if (!popUpYaGestionado) {
        promptCard.style.display = 'block';
    } else {
        // Si ya interactuó con el panel (ej: 'Quizás más tarde'), mostramos el switch.
        switchCard.style.display = 'block';
        document.getElementById('notif-switch').checked = false;
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

export function handlePermissionRequest() {
    localStorage.setItem(`notifGestionado_${auth.currentUser.uid}`, 'true');
    document.getElementById('notif-prompt-card').style.display = 'none';

    Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
            UI.showToast("¡Notificaciones activadas!", "success");
            obtenerYGuardarToken();
        } else {
            // Si lo deniega, mostramos el switch como opción
            document.getElementById('notif-card').style.display = 'block';
            document.getElementById('notif-switch').checked = false;
        }
    });
}

export function dismissPermissionRequest() {
    localStorage.setItem(`notifGestionado_${auth.currentUser.uid}`, 'true');
    document.getElementById('notif-prompt-card').style.display = 'none';
    // Mostramos el switch como opción para más tarde.
    document.getElementById('notif-card').style.display = 'block';
    document.getElementById('notif-switch').checked = false;
}

export function handlePermissionSwitch(event) {
    if (event.target.checked) {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                UI.showToast("¡Notificaciones activadas!", "success");
                document.getElementById('notif-card').style.display = 'none';
                obtenerYGuardarToken();
            } else {
                event.target.checked = false; // Vuelve a 'off' si no da permiso
            }
        });
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
