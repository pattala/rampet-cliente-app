// app.js de la Aplicación del Cliente (VERSIÓN FINAL CON TOKEN INTELIGENTE)

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
if (firebase.messaging.isSupported()) {
    messaging = firebase.messaging();
}

let clienteData = null; 
let premiosData = [];   

// ========== FUNCIONES DE AYUDA ==========
function showToast(message, type = 'info', duration = 5000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
}

function showScreen(screenId) {
    console.log(`Mostrando pantalla: ${screenId}`);
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

// ========== LÓGICA DE DATOS Y NOTIFICACIONES ==========

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

function requestNotificationPermission() {
    console.log('Verificando estado de notificaciones...');
    
    if (!messaging) {
        console.log('Este navegador no es compatible con las notificaciones.');
        return;
    }

    Notification.requestPermission().then((permission) => {
        if (permission === 'granted') {
            console.log('Permiso de notificación concedido.');
            const vapidKey = "BN12Kv7QI7PpxwGfpanJUQ55Uci7KXZmEscTwlE7MIbhI0TzvoXTUOaSSesxFTUbxWsYZUubK00xnLePMm_rtOA";
            
            messaging.getToken({ vapidKey: vapidKey }).then((currentToken) => {
                if (!currentToken) {
                    console.log('No se pudo generar un token.');
                    return;
                }

                console.log('Token del dispositivo actual:', currentToken);

                if (!clienteData || !clienteData.id) {
                    console.error("Error: Se intentó guardar un token pero los datos del cliente no están cargados.");
                    return;
                }

                const tokensEnDb = clienteData.fcmTokens || [];
                
                if (!tokensEnDb.includes(currentToken)) {
                    console.log('Token no encontrado en la BD. Actualizando...');
                    const clienteDocRef = db.collection('clientes').doc(clienteData.id);
                    
                    clienteDocRef.update({
                        fcmTokens: firebase.firestore.FieldValue.arrayUnion(currentToken)
                    })
                    .then(() => {
                        console.log('Token añadido con éxito a Firestore.');
                        clienteData.fcmTokens.push(currentToken);
                    })
                    .catch(err => console.error('Error al guardar el FCM token en Firestore:', err));
                } else {
                    console.log('El token de este dispositivo ya está registrado.');
                }

            }).catch((err) => {
                console.error('Error al obtener token de Firebase Messaging:', err);
            });
        }
    });
}

async function loadClientData(user) {
    showScreen('loading-screen');
    try {
        const clientesRef = db.collection('clientes');
        const snapshot = await clientesRef.where("email", "==", user.email).limit(1).get();
        
        if (snapshot.empty) {
            throw new Error("No se pudo encontrar la ficha de cliente asociada a esta cuenta.");
        }
        
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
            document.getElementById('cliente-puntos-vencimiento').textContent = puntosPorVencer;
            document.getElementById('cliente-fecha-vencimiento').textContent = formatearFecha(fechaVencimiento.toISOString());
            vencimientoCard.style.display = 'block';
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
        
        requestNotificationPermission();

    } catch (error) {
        console.error("Error FATAL en loadClientData:", error);
        showToast("Hubo un error al cargar tus datos.", "error");
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
        showToast("Por favor, completa todos los campos. La contraseña debe tener al menos 6 caracteres.", "error");
        return;
    }

    registerButton.disabled = true;
    registerButton.textContent = 'Procesando...';

    try {
        const clientesRef = db.collection('clientes');
        const snapshot = await clientesRef.where("dni", "==", dni).get();

        if (snapshot.empty) {
            throw new Error("No se encontró ningún cliente con ese DNI. Verifica que sea el mismo con el que te registraste en la tienda.");
        }

        const clienteDoc = snapshot.docs[0];
        const clienteActual = clienteDoc.data();

        if (clienteActual.authUID) {
            throw new Error("Este cliente ya tiene una cuenta de acceso creada. Por favor, intenta iniciar sesión.");
        }

        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        const user = userCredential.user;

        await clienteDoc.ref.update({ 
            authUID: user.uid,
            email: email,
            fcmTokens: []
        });

    } catch (error) {
        if (error.code === 'auth/email-already-in-use') {
            showToast("Este correo electrónico ya está en uso por otro usuario.", "error");
        } else {
            showToast(error.message, "error");
        }
        console.error("Error en registro:", error);
    } finally {
        registerButton.disabled = false;
        registerButton.textContent = 'Crear y Vincular Cuenta';
    }
}

async function login() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
        showToast("Por favor, ingresa tu email y contraseña.", "error");
        return;
    }

    try {
        await auth.signInWithEmailAndPassword(email, password);
    } catch (error) {
        showToast("Error al iniciar sesión. Verifica tus credenciales.", "error");
        console.error("Error en login:", error);
    }
}

