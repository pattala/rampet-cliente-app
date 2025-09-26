// modules/auth.js
// (Login, registro con domicilio opcional y consentimientos, cambio de clave, logout)

import { auth, db, firebase } from './firebase.js';
import * as UI from './ui.js';
import { cleanupListener } from './data.js';

function g(id){ return document.getElementById(id); }
function gv(id){ return g(id)?.value?.trim() || ''; }
function gc(id){ return !!g(id)?.checked; }

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

  // addressLine legible
  const seg1 = [calle, numero].filter(Boolean).join(' ');
  const seg2 = [piso, depto].filter(Boolean).join(' ');
  const seg3 = provincia === 'CABA'
    ? [localidad, 'CABA'].filter(Boolean).join(', ')
    : [localidad, partido, provincia].filter(Boolean).join(', ');
  const seg4 = [codigoPostal, pais].filter(Boolean).join(', ');
  const addressLine = [seg1, seg2, seg3, seg4].filter(Boolean).join(' — ');

  // estado del domicilio según completitud
  const filled = [calle, numero, localidad || partido || provincia, pais].some(Boolean);
  const status = filled ? (calle && numero && (localidad || partido) && provincia ? 'COMPLETE' : 'PARTIAL') : 'NONE';

  return {
    status,                  // 'COMPLETE' | 'PARTIAL' | 'NONE'
    addressLine: filled ? addressLine : '—',
    components: {
      calle, numero, piso, depto,
      provincia,
      partido: provincia === 'Buenos Aires' ? partido : '',
      barrio:   provincia === 'CABA' ? localidad : '',
      localidad: provincia === 'CABA' ? '' : localidad,
      codigoPostal,
      pais,
      referencia
    }
  };
}

/**
 * Registro:
 * - Requisitos mínimos (nombre, dni, email, tel, fecha, pass, términos)
 * - Opcional: domicilio si agregás campos en el registro (IDs con prefijo reg-dom-* o dom-*)
 * - Opcional: consentimientos en registro (#register-optin-notifs, #register-optin-geo)
 */
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
  const regOptinGeo    = !!gc('register-optin-geo');

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
      passwordPersonalizada: true,
      config: {
        notifEnabled: regOptinNotifs,
        geoEnabled:   regOptinGeo,
        notifUpdatedAt: new Date().toISOString(),
        geoUpdatedAt:   new Date().toISOString()
      },
      ...(hasAny ? { domicilio: dom } : {})
    };

    // 3) guardar en clientes/{uid}
    await db.collection('clientes').doc(uid).set(baseDoc, { merge: true });

    // 4) pedir N° de socio (no bloqueante)
    fetch('https://rampet-notification-server-three.vercel.app/api/assign-socio-number', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docId: uid })
    }).catch(() => {});

    // 5) flags UX
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



    const clienteDocRef = await db.collection('clientes').add(baseDoc);

    // Avisar a API externa para asignar # de socio
    fetch('https://rampet-notification-server-three.vercel.app/api/assign-socio-number', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docId: clienteDocRef.id })
    }).catch(err => console.error("Fallo al avisar a la API para asignar N° Socio:", err));

    UI.showToast("¡Registro exitoso! Bienvenido/a al Club.", "success");
  catch (error) {
    if (error?.code === 'auth/email-already-in-use') {
      UI.showToast("Este email ya ha sido registrado.", "error");
    } else {
      UI.showToast("No se pudo crear la cuenta.", "error");
    }
  } finally {
    boton.disabled = false; boton.textContent = 'Crear Cuenta';
  }
}

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
    try { UI.closeChangePasswordModal(); } catch {}
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

export async function logout() {
  try {
    cleanupListener();
    await auth.signOut();
  } catch (error) {
    UI.showToast("Error al cerrar sesión.", "error");
  }
}



