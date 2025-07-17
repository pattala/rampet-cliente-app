// app.js de la Aplicación del Cliente (VERSIÓN FINAL CON UI LIMPIA)

// Configuración de Firebase
const firebaseConfig = {
  apiKey: "AIzaSyAvBw_Cc-t8lfip_FtQ1w_w3DrPDYpxINs",
  authDomain: "sistema-fidelizacion.firebaseapp.com",
  projectId: "sistema-fidelizacion",
  storageBucket: "sistema-fidelizacion.appspot.com",
  messagingSenderId: "357176214962",
  appId: "1:357176214962:web:6c1df9b74ff0f3779490ab"
};

// Inicializar Firebase
const app = firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
let messaging;
const isMessagingSupported = firebase.messaging.isSupported();
if (isMessagingSupported) {
    messaging = firebase.messaging();
}

let clienteData = null; 
let premiosData = [];   

// ... (Todas las funciones de ayuda como showToast, showScreen, etc. se mantienen igual)
function showToast(message, type = 'info', duration = 5000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
}

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    const screenToShow = document.getElementById(screenId);
    if (screenToShow) {
        screenToShow.classList.add('active');
    }
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


// ========== LÓGICA DE NOTIFICACIONES (VERSIÓN LIMPIA) ==========

function obtenerYGuardarToken() {
    if (!isMessagingSupported || !messaging) return;
    const vapidKey = "BN12Kv7QI7PpxwGfpanJUQ55Uci7KXZmEscTwlE7MIbhI0TzvoXTUOaSSesxFTUbxWsYZUubK00xnLePMm_rtOA";
    
    messaging.getToken({ vapidKey })
        .then(currentToken => {
            if (!currentToken || !clienteData || !clienteData.id) return;
            const tokensEnDb = clienteData.fcmTokens || [];
            if (!tokensEnDb.includes(currentToken)) {
                const clienteDocRef = db.collection('clientes').doc(clienteData.id.toString());
                clienteDocRef.update({ fcmTokens: firebase.firestore.FieldValue.arrayUnion(currentToken) })
                    .then(() => {
                        if (clienteData.fcmTokens) clienteData.fcmTokens.push(currentToken);
                        else clienteData.fcmTokens = [currentToken];
                    });
            }
        }).catch(err => console.error('GET_TOKEN_ERROR:', err));
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
        // ** CAMBIO CLAVE: Si el permiso está concedido, no hacemos nada en la UI. **
        // Simplemente nos aseguramos de que el token esté guardado.
        console.log("UI_ACTION: Permiso concedido. No se muestra ninguna tarjeta.");
        obtenerYGuardarToken();
    } else if (permiso === 'denied') {
        // Mostramos la tarjeta pasiva para que pueda intentar reactivar.
        notifCard.style.display = 'block';
        notifSwitch.checked = false;
    } else { // 'default'
        if (!popUpYaMostrado) {
            // El pop-up solo se muestra si el permiso es 'default' Y nunca antes lo hemos mostrado.
            prePermisoOverlay.style.display = 'flex';
        } else {
            // Si ya lo mostramos y no respondieron, mostramos la tarjeta pasiva.
            notifCard.style.display = 'block';
            notifSwitch.checked = false;
        }
    }
}

// ... (El resto del código es idéntico al de la versión anterior)
// ========== LÓGICA DE DATOS Y UI ==========
function getFechaProximoVencimiento(cliente) {
    if (!cliente.historialPuntos || cliente.historialPuntos.length === 0) return null;
    let fechaMasProxima = null;
    const hoy = new Date();
    hoy.setUTCHours(0, 0, 0, 0);

    cliente.historialPuntos.forEach(grupo => {
        if (grupo.puntosDisponibles > 0 && grupo.estado !== 'Caducado') {
            const fechaObtencion = new Date(grupo.fechaObtencion.split('T')[0] + 'T00:00:00Z');
            const fechaCaducidad = new Date(fechaObtencion);
            const diasDeValidez = grupo.diasCaducidad || 90; 
            fechaCaducidad.setUTCDate(fechaCaducidad.getUTCDate() + diasDeValidez);
            if (fechaCaducidad >= hoy) {
                if (fechaMasProxima === null || fechaCaducidad < fechaMasProxima) {
                    fechaMasProxima = fechaCaducidad;
                }
            }
        }
    });
    return fechaMasProxima;
}

function getPuntosEnProximoVencimiento(cliente) {
    const fechaProximoVencimiento = getFechaProximoVencimiento(cliente);
    if (!fechaProximoVencimiento) return 0;
    let puntosAVencer = 0;
    cliente.historialPuntos.forEach(grupo => {
        if (grupo.puntosDisponibles > 0 && grupo.estado !== 'Caducado') {
            const fechaObtencion = new Date(grupo.fechaObtencion.split('T')[0] + 'T00:00:00Z');
            const fechaCaducidad = new Date(fechaObtencion);
            const diasDeValidez = grupo.diasCaducidad || 90;
            fechaCaducidad.setUTCDate(fechaCaducidad.getUTCDate() + diasDeValidez);
            if (fechaCaducidad.getTime() === fechaProximoVencimiento.getTime()) {
                puntosAVencer += grupo.puntosDisponibles;
            }
        }
    });
    return puntosAVencer;
}

