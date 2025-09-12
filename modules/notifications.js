// PWA /modules/notifications.js — FCM con VAPID + guardado de token (compat con app.js)
'use strict';

// Requisitos:
// - firebase app/auth/firestore ya cargados por la PWA.
// - SW en /firebase-messaging-sw.js (compat).
// - VAPID pública definida en window.__RAMPET__.VAPID_PUBLIC (index.html).

const VAPID_PUBLIC = (window.__RAMPET__ && window.__RAMPET__.VAPID_PUBLIC) || '';

if (!VAPID_PUBLIC) {
  console.warn('[FCM] Falta window.__RAMPET__.VAPID_PUBLIC en index.html');
}

// ──────────────────────────────────────────────────────────────
// Helpers internos
// ──────────────────────────────────────────────────────────────
async function ensureMessagingCompatLoaded() {
  if (typeof firebase?.messaging === 'function') return;
  await new Promise((ok, err) => {
    const s = document.createElement('script');
    s.src = 'https://www.gstatic.com/firebasejs/9.6.0/firebase-messaging-compat.js';
    s.onload = ok; s.onerror = err;
    document.head.appendChild(s);
  });
}

async function registerSW() {
  if (!('serviceWorker' in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    console.log('✅ SW FCM registrado:', reg.scope || (location.origin + '/'));
    return true;
  } catch (e) {
    console.warn('No se pudo registrar el SW FCM:', e?.message || e);
    return false;
  }
}

async function getClienteDocIdPorUID(uid) {
  const snap = await firebase.firestore()
    .collection('clientes')
    .where('authUID', '==', uid)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].id;
}

async function guardarTokenEnMiDoc(token) {
  const uid = firebase.auth().currentUser?.uid;
  if (!uid) throw new Error('No hay usuario logueado.');

  const clienteId = await getClienteDocIdPorUID(uid);
  if (!clienteId) throw new Error('No encontré tu doc en clientes (authUID).');

  // Reemplazo total para evitar tokens viejos
  await firebase.firestore().collection('clientes')
    .doc(clienteId)
    .set({ fcmTokens: [token] }, { merge: true });

  try { localStorage.setItem('fcmToken', token); } catch {}
  console.log('✅ Token FCM guardado en clientes/' + clienteId);
}

async function pedirPermisoYGestionarToken() {
  // pidir permiso (idealmente por gesto del usuario)
  const status = await Notification.requestPermission();
  if (status !== 'granted') {
    throw new Error('Permiso de notificaciones NO concedido.');
  }

  // asegurar SDK compat
  await ensureMessagingCompatLoaded();

  // eliminar token previo para evitar tokens huérfanos
  try { await firebase.messaging().deleteToken(); } catch {}

  // obtener token con VAPID (OBLIGATORIO en web)
  const tok = await firebase.messaging().getToken({ vapidKey: VAPID_PUBLIC });
  if (!tok) throw new Error('No se pudo obtener token (vacío).');
  console.log('[FCM] token actual:', tok);

  // guardarlo en mi doc
  await guardarTokenEnMiDoc(tok);

  return tok;
}

function pintarBotonPermiso() {
  // Botón flotante para disparar el flujo por gesto de usuario
  const id = '__activar_push_btn__';
  if (document.getElementById(id)) return;

  const btn = document.createElement('button');
  btn.id = id;
  btn.textContent = '🔔 Activar notificaciones';
  Object.assign(btn.style, {
    position: 'fixed', zIndex: 999999, right: '16px', bottom: '16px',
    padding: '12px 16px', borderRadius: '10px', border: 'none',
    boxShadow: '0 2px 8px rgba(0,0,0,.2)', cursor: 'pointer',
    fontSize: '14px', background: '#2e7d32', color: 'white'
  });
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = 'Activando…';
    try {
      await pedirPermisoYGestionarToken();
      alert('✅ Notificaciones activadas. Ya podés recibir push.');
      btn.remove();
    } catch (e) {
      alert('No se pudo activar: ' + (e?.message || e));
      btn.disabled = false;
      btn.textContent = '🔔 Activar notificaciones';
    }
  };
  document.body.appendChild(btn);
}

// ──────────────────────────────────────────────────────────────
// Inicialización principal de notificaciones (para usar desde app.js)
// ──────────────────────────────────────────────────────────────
export async function initFCM() {
  // 1) Registrar SW
  await registerSW();

  // 2) Canal mensajes SW→PWA (opcional: UI en foreground)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (ev) => {
      // { type: "PUSH_DELIVERED" | "PUSH_READ", data: {...} }
      // console.log('[SW→PWA]', ev.data);
    });
  }

  // 3) Estado de permiso y token
  if (!('Notification' in window)) return;
  const perm = Notification.permission;

  if (perm === 'granted') {
    try {
      await ensureMessagingCompatLoaded();
      const cur = await firebase.messaging().getToken({ vapidKey: VAPID_PUBLIC });
      if (cur) {
        await guardarTokenEnMiDoc(cur); // asegura actualizado
        console.log('🔁 Token verificado/actualizado (permiso ya concedido).');
      } else {
        // si no devuelve token, corremos el flujo completo
        await pedirPermisoYGestionarToken();
      }
    } catch (e) {
      console.warn('No se pudo verificar/actualizar token:', e?.message || e);
    }
  } else if (perm === 'default') {
    pintarBotonPermiso(); // muestra CTA para que el usuario lo active
  } else {
    console.log('🔕 El usuario bloqueó las notificaciones en el navegador.');
  }
}

// Tu app.js importa initNotificationsOnce, así que lo exponemos como alias:
export async function initNotificationsOnce() {
  return initFCM();
}

// ──────────────────────────────────────────────────────────────
// Exports esperados por app.js (shims seguros)
// ──────────────────────────────────────────────────────────────
export async function handlePermissionRequest() {
  // Sólo solicita el permiso (sin token). Útil para tu tarjeta de “activar notifs”.
  try {
    if (!('Notification' in window)) return;
    const res = await Notification.requestPermission();
    console.debug('[notifications.js] permission result:', res);
  } catch (e) {
    console.warn('[notifications.js] handlePermissionRequest error:', e?.message || e);
  }
}

export function dismissPermissionRequest() {
  // Oculta la tarjeta de “activar notificaciones” y marca dismiss
  try { localStorage.setItem('notifPermDismissed', 'true'); } catch {}
  const el =
    document.getElementById('notif-permission-card') ||
    document.querySelector('.notif-permission-card') ||
    document.querySelector('[data-role="notif-permission-card"]');
  if (el) el.style.display = 'none';
}

export function handlePermissionSwitch(e) {
  // En este shim sólo reflejamos el estado (ON/OFF) en consola.
  // Si querés, podés enganchar acá lógica adicional de UI.
  console.debug('[notifications.js] handlePermissionSwitch →', e?.target?.checked);
}

export function handleBellClick() {
  // No-op seguro: tu app ya abre el modal INBOX desde app.js
  console.debug('[notifications.js] handleBellClick() shim');
  return Promise.resolve();
}

export async function handleSignOutCleanup() {
  // Limpieza local en logout (si querés, acá también podrías eliminar el token FCM del dispositivo)
  try { localStorage.removeItem('fcmToken'); } catch {}
  console.debug('[notifications.js] handleSignOutCleanup() shim → fcmToken limpiado del localStorage');
}
