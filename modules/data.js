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

// === Puntos por vencer ===
// === Puntos por vencer ===
// Fuente (prioridad):
// (1) campos directos: puntosProximosAVencer + fechaProximoVencimiento
// (2) arreglo vencimientos[]: { puntos, venceAt }
// (3) historialPuntos[]: { fechaObtencion, diasCaducidad, puntosDisponibles | puntosObtenidos }
export function updateVencimientoCard(cliente = {}) {
  try {
    const card    = document.getElementById('vencimiento-card');
    const ptsEl   = document.getElementById('cliente-puntos-vencimiento');
    const fechaEl = document.getElementById('cliente-fecha-vencimiento');
    if (!card || !ptsEl || !fechaEl) {
      console.warn('[PWA] Tarjeta de vencimiento no encontrada. IDs requeridos: vencimiento-card, cliente-puntos-vencimiento, cliente-fecha-vencimiento');
      return;
    }

    const parseTs = (ts) => {
      if (!ts) return 0;
      if (typeof ts?.toDate === 'function') return ts.toDate().getTime();
      const t = new Date(ts).getTime();
      return isNaN(t) ? 0 : t;
    };
    const startOfToday = (() => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })();

    // ---------- (1) Campos directos ----------
    const directPts  = Number(cliente.puntosProximosAVencer ?? 0);
    const directTs   = parseTs(cliente.fechaProximoVencimiento);
    if (directPts > 0 && directTs) {
      ptsEl.textContent = String(directPts);
      fechaEl.textContent = new Date(directTs).toLocaleDateString();
      card.style.display = 'block';
      return;
    }

    // ---------- (2) Arreglo `vencimientos[]` ----------
    const arrV = Array.isArray(cliente.vencimientos) ? cliente.vencimientos : [];
    const futurosV = arrV
      .map(x => ({
        puntos: Number(x?.puntos || 0),
        ts: parseTs(x?.venceAt)
      }))
      // incluye "vence hoy" (>= inicio del día)
      .filter(x => x.puntos > 0 && x.ts && x.ts >= startOfToday)
      .sort((a, b) => a.ts - b.ts);

    if (futurosV.length) {
      // si hay varias entradas con la MISMA fecha, sumamos
      const firstTs = futurosV[0].ts;
      const mismosDia = futurosV.filter(i => i.ts === firstTs);
      const sum = mismosDia.reduce((acc, i) => acc + i.puntos, 0);
      ptsEl.textContent = String(sum);
      fechaEl.textContent = new Date(firstTs).toLocaleDateString();
      card.style.display = 'block';
      return;
    }

    // ---------- (3) Fallback desde `historialPuntos[]` ----------
    const hist = Array.isArray(cliente.historialPuntos) ? cliente.historialPuntos : [];
    const candidatos = hist.map(h => {
      const obtTs = parseTs(h?.fechaObtencion);
      const dias  = Number(h?.diasCaducidad || 0);
      if (!obtTs || dias <= 0) return null;

      const vence = new Date(obtTs);
      // vencimiento al final del día de la obtención + dias
      vence.setHours(23, 59, 59, 999);
      vence.setDate(vence.getDate() + dias);

      const ptsDisp = Number(h?.puntosDisponibles ?? h?.puntosObtenidos ?? 0);
      return { ts: vence.getTime(), puntos: ptsDisp };
    }).filter(Boolean)
      // incluye "vence hoy"
      .filter(x => x.puntos > 0 && x.ts >= startOfToday)
      .sort((a, b) => a.ts - b.ts);

    if (candidatos.length) {
      const firstTs = candidatos[0].ts;
      const mismosDia = candidatos.filter(i => i.ts === firstTs);
      const sum = mismosDia.reduce((acc, i) => acc + i.puntos, 0);
      ptsEl.textContent = String(sum);
      fechaEl.textContent = new Date(firstTs).toLocaleDateString();
      card.style.display = 'block';
      return;
    }

    // ---------- Sin vencimientos → mostrar 0 ----------
    ptsEl.textContent = '0';
    fechaEl.textContent = '—';
    card.style.display = 'block';

  } catch (e) {
    console.warn('updateVencimientoCard error:', e);
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


