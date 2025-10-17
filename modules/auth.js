// modules/auth.js
// (Login, registro con domicilio opcional y consentimientos, cambio de clave, logout)

import { auth, db, firebase } from './firebase.js';
import * as UI from './ui.js';
import { cleanupListener } from './data.js';

function g(id){ return document.getElementById(id); }
function gv(id){ return g(id)?.value?.trim() || ''; }
function gc(id){ return !!g(id)?.checked; }

// ──────────────────────────────────────────────────────────────
// CONFIG NOTIF SERVER (toma de window.__RAMPET__ si existe)
// ──────────────────────────────────────────────────────────────
const NOTIF_BASE = (window.__RAMPET__ && window.__RAMPET__.NOTIF_BASE)
  || 'https://rampet-notification-server-three.vercel.app';
const API_KEY = (window.__RAMPET__ && window.__RAMPET__.API_KEY)
  || 'Felipe01';

/* ─────────────────────────────────────────────────────────────
   ASIGNACIÓN LOCAL DE N° DE SOCIO (sin API, vía transacción)
   - Usa/crea counters/socios { last: <n> }
   - Si el cliente ya tiene numeroSocio, no hace nada
   - Atómico → sin duplicados en alta concurrente
   ──────────────────────────────────────────────────────────── */
async function assignSocioNumberLocally(uid) {
  const counterRef = db.collection('counters').doc('socios');
  const clienteRef = db.collection('clientes').doc(uid);

  return db.runTransaction(async (tx) => {
    const cliSnap = await tx.get(clienteRef);
    const ya = cliSnap.exists ? (cliSnap.data()?.numeroSocio ?? null) : null;
    if (ya !== null && !Number.isNaN(ya)) return ya;

    const cSnap = await tx.get(counterRef);
    const last = (cSnap.exists ? (cSnap.data()?.last ?? 0) : 0) | 0;
    const next = last + 1;

    tx.set(counterRef, { last: next }, { merge: true });
    tx.set(clienteRef, { numeroSocio: next }, { merge: true });
    return next;
  });
}

// ──────────────────────────────────────────────────────────────
// LOGIN
// ──────────────────────────────────────────────────────────────
export async function login() {
  const email = gv('login-email').toLowerCase();
  const password = gv('login-password');
  const boton = g('login-btn');
  if (!email || !password) return UI.showToast("Ingresa tu email y contraseña.", "error");

  boton.disabled = true; boton.textContent = 'Ingresando...';
  try {
    await auth.signInWithEmailAndPassword(email, password);
    // onAuthStateChanged en app.js continúa el flujo
  } catch (error) {
    if (['auth/user-not-found','auth/wrong-password','auth/invalid-credential'].includes(error.code)) {
      UI.showToast("Email o contraseña incorrectos.", "error");
    } else {
      UI.showToast("Error al iniciar sesión.", "error");
    }
  } finally {
    boton.disabled = false; boton.textContent = 'Ingresar';
  }
}

// ──────────────────────────────────────────────────────────────
export async function sendPasswordResetFromLogin() {
  const email = prompt("Por favor, ingresa tu dirección de email para enviarte el enlace de recuperación:");
  if (!email) return;
  try {
    await auth.sendPasswordResetEmail(email);
    UI.showToast(`Si existe una cuenta para ${email}, recibirás un correo en breve.`, "success", 10000);
  } catch (error) {
    UI.showToast("Ocurrió un problema al enviar el correo. Inténtalo de nuevo.", "error");
    console.error("Error en sendPasswordResetFromLogin:", error);
  }
}

