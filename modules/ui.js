//AAA pwa/modules/ui.js

import * as Data from './data.js';

function safeSetText(id, content) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = content;
    } else {
        console.warn(`[UI SafeSet] Elemento con ID "${id}" no encontrado al intentar actualizar.`);
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

export function renderMainScreen(clienteData, premiosData) {
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
// panel-administrador/modules/ui.js

// ... todo el código existente de ui.js ...

/**
 * Renderiza las campañas activas: como banner si tienen URL, o como tarjeta de texto si no.
 * @param {Array} campañasActivas Un array con los objetos de las campañas.
 */
/**
 * Renderiza las campañas activas.
 * Muestra siempre el nombre y el beneficio en una tarjeta.
 * Si además hay una URL de banner, la añade encima del texto.
 * @param {Array} campañasActivas Un array con los objetos de las campañas.
 */
export function renderCampaigns(campañasActivas) {
    const container = document.getElementById('campanas-container');
    const contentDiv = document.getElementById('campanas-banners');

    if (!container || !contentDiv) return;

    if (!campañasActivas || campañasActivas.length === 0) {
        container.style.display = 'none';
        return;
    }

    contentDiv.innerHTML = ''; // Limpiamos contenido anterior.
    
    campañasActivas.forEach(campana => {
        // 1. Creamos siempre la tarjeta base que contendrá todo.
        const campaignCard = document.createElement('div');
        campaignCard.className = 'campaign-item-card'; // Nueva clase para la tarjeta contenedora

        // 2. Creamos el contenedor para el texto del beneficio.
        const textContent = document.createElement('div');
        textContent.className = 'campaign-text-content';

        let beneficioTexto = '';
        if (campana.tipo === 'multiplicador_compra') {
            beneficioTexto = `Beneficio: Puntos x${campana.valor}`;
        } else if (campana.tipo === 'bono_fijo_compra') {
            beneficioTexto = `Beneficio: +${campana.valor} Puntos Extra`;
        } else {
            // Para campañas informativas, el beneficio puede estar implícito en el nombre o banner.
            beneficioTexto = 'Promoción Especial';
        }

        textContent.innerHTML = `
            <h4>${campana.nombre}</h4>
            <p>${beneficioTexto}</p>
        `;

        // 3. Si hay una URL de banner, creamos la imagen y la insertamos ANTES del texto.
        if (campana.urlBanner && campana.urlBanner.trim() !== '') {
            const img = document.createElement('img');
            img.src = campana.urlBanner;
            img.alt = `Banner de ${campana.nombre}`;
            campaignCard.appendChild(img); // Añadimos la imagen primero
        }
        
        // 4. Añadimos siempre el contenido de texto.
        campaignCard.appendChild(textContent);

        // 5. Añadimos la tarjeta completa al contenedor principal.
        contentDiv.appendChild(campaignCard);
    });

    container.style.display = 'block';
}
