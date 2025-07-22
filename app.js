// app.js de la PWA (VERSIÓN CON NUEVO FLUJO DE ACCESO Y TÉRMINOS)

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

// ========== VARIABLES GLOBALES ==========
let clienteData = null; 
let premiosData = [];
let unsubscribeCliente = null; // Para detener la escucha de Firestore al cerrar sesión

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

    const clienteQuery = db.collection('clientes').where("authUID", "==", user.uid).limit(1);

    unsubscribeCliente = clienteQuery.onSnapshot(async (snapshot) => {
        if (snapshot.empty) {
            showToast("Error: No se encontró tu ficha de cliente.", "error");
            logout();
            return;
        }
        
        const doc = snapshot.docs[0];
        clienteData = { id: doc.id, ...doc.data() };

        if (premiosData.length === 0) {
            try {
                const premiosSnapshot = await db.collection('premios').orderBy('puntos', 'asc').get();
                premiosData = premiosSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            } catch (e) {
                console.error("Error cargando premios:", e);
                showToast("No se pudieron cargar los premios.", "warning");
            }
        }

        renderMainScreen();

    }, (error) => {
        console.error("Error escuchando datos del cliente:", error);
        showToast("Error al cargar tus datos.", "error");
        logout();
    });
}

function renderMainScreen() {
    if (!clienteData) return;

    document.getElementById('cliente-nombre').textContent = clienteData.nombre.split(' ')[0];
    document.getElementById('cliente-puntos').textContent = clienteData.puntos || 0;

    const termsBanner = document.getElementById('terms-banner');
    if (!clienteData.terminosAceptados) {
        termsBanner.style.display = 'block';
    } else {
        termsBanner.style.display = 'none';
    }

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

// ========== LÓGICA DE ACCESO Y REGISTRO ==========
async function login() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const boton = document.getElementById('login-btn');

    if (!email || !password) {
        return showToast("Por favor, ingresa tu email y contraseña.", "error");
    }
    
    boton.disabled = true;
    boton.textContent = 'Ingresando...';

    try {
        await auth.signInWithEmailAndPassword(email, password);
    } catch (error) {
        if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
            showToast("Email o contraseña incorrectos.", "error");
        } else {
            showToast("Error al iniciar sesión. Inténtalo de nuevo.", "error");
        }
        console.error("Error en login:", error);
    } finally {
        boton.disabled = false;
        boton.textContent = 'Ingresar';
    }
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

    if (!nombre || !dni || !email || !fechaNacimiento || !password) {
        return showToast("Por favor, completa todos los campos obligatorios.", "error");
    }
    if (password.length < 6) {
        return showToast("La contraseña debe tener al menos 6 caracteres.", "error");
    }
    if (!termsAccepted) {
        return showToast("Debes aceptar los Términos y Condiciones para registrarte.", "error");
    }

    boton.disabled = true;
    boton.textContent = 'Creando cuenta...';

    try {
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        const authUID = userCredential.user.uid;

        const nuevoClienteId = Date.now(); 
        
        const nuevoCliente = {
            id: nuevoClienteId,
            authUID: authUID,
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
            terminosAceptados: true
        };
        
        await db.collection('clientes').doc(nuevoClienteId.toString()).set(nuevoCliente);
        
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
    try {
        if (unsubscribeCliente) unsubscribeCliente();
        await auth.signOut();
        clienteData = null;
        premiosData = [];
        showScreen('login-screen');
    } catch (error) {
        showToast("Error al cerrar sesión.", "error");
    }
}

// ========== LÓGICA DE TÉRMINOS Y CONDICIONES ==========
function openTermsModal() {
    document.getElementById('terms-modal').style.display = 'flex';
    if (clienteData && !clienteData.terminosAceptados) {
        document.getElementById('accept-terms-btn-modal').style.display = 'block';
    }
}

function closeTermsModal() {
    document.getElementById('terms-modal').style.display = 'none';
    document.getElementById('accept-terms-btn-modal').style.display = 'none';
}

async function acceptTerms() {
    if (!clienteData || !clienteData.id) return;
    
    const boton = document.getElementById('accept-terms-btn-modal');
    boton.disabled = true;

    try {
        const clienteRef = db.collection('clientes').doc(clienteData.id.toString());
        await clienteRef.update({ terminosAceptados: true });
        showToast("¡Gracias por aceptar los términos!", "success");
        closeTermsModal();
    } catch (error) {
        showToast("No se pudo actualizar. Inténtalo de nuevo.", "error");
        console.error("Error aceptando términos:", error);
    } finally {
        boton.disabled = false;
    }
}

// ========== LÓGICA DE NOTIFICACIONES ==========
async function obtenerYGuardarToken() {
    // Esta función no necesita cambios, pero depende de que `clienteData` esté cargado
    if (!isMessagingSupported || !messaging || !clienteData || !clienteData.id) return;
    try {
        const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        await navigator.serviceWorker.ready;
        const vapidKey = "BN12Kv7QI7PpxwGfpanJUQ55Uci7KXZmEscTwlE7MIbhI0TzvoXTUOaSSesxFTUbxWsYZUubK00xnLePMm_rtOA";
        const currentToken = await messaging.getToken({ vapidKey, serviceWorkerRegistration: registration });
        if (currentToken) {
            const tokensEnDb = clienteData.fcmTokens || [];
            if (!tokensEnDb.includes(currentToken)) {
                const clienteDocRef = db.collection('clientes').doc(clienteData.id.toString());
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

// ========== PUNTO DE ENTRADA Y EVENT LISTENERS ==========
function main() {
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
