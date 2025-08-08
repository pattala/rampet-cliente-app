// pwa/modules/notifications.js (VERSIÓN FINAL Y ROBUSTA)

import { auth, db, messaging, firebase, isMessagingSupported } from './firebase.js';
import * as UI from './ui.js';

/**
 * Función principal que gestiona la UI de notificaciones.
 */
export function gestionarPermisoNotificaciones() {
    if (!isMessagingSupported || !auth.currentUser) return;

    const promptCard = document.getElementById('notif-prompt-card');
    const switchCard = document.getElementById('notif-card');
    const blockedWarning = document.getElementById('notif-blocked-warning');
    const popUpYaGestionado = localStorage.getItem(`notifGestionado_${auth.currentUser.uid}`);

    // Ocultamos todos los paneles por defecto.
    promptCard.style.display = 'none';
    switchCard.style.display = 'none';
    blockedWarning.style.display = 'none';

    if (Notification.permission === 'granted') {
        obtenerYGuardarToken(); // Nos aseguramos de tener el token.
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

/**
 * Obtiene el token de Firebase Messaging y lo guarda en el documento del cliente.
 * VERSIÓN CORREGIDA: Espera a que el Service Worker esté listo.
 */
async function obtenerYGuardarToken() {
    if (!isMessagingSupported || !auth.currentUser || !messaging) {
        console.warn("Messaging no soportado o no inicializado, no se puede obtener el token.");
        return;
    }
    
    try {
        const querySnapshot = await db.collection('clientes').where('authUID', '==', auth.currentUser.uid).limit(1).get();
        if (querySnapshot.empty) return;
        const clienteRef = querySnapshot.docs[0].ref;

        // --- INICIO DE LA CORRECCIÓN CLAVE ---
        // Esperamos a que el Service Worker esté registrado y completamente activo.
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
            console.warn("No se pudo obtener el token de registro. El usuario puede necesitar re-otorgar permisos.");
        }
    } catch (err) {
        console.error('Error al obtener y guardar token:', err);
        if (err.code === 'messaging/permission-blocked' || err.code === 'messaging/permission-default') {
            document.getElementById('notif-blocked-warning').style.display = 'block';
        }
    }
}

/**
 * Maneja la solicitud de permiso del banner principal.
 */
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

/**
 * Maneja el rechazo del banner principal.
 */
export function dismissPermissionRequest() {
    localStorage.setItem(`notifGestionado_${auth.currentUser.uid}`, 'true');
    document.getElementById('notif-prompt-card').style.display = 'none';
    document.getElementById('notif-card').style.display = 'block';
    document.getElementById('notif-switch').checked = false;
}

/**
 * Maneja el cambio en el switch de notificaciones.
 */
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

/**
 * Escucha mensajes entrantes cuando la PWA está activa en primer plano.
 */
export function listenForInAppMessages() {
    if (messaging) {
        messaging.onMessage((payload) => {
            const notificacion = payload.notification || payload.data; 
            UI.showToast(`📢 ${notificacion.title}: ${notificacion.body}`, 'info', 10000);
        });
    }
}
