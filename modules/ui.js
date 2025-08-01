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

function renderCampanasCarousel(campanasData) {
    const container = document.getElementById('carrusel-campanas-container');
    const carrusel = document.getElementById('carrusel-campanas');
    const indicadoresContainer = document.getElementById('carrusel-indicadores');
    if (!container || !carrusel || !indicadoresContainer) return;

    // Detenemos cualquier intervalo anterior para evitar fugas de memoria
    if (carouselIntervalId) clearInterval(carouselIntervalId);

    const campanasVisibles = Array.isArray(campanasData) ? campanasData : [];
    if (campanasVisibles.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    carrusel.innerHTML = '';
    indicadoresContainer.innerHTML = '';

    // --- NUEVA LÓGICA CON ÍNDICE ---
    let currentIndex = 0; // Este es nuestro contador de estado
    let isDragging = false, startX, startScrollLeft;

    campanasVisibles.forEach((campana, index) => {
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

        const indicador = document.createElement('span');
        indicador.className = 'indicador';
        indicador.dataset.index = index;
        indicador.addEventListener('click', () => {
            currentIndex = index; // Actualizamos el contador
            scrollToIndex(currentIndex);
        });
        indicadoresContainer.appendChild(indicador);
    });
    
    // Función para desplazarse a un índice específico
    const scrollToIndex = (index) => {
        const targetItem = carrusel.children[index];
        if (targetItem) {
            const scrollTarget = targetItem.offsetLeft + (targetItem.offsetWidth / 2) - (carrusel.offsetWidth / 2);
            carrusel.scrollTo({ left: scrollTarget, behavior: 'smooth' });
        }
    };
    
    // Función para actualizar los indicadores (puntitos)
    const updateActiveIndicator = () => {
        // En lugar de calcular con el scroll, usamos nuestro contador `currentIndex`
        indicadoresContainer.querySelectorAll('.indicador').forEach((ind, idx) => {
            ind.classList.toggle('activo', idx === currentIndex);
        });
    };
    
    // --- LÓGICA DE AUTO-SCROLL MEJORADA ---
    const startCarousel = () => {
        if (carouselIntervalId) clearInterval(carouselIntervalId);
        carouselIntervalId = setInterval(() => {
            if (isDragging) return;
            // Simplemente incrementamos el contador y lo reiniciamos si llega al final
            currentIndex = (currentIndex + 1) % campanasVisibles.length;
            scrollToIndex(currentIndex);
            updateActiveIndicator(); // Actualizamos los puntitos
        }, 3000);  //tiempo desplazamiento
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
        // RE-SINCRONIZAMOS el contador después del arrastre
        const scrollLeft = carrusel.scrollLeft;
        const carouselCenter = scrollLeft + carrusel.offsetWidth / 2;
        let newIndex = 0;
        let minDistance = Infinity;
        for (let i = 0; i < carrusel.children.length; i++) {
            const item = carrusel.children[i];
            const itemCenter = item.offsetLeft + item.offsetWidth / 2;
            const distance = Math.abs(itemCenter - carouselCenter);
            if (distance < minDistance) {
                minDistance = distance;
                newIndex = i;
            }
        }
        currentIndex = newIndex; // Actualizamos el contador
        updateActiveIndicator();
        startCarousel();
    };
    
    const dragging = (e) => {
        if (!isDragging) return;
        e.preventDefault();
        const x = (e.pageX || e.touches[0].pageX) - carrusel.offsetLeft;
        const walk = (x - startX) * 2;
        carrusel.scrollLeft = startScrollLeft - walk;
    };
    
    // Escuchador de 'scroll' para actualizar los puntitos durante el arrastre
    const onScroll = () => {
        const scrollLeft = carrusel.scrollLeft;
        const carouselCenter = scrollLeft + carrusel.offsetWidth / 2;
        let newIndex = 0;
        let minDistance = Infinity;
        for (let i = 0; i < carrusel.children.length; i++) {
            const item = carrusel.children[i];
            const itemCenter = item.offsetLeft + item.offsetWidth / 2;
            const distance = Math.abs(itemCenter - carouselCenter);
            if (distance < minDistance) {
                minDistance = distance;
                newIndex = i;
            }
        }
        // Solo actualizamos los puntitos, no el contador principal `currentIndex`
        indicadoresContainer.querySelectorAll('.indicador').forEach((ind, idx) => {
            ind.classList.toggle('activo', idx === newIndex);
        });
    };

    // Añadimos los listeners
    carrusel.addEventListener('mousedown', dragStart);
    carrusel.addEventListener('touchstart', dragStart, { passive: true });
    carrusel.addEventListener('mousemove', dragging);
    carrusel.addEventListener('touchmove', dragging, { passive: true });
    carrusel.addEventListener('mouseup', dragStop);
    carrusel.addEventListener('mouseleave', dragStop);
    carrusel.addEventListener('touchend', dragStop);
    carrusel.addEventListener('scroll', onScroll, { passive: true });

    // Iniciar todo
    updateActiveIndicator();
    if (campanasVisibles.length > 1) {
        startCarousel();
    }
}