async function logout() {
    try {
        await auth.signOut();
    } catch (error) {
        showToast("Error al cerrar sesión.", "error");
    }
}

// ========== PUNTO DE ENTRADA DE LA APLICACIÓN ==========

function main() {
    document.getElementById('show-register-link').addEventListener('click', (e) => {
        e.preventDefault();
        showScreen('register-screen');
    });
    document.getElementById('show-login-link').addEventListener('click', (e) => {
        e.preventDefault();
        showScreen('login-screen');
    });

    document.getElementById('register-btn').addEventListener('click', registerAndLinkAccount);
    document.getElementById('login-btn').addEventListener('click', login);
    document.getElementById('logout-btn').addEventListener('click', logout);

    auth.onAuthStateChanged(user => {
        console.log("Cambio de estado de autenticación. Usuario:", user ? user.email : 'null');
        if (user) {
            loadClientData(user);
        } else {
            clienteData = null;
            showScreen('login-screen');
        }
    });

    if (messaging) {
        messaging.onMessage((payload) => {
            console.log('¡Mensaje recibido en primer plano!', payload);
            
            const notificacion = payload.data; 
            showToast(`📢 ${notificacion.title}: ${notificacion.body}`, 'info', 10000);
        });
    }
}

document.addEventListener('DOMContentLoaded', main);


----------------
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Club RAMPET - Mis Puntos</title>
    <link rel="stylesheet" href="styles.css">
    <script src="https://www.gstatic.com/firebasejs/9.6.0/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.6.0/firebase-firestore-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.6.0/firebase-auth-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.6.0/firebase-messaging-compat.js"></script>
</head>
<body>
    <div id="toast-container"></div>
    <div class="container">
        <header>
            <img src="images/mi_logo.png" alt="Logo RAMPET" class="logo">
            <h1>Club RAMPET</h1>
        </header>

        <div id="loading-screen" class="screen active">
            <p>Cargando...</p>
        </div>
        
        <div id="login-screen" class="screen">
            <h2>Bienvenido</h2>
            <p>Ingresa para consultar tus puntos y beneficios.</p>
            <div class="form-group">
                <input type="email" id="login-email" placeholder="Tu Email" autocomplete="email">
                <input type="password" id="login-password" placeholder="Tu Contraseña">
                <button id="login-btn" class="primary-btn">Ingresar</button>
            </div>
            <p class="toggle-link">¿Primera vez aquí? <a href="#" id="show-register-link">Crea tu cuenta</a></p>
        </div>

        <div id="register-screen" class="screen">
            <h2>Crea tu acceso</h2>
            <p>Usa los datos con los que te registraste en la tienda para vincular tu cuenta.</p>
            <div class="form-group">
                <input type="text" id="register-dni" placeholder="Tu DNI" required>
                <input type="email" id="register-email" placeholder="Tu Email" required autocomplete="email">
                <input type="password" id="register-password" placeholder="Crea una Contraseña (mín. 6 caracteres)" required>
                <button id="register-btn" class="primary-btn">Crear y Vincular Cuenta</button>
            </div>
            <p class="toggle-link">¿Ya tienes cuenta? <a href="#" id="show-login-link">Ingresa aquí</a></p>
        </div>

        <div id="main-app-screen" class="screen">
            <div class="user-header">
                <h3>Hola, <span id="cliente-nombre">--</span></h3>
                <button id="logout-btn" class="secondary-btn">Salir</button>
            </div>
            <div class="card puntos-card">
                <p>Tus Puntos Disponibles</p>
                <h2 id="cliente-puntos">--</h2>
            </div>

            <div id="vencimiento-card" class="card vencimiento-card" style="display: none;">
                <p>⚠️ Puntos por Vencer</p>
                <h2><span id="cliente-puntos-vencimiento">--</span> Puntos</h2>
                <p>Vencen el: <strong id="cliente-fecha-vencimiento">--</strong></p>
            </div>

            <div id="historial-container" class="card">
                <h3>Historial Reciente</h3>
                <ul id="lista-historial"></ul>
            </div>
            <div id="premios-container" class="card">
                <h3>Premios que puedes canjear</h3>
                <ul id="lista-premios-cliente"></ul>
            </div>
        </div>

    </div>
    <script src="app.js"></script>
