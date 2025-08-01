// pwa/modules/ui.js (VERSIÓN FINAL CON CARRUSEL MEJORADO)

import * as Data from './data.js';

// --- Variable global para el intervalo y estado del carrusel ---
let carouselIntervalId = null;
let isDragging = false, startX, startScrollLeft;


// ====================================================================
// == FUNCIONES DE AYUDA Y RENDERIZADO GENERAL                      ==
// ====================================================================

function safeSetText(id, content) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = content;
    } else {
        console.warn(`[UI SafeSet] Elemento con ID "${id}" no encontrado.`);
    }
}

export function showToast(message, type = 'info', duration = 5000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
}

export function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
    const screenToShow = document.getElementById(screenId);
    if (screenToShow) {
        screenToShow.classList.add('active');
    } else {
        console.error(`[UI ShowScreen] No se encontró la pantalla con ID "${screenId}".`);
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

export function renderMainScreen(clienteData, premiosData, campanasData = []) {
    if (!clienteData) return;

    safeSetText('cliente-nombre', clienteData.nombre.split(' ')[0]);
    safeSetText('cliente-numero-socio', clienteData.numeroSocio ? `#${clienteData.numeroSocio}` : 'N° Pendiente');
    safeSetText('cliente-puntos', clienteData.puntos || 0);

    const termsBanner = document.getElementById('terms-banner');
    if (termsBanner) {
        termsBanner.style.display = !clienteData.terminosAceptados ? 'block' : 'none';
    }

    const vencimientoCard = document.getElementById('vencimiento-card');
    const puntosPorVencer = Data.getPuntosEnProximoVencimiento(clienteData);
    const fechaVencimiento = Data.getFechaProximoVencimiento(clienteData);

    if (vencimientoCard) {
        if (puntosPorVencer > 0 && fechaVencimiento) {
            vencimientoCard.style.display = 'block';
            safeSetText('cliente-puntos-vencimiento', puntosPorVencer);
            safeSetText('cliente-fecha-vencimiento', formatearFecha(fechaVencimiento.toISOString()));
        } else {
            vencimientoCard.style.display = 'none';
        }
    }

    const historialLista = document.getElementById('lista-historial');
    if (historialLista) {
        historialLista.innerHTML = '';
        const historialReciente = [...(clienteData.historialPuntos || [])].sort((a,b) => new Date(b.fechaObtencion) - new Date(a.fechaObtencion)).slice(0, 5);
        if (historialReciente.length > 0) {
            historialReciente.forEach(item => {
                const li = document.createElement('li');
                const puntos = item.puntosObtenidos > 0 ? `+${item.puntosObtenidos}` : item.puntosObtenidos;
                li.innerHTML = `<span>${formatearFecha(item.fechaObtencion)}</span> <strong>${item.origen}</strong> <span class="puntos ${puntos > 0 ? 'ganados':'gastados'}">${puntos} pts</span>`;
                historialLista.appendChild(li);
            });
        } else {
            historialLista.innerHTML = '<li>Aún no tienes movimientos.</li>';
        }
    }

    const premiosLista = document.getElementById('lista-premios-cliente');
    if (premiosLista) {
        premiosLista.innerHTML = '';
        if (premiosData && premiosData.length > 0) {
            premiosData.forEach(premio => {
                const li = document.createElement('li');
                const puedeCanjear = clienteData.puntos >= premio.puntos;
                li.className = puedeCanjear ? 'canjeable' : 'no-canjeable';
                li.innerHTML = `<strong>${premio.nombre}</strong> <span class="puntos-premio">${premio.puntos} Puntos</span>`;
                premiosLista.appendChild(li);
            });
        } else {
            premiosLista.innerHTML = '<li>No hay premios disponibles en este momento.</li>';
        }
    }
    
    // Llamada a la nueva función del carrusel
    renderCampanasCarousel(campanasData);

    showScreen('main-app-screen');
}

export function openTermsModal(showAcceptButton) {
    const modal = document.getElementById('terms-modal');
    const button = document.getElementById('accept-terms-btn-modal');
    if(modal) modal.style.display = 'flex';
    if(button) button.style.display = showAcceptButton ? 'block' : 'none';
}

export function closeTermsModal() {
    const modal = document.getElementById('terms-modal');
    if(modal) modal.style.display = 'none';
}

export function openChangePasswordModal() {
    const modal = document.getElementById('change-password-modal');
    if (modal) {
        document.getElementById('current-password').value = '';
        document.getElementById('new-password').value = '';
        document.getElementById('confirm-new-password').value = '';
        modal.style.display = 'flex';
    }
}

export function closeChangePasswordModal() {
    const modal = document.getElementById('change-password-modal');
    if (modal) modal.style.display = 'none';
}

// ====================================================================
// == FUNCIONALIDAD DEL CARRUSEL DE CAMPAÑAS                        ==
// ====================================================================

// pwa/modules/ui.js -> REEMPLAZAR ESTA FUNCIÓN COMPLETA

// pwa/modules/ui.js -> REEMPLAZAR ESTA FUNCIÓN COMPLETA CON LA VERSIÓN FINAL

function renderCampanasCarousel(campanasData) {
    const container = document.getElementById('carrusel-campanas-container');
    const carrusel = document.getElementById('carrusel-campanas');
    const indicadoresContainer = document.getElementById('carrusel-indicadores');
    if (!container || !carrusel || !indicadoresContainer) return;

    if (carouselIntervalId) clearInterval(carouselIntervalId);

    const campanasVisibles = Array.isArray(campanasData) ? campanasData : [];
    if (campanasVisibles.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    carrusel.innerHTML = '';
    indicadoresContainer.innerHTML = '';

    let currentIndex = 0; // Índice del banner actual.

    // Función para desplazarse a un banner por su índice.
    const scrollToIndex = (index) => {
        const targetItem = carrusel.children[index];
        if (targetItem) {
            // El scroll-snap del CSS hará el trabajo de centrado.
            // Solo necesitamos desplazarlo a su posición de inicio.
            carrusel.scrollTo({
                left: targetItem.offsetLeft,
                behavior: 'smooth'
            });
        }
    };

    // Función para actualizar qué punto indicador está activo.
    const updateActiveIndicator = (index) => {
        indicadoresContainer.querySelectorAll('.indicador').forEach((ind, idx) => {
            ind.classList.toggle('activo', idx === index);
        });
    };

    // Lógica de auto-scroll
    const startCarousel = () => {
        if (carouselIntervalId) clearInterval(carouselIntervalId);
        if (campanasVisibles.length <= 1) return; // No iniciar si no hay suficientes banners
        
        carouselIntervalId = setInterval(() => {
            currentIndex = (currentIndex + 1) % campanasVisibles.length;
            scrollToIndex(currentIndex);
        }, 3000); // Cambia cada 4 segundos
    };

    const stopCarousel = () => clearInterval(carouselIntervalId);

    // --- LA CLAVE: Intersection Observer ---
    // Este observador se encarga de sincronizar el estado (currentIndex y los puntos)
    // de forma eficiente cada vez que el scroll del usuario se detiene.
    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    // entry.target es el banner que se ha vuelto visible.
                    // Buscamos su índice dentro de la lista de banners.
                    const newIndex = Array.from(carrusel.children).indexOf(entry.target);
                    currentIndex = newIndex; // Actualizamos nuestro índice de estado.
                    updateActiveIndicator(currentIndex); // Actualizamos los puntos.
                }
            });
        },
        {
            root: carrusel, // El scroll ocurre dentro del propio carrusel.
            threshold: 0.75, // Se activa cuando el 75% del banner está visible.
        }
    );

    // Creamos los banners y los indicadores
    campanasVisibles.forEach((campana, index) => {
        // --- Creación del banner (código sin cambios) ---
        const item = campana.urlBanner ? document.createElement('a') : document.createElement('div');
        if (campana.urlBanner) {
            item.href = campana.urlBanner;
            item.target = '_blank';
            item.rel = 'noopener noreferrer';
            item.className = 'banner-item';
            const img = document.createElement('img');
            img.src = campana.urlBanner;
            img.alt = campana.nombre;
            item.appendChild(img);
        } else {
            item.className = 'banner-item-texto';
            const title = document.createElement('h4');
            title.textContent = campana.nombre;
            item.appendChild(title);
            if (campana.cuerpo) {
                const description = document.createElement('p');
                description.textContent = campana.cuerpo;
                item.appendChild(description);
            }
        }
        carrusel.appendChild(item);
        observer.observe(item); // <- ¡Importante! Le decimos al observador que vigile este banner.

        // --- Creación del indicador ---
        const indicador = document.createElement('span');
        indicador.className = 'indicador';
        indicador.addEventListener('click', () => scrollToIndex(index));
        indicadoresContainer.appendChild(indicador);
    });

    // --- Mejorar la Experiencia de Usuario ---
    // Pausamos el auto-scroll cuando el usuario interactúa con el carrusel.
    carrusel.addEventListener('mouseenter', stopCarousel);
    carrusel.addEventListener('mouseleave', startCarousel);
    carrusel.addEventListener('touchstart', stopCarousel, { passive: true });
    carrusel.addEventListener('touchend', startCarousel);

    // Iniciar todo
    updateActiveIndicator(0); // Activamos el primer punto al cargar.
    startCarousel(); // Iniciamos el auto-scroll.
}
