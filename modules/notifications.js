// pwa/modules/notifications.js
import { auth, db, messaging, firebase, isMessagingSupported } from './firebase.js';
import * as UI from './ui.js';

function getClienteDocRefOrNull() {
  return db.collection('clientes').where('authUID', '==', auth.currentUser.uid).limit(1).get()
    .then(snap => snap.empty ? null : snap.docs[0].ref)
    .catch(() => null);
}

// ── Guardar “delivered” en Firestore
async function markDeliveredInInbox(data) {
  if (!data?.id || !auth.currentUser) return;
  try {
    const ref = await getClienteDocRefOrNull();
    if (!ref) return;
    const inboxRef = ref.collection('inbox').doc(data.id);
    await inboxRef.set({
      title: data.title || '',
      body:  data.body  || '',
      url:   data.url   || '/notificaciones',
      tag:   data.tag   || null,
      status: 'delivered',
      deliveredAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (e) {
    console.warn('markDeliveredInInbox error:', e);
  }
}

// ── Guardar “read” en Firestore
async function markReadInInbox(notifId) {
  if (!notifId || !auth.currentUser) return;
  try {
    const ref = await getClienteDocRefOrNull();
    if (!ref) return;
    await ref.collection('inbox').doc(notifId).set({
      status: 'read',
      readAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (e) {
    console.warn('markReadInInbox error:', e);
  }
}

/** UI contador en el 🔔 */
function bumpBellCounter() {
  const el = document.getElementById('notif-counter');
  if (!el) return;
  const val = Number(el.textContent || '0') + 1;
  el.textContent = String(val);
  el.style.display = 'inline-block';
}
export function resetBellCounter() {
  const el = document.getElementById('notif-counter');
  if (!el) return;
  el.textContent = '';
  el.style.display = 'none';
}

/** Mostrar toast en foreground y registrar delivered */
function showToastAndTrack(data) {
  // toast in-app
  UI.showToast(`📢 ${data.title}: ${data.body}`, 'info', 8000);
  // contador 🔔
  bumpBellCounter();
  // delivered
  markDeliveredInInbox(data);
}

/** Foreground listener */
export function listenForInAppMessages() {
  if (!messaging) return;
  messaging.onMessage((payload) => {
    const d = (payload?.data)
      ? { id: payload.data.id, title: payload.data.title, body: payload.data.body, url: payload.data.url, tag: payload.data.tag }
      : (payload?.notification)
      ? { id: payload.data?.id, title: payload.notification.title, body: payload.notification.body, url: payload.fcmOptions?.link }
      : null;

    if (!d) return;
    showToastAndTrack(d);
  });

  // Mensajes del SW (background delivered / click read)
  navigator.serviceWorker?.addEventListener('message', (evt) => {
    const { type, data, notifId } = evt.data || {};
    if (type === 'PUSH_DELIVERED' && data) {
      // app estaba en background: sube contador + delivered
      bumpBellCounter();
      markDeliveredInInbox(data);
    }
    if (type === 'PUSH_READ' && notifId) {
      // usuario clickeó la notificación del sistema
      markReadInInbox(notifId);
      resetBellCounter();
    }
  });
}

/** Gestión de permiso / token (igual que ya tenías) */
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
  if (!isMessagingSupported || !auth.currentUser || !messaging) return;
  try {
    const snap = await db.collection('clientes').where('authUID', '==', auth.currentUser.uid).limit(1).get();
    if (snap.empty) return;
    const clienteRef = snap.docs[0].ref;

    const registration = await navigator.serviceWorker.ready;
    const vapidKey = "BN12Kv7QI7PpxwGfpanJUQ55Uci7KXZmEscTwlE7MIbhI0TzvoXTUOaSSesxFTUbxWsYZUubK00xnLePMm_rtOA";
    const currentToken = await messaging.getToken({ vapidKey, serviceWorkerRegistration: registration });
    if (currentToken) {
      await clienteRef.update({ fcmTokens: firebase.firestore.FieldValue.arrayUnion(currentToken) });
      console.log("Token de notificación guardado/actualizado con éxito.");
    }
  } catch (err) {
    console.error('Error al obtener/guardar token:', err);
  }
}

export function handlePermissionRequest() {
  localStorage.setItem(`notifGestionado_${auth.currentUser.uid}`, 'true');
  document.getElementById('notif-prompt-card').style.display = 'none';
  Notification.requestPermission().then(p => {
    if (p === 'granted') {
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
export function handlePermissionSwitch(e) {
  if (e.target.checked) {
    Notification.requestPermission().then(p => {
      if (p === 'granted') {
        UI.showToast("¡Notificaciones activadas!", "success");
        document.getElementById('notif-card').style.display = 'none';
        obtenerYGuardarToken();
      } else {
        e.target.checked = false;
      }
    });
  }
}