async function loadClientData(user) {
    showScreen('loading-screen');
    try {
        const clientesRef = db.collection('clientes');
        const snapshot = await clientesRef.where("email", "==", user.email).limit(1).get();
        if (snapshot.empty) throw new Error("No se pudo encontrar la ficha de cliente.");
        
        const doc = snapshot.docs[0];
        clienteData = { id: doc.id, ...doc.data() };
        
        const premiosSnapshot = await db.collection('premios').get();
        premiosData = premiosSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        document.getElementById('cliente-nombre').textContent = clienteData.nombre.split(' ')[0];
        document.getElementById('cliente-puntos').textContent = clienteData.puntos || 0;
        
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
            const historialReciente = clienteData.historialPuntos.sort((a,b) => new Date(b.fechaObtencion) - new Date(a.fechaObtencion)).slice(0, 5);
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
        const premiosCanjeables = premiosData.filter(p => p.puntos <= clienteData.puntos && p.stock > 0);
        if (premiosCanjeables.length > 0) {
            premiosCanjeables.forEach(premio => {
                const li = document.createElement('li');
                li.innerHTML = `<strong>${premio.nombre}</strong> <span class="puntos-premio">${premio.puntos} Puntos</span>`;
                premiosLista.appendChild(li);
            });
        } else {
             premiosLista.innerHTML = '<li>Sigue sumando puntos para canjear premios.</li>';
        }

        showScreen('main-app-screen');
        gestionarPermisoNotificaciones();

    } catch (error) {
        console.error("Error FATAL en loadClientData:", error);
        showToast(error.message, "error");
        logout();
    }
}

// ========== LÓGICA DE AUTENTICACIÓN ==========
async function registerAndLinkAccount() {
    const dni = document.getElementById('register-dni').value.trim();
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value;
    const registerButton = document.getElementById('register-btn');
    if (!dni || !email || password.length < 6) {
        showToast("Por favor, completa todos los campos...", "error");
        return;
    }
    registerButton.disabled = true;
    registerButton.textContent = 'Procesando...';
    try {
        const clientesRef = db.collection('clientes');
        const snapshot = await clientesRef.where("dni", "==", dni).get();
        if (snapshot.empty) throw new Error("No se encontró cliente con ese DNI.");
        const clienteDoc = snapshot.docs[0];
        const clienteActual = clienteDoc.data();
        if (clienteActual.authUID) throw new Error("Este cliente ya tiene una cuenta.");
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        await clienteDoc.ref.update({ authUID: userCredential.user.uid, email: email, fcmTokens: [] });
    } catch (error) {
        if (error.code === 'auth/email-already-in-use') showToast("Este email ya está en uso.", "error");
        else showToast(error.message, "error");
    } finally {
        registerButton.disabled = false;
        registerButton.textContent = 'Crear y Vincular Cuenta';
    }
}

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
    document.getElementById('show-register-link').addEventListener('click', (e) => { e.preventDefault(); showScreen('register-screen'); });
    document.getElementById('show-login-link').addEventListener('click', (e) => { e.preventDefault(); showScreen('login-screen'); });
    document.getElementById('register-btn').addEventListener('click', registerAndLinkAccount);
    document.getElementById('login-btn').addEventListener('click', login);
    document.getElementById('logout-btn').addEventListener('click', logout);

    if (isMessagingSupported) {
        const handleUserDecision = () => {
            if (!auth.currentUser) return;
            const storageKey = `popUpPermisoMostrado_${auth.currentUser.uid}`;
            localStorage.setItem(storageKey, 'true');
            document.getElementById('pre-permiso-overlay').style.display = 'none';
        };

        document.getElementById('btn-activar-permiso').addEventListener('click', () => {
            handleUserDecision();
            Notification.requestPermission().then(() => gestionarPermisoNotificaciones());
        });

        document.getElementById('btn-ahora-no').addEventListener('click', () => {
            handleUserDecision();
            showToast("Entendido. Puedes cambiar de opinión cuando quieras.", "info");
            gestionarPermisoNotificaciones();
        });

        document.getElementById('notif-switch').addEventListener('change', (event) => {
            const manualGuide = document.getElementById('notif-manual-guide');
            if (event.target.checked) {
                if (Notification.permission === 'denied') {
                    manualGuide.style.display = 'block';
                    event.target.checked = false; 
                } else {
                    manualGuide.style.display = 'none';
                    Notification.requestPermission().then(() => gestionarPermisoNotificaciones());
                }
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && auth.currentUser) {
                gestionarPermisoNotificaciones();
            }
        });

        messaging.onMessage((payload) => {
            const notificacion = payload.data || payload.notification; 
            showToast(`📢 ${notificacion.title}: ${notificacion.body}`, 'info', 10000);
        });
    }

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
