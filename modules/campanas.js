import { db } from './firebase.js';

/**
 * Muestra los banners de las campañas activas en la interfaz.
 * @param {Array<Object>} campanas - Un array de objetos de campaña.
 */
function renderizarBanners(campanas) {
    const container = document.getElementById('campanas-container');
    const lista = document.getElementById('lista-campanas');

    if (!container || !lista) {
        console.error("No se encontraron los contenedores para las campañas.");
        return;
    }

    // Si no hay campañas, nos aseguramos de que el contenedor esté oculto
    if (campanas.length === 0) {
        container.style.display = 'none';
        return;
    }

    // Generamos el HTML para cada banner de campaña
    lista.innerHTML = campanas.map(campana => {
        // Solo mostramos campañas que tengan una URL de banner
        if (!campana.urlBanner) return '';

        return `
            <div class="campana-banner">
                <img src="${campana.urlBanner}" alt="${campana.nombre}">
            </div>
        `;
    }).join('');

    // Mostramos el contenedor principal
    container.style.display = 'block';
}


/**
 * Busca en Firestore las campañas que están activas y vigentes
 * y luego las muestra en la PWA.
 */
export async function cargarCampanasActivas() {
    try {
        // Obtenemos la fecha de hoy en formato YYYY-MM-DD
        const hoy = new Date().toISOString().split('T')[0];

        // Consultamos las campañas que están activas y cuya fecha de inicio ya pasó
        const snapshot = await db.collection('campanas')
            .where('estado', '==', 'activa')
            .where('fechaInicio', '<=', hoy)
            .get();

        // Filtramos del lado del cliente las que aún no han terminado
        const campanasVigentes = snapshot.docs
            .map(doc => doc.data())
            .filter(campana => campana.fechaFin >= hoy);
        
        renderizarBanners(campanasVigentes);

    } catch (error) {
        console.error("Error al cargar las campañas:", error);
    }
}
