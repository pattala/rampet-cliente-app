// app.js de la Aplicación del Cliente (Versión de Verificación Final)

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

let clienteData = null; 

function showToast(message, type = 'info', duration = 5000) {
    const container = document.getElementById('toast-container');
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
    if (parts.length !== 3) return 'Fecha inválida';
    const fecha = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    if (isNaN(fecha.getTime())) return 'Fecha inválida';
    const dia = String(fecha.getUTCDate()).padStart(2, '0');
    const mes = String(fecha.getUTCMonth() + 1).padStart(2, '0');
    const anio = fecha.getUTCFullYear();
    return `${dia}/${mes}/${anio}`;
}

// ========== LÓGICA DE NOTIFICACIONES ==========
function obtenerYGuardarToken() {
    if (!isMessagingSupported || !messaging || !clienteData || !clienteData.id) return;

    const vapidKey = "BN12Kv7QI7PpxwGfpanJUQ55Uci7KXZmEscTwlE7MIbhI0TzvoXTUOaSSesxFTUbxWsYZUubK00xnLePMm_rtOA";
    
    messaging.getToken({ vapidKey })
        .then(currentToken => {
            if (!currentToken) {
                console.warn('No se pudo generar el token de FCM.');
                return;
            }
            const tokensEnDb = clienteData.fcmTokens || [];
            if (!tokensEnDb.includes(currentToken)) {
                console.log("Intentando guardar nuevo token en Firestore...");
                const clienteDocRef = db.collection('clientes').doc(clienteData.id.toString());
                
                // Esta es la operación que está fallando
                return clienteDocRef.update({
                    fcmTokens: firebase.firestore.FieldValue.arrayUnion(currentToken)
                });
            } else {
                console.log("El token ya está registrado.");
            }
        })
        .then(() => {
            console.log("Token guardado con éxito o ya existente.");
        })
        .catch(err => {
            console.error('ERROR AL OBTENER O GUARDAR EL TOKEN:', err);
            // Si el error es de permisos, se mostrará aquí en la consola.
            if(err.code === 'permission-denied'){
                showToast("Error: No tienes permiso para actualizar los datos.", "error");
            }
        });
}

function gestionarPermisoNotificaciones() {
    // ... (Esta función se mantiene igual que la última versión validada)
    if (!isMessagingSupported || !auth.currentUser) return;
    const permiso = Notification.permission;
    const uid = auth.currentUser.uid;
    const storageKey = `popUpPermisoMostrado_${uid}`;
    const popUpYaMostrado = localStorage.getItem(storageKey);
    const notifCard = document.getElementById('notif-card');
    const notifSwitch = document.getElementById('notif-switch');
    const prePermisoOverlay = document.getElementById('pre-permiso-overlay');
    prePermisoOverlay.style.display = 'none';
    notifCard.style.display = 'none';
    if (permiso === 'granted') {
        obtenerYGuardarToken();
    } else if (permiso === 'denied') {
        notifCard.style.display = 'block';
        notifSwitch.checked = false;
    } else {
        if (!popUpYaMostrado) {
            prePermisoOverlay.style.display = 'flex';
        } else {
            notifCard.style.display = 'block';
            notifSwitch.checked = false;
        }
    }
}

// ========== LÓGICA DE DATOS Y UI ==========
async function loadClientData(user) {
    showScreen('loading-screen');
    try {
        const clientesRef = db.collection('clientes');
        const snapshot = await clientesRef.where("email", "==", user.email).limit(1).get();
        if (snapshot.empty) throw new Error("No se pudo encontrar la ficha de cliente.");
        const doc = snapshot.docs[0];
        clienteData = { id: doc.id, ...doc.data() };
        
        // ... (resto del renderizado de la UI, sin cambios)
        document.getElementById('cliente-nombre').textContent = clienteData.nombre.split(' ')[0];
        document.getElementById('cliente-puntos').textContent = clienteData.puntos || 0;
        // ... etc.

        showScreen('main-app-screen');
        gestionarPermisoNotificaciones();
    } catch (error) {
        console.error("Error en loadClientData:", error);
        showToast(error.message, "error");
        logout();
    }
}

// ========== LÓGICA DE AUTENTICACIÓN ==========
async function registerAndLinkAccount() {
    // ... (función sin cambios)
    const dni = document.getElementById('register-dni').value.trim();
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value;
    if (!dni || !email || password.length < 6) return showToast("Por favor, completa todos los campos.", "error");
    try {
        const clientesRef = db.collection('clientes');
        const snapshot = await clientesRef.where("dni", "==", dni).get();
        if (snapshot.empty) throw new Error("No se encontró cliente con ese DNI.");
        const clienteDoc = snapshot.docs[0];
        if (clienteDoc.data().authUID) throw new Error("Este cliente ya tiene una cuenta.");
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        await clienteDoc.ref.update({ authUID: userCredential.user.uid, email: email, fcmTokens: [] });
    } catch (error) {
        showToast(error.message, "error");
    }
}
async function login() { /* ... (función sin cambios) ... */ }
async function logout() { /* ... (función sin cambios) ... */ }
// Pego el código completo por si acaso
async function login() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    if (!email || !password) return showToast("Por favor, ingresa tu email y contraseña.", "error");
    try {
        await auth.signInWithEmailAndPassword(email, password);
    } catch (error) {
        showToast("Error al iniciar sesión. Verifica tus credenciales.", "error");
    }
}
async function logout() {
    try { await auth.signOut(); } 
    catch (error) { showToast("Error al cerrar sesión.", "error"); }
}

// ========== PUNTO DE ENTRADA DE LA APLICACIÓN ==========
function main() {
    // ... (event listeners sin cambios)
    document.getElementById('show-register-link').addEventListener('click', (e) => { e.preventDefault(); showScreen('register-screen'); });
    document.getElementById('show-login-link').addEventListener('click', (e) => { e.preventDefault(); showScreen('login-screen'); });
    document.getElementById('register-btn').addEventListener('click', registerAndLinkAccount);
    document.getElementById('login-btn').addEventListener('click', login);
    document.getElementById('logout-btn').addEventListener('click', logout);
    if (isMessagingSupported) {
        const handleUserDecision = () => { if (!auth.currentUser) return; const storageKey = `popUpPermisoMostrado_${auth.currentUser.uid}`; localStorage.setItem(storageKey, 'true'); document.getElementById('pre-permiso-overlay').style.display = 'none'; };
        document.getElementById('btn-activar-permiso').addEventListener('click', () => { handleUserDecision(); Notification.requestPermission().then(() => gestionarPermisoNotificaciones()); });
        document.getElementById('btn-ahora-no').addEventListener('click', () => { handleUserDecision(); showToast("Entendido. Puedes cambiar de opinión cuando quieras.", "info"); gestionarPermisoNotificaciones(); });
        document.getElementById('notif-switch').addEventListener('change', (event) => { const manualGuide = document.getElementById('notif-manual-guide'); if (event.target.checked) { if (Notification.permission === 'denied') { manualGuide.style.display = 'block'; event.target.checked = false; } else { manualGuide.style.display = 'none'; Notification.requestPermission().then(() => gestionarPermisoNotificaciones()); } } });
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && auth.currentUser) { gestionarPermisoNotificaciones(); } });
        messaging.onMessage((payload) => { const notificacion = payload.data || payload.notification; showToast(`📢 ${notificacion.title}: ${notificacion.body}`, 'info', 10000); });
    }
    auth.onAuthStateChanged(user => { if (user) { loadClientData(user); } else { clienteData = null; showScreen('login-screen'); } });
}

document.addEventListener('DOMContentLoaded', main);