// ──────────────────────────────────────────────────────────────
// Construcción de DOMICILIO desde el formulario de registro
// ──────────────────────────────────────────────────────────────
function collectSignupAddress() {
  const get = (id) => document.getElementById(id)?.value?.trim() || '';

  const calle       = get('reg-calle');
  const numero      = get('reg-numero');
  const piso        = get('reg-piso');
  const depto       = get('reg-depto');
  const provincia   = get('reg-provincia');
  const partido     = get('reg-partido');   // para BA
  const localidad   = get('reg-localidad'); // barrio/localidad
  const codigoPostal= get('reg-cp');
  const pais        = get('reg-pais') || 'Argentina';
  const referencia  = get('reg-referencia');

  const seg1 = [calle, numero].filter(Boolean).join(' ');
  const seg2 = [piso, depto].filter(Boolean).join(' ');
  const seg3 = provincia === 'CABA'
    ? [localidad, 'CABA'].filter(Boolean).join(', ')
    : [localidad, partido, provincia].filter(Boolean).join(', ');
  const seg4 = [codigoPostal, pais].filter(Boolean).join(', ');
  const addressLine = [seg1, seg2, seg3, seg4].filter(Boolean).join(' — ');

  const filled = [calle, numero, localidad || partido || provincia, pais].some(Boolean);
  const status = filled ? (calle && numero && (localidad || partido) && provincia ? 'COMPLETE' : 'PARTIAL') : 'NONE';

  return {
    status,                  // 'COMPLETE' | 'PARTIAL' | 'NONE'
    addressLine: filled ? addressLine : '—',
    components: {
      calle, numero, piso, depto,
      provincia,
      partido:   provincia === 'Buenos Aires' ? partido : '',
      barrio:    provincia === 'CABA' ? localidad : '',
      localidad: provincia === 'CABA' ? '' : localidad,
      codigoPostal,
      pais,
      referencia
    }
  };
}

// ──────────────────────────────────────────────────────────────
// REGISTRO DE CUENTA
// ──────────────────────────────────────────────────────────────
export async function registerNewAccount() {
  const nombre          = gv('register-nombre');
  const dni             = gv('register-dni');
  const email           = (gv('register-email') || '').toLowerCase();
  const telefono        = gv('register-telefono');
  const fechaNacimiento = gv('register-fecha-nacimiento');
  const password        = gv('register-password');
  const termsAccepted   = gc('register-terms');

  // Validaciones
  if (!nombre || !dni || !email || !password || !fechaNacimiento) {
    return UI.showToast("Completa todos los campos obligatorios.", "error");
  }
  if (!/^[0-9]+$/.test(dni) || dni.length < 6) {
    return UI.showToast("El DNI debe tener al menos 6 números y sin símbolos.", "error");
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return UI.showToast("Ingresa un email válido.", "error");
  }
  if (telefono && (!/^[0-9]+$/.test(telefono) || telefono.length < 10)) {
    return UI.showToast("El teléfono debe tener solo números y al menos 10 dígitos.", "error");
  }
  if (password.length < 6) {
    return UI.showToast("La contraseña debe tener al menos 6 caracteres.", "error");
  }
  if (!termsAccepted) {
    return UI.showToast("Debes aceptar los Términos y Condiciones.", "error");
  }

  // Domicilio del registro
  const dom = collectSignupAddress();
  const hasAny = Object.values(dom.components).some(v => v && String(v).trim() !== "");

  // (Opcional) consentimientos si existen
  const regOptinNotifs = !!gc('register-optin-notifs');
  const regOptinGeo    = !!gc('register-geo');

  const btn = g('register-btn');
  btn.disabled = true; btn.textContent = 'Creando...';

  try {
    // 1) crear usuario
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    const uid  = cred.user.uid;

    // 2) documento base
    const baseDoc = {
      authUID: uid,
      numeroSocio: null,
      nombre, dni, email, telefono, fechaNacimiento,
      fechaInscripcion: new Date().toISOString(),
      puntos: 0, saldoAcumulado: 0, totalGastado: 0,
      historialPuntos: [], historialCanjes: [],
      fcmTokens: [],
      terminosAceptados: true,
      terminosAceptadosAt: new Date().toISOString(),
      passwordPersonalizada: true,
      config: {
        notifEnabled: regOptinNotifs,
        geoEnabled:   regOptinGeo,
        notifUpdatedAt: new Date().toISOString(),
        geoUpdatedAt:   new Date().toISOString()
      },
      ...(hasAny ? { domicilio: dom } : {}),
      // Origen para el Panel
      source: 'pwa',
      creadoDesde: 'pwa',
      metadata: {
        createdFrom: 'pwa',
        sourceVersion: 'pwa@1.0.0'
      },
      tyc: {
        acceptedAt: new Date().toISOString(),
        version: null,
        url: null,
        source: 'pwa'
      }
    };

    // 3) guardar en clientes/{uid}
    await db.collection('clientes').doc(uid).set(baseDoc, { merge: true });

    // 3.b) asignación local inmediata (sin API, transacción)
    try {
      const n = await assignSocioNumberLocally(uid);
      console.log('[PWA] numeroSocio asignado localmente =', n);
    } catch (e) {
      console.warn('[PWA] no se pudo asignar localmente el numeroSocio:', e);
    }

    // 4) (opcional) intentar API — si CORS falla, no rompe el alta
    try {
      const r = await fetch(`${NOTIF_BASE}/api/assign-socio-number`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY
        },
        body: JSON.stringify({ docId: uid, sendWelcome: false })
      });

      const j = await r.json().catch(() => ({}));
      console.log('[assign-socio-number][PWA]', r.status, j);

      if (r.ok && (j?.numeroSocio ?? null) !== null) {
        try {
          await db.collection('clientes').doc(uid).set(
            { numeroSocio: j.numeroSocio },
            { merge: true }
          );
        } catch (e) {
          console.warn('[assign-socio-number][PWA] no pude reflejar numeroSocio en merge local:', e);
        }
      }
    } catch (err) {
      // CORS u otros errores: ignoramos, ya asignamos localmente
      console.warn('[assign-socio-number][PWA] API no disponible:', err);
    }

    // 5) UX flags locales
    try { localStorage.setItem('justSignedUp', '1'); } catch {}
    try { localStorage.setItem('addressProvidedAtSignup', hasAny ? '1' : '0'); } catch {}

    UI.showToast("¡Registro exitoso! Bienvenido/a al Club.", "success");
  } catch (error) {
    console.error('registerNewAccount error:', error?.code || error);
    if (error?.code === 'auth/email-already-in-use') {
      UI.showToast("Este email ya está registrado.", "error");
    } else {
      UI.showToast("No se pudo crear la cuenta.", "error");
    }
  } finally {
    btn.disabled = false; btn.textContent = 'Crear Cuenta';
  }
}

