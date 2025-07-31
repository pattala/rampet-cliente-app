// ====================================================================
// == FUNCIONALIDAD DEL CARRUSEL DE CAMPAÑAS (VERSIÓN CORREGIDA)    ==
// ====================================================================

let carouselIntervalId = null;
let isDragging = false, startX, startScrollLeft;

function renderCampanasCarousel(campanasData) {
    const container = document.getElementById('carrusel-campanas-container');
    const carrusel = document.getElementById('carrusel-campanas');
    const indicadoresContainer = document.getElementById('carrusel-indicadores');
    if (!container || !carrusel || !indicadoresContainer) return;

    if (carouselIntervalId) clearInterval(carouselIntervalId);

    const campanasVisibles = Array.isArray(campanasData) ? campanasData : [];
    if (campanasVisibles.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    carrusel.innerHTML = '';
    indicadoresContainer.innerHTML = '';

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
            const itemWidth = carrusel.children[index].offsetLeft;
            carrusel.scrollTo({ left: itemWidth, behavior: 'smooth' });
        });
        indicadoresContainer.appendChild(indicador);
    });

    const updateActiveIndicator = () => {
        const itemWidth = carrusel.firstElementChild.offsetWidth + 15;
        const currentIndex = Math.round(carrusel.scrollLeft / itemWidth);
        indicadoresContainer.querySelectorAll('.indicador').forEach((ind, idx) => {
            ind.classList.toggle('activo', idx === currentIndex);
        });
    };
    
    // --- LÓGICA DE AUTO-SCROLL CORREGIDA ---
    const startCarousel = () => {
        // No iniciar si ya hay uno o si el usuario está arrastrando
        if (carouselIntervalId || isDragging) return;
        console.log("%cCarousel STARTING...", "color: green; font-weight: bold;"); // Log de depuración
        carouselIntervalId = setInterval(() => {
            const scrollEnd = carrusel.scrollWidth - carrusel.clientWidth;
            if (carrusel.scrollLeft >= scrollEnd - 5) { // Umbral de 5px
                carrusel.scrollTo({ left: 0, behavior: 'smooth' });
            } else {
                carrusel.scrollBy({ left: carrusel.firstElementChild.offsetWidth + 15, behavior: 'smooth' });
            }
        }, 4000);
    };

    const stopCarousel = () => {
        clearInterval(carouselIntervalId);
        carouselIntervalId = null; // Importante resetear el ID
        console.log("%cCarousel STOPPING...", "color: red;"); // Log de depuración
    };

    // --- LÓGICA DE ARRASTRE (SWIPE) ---
    const dragStart = (e) => {
        stopCarousel(); // Detener al empezar a arrastrar
        isDragging = true;
        carrusel.classList.add('arrastrando');
        startX = (e.pageX || e.touches[0].pageX) - carrusel.offsetLeft;
        startScrollLeft = carrusel.scrollLeft;
    };

    const dragStop = () => {
        isDragging = false;
        carrusel.classList.remove('arrastrando');
        // Reanudar solo si el puntero no está encima del carrusel
        if (!carrusel.matches(':hover')) {
             startCarousel();
        }
    };
    
    const dragging = (e) => {
        if (!isDragging) return;
        e.preventDefault();
        const x = (e.pageX || e.touches[0].pageX) - carrusel.offsetLeft;
        const walk = (x - startX) * 2;
        carrusel.scrollLeft = startScrollLeft - walk;
        updateActiveIndicator();
    };

    // Remover listeners viejos para evitar duplicados si esta función se llama de nuevo
    carrusel.removeEventListener('scroll', updateActiveIndicator);
    
    // Añadir listeners
    carrusel.addEventListener('scroll', () => {
        if(!isDragging) updateActiveIndicator();
    });

    // Solo añadir listeners de interacción si hay más de un item
    if (campanasVisibles.length > 1) {
        carrusel.addEventListener('mousedown', dragStart);
        carrusel.addEventListener('touchstart', dragStart, { passive: true });
        carrusel.addEventListener('mousemove', dragging);
        carrusel.addEventListener('touchmove', dragging, { passive: true });
        carrusel.addEventListener('mouseup', dragStop);
        carrusel.addEventListener('mouseleave', dragStop); // dragStop reanudará el carrusel
        carrusel.addEventListener('touchend', dragStop);

        // Lógica de pausa al pasar el ratón por encima
        carrusel.addEventListener('mouseenter', stopCarousel);
        // Al salir el ratón, llamamos a dragStop que contiene la lógica para reanudar
        carrusel.addEventListener('mouseleave', dragStop);

        startCarousel(); // Iniciar el carrusel
    }
    
    updateActiveIndicator(); // Llamada inicial
}
