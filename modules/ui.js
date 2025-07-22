// modules/ui.js (PWA)
// Gestiona toda la manipulación del DOM.

import * as Data from './data.js';

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

export function renderMainScreen(clienteData, premiosData) {
    if (!clienteData) return;

    // Encabezado
    document.getElementById('cliente-nombre').textContent = clienteData.nombre.split(' ')[0];
    document.getElementById('cliente-numero-socio').textContent = clienteData.numeroSocio ? `#${clienteData.numeroSocio}` : 'N° Pendiente';
    document.getElementById('cliente-puntos').textContent = clienteData.puntos || 0;

    // Banner de términos y condiciones
    document.getElementById('terms-banner').style.display = !clienteData.terminosAceptados ? 'block' : 'none';
    
    // Tarjeta de vencimiento de puntos
    const puntosPorVencer = Data.getPuntosEnProximoVencimiento(clienteData);
    const fechaVencimiento = Data.getFechaProximoVencimiento(clienteData);
    const vencimientoCard = document.getElementById('vencimiento-card');
    if (puntosPorVencer > 0 && fechaVencimiento) {
        vencimientoCard.style.display = 'block';
        document.getElementById('cliente-puntos-vencimiento').textContent = puntosPorVencer;
        document.getElementById('cliente-fecha-vencimiento').textContent = formatearFecha(fechaVencimiento.toISOString());
    } else {
        vencimientoCard.style.display = 'none';
    }

    // Historial reciente
    const historialLista = document.getElementById('lista-historial');
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

    // Catálogo de premios
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
    } else {
        premiosLista.innerHTML = '<li>No hay premios disponibles en este momento.</li>';
    }

    showScreen('main-app-screen');
}

export function openTermsModal(showAcceptButton) {
    document.getElementById('terms-modal').style.display = 'flex';
    document.getElementById('accept-terms-btn-modal').style.display = showAcceptButton ? 'block' : 'none';
}

export function closeTermsModal() {
    document.getElementById('terms-modal').style.display = 'none';
}