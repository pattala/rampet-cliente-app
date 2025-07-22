// modules/auth.js (PWA)
// Gestiona la autenticación de usuarios.

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
        // El listener onAuthStateChanged en app.js se encargará del resto.
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

export async function registerNewAccount() {
    const nombre = document.getElementById('register-nombre').value.trim();
    const dni = document.getElementById('register-dni').value.trim();
    const email = document.getElementById('register-email').value.trim().toLowerCase();
    const telefono = document.getElementById('register-telefono').value.trim();
    const fechaNacimiento = document.getElementById('register-fecha-nacimiento').value;
    const password = document.getElementById('register-password').value;
    const termsAccepted = document.getElementById('register-terms').checked;
    
    if (!nombre || !dni || !email || !password || !fechaNacimiento) return UI.showToast("Completa todos los campos.", "error");
    if (password.length < 6) return UI.showToast("La contraseña debe tener al menos 6 caracteres.", "error");
    if (!termsAccepted) return UI.showToast("Debes aceptar los Términos y Condiciones.", "error");

    const boton = document.getElementById('register-btn');
    boton.disabled = true;
    boton.textContent = 'Creando...';
    try {
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        
        await db.collection('clientes').add({
            authUID: userCredential.user.uid,
            numeroSocio: null, // Pendiente de aprobación
            nombre, dni, email, telefono, fechaNacimiento,
            fechaInscripcion: new Date().toISOString().split('T')[0],
            puntos: 0, saldoAcumulado: 0, totalGastado: 0,
            historialPuntos: [], historialCanjes: [], fcmTokens: [],
            terminosAceptados: false, // El usuario deberá aceptar explícitamente
            passwordPersonalizada: true
        });
        
        UI.showToast("¡Registro exitoso! Tu cuenta está pendiente de aprobación.", "success");
        // El onAuthStateChanged en app.js se encargará de loguearlo.

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

export async function logout() {
    try {
        cleanupListener();
        await auth.signOut();
        // El listener onAuthStateChanged en app.js mostrará la pantalla de login.
    } catch (error) {
        UI.showToast("Error al cerrar sesión.", "error");
    }
}