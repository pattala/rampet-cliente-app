// app.js de la Aplicación del Cliente (VERSIÓN FINAL Y ROBUSTA)

// Configuración de Firebase (se mantiene igual)
const firebaseConfig = { /* ... */ };
const app = firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
let messaging;
if (firebase.messaging.isSupported()) {
    messaging = firebase.messaging();
}
// ... resto de variables globales ...
// ... funciones de ayuda (showToast, etc.) se mantienen igual ...


// ========== LÓGICA DE NOTIFICACIONES (VERSIÓN INTELIGENTE) ==========

function requestNotificationPermission() {
    console.log('Verificando estado de notificaciones...');
    
    if (!messaging) {
        console.log('Este navegador no es compatible con las notificaciones.');
        return;
    }

    Notification.requestPermission().then((permission) => {
        if (permission === 'granted') {
            console.log('Permiso de notificación concedido. Obteniendo token...');
            const vapidKey = "PEGA_AQUÍ_TU_CLAVE_VAPID_DE_FIREBASE"; // Reemplaza con tu clave
            
            messaging.getToken({ vapidKey: vapidKey }).then((currentToken) => {
                if (currentToken) {
                    // --- INICIO DE LA LÓGICA INTELIGENTE ---
                    // Comprobamos si el token de este dispositivo ya está en la lista del cliente.
                    const tokensDelCliente = clienteData.fcmTokens || [];
                    if (!tokensDelCliente.includes(currentToken)) {
                        console.log('Token nuevo o de un dispositivo diferente. Guardando en Firestore...');
                        
                        const clienteDocRef = db.collection('clientes').doc(clienteData.id);
                        clienteDocRef.update({
                            fcmTokens: firebase.firestore.FieldValue.arrayUnion(currentToken)
                        })
                        .then(() => {
                            console.log('Token añadido con éxito al array.');
                            // Actualizamos los datos en memoria para futuras comprobaciones
                            clienteData.fcmTokens.push(currentToken);
                        })
                        .catch(err => console.error('Error al guardar el FCM token:', err));
                    } else {
                        console.log('Este dispositivo ya está registrado. No se requiere acción.');
                    }
                    // --- FIN DE LA LÓGICA INTELIGENTE ---
                }
            }).catch((err) => {
                console.error('Ocurrió un error al obtener el token:', err);
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
        
        // El resto de la función (cargar premios, historial, etc.) se mantiene igual...
        // ...
        
        showScreen('main-app-screen');
        
        // Se llama a la función inteligente después de cargar los datos.
        requestNotificationPermission();

    } catch (error) {
        console.error("Error FATAL en loadClientData:", error);
        showToast("Hubo un error al cargar tus datos.", "error");
        logout();
    }
}

// ... (El resto del archivo: registerAndLinkAccount, login, logout, main, onMessage, etc., se mantiene exactamente igual que en la versión anterior) ...

function main() {
    // ...
    if (messaging) {
        messaging.onMessage((payload) => {
            console.log('¡Mensaje recibido en primer plano!', payload);
            const notificacion = payload.data; 
            showToast(`📢 ${notificacion.title}: ${notificacion.body}`, 'info', 10000);
        });
    }
}

document.addEventListener('DOMContentLoaded', main);
