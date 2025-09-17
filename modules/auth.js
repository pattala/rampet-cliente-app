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

/**
 * Registro:
 * - Requisitos mínimos (nombre, dni, email, tel, fecha, pass, términos)
 * - Opcional: domicilio si agregás campos en el registro (IDs con prefijo reg-dom-* o dom-*)
 * - Opcional: consentimientos en registro (#register-optin-notifs, #register-optin-geo)
 */
export async function registerNewAccount() {
  const nombre = gv('register-nombre');
  const dni = gv('register-dni');
  const email = gv('register-email').toLowerCase();
  const telefono = gv('register-telefono');
  const fechaNacimiento = gv('register-fecha-nacimiento');
  const password = gv('register-password');
  const termsAccepted = gc('register-terms');

  if (!nombre || !dni || !email || !password || !fechaNacimiento) {
    return UI.showToast("Completa todos los campos obligatorios.", "error");
  }
  if (!/^[0-9]+$/.test(dni) || dni.length < 6) {
    return UI.showToast("El DNI debe tener al menos 6 números y no debe contener letras ni símbolos.", "error");
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return UI.showToast("Por favor, ingresa una dirección de email válida.", "error");
  }
  if (telefono && (!/^[0-9]+$/.test(telefono) || telefono.length < 10)) {
    return UI.showToast("El teléfono debe contener solo números y tener al menos 10 dígitos (con código de área).", "error");
  }
  if (password.length < 6) {
    return UI.showToast("La contraseña debe tener al menos 6 caracteres.", "error");
  }
  if (!termsAccepted) {
    return UI.showToast("Debes aceptar los Términos y Condiciones.", "error");
  }

  // Lectura opcional de consentimientos pre-tildados (marketing)
  const regOptinNotifs = gc('register-optin-notifs'); // opcional
  const regOptinGeo    = gc('register-optin-geo');    // opcional

  // Intentar tomar domicilio del registro, si agregaste esos campos
  // Preferencia: IDs con prefijo "reg-dom-", si no existen, usa los "dom-"
  const pick = (a, b) => gv(a) || gv(b);
  const domicilioComponents = {
    calle:        pick('reg-dom-calle','dom-calle'),
    numero:       pick('reg-dom-numero','dom-numero'),
    piso:         pick('reg-dom-piso','dom-piso'),
    depto:        pick('reg-dom-depto','dom-depto'),
    barrio:       pick('reg-dom-barrio','dom-barrio'),
    localidad:    pick('reg-dom-localidad','dom-localidad'),
    partido:      pick('reg-dom-partido','dom-partido'),
    provincia:    pick('reg-dom-provincia','dom-provincia'),
    codigoPostal: pick('reg-dom-cp','dom-cp'),
    pais:         pick('reg-dom-pais','dom-pais') || 'Argentina',
    referencia:   pick('reg-dom-referencia','dom-referencia')
  };
  const hasAnyAddress = Object.entries(domicilioComponents).some(([k,v]) => !!v && k!=='pais');

  const boton = g('register-btn');
  boton.disabled = true; boton.textContent = 'Creando...';

  try {
    const userCredential = await auth.createUserWithEmailAndPassword(email, password);

    // Doc base del cliente
    const baseDoc = {
      authUID: userCredential.user.uid,
      numeroSocio: null,
      nombre, dni, email, telefono, fechaNacimiento,
      fechaInscripcion: new Date().toISOString().split('T')[0],
      puntos: 0, saldoAcumulado: 0, totalGastado: 0,
      historialPuntos: [], historialCanjes: [], fcmTokens: [],
      terminosAceptados: !!termsAccepted,
      passwordPersonalizada: true
    };

    // Config + consentimientos desde registro (opcional)
    baseDoc.config = {
      notifEnabled: !!regOptinNotifs,
      geoEnabled:   !!regOptinGeo,
      notifUpdatedAt: new Date().toISOString(),
      geoUpdatedAt:   new Date().toISOString()
    };

    // Domicilio opcional si se cargó algo
    if (hasAnyAddress) {
      const parts = [];
      if (domicilioComponents.calle) {
        parts.push(domicilioComponents.calle + (domicilioComponents.numero ? ' ' + domicilioComponents.numero : ''));
      }
      const pisoDto = [domicilioComponents.piso, domicilioComponents.depto].filter(Boolean).join(' ');
      if (pisoDto) parts.push(pisoDto);
      if (domicilioComponents.barrio) parts.push(`Barrio ${domicilioComponents.barrio}`);
      if (domicilioComponents.localidad) parts.push(domicilioComponents.localidad);
      if (domicilioComponents.partido) parts.push(domicilioComponents.partido);
      if (domicilioComponents.provincia) parts.push(domicilioComponents.provincia);
      if (domicilioComponents.codigoPostal) parts.push(domicilioComponents.codigoPostal);
      if (domicilioComponents.pais) parts.push(domicilioComponents.pais);

      baseDoc.domicilio = {
        addressLine: parts.filter(Boolean).join(', '),
        components: domicilioComponents,
        geocoded: {
          lat: null, lng: null, geohash7: null,
          provider: null, confidence: null,
          geocodedAt: null, verified: false
        }
      };
    }

    const clienteDocRef = await db.collection('clientes').add(baseDoc);

    // Avisar a API externa para asignar # de socio
    fetch('https://rampet-notification-server-three.vercel.app/api/assign-socio-number', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docId: clienteDocRef.id })
    }).catch(err => console.error("Fallo al avisar a la API para asignar N° Socio:", err));

    UI.showToast("¡Registro exitoso! Bienvenido/a al Club.", "success");
  } catch (error) {
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
