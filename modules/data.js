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
// Parsear Timestamp (Firestore), ISO string o Date nativo
function parseDateLike(d) {
  if (!d) return null;
  if (typeof d?.toDate === 'function') return d.toDate(); // Firestore Timestamp
  if (typeof d === 'string') {
    const t = new Date(d);
    return isNaN(t) ? null : t;
  }
  if (d instanceof Date) return d;
  return null;
}
function startOfTodayMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
// Agrupa próximas caducidades por día y devuelve una lista ordenada ascendente.
// Fuente prioritaria: (1) directos, (2) vencimientos[], (3) historialPuntos[].
function computeUpcomingExpirations(cliente = {}) {
  const todayStart = startOfTodayMs();

  const parseTs = (ts) => {
    if (!ts) return 0;
    if (typeof ts?.toDate === 'function') return ts.toDate().getTime();
    const t = new Date(ts).getTime();
    return isNaN(t) ? 0 : t;
  };
  const dayKey = (ms) => {
    const d = new Date(ms);
    d.setHours(0,0,0,0);
    return d.getTime();
  };

  // (1) Directos
  const directPts = Number(cliente?.puntosProximosAVencer ?? 0);
  const directTs  = parseTs(cliente?.fechaProximoVencimiento);
  if (directPts > 0 && directTs) {
    const dk = dayKey(directTs);
    return [{ ts: dk, puntos: directPts }];
  }

  // (2) Vencimientos[]
  const fromV = {};
  const arrV = Array.isArray(cliente?.vencimientos) ? cliente.vencimientos : [];
  for (const x of arrV) {
    const pts = Number(x?.puntos || 0);
    const ts  = parseTs(x?.venceAt);
    if (pts > 0 && ts && ts >= todayStart) {
      const dk = dayKey(ts);
      fromV[dk] = (fromV[dk] || 0) + pts;
    }
  }
  const listV = Object.keys(fromV).map(k => ({ ts: Number(k), puntos: fromV[k] })).sort((a,b)=>a.ts-b.ts);
  if (listV.length) return listV;

  // (3) historialPuntos[]
  const fromH = {};
  const hist = Array.isArray(cliente?.historialPuntos) ? cliente.historialPuntos : [];
  for (const h of hist) {
    const obt = parseDateLike(h?.fechaObtencion);
    const dias = Number(h?.diasCaducidad || 0);
    const disp = Number(h?.puntosDisponibles ?? h?.puntosObtenidos ?? 0);
    if (!obt || dias <= 0 || disp <= 0) continue;
    const vence = new Date(obt);
    // usamos fin de día para el cálculo, pero agrupamos por inicio de día
    vence.setHours(23,59,59,999);
    vence.setDate(vence.getDate() + dias);
    const ms = vence.getTime();
    if (ms < todayStart) continue; // incluye "vence hoy"
    const dk = dayKey(ms);
    fromH[dk] = (fromH[dk] || 0) + disp;
  }
  const listH = Object.keys(fromH).map(k => ({ ts: Number(k), puntos: fromH[k] })).sort((a,b)=>a.ts-b.ts);
  return listH;
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
      const texto = `$ ${saldo.toFixed(2)}`;
      saldoEl.textContent = texto;
      card.style.display = 'block';
    } else {
      saldoEl.textContent = '$ 0.00';
      // Requerimiento actual: saldo se oculta si es 0
      card.style.display = 'none';
    }
  } catch (e) {
    console.warn('updateSaldoCard error:', e);
  }
}

// === Fallbacks exportados (útiles para otros módulos) ===
export function getFechaProximoVencimiento(cliente = {}) {
  // (1) Campo directo
  if (cliente?.fechaProximoVencimiento) {
    const dt = parseDateLike(cliente.fechaProximoVencimiento);
    if (dt) return dt;
  }

  // (2) Desde historialPuntos
  const hist = Array.isArray(cliente?.historialPuntos) ? cliente.historialPuntos : [];
  const ahora = new Date();

  const candidatos = hist
    .filter(i => (i?.puntosDisponibles ?? 0) > 0 && (i?.diasCaducidad ?? 0) > 0)
    .map(i => {
      const base = parseDateLike(i.fechaObtencion);
      if (!base) return null;
      const vence = new Date(base.getTime());
      vence.setDate(vence.getDate() + Number(i.diasCaducidad || 0));
      return vence;
    })
    .filter(Boolean)
    .filter(vence => vence >= new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())) // incluye hoy
    .sort((a, b) => a - b);

  return candidatos.length ? candidatos[0] : null;
}

