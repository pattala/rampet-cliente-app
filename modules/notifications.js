// pwa/modules/notifications.js (LÓGICA FINAL Y COMPLETA)

import { auth, db, messaging, firebase, isMessagingSupported } from './firebase.js';
import * as UI from './ui.js';

export function gestionarPermisoNotificaciones() {
    if (!isMessagingSupported || !auth.currentUser) return;

    const promptCard = document.getElementById('notif-prompt-card');
    const switchCard = document.getElementById('notif-card');
    const blockedWarning = document.getElementById('notif-blocked-warning');
    const popUpYaGestionado = localStorage.getItem(`notifGestionado_${auth.currentUser.uid}`);

    // Ocultamos todos los paneles por defecto
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

    // CASO 2: El permiso está en 'default' (aún no ha decidido).
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
    // ... (Esta función no necesita cambios)
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
    // ... (Esta función no necesita cambios)
}
