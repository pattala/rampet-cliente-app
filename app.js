// app.js de la PWA (VERSIÓN CON NUEVO FLUJO, TÉRMINOS Y CORRECCIONES)

// ========== CONFIGURACIÓN DE FIREBASE ==========
const firebaseConfig = {
    apiKey: "AIzaSyAvBw_Cc-t8lfip_FtQ1w_w3DrPDYpxINs",
    authDomain: "sistema-fidelizacion.firebaseapp.com",
    projectId: "sistema-fidelizacion",
    storageBucket: "sistema-fidelizacion.appspot.com",
    messagingSenderId: "357176214962",
    appId: "1:357176214962:web:6c1df9b74ff0f3779490ab"
};

const app = firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
let messaging;
const isMessagingSupported = firebase.messaging.isSupported();
if (isMessagingSupported) {
    messaging = firebase.messaging();
}

// ========== CONSTANTES Y VARIABLES GLOBALES ==========
const API_BASE_URL = "https://rampet-notification-server.vercel.app/api"; // Reemplaza si es necesario
const MI_API_SECRET = 'R@mpet@2024@0112#1974#112'; // Debe coincidir con el del servidor
let clienteData = null; 
let premiosData = [];
let unsubscribeCliente = null;

// ========== FUNCIONES DE AYUDA ==========
function showToast(message, type = 'info', duration = 5000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
}

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
    const screenToShow = document.getElementById(screenId);
    if (screenToShow) screenToShow.classList.add('active');
}

function formatearFecha(isoDateString) {
    if (!isoDateString) return 'N/A';
    const parts = isoDateString.split('T')[0].split('-');
    const fecha = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    if (isNaN(fecha.getTime())) return 'Fecha inválida';
    const dia = String(fecha.getUTCDate()).padStart(2, '0');
    const mes = String(fecha.getUTCMonth() + 1).padStart(2, '0');
    const anio = fecha.getUTCFullYear();
    return `${dia}/${mes}/${anio}`;
}

