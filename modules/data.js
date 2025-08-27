// modules/data.js (PWA - LISTENERS + vencimiento + SALDO + render unificado)

// ─────────────────────────────────────────────────────────────
// ANCLA SUPERIOR (imports)
import { db } from './firebase.js';
import * as UI from './ui.js';
import * as Auth from './auth.js';
import * as Notifications from './notifications.js';
// ─────────────────────────────────────────────────────────────

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

// -------------------- Helpers locales --------------------
// RAMPET FIX: helper robusto para parsear fechas (Timestamp | ISO | Date)
function parseDateLike(d) {
  if (!d) return null;
  if (typeof d === 'string') return new Date(d);
  if (typeof d?.toDate === 'function') return d.toDate(); // Firestore Timestamp
  if (d instanceof Date) return d;
  return null;
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
      // RAMPET FIX: corregido template string
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
// RAMPET FIX: fallbacks exportados (usables también en otros módulos)
export function getFechaProximoVencimiento(cliente) {
  // 1) Si viene persistido en el doc de cliente
  if (cliente?.fechaProximoVencimiento) {
    const dt = parseDateLike(cliente.fechaProximoVencimiento);
    if (dt) return dt;
  }

  // 2) Calcular desde historialPuntos[]
  const hist = Array.isArray(cliente?.historialPuntos) ? cliente.historialPuntos : [];
  const futuros = hist
    .filter(i => (i?.puntosDisponibles ?? 0) > 0 && (i?.diasCaducidad ?? 0) > 0)
    .map(i => {
      const base = parseDateLike(i.fechaObtencion);
      if (!base) return null;
      const vence = new Date(base.getTime());
      vence.setDate(vence.getDate() + Number(i.diasCaducidad || 0));
      return { vence, puntos: Number(i.puntosDisponibles || 0) };
    })
    .filter(Boolean)
    .filter(x => x.vence > new Date())
    .sort((a, b) => a.vence - b.vence);

  return futuros.length ? futuros[0].vence : null;
}

export function getPuntosEnProximoVencimiento(cliente) {
  // 1) Si viene persistido en el doc de cliente
  if (typeof cliente?.puntosProximosAVencer === 'number') {
    return cliente.puntosProximosAVencer;
  }

  // 2) Calcular desde historialPuntos[]
  const hist = Array.isArray(cliente?.historialPuntos) ? cliente.historialPuntos : [];
  const hoy = new Date();

  let minFecha = null;
  const bloques = [];

  for (const i of hist) {
    const disp = Number(i?.puntosDisponibles || 0);
    const dias = Number(i?.diasCaducidad || 0);
    if (disp <= 0 || dias <= 0) continue;

    const base = parseDateLike(i.fechaObtencion);
    if (!base) continue;

    const vence = new Date(base.getTime());
    vence.setDate(vence.getDate() + dias);
    if (vence <= hoy) continue;

    bloques.push({ vence, puntos: disp });
    if (!minFecha || vence < minFecha) minFecha = vence;
  }

  if (!minFecha) return 0;

  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  return bloques
    .filter(b => sameDay(b.vence, minFecha))
    .reduce((acc, b) => acc + b.puntos, 0);
}

export function updateVencimientoCard(cliente = {}) {
  try {
    const card = document.getElementById('vencimiento-card');
    const ptsEl = document.getElementById('cliente-puntos-vencimiento');
    const fechaEl = document.getElementById('cliente-fecha-vencimiento');
    if (!card || !ptsEl || !fechaEl) return;

    // Modelo 1: campos directos persistidos
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
        ts: x?.venceAt?.toDate
          ? x.venceAt.toDate().getTime()
          : (x?.venceAt ? new Date(x.venceAt).getTime() : 0)
      }))
      .filter(x => x.puntos > 0 && x.ts && x.ts > now)
      .sort((a, b) => a.ts - b.ts);

    if (futuros.length) {
      const primero = futuros[0];
      ptsEl.textContent = String(primero.puntos);
      fechaEl.textContent = new Date(primero.ts).toLocaleDateString();
      card.style.display = 'block';
      return;
    }

    // RAMPET FIX: Fallback 3 — calcular desde historialPuntos
    const fechaCalc = getFechaProximoVencimiento(cliente);
    const ptsCalc = getPuntosEnProximoVencimiento(cliente);

    if (fechaCalc && ptsCalc > 0) {
      ptsEl.textContent = String(ptsCalc);
      fechaEl.textContent = fechaCalc.toLocaleDateString();
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
  updateVencimientoCard(clienteData);
  updateSaldoCard(clienteData);
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

// ─────────────────────────────────────────────────────────────
// ANCLA INFERIOR: fin del archivo
// ─────────────────────────────────────────────────────────────
