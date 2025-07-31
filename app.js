// ====================================================================
// == RAMPET PWA - ARCHIVO JAVASCRIPT ÚNICO Y COMPLETO              ==
// ====================================================================

import { setupFirebase, checkMessagingSupport, auth, db, firebase } from './modules/firebase.js';
import * as Notifications from './modules/notifications.js';

// ====================================================================
// == LÓGICA DE UI (antes en ui.js)                                 ==
// ====================================================================
let carouselIntervalId = null;
let isDragging = false, startX, startScrollLeft;

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
// ... (Aquí irían las demás funciones de UI que teníamos: formatearFecha, renderMainScreen, modales, carrusel, etc.)
function formatearFecha(isoDateString) { if (!isoDateString) return 'N/A'; const parts = isoDateString.split('T')[0].split('-'); if (parts.length !== 3) return 'Fecha inválida'; const fecha = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])); if (isNaN(fecha.getTime())) return 'Fecha inválida'; const dia = String(fecha.getUTCDate()).padStart(2, '0'); const mes = String(fecha.getUTCMonth() + 1).padStart(2, '0'); const anio = fecha.getUTCFullYear(); return `${dia}/${mes}/${anio}`; }
function renderMainScreen(clienteData, premiosData, campanasData = []) { if (!clienteData) return; document.getElementById('cliente-nombre').textContent = clienteData.nombre.split(' ')[0]; document.getElementById('cliente-numero-socio').textContent = clienteData.numeroSocio ? `#${clienteData.numeroSocio}` : 'N° Pendiente'; document.getElementById('cliente-puntos').textContent = clienteData.puntos || 0; const termsBanner = document.getElementById('terms-banner'); if (termsBanner) termsBanner.style.display = !clienteData.terminosAceptados ? 'block' : 'none'; const vencimientoCard = document.getElementById('vencimiento-card'); const puntosPorVencer = getPuntosEnProximoVencimiento(clienteData); const fechaVencimiento = getFechaProximoVencimiento(clienteData); if (vencimientoCard) { if (puntosPorVencer > 0 && fechaVencimiento) { vencimientoCard.style.display = 'block'; document.getElementById('cliente-puntos-vencimiento').textContent = puntosPorVencer; document.getElementById('cliente-fecha-vencimiento').textContent = formatearFecha(fechaVencimiento.toISOString()); } else { vencimientoCard.style.display = 'none'; } } const historialLista = document.getElementById('lista-historial'); if (historialLista) { historialLista.innerHTML = ''; const historialReciente = [...(clienteData.historialPuntos || [])].sort((a,b) => new Date(b.fechaObtencion) - new Date(a.fechaObtencion)).slice(0, 5); if (historialReciente.length > 0) { historialReciente.forEach(item => { const li = document.createElement('li'); const puntos = item.puntosObtenidos > 0 ? `+${item.puntosObtenidos}` : item.puntosObtenidos; li.innerHTML = `<span>${formatearFecha(item.fechaObtencion)}</span> <strong>${item.origen}</strong> <span class="puntos ${puntos > 0 ? 'ganados':'gastados'}">${puntos} pts</span>`; historialLista.appendChild(li); }); } else { historialLista.innerHTML = '<li>Aún no tienes movimientos.</li>'; } } const premiosLista = document.getElementById('lista-premios-cliente'); if (premiosLista) { premiosLista.innerHTML = ''; if (premiosData && premiosData.length > 0) { premiosData.forEach(premio => { const li = document.createElement('li'); const puedeCanjear = clienteData.puntos >= premio.puntos; li.className = puedeCanjear ? 'canjeable' : 'no-canjeable'; li.innerHTML = `<strong>${premio.nombre}</strong> <span class="puntos-premio">${premio.puntos} Puntos</span>`; premiosLista.appendChild(li); }); } else { premiosLista.innerHTML = '<li>No hay premios disponibles en este momento.</li>'; } } renderCampanasCarousel(campanasData); showScreen('main-app-screen'); }
function openTermsModal(showAcceptButton) { const modal = document.getElementById('terms-modal'); const button = document.getElementById('accept-terms-btn-modal'); if(modal) modal.style.display = 'flex'; if(button) button.style.display = showAcceptButton ? 'block' : 'none'; }
function closeTermsModal() { const modal = document.getElementById('terms-modal'); if(modal) modal.style.display = 'none'; }
function openChangePasswordModal() { const modal = document.getElementById('change-password-modal'); if (modal) { document.getElementById('current-password').value = ''; document.getElementById('new-password').value = ''; document.getElementById('confirm-new-password').value = ''; modal.style.display = 'flex'; } }
function closeChangePasswordModal() { const modal = document.getElementById('change-password-modal'); if (modal) modal.style.display = 'none'; }
function renderCampanasCarousel(campanasData) { const container = document.getElementById('carrusel-campanas-container'); const carrusel = document.getElementById('carrusel-campanas'); const indicadoresContainer = document.getElementById('carrusel-indicadores'); if (!container || !carrusel || !indicadoresContainer) return; if (carouselIntervalId) clearInterval(carouselIntervalId); const campanasVisibles = Array.isArray(campanasData) ? campanasData : []; if (campanasVisibles.length === 0) { container.style.display = 'none'; return; } container.style.display = 'block'; carrusel.innerHTML = ''; indicadoresContainer.innerHTML = ''; campanasVisibles.forEach((campana, index) => { const item = campana.urlBanner ? document.createElement('a') : document.createElement('div'); if (campana.urlBanner) { item.href = campana.urlBanner; item.target = '_blank'; item.rel = 'noopener noreferrer'; item.className = 'banner-item'; const img = document.createElement('img'); img.src = campana.urlBanner; img.alt = campana.nombre; item.appendChild(img); } else { item.className = 'banner-item-texto'; const title = document.createElement('h4'); title.textContent = campana.nombre; item.appendChild(title); if (campana.cuerpo) { const description = document.createElement('p'); description.textContent = campana.cuerpo; item.appendChild(description); } } carrusel.appendChild(item); const indicador = document.createElement('span'); indicador.className = 'indicador'; indicador.dataset.index = index; indicador.addEventListener('click', () => { const itemWidth = carrusel.children[index].offsetLeft; carrusel.scrollTo({ left: itemWidth, behavior: 'smooth' }); }); indicadoresContainer.appendChild(indicador); }); const updateActiveIndicator = () => { const itemWidth = carrusel.firstElementChild.offsetWidth + 15; const currentIndex = Math.round(carrusel.scrollLeft / itemWidth); indicadoresContainer.querySelectorAll('.indicador').forEach((ind, idx) => { ind.classList.toggle('activo', idx === currentIndex); }); }; const startCarousel = () => { if (carouselIntervalId || isDragging) return; carouselIntervalId = setInterval(() => { const scrollEnd = carrusel.scrollWidth - carrusel.clientWidth; if (carrusel.scrollLeft >= scrollEnd - 5) { carrusel.scrollTo({ left: 0, behavior: 'smooth' }); } else { carrusel.scrollBy({ left: carrusel.firstElementChild.offsetWidth + 15, behavior: 'smooth' }); } }, 4000); }; const stopCarousel = () => { clearInterval(carouselIntervalId); carouselIntervalId = null; }; const dragStart = (e) => { stopCarousel(); isDragging = true; carrusel.classList.add('arrastrando'); startX = (e.pageX || e.touches[0].pageX) - carrusel.offsetLeft; startScrollLeft = carrusel.scrollLeft; }; const dragStop = () => { isDragging = false; carrusel.classList.remove('arrastrando'); if (!carrusel.matches(':hover')) { startCarousel(); } }; const dragging = (e) => { if (!isDragging) return; e.preventDefault(); const x = (e.pageX || e.touches[0].pageX) - carrusel.offsetLeft; const walk = (x - startX) * 2; carrusel.scrollLeft = startScrollLeft - walk; updateActiveIndicator(); }; carrusel.addEventListener('scroll', () => { if (!isDragging) updateActiveIndicator(); }); if (campanasVisibles.length > 1) { carrusel.addEventListener('mousedown', dragStart); carrusel.addEventListener('touchstart', dragStart, { passive: true }); carrusel.addEventListener('mousemove', dragging); carrusel.addEventListener('touchmove', dragging, { passive: true }); carrusel.addEventListener('mouseup', dragStop); carrusel.addEventListener('mouseleave', dragStop); carrusel.addEventListener('touchend', dragStop); carrusel.addEventListener('mouseenter', stopCarousel); carrusel.addEventListener('mouseleave', dragStop); startCarousel(); } updateActiveIndicator(); }