// ========== LÓGICA DE DATOS Y UI ==========
function listenToClientData(user) {
    showScreen('loading-screen');
    if (unsubscribeCliente) unsubscribeCliente();

    // 1. Intentamos encontrar al cliente por su authUID (el método ideal)
    let clienteQuery = db.collection('clientes').where("authUID", "==", user.uid).limit(1);
    let snapshot = await clienteQuery.get();

    if (snapshot.empty) {
        // 2. Si no se encuentra, es un usuario antiguo. Lo buscamos por email.
        console.warn("No se encontró cliente por authUID. Intentando buscar por email...");
        clienteQuery = db.collection('clientes').where("email", "==", user.email).limit(1);
        snapshot = await clienteQuery.get();

        if (!snapshot.empty) {
            // 3. ¡Lo encontramos! "Reparamos" el documento añadiéndole el authUID.
            const clienteDoc = snapshot.docs[0];
            console.log(`Reparando cliente antiguo: ${clienteDoc.id}`);
            await clienteDoc.ref.update({ authUID: user.uid });
            // Ahora, la escucha en tiempo real funcionará con la nueva consulta.
            clienteQuery = db.collection('clientes').where("authUID", "==", user.uid).limit(1);
        } else {
            // 4. Si no lo encontramos ni por UID ni por email, la cuenta está huérfana.
            showToast("Error crítico: Tu cuenta de acceso no está vinculada a ninguna ficha de cliente.", "error");
            logout();
            return;
        }
    }

function renderMainScreen() {
    if (!clienteData) return;

    document.getElementById('cliente-nombre').textContent = clienteData.nombre.split(' ')[0];
    document.getElementById('cliente-puntos').textContent = clienteData.puntos || 0;

    const termsBanner = document.getElementById('terms-banner');
    termsBanner.style.display = !clienteData.terminosAceptados ? 'block' : 'none';

    // ... (El resto del renderizado de Vencimiento, Historial y Premios se mantiene)
    const puntosPorVencer = getPuntosEnProximoVencimiento(clienteData);
    const fechaVencimiento = getFechaProximoVencimiento(clienteData);
    const vencimientoCard = document.getElementById('vencimiento-card');
    if (puntosPorVencer > 0 && fechaVencimiento) {
        vencimientoCard.style.display = 'block';
        document.getElementById('cliente-puntos-vencimiento').textContent = puntosPorVencer;
        document.getElementById('cliente-fecha-vencimiento').textContent = formatearFecha(fechaVencimiento.toISOString());
    } else {
        vencimientoCard.style.display = 'none';
    }

    const historialLista = document.getElementById('lista-historial');
    historialLista.innerHTML = '';
    if (clienteData.historialPuntos && clienteData.historialPuntos.length > 0) {
        const historialReciente = [...clienteData.historialPuntos].sort((a,b) => new Date(b.fechaObtencion) - new Date(a.fechaObtencion)).slice(0, 5);
        historialReciente.forEach(item => {
            const li = document.createElement('li');
            const puntos = item.puntosObtenidos > 0 ? `+${item.puntosObtenidos}` : item.puntosObtenidos;
            li.innerHTML = `<span>${formatearFecha(item.fechaObtencion)}</span> <strong>${item.origen}</strong> <span class="puntos ${puntos > 0 ? 'ganados':'gastados'}">${puntos} pts</span>`;
            historialLista.appendChild(li);
        });
    } else {
        historialLista.innerHTML = '<li>Aún no tienes movimientos.</li>';
    }

    const premiosLista = document.getElementById('lista-premios-cliente');
    premiosLista.innerHTML = '';
    if (premiosData.length > 0) {
        premiosData.forEach(premio => {
            const li = document.createElement('li');
            const puedeCanjear = clienteData.puntos >= premio.puntos;
            li.className = puedeCanjear ? 'canjeable' : 'no-canjeable';
            li.innerHTML = `<strong>${premio.nombre}</strong> <span class="puntos-premio">${premio.puntos} Puntos</span>`;
            premiosLista.appendChild(li);
        });
        
        if (!clienteData.terminosAceptados) {
            const infoMsg = document.createElement('p');
            infoMsg.className = 'info-message';
            infoMsg.innerHTML = 'Para poder canjear estos premios en la tienda, primero debes <a href="#" id="accept-terms-link-premios">aceptar los Términos y Condiciones</a>.';
            premiosLista.appendChild(infoMsg);
        }

    } else {
        premiosLista.innerHTML = '<li>No hay premios disponibles en este momento.</li>';
    }

    showScreen('main-app-screen');
}

function getFechaProximoVencimiento(cliente) { /* ...código sin cambios... */ }
function getPuntosEnProximoVencimiento(cliente) { /* ...código sin cambios... */ }

// ========== LÓGICA DE ACCESO Y REGISTRO ==========
async function login() {
    // ... (código de la función login sin cambios)
}

async function registerNewAccount() {
    const nombre = document.getElementById('register-nombre').value.trim();
    const dni = document.getElementById('register-dni').value.trim();
    const email = document.getElementById('register-email').value.trim().toLowerCase();
    const telefono = document.getElementById('register-telefono').value.trim();
    const fechaNacimiento = document.getElementById('register-fecha-nacimiento').value;
    const password = document.getElementById('register-password').value;
    const termsAccepted = document.getElementById('register-terms').checked;
    const boton = document.getElementById('register-btn');

    // CORRECCIÓN: Teléfono ahora es obligatorio
    if (!nombre || !dni || !email || !telefono || !fechaNacimiento || !password) {
        return showToast("Por favor, completa todos los campos.", "error");
    }
    if (password.length < 6) { return showToast("La contraseña debe tener al menos 6 caracteres.", "error"); }
    if (!termsAccepted) { return showToast("Debes aceptar los Términos y Condiciones.", "error"); }

    boton.disabled = true;
    boton.textContent = 'Creando cuenta...';

    try {
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        const authUID = userCredential.user.uid;

        // CORRECCIÓN ID: Dejamos que Firestore genere el ID
        const clienteRef = db.collection('clientes').doc(); 
        
        const nuevoCliente = {
            id: clienteRef.id, // Guardamos el ID autogenerado
            authUID,
            nombre,
            dni,
            email,
            telefono,
            fechaNacimiento,
            fechaInscripcion: new Date().toISOString().split('T')[0],
            puntos: 0,
            saldoAcumulado: 0,
            totalGastado: 0,
            ultimaCompra: "",
            historialPuntos: [],
            historialCanjes: [],
            fcmTokens: [],
            terminosAceptados: true,
            passwordPersonalizada: true // Nació con contraseña personal
        };
        
        await clienteRef.set(nuevoCliente);

        // CORRECCIÓN EMAIL BIENVENIDA: Enviamos el email tras el registro
        showToast("Enviando email de bienvenida...", "info");
        await fetch(`${API_BASE_URL}/send-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MI_API_SECRET}` },
            body: JSON.stringify({
                to: email,
                templateId: 'bienvenida',
                templateData: {
                    nombre: nombre.split(' ')[0],
                    id_cliente: nuevoCliente.id
                }
            }),
        });

    } catch (error) {
        if (error.code === 'auth/email-already-in-use') {
            showToast("Este email ya ha sido registrado.", "error");
        } else {
            showToast("No se pudo crear la cuenta. Inténtalo de nuevo.", "error");
        }
        console.error("Error en registro:", error);
    } finally {
        boton.disabled = false;
        boton.textContent = 'Crear Cuenta';
    }
}

