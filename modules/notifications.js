// /modules/notifications.js — FCM + VAPID + token + foreground banner
'use strict';

// Requisitos: firebase app/auth/firestore ya cargados.
// SW: /firebase-messaging-sw.js
// VAPID pública: window.__RAMPET__.VAPID_PUBLIC

const VAPID_PUBLIC = (window.__RAMPET__ && window.__RAMPET__.VAPID_PUBLIC) || '';
if (!VAPID_PUBLIC) console.warn('[FCM] Falta window.__RAMPET__.VAPID_PUBLIC en index.html');

// ───────────────── helpers ─────────────────
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
    // evita doble registro si ya existe
    const existing = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
    if (existing) {
      console.log('✅ SW FCM ya registrado:', existing.scope);
      return true;
    }
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
  return snap.empty ? null : snap.docs[0].id;
}

async function guardarTokenEnMiDoc(token) {
  const uid = firebase.auth().currentUser?.uid;
  if (!uid) throw new Error('No hay usuario logueado.');
  const clienteId = await getClienteDocIdPorUID(uid);
  if (!clienteId) throw new Error('No encontré tu doc en clientes (authUID).');

  await firebase.firestore().collection('clientes')
    .doc(clienteId)
    .set({ fcmTokens: [token] }, { merge: true });

  try { localStorage.setItem('fcmToken', token); } catch {}
  console.log('✅ Token FCM guardado en clientes/' + clienteId);
}

async function pedirPermisoYGestionarToken() {
  const status = await Notification.requestPermission();
  if (status !== 'granted') throw new Error('Permiso de notificaciones NO concedido.');

  await ensureMessagingCompatLoaded();
  // Limpieza suave: si existe y el browser lo permite
  try { await firebase.messaging().deleteToken(); } catch {}

  const tok = await firebase.messaging().getToken({ vapidKey: VAPID_PUBLIC });
  if (!tok) throw new Error('No se pudo obtener token (vacío).');
  console.log('[FCM] token actual:', tok);
  await guardarTokenEnMiDoc(tok);
  return tok;
}

function pintarBotonPermiso() {
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
    btn.disabled = true; btn.textContent = 'Activando…';
    try {
      await pedirPermisoYGestionarToken();
      alert('✅ Notificaciones activadas. Ya podés recibir push.');
      btn.remove();
    } catch (e) {
      alert('No se pudo activar: ' + (e?.message || e));
      btn.disabled = false; btn.textContent = '🔔 Activar notificaciones';
    }
  };
  document.body.appendChild(btn);
}

// ───────────── init principal (llamado desde app.js) ─────────────
export async function initFCM() {
  await registerSW();

  // Canal SW→PWA (si querés enganchar UI adicional, hacelo en app.js)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (ev) => {
      // { type: "PUSH_DELIVERED" | "PUSH_READ", data: {...} }
    });
  }

  if (!('Notification' in window)) return;
  const perm = Notification.permission;

  if (perm === 'granted') {
    try {
      await ensureMessagingCompatLoaded();

      // Foreground: mostrar banner también cuando la app está visible
      try {
        const messaging = firebase.messaging();
        messaging.onMessage(async (payload) => {
          const d = payload?.data || {};
          try {
            const reg = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js')
                      || await navigator.serviceWorker.getRegistration();
            if (reg?.showNotification) {
              await reg.showNotification(d.title || 'RAMPET', {
                body: d.body || '',
                icon: d.icon || 'https://rampet.vercel.app/images/mi_logo_192.png',
                tag: d.tag || d.id || 'rampet-fg',
                renotify: false,
                data: { id: d.id || null, url: d.url || d.click_action || '/notificaciones', via: 'page' }
              });
            }
          } catch (e) {
            console.warn('[onMessage] showNotification error', e?.message || e);
          }
          // Simular evento para la UI (campana/badge)
          try { window.postMessage({ type: 'PUSH_DELIVERED', data: d }, '*'); } catch {}
        });
      } catch (e) {
        console.warn('[notifications] onMessage hook error', e?.message || e);
      }

      // Asegurar/actualizar token
      const cur = await firebase.messaging().getToken({ vapidKey: VAPID_PUBLIC });
      if (cur) {
        await guardarTokenEnMiDoc(cur);
        console.log('🔁 Token verificado/actualizado (permiso ya concedido).');
      } else {
        await pedirPermisoYGestionarToken();
      }
    } catch (e) {
      console.warn('No se pudo verificar/actualizar token:', e?.message || e);
    }
  } else if (perm === 'default') {
    pintarBotonPermiso();
  } else {
    console.log('🔕 El usuario bloqueó las notificaciones en el navegador.');
  }
}

// Alias para tu import original
export async function initNotificationsOnce() { return initFCM(); }

// ───────────── shims usados por la UI ─────────────
export async function handlePermissionRequest() {
  try {
    if (!('Notification' in window)) return;
    const res = await Notification.requestPermission();
    console.debug('[notifications.js] permission result:', res);
  } catch (e) {
    console.warn('[notifications.js] handlePermissionRequest error:', e?.message || e);
  }
}
export function dismissPermissionRequest() {
  try { localStorage.setItem('notifPermDismissed', 'true'); } catch {}
  const el =
    document.getElementById('notif-permission-card') ||
    document.querySelector('.notif-permission-card') ||
    document.querySelector('[data-role="notif-permission-card"]');
  if (el) el.style.display = 'none';
}
export function handlePermissionSwitch(e) {
  console.debug('[notifications.js] handlePermissionSwitch →', e?.target?.checked);
}
export function handleBellClick() {
  console.debug('[notifications.js] handleBellClick() shim');
  return Promise.resolve();
}
export async function handleSignOutCleanup() {
  try { localStorage.removeItem('fcmToken'); } catch {}
  console.debug('[notifications.js] handleSignOutCleanup() shim → fcmToken limpiado del localStorage');
}
export async function gestionarPermisoNotificaciones() {
  try { await handlePermissionRequest(); }
  catch (e) { console.warn('[notifications.js] gestionarPermisoNotificaciones error:', e?.message || e); }
}