// ====================================================================
// == LÓGICA DE DATOS (antes en data.js)                            ==
// ====================================================================
let clienteData = null;
let clienteRef = null;
let premiosData = [];
let unsubscribeCliente = null;

function cleanupListener() {
    if (unsubscribeCliente) unsubscribeCliente();
    clienteData = null;
    clienteRef = null;
    premiosData = [];
}
async function listenToClientData(user) {
    if (unsubscribeCliente) unsubscribeCliente();
    const clienteQuery = db.collection('clientes').where("authUID", "==", user.uid).limit(1);
    unsubscribeCliente = clienteQuery.onSnapshot(async (snapshot) => {
        if (snapshot.empty) {
            showToast("Error: Tu cuenta no está vinculada a ninguna ficha de cliente.", "error");
            logout();
            return;
        }
        const doc = snapshot.docs[0];
        clienteData = doc.data();
        clienteRef = doc.ref;
        try {
            if (premiosData.length === 0) {
                const premiosSnapshot = await db.collection('premios').orderBy('puntos', 'asc').get();
                premiosData = premiosSnapshot.docs.map(p => p.data());
            }
            const hoy = new Date().toISOString().split('T')[0];
            const campanasSnapshot = await db.collection('campanas').where('estaActiva', '==', true).where('fechaInicio', '<=', hoy).get();
            const campanasVisibles = campanasSnapshot.docs.map(doc => doc.data()).filter(campana => hoy <= campana.fechaFin);
            renderMainScreen(clienteData, premiosData, campanasVisibles);
        } catch (e) {
            console.error("Error cargando datos adicionales:", e);
            renderMainScreen(clienteData, premiosData, []);
        }
        Notifications.gestionarPermisoNotificaciones(clienteData);
    }, (error) => {
        console.error("Error en listener de cliente:", error);
        logout();
    });
}
async function acceptTerms() {
    if (!clienteRef) return;
    const boton = document.getElementById('accept-terms-btn-modal');
    boton.disabled = true;
    try {
        await clienteRef.update({ terminosAceptados: true });
        showToast("¡Gracias por aceptar los términos!", "success");
        closeTermsModal();
    } catch (error) {
        showToast("No se pudo actualizar. Inténtalo de nuevo.", "error");
    } finally {
        boton.disabled = false;
    }
}
function getFechaProximoVencimiento(cliente) { if (!cliente.historialPuntos || cliente.historialPuntos.length === 0) return null; let fechaMasProxima = null; const hoy = new Date(); hoy.setUTCHours(0, 0, 0, 0); cliente.historialPuntos.forEach(grupo => { if (grupo.puntosDisponibles > 0 && grupo.estado !== 'Caducado') { const fechaObtencion = new Date(grupo.fechaObtencion.split('T')[0] + 'T00:00:00Z'); const fechaCaducidad = new Date(fechaObtencion); fechaCaducidad.setUTCDate(fechaCaducidad.getUTCDate() + (grupo.diasCaducidad || 90)); if (fechaCaducidad >= hoy && (fechaMasProxima === null || fechaCaducidad < fechaMasProxima)) { fechaMasProxima = fechaCaducidad; } } }); return fechaMasProxima; }
function getPuntosEnProximoVencimiento(cliente) { const fechaProximoVencimiento = getFechaProximoVencimiento(cliente); if (!fechaProximoVencimiento) return 0; let puntosAVencer = 0; cliente.historialPuntos.forEach(grupo => { if (grupo.puntosDisponibles > 0 && grupo.estado !== 'Caducado') { const fechaObtencion = new Date(grupo.fechaObtencion.split('T')[0] + 'T00:00:00Z'); const fechaCaducidad = new Date(fechaObtencion); fechaCaducidad.setUTCDate(fechaCaducidad.getUTCDate() + (grupo.diasCaducidad || 90)); if (fechaCaducidad.getTime() === fechaProximoVencimiento.getTime()) { puntosAVencer += grupo.puntosDisponibles; } } }); return puntosAVencer; }


