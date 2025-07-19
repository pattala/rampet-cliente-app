// app.js de la Aplicación del Cliente (VERSIÓN FINAL CON UI LIMPIA)19_7

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
    const fecha = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    if (isNaN(fecha.getTime())) return 'Fecha inválida';
    const dia = String(fecha.getUTCDate()).padStart(2, '0');
    const mes = String(fecha.getUTCMonth() + 1).padStart(2, '0');
    const anio = fecha.getUTCFullYear();
    return `${dia}/${mes}/${anio}`;
}

function obtenerYGuardarToken() {
    if (!isMessagingSupported || !messaging || !clienteData || !clienteData.id) return;
    const vapidKey = "BN12Kv7QI7PpxwGfpanJUQ55Uci7KXZmEscTwlE7MIbhI0TzvoXTUOaSSesxFTUbxWsYZUubK00xnLePMm_rtOA";
    messaging.getToken({ vapidKey })
        .then(currentToken => {
            if (!currentToken) return;
            const tokensEnDb = clienteData.fcmTokens || [];
            if (!tokensEnDb.includes(currentToken)) {
                const clienteDocRef = db.collection('clientes').doc(clienteData.id.toString());
                return clienteDocRef.update({ fcmTokens: firebase.firestore.FieldValue.arrayUnion(currentToken) });
            }
        })
        .catch(err => console.error('ERROR AL OBTENER O GUARDAR EL TOKEN:', err));
}

function gestionarPermisoNotificaciones() {
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
    } else { // 'default'
        if (!popUpYaMostrado) {
            prePermisoOverlay.style.display = 'flex';
        } else {
            notifCard.style.display = 'block';
            notifSwitch.checked = false;
        }
    }
}

async function loadClientData(user) {
    // ... esta función no cambia
}

// ... El resto del archivo app.js se mantiene igual ...

function main() {
    // ...
    auth.onAuthStateChanged(user => {
        if (user) {
            loadClientData(user);
        } else {
            clienteData = null;
            showScreen('login-screen');
        }
    });
}

document.addEventListener('DOMContentLoaded', main);
