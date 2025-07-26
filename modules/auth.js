// pwa/modules/auth.js (VERSIÓN CORREGIDA)

import { auth, db } from './firebase.js';
import * as UI from './ui.js';
import * as Notifications from './notifications.js'; // Importamos el módulo de notificaciones
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
    // --- 1. Recolección de datos (sin cambios) ---
    const nombre = document.getElementById('register-nombre').value.trim();
    const dni = document.getElementById('register-dni').value.trim();
    const email = document.getElementById('register-email').value.trim().toLowerCase();
    const telefono = document.getElementById('register-telefono').value.trim();
    const fechaNacimiento = document.getElementById('register-fecha-nacimiento').value;
    const password = document.getElementById('register-password').value;
    const termsAccepted = document.getElementById('register-terms').checked;

    // --- 2. Bloque de Validaciones Mejorado ---

    // Validación de campos obligatorios (existente)
    if (!nombre || !dni || !email || !password || !fechaNacimiento) {
        return UI.showToast("Completa todos los campos obligatorios.", "error");
    }

    // NUEVA VALIDACIÓN: Formato del DNI
    if (!/^[0-9]+$/.test(dni) || dni.length < 6) {
        return UI.showToast("El DNI debe tener al menos 6 números y no debe contener letras ni símbolos.", "error");
    }

    // NUEVA VALIDACIÓN: Formato de Email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return UI.showToast("Por favor, ingresa una dirección de email válida.", "error");
    }
    
    // NUEVA VALIDACIÓN: Formato de Teléfono (opcional pero si existe se valida)
    if (telefono && (!/^[0-9]+$/.test(telefono) || telefono.length < 10)) {
        return UI.showToast("El teléfono debe contener solo números y tener al menos 10 dígitos (con código de área).", "error");
    }

    // Validación de contraseña (existente)
    if (password.length < 6) {
        return UI.showToast("La contraseña debe tener al menos 6 caracteres.", "error");
    }

    // Validación de términos (existente)
    if (!termsAccepted) {
        return UI.showToast("Debes aceptar los Términos y Condiciones.", "error");
    }

    // --- 3. Lógica de Registro (sin cambios) ---
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

export async function logout() {
    try {
        cleanupListener();
        await auth.signOut();
        // El listener onAuthStateChanged en app.js mostrará la pantalla de login.
    } catch (error) {
        UI.showToast("Error al cerrar sesión.", "error");
    }
}
