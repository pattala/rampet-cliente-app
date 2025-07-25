// pwa/modules/notifications.js (VERSIÓN CON LIMPIEZA DE TOKENS)

import { auth, db, messaging, firebase, isMessagingSupported } from './firebase.js';
import * as UI from './ui.js';

/**
 * Limpia TODOS los tokens de FCM para el usuario actual en Firestore.
 * Se llama cuando la PWA detecta que los permisos han sido bloqueados.
 */
async function limpiarTokensInvalidos() {
    if (!auth.currentUser) return;
    try {
        const querySnapshot = await db.collection('clientes').where('authUID', '==', auth.currentUser.uid).limit(1).get();
        if (querySnapshot.empty) return;
        const clienteRef = querySnapshot.docs[0].ref;
        
        // Establece el array de tokens a un array vacío.
        await clienteRef.update({ fcmTokens: [] });
        console.log("Tokens de notificación limpiados de Firestore porque el permiso fue denegado.");
    } catch (error) {
        console.error("Error al limpiar tokens inválidos:", error);
    }
}

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
        // ¡NUEVA LÓGICA! Si detectamos que está bloqueado, limpiamos los tokens.
        limpiarTokensInvalidos();
        return;
    }

    if (!popUpYaGestionado) {
        promptCard.style.display = 'block';
    } else {
        switchCard.style.display = 'block';
        document.getElementById('notif-switch').checked = false;
    }
}

// ... (el resto de las funciones: obtenerYGuardarToken, handlePermissionRequest, etc., no cambian)
// ... (pega aquí el resto de las funciones de tu archivo notifications.js)
