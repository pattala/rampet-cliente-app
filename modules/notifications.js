// pwa/modules/notifications.js (CON TRIGGER PARA INSTALACIÓN)

import { auth, db, messaging, firebase, isMessagingSupported } from './firebase.js';
import * as UI from './ui.js';
// Importamos la función que nos dice si la app se puede instalar.
import { isInstallable } from '../app.js';

/**
 * Muestra el banner de instalación si está disponible.
 */
function showInstallPromptIfAvailable() {
    if (isInstallable()) {
        const installCard = document.getElementById('install-prompt-card');
        if (installCard) {
            installCard.style.display = 'block';
        }
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
            document.getElementById('notif-card').style.display = 'block';
            document.getElementById('notif-switch').checked = false;
        }
        // == LÍNEA AÑADIDA: Mostramos el prompt de instalación después de la decisión. ==
        showInstallPromptIfAvailable();
    });
}

export function dismissPermissionRequest() {
    localStorage.setItem(`notifGestionado_${auth.currentUser.uid}`, 'true');
    document.getElementById('notif-prompt-card').style.display = 'none';
    document.getElementById('notif-card').style.display = 'block';
    document.getElementById('notif-switch').checked = false;
    // == LÍNEA AÑADIDA: Mostramos el prompt de instalación también si lo pospone. ==
    showInstallPromptIfAvailable();
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
