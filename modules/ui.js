// pwa/modules/ui.js (VERSIÓN OK - export top-level, carrusel + historial reciente)

import * as Data from './data.js';

// --- Estado del carrusel ---
let carouselIntervalId = null;
let isDragging = false, startX, startScrollLeft;

// ─────────────────────────────────────────────────────────────
// Utilidades base
// ─────────────────────────────────────────────────────────────
function safeSetText(id, content) {
  const el = document.getElementById(id);
  if (el) el.textContent = content;
  else console.warn(`[UI SafeSet] No existe #${id}`);
}

export function showToast(message, type = 'info', duration = 6000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

export function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(screenId);
  if (target) target.classList.add('active');
  else console.error(`[UI ShowScreen] No existe #${screenId}`);
}

function formatearFecha(iso) {
  if (!iso) return 'N/A';
  const parts = String(iso).split('T')[0].split('-');
  if (parts.length !== 3) return 'Fecha inválida';
  const d = new Date(Date.UTC(parts[0], parts[1]-1, parts[2]));
  if (isNaN(d)) return 'Fecha inválida';
  const dd = String(d.getUTCDate()).padStart(2,'0');
  const mm = String(d.getUTCMonth()+1).padStart(2,'0');
  const yy = d.getUTCFullYear();
  return `${dd}/${mm}/${yy}`;
}

// ─────────────────────────────────────────────────────────────
// Pantalla principal
// ─────────────────────────────────────────────────────────────
export function renderMainScreen(clienteData, premiosData, campanasData = []) {
  if (!clienteData) return;

  safeSetText('cliente-nombre', (clienteData.nombre || '--').split(' ')[0]);
  safeSetText('cliente-numero-socio', clienteData.numeroSocio ? `#${clienteData.numeroSocio}` : 'N° De Socio Pendiente de Aceptacion');
  safeSetText('cliente-puntos', clienteData.puntos || 0);

  const termsBanner = document.getElementById('terms-banner');
  if (termsBanner) termsBanner.style.display = !clienteData.terminosAceptados ? 'block' : 'none';

  // Tarjeta de vencimiento (la dejamos visible con 0/— si no hay próximas tandas)
  const vencCard = document.getElementById('vencimiento-card');
  if (vencCard) {
    const pts = Data.getPuntosEnProximoVencimiento(clienteData);
    const fecha = Data.getFechaProximoVencimiento(clienteData);
    safeSetText('cliente-puntos-vencimiento', pts > 0 ? pts : 0);
    safeSetText('cliente-fecha-vencimiento', fecha ? formatearFecha(fecha.toISOString()) : '—');
    vencCard.style.display = 'block';
  }

  // Historial reciente (incluye canjes)
  renderRecentHistory(clienteData);

  // Lista de premios
  const premiosLista = document.getElementById('lista-premios-cliente');
  if (premiosLista) {
    premiosLista.innerHTML = '';
    if (Array.isArray(premiosData) && premiosData.length) {
      premiosData.forEach(premio => {
        const li = document.createElement('li');
        const puede = Number(clienteData.puntos || 0) >= Number(premio.puntos || 0);
        li.className = puede ? 'canjeable' : 'no-canjeable';
        li.innerHTML = `<strong>${premio.nombre}</strong> <span class="puntos-premio">${premio.puntos} Puntos</span>`;
        premiosLista.appendChild(li);
      });
    } else {
      premiosLista.innerHTML = '<li>No hay premios disponibles en este momento.</li>';
    }
  }

  // Carrusel de campañas
  renderCampanasCarousel(campanasData);

  showScreen('main-app-screen');
}

export function openTermsModal(showAcceptButton) {
  const m = document.getElementById('terms-modal');
  const btn = document.getElementById('accept-terms-btn-modal');
  if (m) m.style.display = 'flex';
  if (btn) btn.style.display = showAcceptButton ? 'block' : 'none';
}
export function closeTermsModal() {
  const m = document.getElementById('terms-modal');
  if (m) m.style.display = 'none';
}

export function openChangePasswordModal() {
  const m = document.getElementById('change-password-modal');
  if (!m) return;
  document.getElementById('current-password').value = '';
  document.getElementById('new-password').value = '';
  document.getElementById('confirm-new-password').value = '';
  m.style.display = 'flex';
}
export function closeChangePasswordModal() {
  const m = document.getElementById('change-password-modal');
  if (m) m.style.display = 'none';
}

