// pwa/modules/ui.js

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

export function openForgotPasswordModal() {
    const modal = document.getElementById('forgot-password-modal');
    if (modal) {
        document.getElementById('forgot-password-email-input').value = '';
        modal.style.display = 'flex';
    }
}

export function closeForgotPasswordModal() {
    const modal = document.getElementById('forgot-password-modal');
    if (modal) modal.style.display = 'none';
}
