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

    campanasVisibles.forEach((campana, index) => {
        // Crear item del carrusel (banner o tarjeta de texto)
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

        // Crear indicador (puntito)
        const indicador = document.createElement('span');
        indicador.className = 'indicador';
        indicador.dataset.index = index;
        indicador.addEventListener('click', () => {
            const itemWidth = carrusel.children[index].offsetLeft;
            carrusel.scrollTo({ left: itemWidth, behavior: 'smooth' });
        });
        indicadoresContainer.appendChild(indicador);
    });

    // --- LÓGICA DE ACTUALIZACIÓN DE INDICADORES ---
    const updateActiveIndicator = () => {
        // Usamos un umbral para detectar qué item está más centrado
        const scrollLeft = carrusel.scrollLeft;
        const carouselCenter = scrollLeft + carrusel.offsetWidth / 2;
        let currentIndex = 0;
        for (let i = 0; i < carrusel.children.length; i++) {
            const item = carrusel.children[i];
            const itemCenter = item.offsetLeft + item.offsetWidth / 2;
            if (Math.abs(itemCenter - carouselCenter) < item.offsetWidth / 2) {
                currentIndex = i;
                break;
            }
        }
        
        indicadoresContainer.querySelectorAll('.indicador').forEach((ind, idx) => {
            ind.classList.toggle('activo', idx === currentIndex);
        });
    };
    
    // --- LÓGICA DE AUTO-SCROLL ---
    const startCarousel = () => {
        if (carouselIntervalId) clearInterval(carouselIntervalId);
        carouselIntervalId = setInterval(() => {
            if (isDragging) return;
            const scrollEnd = carrusel.scrollWidth - carrusel.clientWidth;
            // Si está cerca del final, volver al principio
            if (carrusel.scrollLeft >= scrollEnd - 1) {
                carrusel.scrollTo({ left: 0, behavior: 'smooth' });
            } else {
                // Si no, avanzar al siguiente item
                carrusel.scrollBy({ left: carrusel.firstElementChild.offsetWidth + 15, behavior: 'smooth' });
            }
        }, 3000); // Cambiar cada 4 segundos
    };

    const stopCarousel = () => clearInterval(carouselIntervalId);

    // --- LÓGICA DE ARRASTRE (SWIPE) ---
    const dragStart = (e) => {
        isDragging = true;
        carrusel.classList.add('arrastrando');
        startX = (e.pageX || e.touches[0].pageX) - carrusel.offsetLeft;
        startScrollLeft = carrusel.scrollLeft;
        stopCarousel();
    };

    const dragStop = () => {
        isDragging = false;
        carrusel.classList.remove('arrastrando');
        startCarousel();
    };
    
    const dragging = (e) => {
        if (!isDragging) return;
        e.preventDefault();
        const x = (e.pageX || e.touches[0].pageX) - carrusel.offsetLeft;
        const walk = (x - startX) * 2; // El *2 es para que se sienta más rápido
        carrusel.scrollLeft = startScrollLeft - walk;
        updateActiveIndicator(); // Actualizar indicador mientras se arrastra
    };

    carrusel.addEventListener('mousedown', dragStart);
    carrusel.addEventListener('touchstart', dragStart, { passive: true });
    carrusel.addEventListener('mousemove', dragging);
    carrusel.addEventListener('touchmove', dragging, { passive: true });
    carrusel.addEventListener('mouseup', dragStop);
    carrusel.addEventListener('mouseleave', dragStop);
    carrusel.addEventListener('touchend', dragStop);
    carrusel.addEventListener('scroll', () => {
        if(!isDragging) updateActiveIndicator(); // Solo actualizar en scroll si no es por arrastre
    });

    // Iniciar todo
    updateActiveIndicator();
    if (campanasVisibles.length > 1) {
        startCarousel();
    }
}
