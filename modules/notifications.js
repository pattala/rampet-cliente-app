// pwa/modules/notifications.js (VERSIÓN SIMPLIFICADA)

import { auth, db, messaging, firebase, isMessagingSupported } from './firebase.js';
import * as UI from './ui.js';

// Ya no necesitamos la lógica de instalación aquí.

export function gestionarPermisoNotificaciones() {
    if (!isMessagingSupported || !auth.currentUser) return;

    const promptCard = document.getElementById('notif-prompt-card');
    const switchCard = document.getElementById('notif-card');
    const blockedWarning = document.getElementById('notif-blocked-warning');
    const popUpYaGestionado = localStorage.getItem(`notifGestionado_${auth.currentUser.uid}`);

    promptCard.style.display = 'none';
    switchCard.style.display = 'none';
    blockedWarning.style.display = 'none';

    if (Notification.permission === 'granted') {
        obtenerYGuardarToken();
        return;
    }

    if (Notification.permission === 'denied') {
        blockedWarning.style.display = 'block';
        return;
    }

    if (!popUpYaGestionado) {
        promptCard.style.display = 'block';
    } else {
        switchCard.style.display = 'block';
        document.getElementById('notif-switch').checked = false;
    }
}

async function obtenerYGuardarToken() {
    // Añadimos una comprobación extra para asegurarnos de que 'messaging' está disponible
    if (!isMessagingSupported || !auth.currentUser || !messaging) {
        console.warn("Messaging no soportado o no inicializado, no se puede obtener el token.");
        return;
    }
    
    try {
        const querySnapshot = await db.collection('clientes').where('authUID', '==', auth.currentUser.uid).limit(1).get();
        if (querySnapshot.empty) return;
        const clienteRef = querySnapshot.docs[0].ref;

        // --- INICIO DE LA CORRECCIÓN CLAVE ---
        // Nos aseguramos de que el Service Worker esté registrado y completamente activo ANTES de pedir el token.
        // navigator.serviceWorker.ready es una promesa que se resuelve cuando el SW está listo.
        const registration = await navigator.serviceWorker.ready;
        
        const vapidKey = "BN12Kv7QI7PpxwGfpanJUQ55Uci7KXZmEscTwlE7MIbhI0TzvoXTUOaSSesxFTUbxWsYZUubK00xnLePMm_rtOA";
        
        const currentToken = await messaging.getToken({ 
            vapidKey: vapidKey,
            serviceWorkerRegistration: registration // Pasamos el registro activo
        });
        // --- FIN DE LA CORRECCIÓN CLAVE ---
        
        if (currentToken) {
            await clienteRef.update({ fcmTokens: firebase.firestore.FieldValue.arrayUnion(currentToken) });
            console.log("Token de notificación guardado/actualizado con éxito.");
        } else {
            console.warn("No se pudo obtener el token de registro. Esto puede ocurrir si el usuario revocó el permiso.");
        }
    } catch (err) {
        console.error('Error al obtener y guardar token:', err);
        // Si el error es de permisos, mostramos la advertencia de bloqueo.
        if (err.code === 'messaging/permission-blocked' || err.code === 'messaging/permission-default') {
            document.getElementById('notif-blocked-warning').style.display = 'block';
        }
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
            document.getElementById('notif-card').style.display = 'block';
            document.getElementById('notif-switch').checked = false;
        }
    });
}

export function dismissPermissionRequest() {
    localStorage.setItem(`notifGestionado_${auth.currentUser.uid}`, 'true');
    document.getElementById('notif-prompt-card').style.display = 'none';
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
                event.target.checked = false;
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

