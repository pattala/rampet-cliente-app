// PWA /notifications.js — Reemplazo completo (FCM con VAPID + guardado de token)
'use strict';

// Espera que el proyecto ya tenga firebase app/auth/firestore cargados en la PWA
// y que el SW esté en /firebase-messaging-sw.js (compat).
// Requiere window.__RAMPET__.VAPID_PUBLIC

const VAPID_PUBLIC =
  (window.__RAMPET__ && window.__RAMPET__.VAPID_PUBLIC) || '';

if (!VAPID_PUBLIC) {
  console.warn('[FCM] Falta window.__RAMPET__.VAPID_PUBLIC en index.html');
}

async function ensureMessagingCompatLoaded() {
  if (typeof firebase.messaging === 'function') return;
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
    console.log('✅ SW FCM registrado:', reg.scope || location.origin + '/');
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

  // Reemplazo total para evitar basura de tokens viejos
  await firebase.firestore().collection('clientes')
    .doc(clienteId)
    .set({ fcmTokens: [token] }, { merge: true });

  console.log('✅ Token FCM guardado en clientes/' + clienteId);
}

async function pedirPermisoYGestionarToken() {
  // 1) pedir permiso (debe ejecutarse por gesto del usuario idealmente)
  const status = await Notification.requestPermission();
  if (status !== 'granted') {
    throw new Error('Permiso de notificaciones NO concedido.');
  }

  // 2) asegurar SDK compat
  await ensureMessagingCompatLoaded();

  // 3) eliminar token previo (si existiera) para evitar invalid
  try { await firebase.messaging().deleteToken(); } catch (e) { /* no-op */ }

  // 4) obtener token con VAPID (OBLIGATORIO)
  const tok = await firebase.messaging().getToken({ vapidKey: VAPID_PUBLIC });
  if (!tok) throw new Error('No se pudo obtener token (vacío).');
  console.log('[FCM] token actual:', tok);

  // 5) guardar en mi doc
  await guardarTokenEnMiDoc(tok);

  return tok;
}

function pintarBotonPermiso() {
  // Botón flotante para cuando el permiso está en "default"
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

export async function initFCM() {
  // 1) SW
  await registerSW();

  // 2) Canal de mensajes desde el SW (opcional, por si querés UI en foreground)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (ev) => {
      // ev.data = { type: "PUSH_DELIVERED" | "PUSH_READ", data: {...} }
      // Podés hookear UI acá si querés
      // console.log('[SW→PWA]', ev.data);
    });
  }

  // 3) Estado de permiso
  if (!('Notification' in window)) return;
  const perm = Notification.permission;

  if (perm === 'granted') {
    // Si ya tiene permiso, aseguramos SDK y token guardado
    try {
      await ensureMessagingCompatLoaded();
      const cur = await firebase.messaging().getToken({ vapidKey: VAPID_PUBLIC });
      if (cur) {
        await guardarTokenEnMiDoc(cur);
        console.log('🔁 Token verificado/actualizado (permiso ya concedido).');
      } else {
        // Si por algún motivo no hay token, pedimos flujo completo
        await pedirPermisoYGestionarToken();
      }
    } catch (e) {
      console.warn('No se pudo verificar/actualizar token:', e?.message || e);
    }
  } else if (perm === 'default') {
    // Mostrar botón para disparar el flujo por gesto del usuario
    pintarBotonPermiso();
  } else {
    console.log('🔕 El usuario bloqueó las notificaciones en el navegador.');
  }
}

// Oculta la tarjeta/prompt de “activar notificaciones” y marca el dismiss
export function dismissPermissionRequest() {
  try { localStorage.setItem('notifPermDismissed', 'true'); } catch {}
  // Ajustá el selector si tu HTML usa otro id/clase para el card del prompt
  const el = document.getElementById('notif-permission-card') 
          || document.querySelector('.notif-permission-card')
          || document.querySelector('[data-role="notif-permission-card"]');
  if (el) el.style.display = 'none';
}
// ====== COMPAT SHIMS (exports mínimos para que app.js no rompa) ======
// Objetivo: evitar "does not provide an export named ..." sin cambiar tu flujo actual.
// Si más adelante tienes implementaciones reales, podemos reemplazar estos shims.

export function handleBellClick() {
  // No-op seguro: app.js ya abre el modal de inbox por su cuenta.
  try { console.debug('[notifications.js] handleBellClick() shim'); } catch {}
  return Promise.resolve();
}

export async function handlePermissionRequest() {
  // Pide permiso de notificaciones. No genera token aquí a propósito.
  try {
    console.debug('[notifications.js] handlePermissionRequest() shim → requesting permission');
    if (!('Notification' in window)) return;
    const res = await Notification.requestPermission();
    console.debug('[notifications.js] permission result:', res);
  } catch (e) {
    console.warn('[notifications.js] handlePermissionRequest shim error:', e);
  }
}

export function dismissPermissionRequest() {
  // Oculta la tarjeta de “activar notificaciones”
  try { localStorage.setItem('notifPermDismissed', 'true'); } catch {}
  const el =
    document.getElementById('notif-permission-card') ||
    document.querySelector('.notif-permission-card') ||
    document.querySelector('[data-role="notif-permission-card"]');
  if (el) el.style.display = 'none';
  try { console.debug('[notifications.js] dismissPermissionRequest() shim'); } catch {}
}

export function handlePermissionSwitch(e) {
  // Switch ON/OFF (sólo UI en este shim)
  try { console.debug('[notifications.js] handlePermissionSwitch() shim →', e?.target?.checked); } catch {}
}

export async function handleSignOutCleanup() {
  // Limpieza mínima local en logout (no toca Firestore en este shim)
  try {
    localStorage.removeItem('fcmToken');
    console.debug('[notifications.js] handleSignOutCleanup() shim → fcmToken limpiado del localStorage');
  } catch {}
}


