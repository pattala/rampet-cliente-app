// pwa/modules/auth.js

import { auth, db, firebase } from './firebase.js';
import * as UI from './ui.js';
import { cleanupListener } from './data.js';

export async function login() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const boton = document.getElementById('login-btn');
    if (!email || !password) return UI.showToast("Ingresa tu email y contraseña.", "error");

    boton.disabled = true;
    boton.textContent = 'Ingresando...';
    try {
        await auth.signInWithEmailAndPassword(email, password);
    } catch (error) {
        if (['auth/user-not-found', 'auth/wrong-password', 'auth/invalid-credential'].includes(error.code)) {
            UI.showToast("Email o contraseña incorrectos.", "error");
        } else {
            UI.showToast("Error al iniciar sesión.", "error");
        }
    } finally {
        boton.disabled = false;
        boton.textContent = 'Ingresar';
    }
}

export async function sendPasswordResetFromLogin() {
    const emailInput = document.getElementById('forgot-password-email-input');
    const email = emailInput.value.trim();
    
    if (!email) {
        return UI.showToast("Por favor, ingresa una dirección de email.", "error");
    }
    
    const boton = document.getElementById('send-reset-email-btn');
    boton.disabled = true;
    boton.textContent = 'Enviando...';

    try {
        await auth.sendPasswordResetEmail(email);
        UI.showToast(`Si existe una cuenta para ${email}, recibirás un correo en breve.`, "success", 10000);
        UI.closeForgotPasswordModal();
    } catch (error) {
        UI.showToast("Ocurrió un problema. Verifica el email e inténtalo de nuevo.", "error");
        console.error("Error en sendPasswordResetFromLogin:", error);
    } finally {
        boton.disabled = false;
        boton.textContent = 'Enviar Email de Recuperación';
    }
}

export async function registerNewAccount() {
    const nombre = document.getElementById('register-nombre').value.trim();
    const dni = document.getElementById('register-dni').value.trim();
    const email = document.getElementById('register-email').value.trim().toLowerCase();
    const telefono = document.getElementById('register-telefono').value.trim();
    const fechaNacimiento = document.getElementById('register-fecha-nacimiento').value;
    const password = document.getElementById('register-password').value;
    const termsAccepted = document.getElementById('register-terms').checked;

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

    const boton = document.getElementById('register-btn');
    boton.disabled = true;
    boton.textContent = 'Creando...';
    try {
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        await db.collection('clientes').add({
            authUID: userCredential.user.uid,
            numeroSocio: null,
            nombre, dni, email, telefono, fechaNacimiento,
            fechaInscripcion: new Date().toISOString().split('T')[0],
            puntos: 0, saldoAcumulado: 0, totalGastado: 0,
            historialPuntos: [], historialCanjes: [], fcmTokens: [],
            terminosAceptados: termsAccepted,
            passwordPersonalizada: true
        });
    } catch (error) {
        if (error.code === 'auth/email-already-in-use') {
            UI.showToast("Este email ya ha sido registrado.", "error");
        } else {
            UI.showToast("No se pudo crear la cuenta.", "error");
        }
    } finally {
        boton.disabled = false;
        boton.textContent = 'Crear Cuenta';
    }
}

export async function changePassword() {
    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmNewPassword = document.getElementById('confirm-new-password').value;

    if (!currentPassword || !newPassword || !confirmNewPassword) {
        return UI.showToast("Debes completar todos los campos.", "error");
    }
    if (newPassword.length < 6) {
        return UI.showToast("La nueva contraseña debe tener al menos 6 caracteres.", "error");
    }
    if (newPassword !== confirmNewPassword) {
        return UI.showToast("Las nuevas contraseñas no coinciden.", "error");
    }

    const boton = document.getElementById('save-new-password-btn');
    boton.disabled = true;
    boton.textContent = 'Guardando...';

    try {
        const user = auth.currentUser;
        if (!user) throw new Error("No hay usuario activo.");

        const credential = firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
        await user.reauthenticateWithCredential(credential);

        await user.updatePassword(newPassword);

        UI.showToast("¡Contraseña actualizada con éxito!", "success");
        UI.closeChangePasswordModal();

    } catch (error) {
        if (error.code === 'auth/wrong-password') {
            UI.showToast("La contraseña actual es incorrecta.", "error");
        } else {
            UI.showToast("No se pudo actualizar la contraseña. Inténtalo de nuevo.", "error");
        }
        console.error("Error en changePassword:", error);
    } finally {
        boton.disabled = false;
        boton.textContent = 'Guardar Nueva Contraseña';
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