</body>
</html>

--------

/* --- Estilos Generales --- */
:root {
    --primary-color: #007bff;
    --primary-hover: #0056b3;
    --success-color: #28a745;
    --danger-color: #dc3545;
    --background-color: #f0f2f5;
    --card-background: #ffffff;
    --text-color: #333;
    --light-text-color: #777;
    --border-color: #dee2e6;
    --box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    background-color: var(--background-color);
    color: var(--text-color);
    margin: 0;
    padding: 20px;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    min-height: 100vh;
}

.container {
    width: 100%;
    max-width: 400px;
    padding: 20px;
    box-sizing: border-box;
}

header {
    text-align: center;
    margin-bottom: 30px;
}

.logo {
    height: 60px;
    margin-bottom: 10px;
}

h1 {
    font-size: 1.8em;
    color: var(--primary-color);
    margin: 0;
}

h2 {
    font-size: 1.5em;
    margin-bottom: 10px;
}

h3 {
    font-size: 1.2em;
    border-bottom: 2px solid var(--border-color);
    padding-bottom: 10px;
    margin-top: 0;
}

p {
    color: var(--light-text-color);
    line-height: 1.6;
}

ul {
    list-style-type: none;
    padding: 0;
    margin: 0;
}

/* --- Pantallas y Transiciones --- */
.screen {
    display: none;
    animation: fadeIn 0.5s;
}

.screen.active {
    display: block;
}

@keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
}

/* --- Formularios --- */
.form-group {
    display: flex;
    flex-direction: column;
    gap: 15px;
    margin-bottom: 20px;
}

input[type="email"],
input[type="password"],
input[type="text"] {
    width: 100%;
    padding: 15px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    box-sizing: border-box;
    font-size: 16px;
}

.toggle-link {
    text-align: center;
    font-size: 14px;
}

.toggle-link a {
    color: var(--primary-color);
    font-weight: 600;
    text-decoration: none;
}

/* --- Botones --- */
.primary-btn {
    background-color: var(--primary-color);
    color: white;
    padding: 15px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    font-weight: 600;
    font-size: 16px;
    transition: background-color 0.2s;
}

.primary-btn:hover {
    background-color: var(--primary-hover);
}

.secondary-btn {
    background: none;
    border: 1px solid var(--border-color);
    color: var(--text-color);
    padding: 8px 15px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 14px;
}

/* --- Vista Principal --- */
.user-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
}

.user-header h3 {
    border: none;
    padding: 0;
    margin: 0;
    font-size: 1.4em;
}

.card {
    background-color: var(--card-background);
    padding: 20px;
    border-radius: 12px;
    box-shadow: var(--box-shadow);
    margin-bottom: 20px;
}

.puntos-card {
    text-align: center;
    background: linear-gradient(45deg, var(--primary-color), #0056b3);
    color: white;
}

.puntos-card p {
    margin: 0 0 5px 0;
    font-size: 16px;
    color: rgba(255, 255, 255, 0.8);
}

.puntos-card h2 {
    font-size: 3em;
    margin: 0;
    font-weight: 700;
}

/* --- Estilos para Vencimiento --- */
.vencimiento-card {
    background: var(--danger-color);
    color: white;
    text-align: center;
}

.vencimiento-card p {
    color: rgba(255, 255, 255, 0.9);
    margin: 0;
}

.vencimiento-card h2 {
    font-size: 2.5em;
    margin: 5px 0;
}

/* --- Estilos para Listas --- */
#lista-historial li, #lista-premios-cliente li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 15px 0;
    border-bottom: 1px solid var(--border-color);
}
#lista-historial li:last-child, #lista-premios-cliente li:last-child {
    border-bottom: none;
}

#lista-historial .puntos {
    font-weight: 600;
}
#lista-historial .puntos.ganados {
    color: var(--success-color);
}
#lista-historial .puntos.gastados {
    color: var(--danger-color);
}

#lista-premios-cliente .puntos-premio {
    font-weight: 600;
    color: var(--primary-color);
}


/* --- Toast --- */
#toast-container {
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 9999;
}

.toast {
    padding: 15px 20px;
    border-radius: 8px;
    color: white;
    font-weight: 600;
    box-shadow: 0 5px 15px rgba(0,0,0,0.2);
    margin-bottom: 10px;
    animation: slideIn 0.5s forwards;
}

@keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
}

.toast.success { background-color: #28a745; }
.toast.error { background-color: #dc3545; }
.toast.info { background-color: #17a2b8; }