// ─────────────────────────────────────────────────────────────
// Carrusel de campañas
// ─────────────────────────────────────────────────────────────
function renderCampanasCarousel(campanasData) {
  const container = document.getElementById('carrusel-campanas-container');
  const carrusel = document.getElementById('carrusel-campanas');
  const indicadoresContainer = document.getElementById('carrusel-indicadores');
  if (!container || !carrusel || !indicadoresContainer) return;

  if (carouselIntervalId) clearInterval(carouselIntervalId);

  const campanasVisibles = Array.isArray(campanasData) ? campanasData : [];
  if (!campanasVisibles.length) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  carrusel.innerHTML = '';
  indicadoresContainer.innerHTML = '';

  campanasVisibles.forEach((campana, index) => {
    let item;

    if (campana.urlBanner) {
      // Con imagen (y posible overlay de texto)
      item = document.createElement('a');
      item.href = '#';
      item.target = '_blank';
      item.rel = 'noopener noreferrer';
      item.className = 'banner-item banner-con-imagen';

      const img = document.createElement('img');
      img.src = campana.urlBanner;
      img.alt = campana.nombre;
      item.appendChild(img);

      if (campana.cuerpo) {
        const overlay = document.createElement('div');
        overlay.className = 'banner-texto-overlay';
        const h4 = document.createElement('h4');
        h4.textContent = campana.nombre;
        const p = document.createElement('p');
        p.textContent = campana.cuerpo;
        overlay.appendChild(h4);
        overlay.appendChild(p);
        item.appendChild(overlay);
      }
    } else {
      // Solo texto
      item = document.createElement('div');
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
      const left = carrusel.children[index].offsetLeft;
      carrusel.scrollTo({ left, behavior: 'smooth' });
    });
    indicadoresContainer.appendChild(indicador);
  });

  const updateActiveIndicator = () => {
    const scrollLeft = carrusel.scrollLeft;
    const center = scrollLeft + carrusel.offsetWidth / 2;
    let currentIndex = 0;
    for (let i = 0; i < carrusel.children.length; i++) {
      const it = carrusel.children[i];
      const itCenter = it.offsetLeft + it.offsetWidth / 2;
      if (Math.abs(itCenter - center) < it.offsetWidth / 2) {
        currentIndex = i; break;
      }
    }
    indicadoresContainer.querySelectorAll('.indicador').forEach((ind, idx) => {
      ind.classList.toggle('activo', idx === currentIndex);
    });
  };

  const startCarousel = () => {
    if (carouselIntervalId) clearInterval(carouselIntervalId);
    carouselIntervalId = setInterval(() => {
      if (isDragging) return;
      const end = carrusel.scrollWidth - carrusel.clientWidth;
      if (carrusel.scrollLeft >= end - 1) {
        carrusel.scrollTo({ left: 0, behavior: 'smooth' });
      } else {
        const step = (carrusel.firstElementChild?.offsetWidth || 200) + 15;
        carrusel.scrollBy({ left: step, behavior: 'smooth' });
      }
    }, 3000);
  };
  const stopCarousel = () => clearInterval(carouselIntervalId);

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
    const walk = (x - startX) * 2;
    carrusel.scrollLeft = startScrollLeft - walk;
    updateActiveIndicator();
  };

  carrusel.addEventListener('mousedown', dragStart);
  carrusel.addEventListener('touchstart', dragStart, { passive: true });
  carrusel.addEventListener('mousemove', dragging);
  carrusel.addEventListener('touchmove', dragging, { passive: true });
  carrusel.addEventListener('mouseup', dragStop);
  carrusel.addEventListener('mouseleave', dragStop);
  carrusel.addEventListener('touchend', dragStop);
  carrusel.addEventListener('scroll', () => { if (!isDragging) updateActiveIndicator(); });

  updateActiveIndicator();
  if (campanasVisibles.length > 1) startCarousel();
}

// ─────────────────────────────────────────────────────────────
// Historial reciente (puntos + canjes)
// ─────────────────────────────────────────────────────────────
function parseDateLike(d) {
  if (!d) return null;
  if (typeof d?.toDate === 'function') return d.toDate();
  const t = new Date(d);
  return isNaN(t) ? null : t;
}

export function renderRecentHistory(cliente = {}) {
  const hp = Array.isArray(cliente.historialPuntos) ? cliente.historialPuntos : [];
  const hc = Array.isArray(cliente.historialCanjes) ? cliente.historialCanjes : [];

  const items = [];

  // Movimientos de puntos
  hp.forEach(i => {
    const fecha = parseDateLike(i.fechaObtencion);
    if (!fecha) return;
    const pts = Number(i?.puntosObtenidos ?? i?.puntosDisponibles ?? 0);
    const origen = i?.origen || (pts >= 0 ? 'Puntos' : 'Ajuste');
    items.push({
      ts: +fecha,
      texto: `${origen} ${pts >= 0 ? `(+${pts})` : `(${pts})`}`,
      fecha
    });
  });

  // Canjes
  hc.forEach(i => {
    const fecha = parseDateLike(i.fechaCanje);
    if (!fecha) return;
    const nombre = i?.nombrePremio || 'Premio';
    const coste  = Number(i?.puntosCoste || 0);
    items.push({
      ts: +fecha,
      texto: `Canje: ${nombre} (-${coste} pts)`,
      fecha
    });
  });

  items.sort((a,b) => b.ts - a.ts);
  const top = items.slice(0, 5);

  const ul = document.getElementById('lista-historial');
  if (!ul) return;

  ul.innerHTML = top.length
    ? top.map(x => `<li>${x.texto} · <small>${x.fecha.toLocaleDateString('es-AR')}</small></li>`).join('')
    : `<li class="muted">Sin movimientos recientes</li>`;
}

// Re-render cuando se actualiza el cliente desde data.js
document.addEventListener('rampet:cliente-updated', (e) => {
  try { renderRecentHistory(e.detail?.cliente || {}); } catch {}
});
