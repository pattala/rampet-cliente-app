// pwa/modules/notifications.js (LÓGICA FINAL Y COMPLETA)

import { auth, db, messaging, firebase, isMessagingSupported } from './firebase.js';
import * as UI from './ui.js';

export function gestionarPermisoNotificaciones() {
    if (!isMessagingSupported || !auth.currentUser) return;

    const promptCard = document.getElementById('notif-prompt-card');
    const switchCard = document.getElementById('notif-card');
    const notifSwitch = document.getElementById('notif-switch');
    const popUpYaGestionado = localStorage.getItem(`notifGestionado_${auth.currentUser.uid}`);

    // Ocultamos todo por defecto
    promptCard.style.display = 'none';
    switchCard.style.display = 'none';

    // Si el permiso ya fue concedido o denegado por el navegador, no hay nada que mostrar.
    if (Notification.permission === 'granted' || Notification.permission === 'denied') {
        if(Notification.permission === 'granted') obtenerYGuardarToken(); // Nos aseguramos de tener el token
        return;
    }

    // Si el permiso es 'default' (preguntar) y es la primera vez que el usuario ve la opción,
    // mostramos el panel de bienvenida.
    if (Notification.permission === 'default' && !popUpYaGestionado) {
        promptCard.style.display = 'block';
    } else {
        // Si ya interactuó con el panel (ej: 'Quizás más tarde') o es una visita posterior,
        // mostramos el switch como segunda oportunidad.
        switchCard.style.display = 'block';
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

export function handlePermissionRequest() {
    // Marcamos que el usuario ya interactuó para no mostrar el panel de bienvenida de nuevo.
    localStorage.setItem(`notifGestionado_${auth.currentUser.uid}`, 'true');
    document.getElementById('notif-prompt-card').style.display = 'none';

    Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
            UI.showToast("¡Notificaciones activadas!", "success");
            document.getElementById('notif-card').style.display = 'none'; // Ocultamos el switch
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
                event.target.checked = false; // Vuelve a 'off' si el usuario no da permiso
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
