// modules/data.js (PWA - LISTENERS + vencimiento + SALDO + render unificado)

import { db } from './firebase.js';
import * as UI from './ui.js';
import * as Auth from './auth.js';
import * as Notifications from './notifications.js';

let clienteData = null;
let clienteRef = null;
let premiosData = [];
let campanasData = [];

let unsubscribeCliente = null;
let unsubscribeCampanas = null;

export function cleanupListener() {
  if (unsubscribeCliente) unsubscribeCliente();
  if (unsubscribeCampanas) unsubscribeCampanas();
  clienteData = null;
  clienteRef = null;
  premiosData = [];
  campanasData = [];
}

// === Saldo a favor ===
function updateSaldoCard(cliente = {}) {
  try {
    const card = document.getElementById('saldo-card');
    const saldoEl = document.getElementById('cliente-saldo');
    if (!card || !saldoEl) return;

    const raw = cliente.saldoAcumulado;
    const saldo = Number(isNaN(raw) ? 0 : raw);

    if (saldo > 0) {
      // Formato simple ARS (sin depender de Intl locales)
      const texto = `$ ${saldo.toFixed(2)}`;
      saldoEl.textContent = texto;
      card.style.display = 'block';
    } else {
      saldoEl.textContent = '$ 0.00';
      card.style.display = 'none';
    }
  } catch (e) {
    console.warn('updateSaldoCard error:', e);
  }
}

// === Puntos por vencer ===
export function updateVencimientoCard(cliente = {}) {
  try {
    const card = document.getElementById('vencimiento-card');
    const ptsEl = document.getElementById('cliente-puntos-vencimiento');
    const fechaEl = document.getElementById('cliente-fecha-vencimiento');
    if (!card || !ptsEl || !fechaEl) return;

    // Modelo 1: campos directos
    const pts = Number(cliente.puntosProximosAVencer || 0);
    const fechaTs = cliente.fechaProximoVencimiento;

    if (pts > 0 && fechaTs) {
      const date = fechaTs.toDate ? fechaTs.toDate() : new Date(fechaTs);
      ptsEl.textContent = String(pts);
      fechaEl.textContent = date.toLocaleDateString();
      card.style.display = 'block';
      return;
    }

    // Modelo 2: arreglo `vencimientos` [{ puntos, venceAt }]
    const v = Array.isArray(cliente.vencimientos) ? cliente.vencimientos : [];
    const now = Date.now();
    const futuros = v
      .map(x => ({
        puntos: Number(x?.puntos || 0),
        ts: x?.venceAt?.toDate ? x.venceAt.toDate().getTime() : (x?.venceAt ? new Date(x.venceAt).getTime() : 0)
      }))
      .filter(x => x.puntos > 0 && x.ts && x.ts > now)
      .sort((a, b) => a.ts - b.ts);

    if (futuros.length) {
      const primero = futuros[0];
      ptsEl.textContent = String(primero.puntos);
      fechaEl.textContent = new Date(primero.ts).toLocaleDateString();
      card.style.display = 'block';
    } else {
      card.style.display = 'none';
    }
  } catch (e) {
    console.warn('updateVencimientoCard error:', e);
  }
}

function renderizarPantallaPrincipal() {
  if (!clienteData) return;

  const hoy = new Date().toISOString().split('T')[0];

  const campanasVisibles = campanasData.filter(campana => {
    const esPublica = campana.visibilidad !== 'prueba';
    const esTesterYVePrueba = clienteData.esTester === true && campana.visibilidad === 'prueba';
    if (!(esPublica || esTesterYVePrueba)) return false;

    const fechaInicio = campana.fechaInicio;
    const fechaFin = campana.fechaFin;

    if (!fechaInicio || hoy < fechaInicio) return false;
    if (fechaFin && fechaFin !== '2100-01-01' && hoy > fechaFin) return false;

    return true;
  });

  // Render principal (nombre, puntos, carrusel, historial, premios)
  UI.renderMainScreen(clienteData, premiosData, campanasVisibles);

  // Extras visibles en home
  updateSaldoCard(clienteData);
  updateVencimientoCard(clienteData);
}

export async function listenToClientData(user) {
  UI.showScreen('loading-screen');

  if (unsubscribeCliente) unsubscribeCliente();
  if (unsubscribeCampanas) unsubscribeCampanas();

  // Premios (carga inicial)
  if (premiosData.length === 0) {
    try {
      const premiosSnapshot = await db.collection('premios').orderBy('puntos', 'asc').get();
      premiosData = premiosSnapshot.docs.map(p => ({ id: p.id, ...p.data() }));
    } catch (e) {
      console.error("Error cargando premios:", e);
    }
  }

  // Campañas en tiempo real
  const campanasQuery = db.collection('campanas').where('estaActiva', '==', true);
  unsubscribeCampanas = campanasQuery.onSnapshot(snapshot => {
    campanasData = snapshot.docs.map(doc => doc.data());
    console.log("Campañas actualizadas en tiempo real:", campanasData.length);
    renderizarPantallaPrincipal();
  }, error => {
    console.error("Error escuchando campañas:", error);
  });

  // Cliente en tiempo real
  const clienteQuery = db.collection('clientes').where("authUID", "==", user.uid).limit(1);
  unsubscribeCliente = clienteQuery.onSnapshot(snapshot => {
    if (snapshot.empty) {
      UI.showToast("Error: Tu cuenta no está vinculada a ninguna ficha de cliente.", "error");
      Auth.logout();
      return;
    }

    clienteData = snapshot.docs[0].data();
    clienteRef = snapshot.docs[0].ref;

    console.log("Datos del cliente actualizados en tiempo real.");
    renderizarPantallaPrincipal();

    // Notificaciones (permiso/token)
    Notifications.gestionarPermisoNotificaciones(clienteData);

  }, (error) => {
    console.error("Error en listener de cliente:", error);
    Auth.logout();
  });
}

// Stubs (si algún módulo los importa, no rompen)
export async function acceptTerms() { /* ... */ }
export function getFechaProximoVencimiento(cliente) { /* ... */ }
export function getPuntosEnProximoVencimiento(cliente) { /* ... */ }