// ====================================================================
// == LÓGICA DE AUTENTICACIÓN (antes en auth.js)                    ==
// ====================================================================
async function login() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const boton = document.getElementById('login-btn');
    if (!email || !password) return showToast("Ingresa tu email y contraseña.", "error");
    boton.disabled = true;
    boton.textContent = 'Ingresando...';
    try {
        await auth.signInWithEmailAndPassword(email, password);
    } catch (error) {
        if (['auth/user-not-found', 'auth/wrong-password', 'auth/invalid-credential'].includes(error.code)) {
            showToast("Email o contraseña incorrectos.", "error");
        } else {
            showToast("Error al iniciar sesión.", "error");
        }
    } finally {
        boton.disabled = false;
        boton.textContent = 'Ingresar';
    }
}
async function sendPasswordResetFromLogin() {
    const email = prompt("Por favor, ingresa tu dirección de email:");
    if (!email) return;
    try {
        await auth.sendPasswordResetEmail(email);
        showToast(`Si existe una cuenta para ${email}, recibirás un correo.`, "success", 10000);
    } catch (error) {
        showToast("Ocurrió un problema al enviar el correo.", "error");
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
    if (!nombre || !dni || !email || !password || !fechaNacimiento) return showToast("Completa todos los campos.", "error");
    if (!/^[0-9]+$/.test(dni) || dni.length < 6) return showToast("El DNI debe tener al menos 6 números.", "error");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showToast("Ingresa un email válido.", "error");
    if (password.length < 6) return showToast("La contraseña debe tener al menos 6 caracteres.", "error");
    if (!termsAccepted) return showToast("Debes aceptar los Términos y Condiciones.", "error");
    const boton = document.getElementById('register-btn');
    boton.disabled = true;
    boton.textContent = 'Creando...';
    try {
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        await db.collection('clientes').add({
            authUID: userCredential.user.uid,
            numeroSocio: null, nombre, dni, email, telefono, fechaNacimiento,
            fechaInscripcion: new Date().toISOString().split('T')[0],
            puntos: 0, saldoAcumulado: 0, totalGastado: 0,
            historialPuntos: [], historialCanjes: [], fcmTokens: [],
            terminosAceptados: termsAccepted, passwordPersonalizada: true
        });
    } catch (error) {
        if (error.code === 'auth/email-already-in-use') {
            showToast("Este email ya ha sido registrado.", "error");
        } else {
            showToast("No se pudo crear la cuenta.", "error");
        }
    } finally {
        boton.disabled = false;
        boton.textContent = 'Crear Cuenta';
    }
}
async function changePassword() {
    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmNewPassword = document.getElementById('confirm-new-password').value;
    if (!currentPassword || !newPassword || !confirmNewPassword) return showToast("Completa todos los campos.", "error");
    if (newPassword.length < 6) return showToast("La nueva contraseña debe tener al menos 6 caracteres.", "error");
    if (newPassword !== confirmNewPassword) return showToast("Las nuevas contraseñas no coinciden.", "error");
    const boton = document.getElementById('save-new-password-btn');
    boton.disabled = true;
    boton.textContent = 'Guardando...';
    try {
        const user = auth.currentUser;
        const credential = firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
        await user.reauthenticateWithCredential(credential);
        await user.updatePassword(newPassword);
        showToast("¡Contraseña actualizada con éxito!", "success");
        closeChangePasswordModal();
    } catch (error) {
        if (error.code === 'auth/wrong-password') {
            showToast("La contraseña actual es incorrecta.", "error");
        } else {
            showToast("No se pudo actualizar la contraseña.", "error");
        }
    } finally {
        boton.disabled = false;
        boton.textContent = 'Guardar Nueva Contraseña';
    }
}
async function logout() {
    try {
        await auth.signOut();
    } catch (error) {
        showToast("Error al cerrar sesión.", "error");
    }
}


// ====================================================================
// == INICIALIZACIÓN DE LA APLICACIÓN                               ==
// ====================================================================

function initializeApp() {
    setupFirebase();
    document.getElementById('show-register-link')?.addEventListener('click', (e) => { e.preventDefault(); showScreen('register-screen'); });
    document.getElementById('show-login-link')?.addEventListener('click', (e) => { e.preventDefault(); showScreen('login-screen'); });
    document.getElementById('login-btn')?.addEventListener('click', login);
    document.getElementById('register-btn')?.addEventListener('click', registerNewAccount);
    document.getElementById('forgot-password-link')?.addEventListener('click', (e) => { e.preventDefault(); sendPasswordResetFromLogin(); });
    document.getElementById('logout-btn')?.addEventListener('click', logout);
    document.getElementById('change-password-btn')?.addEventListener('click', openChangePasswordModal);
    document.getElementById('accept-terms-btn-modal')?.addEventListener('click', acceptTerms);
    document.getElementById('show-terms-link')?.addEventListener('click', (e) => { e.preventDefault(); openTermsModal(false); });
    document.getElementById('show-terms-link-banner')?.addEventListener('click', (e) => { e.preventDefault(); openTermsModal(true); });
    document.getElementById('footer-terms-link')?.addEventListener('click', (e) => { e.preventDefault(); openTermsModal(false); });
    document.getElementById('close-terms-modal')?.addEventListener('click', closeTermsModal);
    document.getElementById('close-password-modal')?.addEventListener('click', closeChangePasswordModal);
    document.getElementById('save-new-password-btn')?.addEventListener('click', changePassword);
    checkMessagingSupport().then(isSupported => {
        if (isSupported) {
            document.getElementById('btn-activar-notif-prompt')?.addEventListener('click', Notifications.handlePermissionRequest);
            document.getElementById('btn-rechazar-notif-prompt')?.addEventListener('click', Notifications.dismissPermissionRequest);
            document.getElementById('notif-switch')?.addEventListener('change', Notifications.handlePermissionSwitch);
            Notifications.listenForInAppMessages();
        }
    });
    auth.onAuthStateChanged(user => {
        if (user) {
            showScreen('loading-screen');
            listenToClientData(user);
        } else {
            cleanupListener();
            showScreen('login-screen');
        }
    });
}
document.addEventListener('DOMContentLoaded', initializeApp);