// ──────────────────────────────────────────────────────────────
// CAMBIAR CONTRASEÑA
// ──────────────────────────────────────────────────────────────
export async function changePassword() {
  const curr  = gv('current-password');
  const pass1 = gv('new-password');
  const pass2 = gv('confirm-new-password');

  if (!pass1 || !pass2) return UI.showToast("Debes completar todos los campos.", "error");
  if (pass1.length < 6)  return UI.showToast("La nueva contraseña debe tener al menos 6 caracteres.", "error");
  if (pass1 !== pass2)   return UI.showToast("Las nuevas contraseñas no coinciden.", "error");

  const boton = document.getElementById('save-new-password-btn') || document.getElementById('save-change-password');
  if (!boton) return;
  boton.disabled = true; const prev = boton.textContent; boton.textContent = 'Guardando...';

  try {
    const user = auth.currentUser;
    if (!user) throw new Error("No hay usuario activo.");

    if (curr) {
      const credential = firebase.auth.EmailAuthProvider.credential(user.email, curr);
      try { await user.reauthenticateWithCredential(credential); } catch {}
    }

    await user.updatePassword(pass1);
    UI.showToast("¡Contraseña actualizada con éxito!", "success");
    try { UI.closeChangePasswordModal?.(); } catch {}
  } catch (error) {
    if (error?.code === 'auth/requires-recent-login') {
      try {
        await firebase.auth().sendPasswordResetEmail(auth.currentUser?.email);
        UI.showToast('Por seguridad te enviamos un e-mail para restablecer la contraseña.', 'info');
      } catch {
        UI.showToast('No pudimos enviar el e-mail de restablecimiento.', 'error');
      }
    } else {
      UI.showToast("No se pudo actualizar la contraseña. Inténtalo de nuevo.", "error");
    }
    console.error("Error en changePassword:", error);
  } finally {
    boton.disabled = false; boton.textContent = prev || 'Guardar';
  }
}

// ──────────────────────────────────────────────────────────────
// LOGOUT
// ──────────────────────────────────────────────────────────────
export async function logout() {
  try {
    cleanupListener?.();
    await auth.signOut();
  } catch (error) {
    UI.showToast("Error al cerrar sesión.", "error");
  }
}

