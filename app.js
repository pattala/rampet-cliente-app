// app.js de la Aplicación del Cliente (VERSIÓN FINAL CORREGIDA)

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

// --- INICIO DE LA LÓGICA DE NOTIFICACIÓN CORREGIDA Y ROBUSTA ---
function requestNotificationPermission() {
    console.log('Verificando estado de notificaciones...');
    
    if (!messaging) {
        console.log('Este navegador no es compatible con las notificaciones.');
        return;
    }

    Notification.requestPermission().then((permission) => {
        if (permission === 'granted') {
            console.log('Permiso de notificación concedido.');
            const vapidKey = BN12Kv7QI7PpxwGfpanJUQ55Uci7KXZmEscTwlE7MIbhI0TzvoXTUOaSSesxFTUbxWsYZUubK00xnLePMm_rtOA; // ¡Importante!
            
            messaging.getToken({ vapidKey: vapidKey }).then((currentToken) => {
                if (!currentToken) {
                    console.log('No se pudo generar un token.');
                    return;
                }

                console.log('Token del dispositivo actual:', currentToken);

                // Verificamos que los datos del cliente estén cargados antes de continuar
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
                        clienteData.fcmTokens.push(currentToken); // Actualiza la data en memoria
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
// --- FIN DE LA LÓGICA DE NOTIFICACIÓN CORREGIDA Y ROBUSTA ---

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