async function logout() {
    // ... (código de la función logout sin cambios)
}

// ========== LÓGICA DE TÉRMINOS Y CONDICIONES ==========
function openTermsModal() { /* ...código sin cambios... */ }
function closeTermsModal() { /* ...código sin cambios... */ }
async function acceptTerms() { /* ...código sin cambios... */ }

// ========== LÓGICA DE NOTIFICACIONES ==========
async function obtenerYGuardarToken() {
    if (!isMessagingSupported || !messaging || !clienteData || !clienteData.id) return;
    try {
        const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        await navigator.serviceWorker.ready;
        const vapidKey = "BN12Kv7QI7PpxwGfpanJUQ55Uci7KXZmEscTwlE7MIbhI0TzvoXTUOaSSesxFTUbxWsYZUubK00xnLePMm_rtOA";
        const currentToken = await messaging.getToken({ vapidKey, serviceWorkerRegistration: registration });
        if (currentToken) {
            const tokensEnDb = clienteData.fcmTokens || [];
            if (!tokensEnDb.includes(currentToken)) {
                const clienteDocRef = db.collection('clientes').doc(clienteData.id);
                await clienteDocRef.update({ fcmTokens: firebase.firestore.FieldValue.arrayUnion(currentToken) });
                showToast("¡Notificaciones activadas!", "success");
            }
        } else {
            showToast("No se pudo obtener el token. Por favor, concede el permiso.", "warning");
        }
    } catch (err) {
        console.error('Error en obtenerYGuardarToken:', err);
        showToast("No se pudieron activar las notificaciones.", "error");
    }
}

function gestionarPermisoNotificaciones() {
    if (!isMessagingSupported || !auth.currentUser) return;
    
    // Mostramos la tarjeta de configuración de notificaciones para que el usuario pueda interactuar con ella
    const notifCard = document.getElementById('notif-card');
    notifCard.style.display = 'block';

    const notifSwitch = document.getElementById('notif-switch');
    if (Notification.permission === 'granted') {
        notifSwitch.checked = true;
        obtenerYGuardarToken();
    } else {
        notifSwitch.checked = false;
    }
}

// ========== PUNTO DE ENTRADA Y EVENT LISTENERS ==========
function main() {
    // ... (El resto de la función `main` se mantiene igual que en la versión anterior que te pasé)
    document.getElementById('show-register-link').addEventListener('click', (e) => { e.preventDefault(); showScreen('register-screen'); });
    document.getElementById('show-login-link').addEventListener('click', (e) => { e.preventDefault(); showScreen('login-screen'); });
    document.getElementById('login-btn').addEventListener('click', login);
    document.getElementById('register-btn').addEventListener('click', registerNewAccount);
    document.getElementById('logout-btn').addEventListener('click', logout);
    document.getElementById('show-terms-link').addEventListener('click', (e) => { e.preventDefault(); openTermsModal(); });
    document.getElementById('show-terms-link-banner').addEventListener('click', (e) => { e.preventDefault(); openTermsModal(); });
    document.getElementById('close-terms-modal').addEventListener('click', closeTermsModal);
    document.getElementById('accept-terms-btn-modal').addEventListener('click', acceptTerms);
    document.getElementById('premios-container').addEventListener('click', (e) => {
        if (e.target.id === 'accept-terms-link-premios') {
            e.preventDefault();
            openTermsModal();
        }
    });

    if (isMessagingSupported) {
        // Switch para activar/desactivar notificaciones
        document.getElementById('notif-switch').addEventListener('change', (event) => {
            if (event.target.checked) {
                Notification.requestPermission().then(permission => {
                    if (permission === 'granted') {
                        obtenerYGuardarToken();
                    } else {
                        showToast("Permiso de notificaciones no concedido.", "warning");
                        event.target.checked = false;
                    }
                });
            }
            // NOTA: No implementamos la lógica para "desactivar" (quitar token),
            // ya que es más complejo y generalmente no es necesario.
        });
        
        // Listener para mensajes con la app en primer plano
        messaging.onMessage((payload) => {
            const notificacion = payload.data || payload.notification; 
            showToast(`📢 ${notificacion.title}: ${notificacion.body}`, 'info', 10000);
        });
    }

    auth.onAuthStateChanged(user => {
        if (user) {
            listenToClientData(user);
        } else {
            if (unsubscribeCliente) unsubscribeCliente();
            clienteData = null;
            premiosData = [];
            showScreen('login-screen');
        }
    });
}

document.addEventListener('DOMContentLoaded', main);