export function getPuntosEnProximoVencimiento(cliente = {}) {
  // (1) Campo directo
  if (typeof cliente?.puntosProximosAVencer === 'number' && cliente.puntosProximosAVencer > 0) {
    return cliente.puntosProximosAVencer;
  }

  // (2) Desde historialPuntos
  const hist = Array.isArray(cliente?.historialPuntos) ? cliente.historialPuntos : [];
  const hoy0 = new Date();
  hoy0.setHours(0, 0, 0, 0);

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
    // incluir “vence hoy”
    if (vence < hoy0) continue;

    bloques.push({ vence, puntos: disp });
    if (!minFecha || +vence < +minFecha) minFecha = vence;
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

// === Puntos por vencer (tarjeta de Home) ===
// Prioridad de fuentes:
// (1) campos directos: puntosProximosAVencer + fechaProximoVencimiento
// (2) arreglo vencimientos[]: { puntos, venceAt }
// (3) historialPuntos[]: { fechaObtencion, diasCaducidad, puntosDisponibles | puntosObtenidos }
// === Puntos por vencer (tarjeta de Home) — Opción C (lista de próximas tandas)
export function updateVencimientoCard(cliente = {}) {
  try {
    const card    = document.getElementById('vencimiento-card');
    const ptsEl   = document.getElementById('cliente-puntos-vencimiento');  // muestra la PRIMERA tanda
    const fechaEl = document.getElementById('cliente-fecha-vencimiento');   // muestra fecha de la PRIMERA tanda
    if (!card || !ptsEl || !fechaEl) {
      console.warn('[PWA] Tarjeta de vencimiento no encontrada. IDs requeridos: vencimiento-card, cliente-puntos-vencimiento, cliente-fecha-vencimiento');
      return;
    }

    // Contenedor para las tandas siguientes (si no existe, lo creamos)
    let listEl = document.getElementById('vencimiento-list');
    if (!listEl) {
      listEl = document.createElement('ul');
      listEl.id = 'vencimiento-list';
      listEl.style.margin = '6px 0 0';
      listEl.style.paddingLeft = '18px';
      const after = fechaEl.parentElement || card;
      after.appendChild(listEl);
    }

    const data = computeUpcomingExpirations(cliente); // [{ts, puntos}] ordenado
    const fmt = (ms) => new Date(ms).toLocaleDateString('es-AR');

    if (data.length === 0) {
      // Sin vencimientos → mostrar 0 y limpiar lista
      ptsEl.textContent = '0';
      fechaEl.textContent = '—';
      listEl.innerHTML = '';
      card.style.display = 'block';
      return;
    }

    // Primera tanda (la más próxima)
    ptsEl.textContent = String(data[0].puntos);
    fechaEl.textContent = fmt(data[0].ts);

    // Siguientes 2–3 tandas
    const siguientes = data.slice(1, 3); // mostrará hasta 2 adicionales
    if (siguientes.length) {
      listEl.innerHTML = siguientes
        .map(v => `<li><span style="font-weight:600;">${v.puntos}</span> el ${fmt(v.ts)}</li>`)
        .join('');
    } else {
      listEl.innerHTML = '';
    }

    card.style.display = 'block';
  } catch (e) {
    console.warn('updateVencimientoCard error:', e);
  }
}


    // ---------- (3) Fallback desde `historialPuntos[]` ----------
    const hist = Array.isArray(cliente.historialPuntos) ? cliente.historialPuntos : [];
    const candidatos = hist.map(h => {
      const obtTs = parseTs(h?.fechaObtencion);
      const dias  = Number(h?.diasCaducidad || 0);
      if (!obtTs || dias <= 0) return null;

      const vence = new Date(obtTs);
      // fin del día de vencimiento (para no descartar por horas)
      vence.setHours(23, 59, 59, 999);
      vence.setDate(vence.getDate() + dias);

      const ptsDisp = Number(h?.puntosDisponibles ?? h?.puntosObtenidos ?? 0);
      return { ts: vence.getTime(), puntos: ptsDisp };
    }).filter(Boolean)
      .filter(x => x.puntos > 0 && x.ts >= todayStart)
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

// === Render principal ===
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
  updateVencimientoCard(clienteData); // siempre visible (0/— si no hay)
  updateSaldoCard(clienteData);       // visible solo si saldo > 0
}

// === Listeners / flujo principal ===
export async function listenToClientData(user) {
  UI.showScreen('loading-screen');

  if (unsubscribeCliente) unsubscribeCliente();
  if (unsubscribeCampanas) unsubscribeCampanas();

  // Premios (carga inicial, una sola vez)
  if (premiosData.length === 0) {
    try {
      const premiosSnapshot = await db.collection('premios').orderBy('puntos', 'asc').get();
      premiosData = premiosSnapshot.docs.map(p => ({ id: p.id, ...p.data() }));
    } catch (e) {
      console.error("[PWA] Error cargando premios:", e);
    }
  }

  // Campañas en tiempo real
  try {
    const campanasQuery = db.collection('campanas').where('estaActiva', '==', true);
    unsubscribeCampanas = campanasQuery.onSnapshot(snapshot => {
      campanasData = snapshot.docs.map(doc => doc.data());
      console.log("[PWA] Campañas actualizadas:", campanasData.length);
      renderizarPantallaPrincipal();
    }, error => {
      console.error("[PWA] Error escuchando campañas:", error);
    });
  } catch (e) {
    console.error("[PWA] Error seteando listener de campañas:", e);
  }

  // Cliente en tiempo real
  try {
    const clienteQuery = db.collection('clientes').where("authUID", "==", user.uid).limit(1);
    unsubscribeCliente = clienteQuery.onSnapshot(snapshot => {
      if (snapshot.empty) {
        UI.showToast("Error: Tu cuenta no está vinculada a ninguna ficha de cliente.", "error");
        Auth.logout();
        return;
      }

      clienteData = snapshot.docs[0].data();
      clienteRef = snapshot.docs[0].ref;
// DEBUG: exponer datos en consola (quitar en producción si querés)
if (typeof window !== 'undefined') {
  window.clienteData = clienteData;
  window.clienteRef  = clienteRef;
}
      console.log("[PWA] Datos del cliente actualizados.");
      renderizarPantallaPrincipal();

      // Notificaciones (permiso/token)
      Notifications.gestionarPermisoNotificaciones(clienteData);

    }, (error) => {
      console.error("[PWA] Error en listener de cliente:", error);
      Auth.logout();
    });
  } catch (e) {
    console.error("[PWA] Error seteando listener de cliente:", e);
    Auth.logout();
  }
}

// Stubs (si algún módulo los importa, no rompen)
export async function acceptTerms() { /* ... */ }

// ─────────────────────────────────────────────────────────────
export { /* ancla de export adicionales si luego agregás más */ };
// ─────────────────────────────────────────────────────────────
// ANCLA INFERIOR: fin del archivo
// ─────────────────────────────────────────────────────────────



