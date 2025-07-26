// pwa/app.js - VERSIÓN DE PRUEBA MÍNIMA

// Esperamos a que todo el HTML esté cargado y listo
document.addEventListener('DOMContentLoaded', function() {
    
    console.log("DOM completamente cargado. Buscando el enlace...");
    
    // Buscamos específicamente el enlace para recuperar la contraseña
    const forgotLink = document.getElementById('forgot-password-link');
    
    // Verificamos si lo encontramos
    if (forgotLink) {
        console.log("✔️ ¡Enlace encontrado! Adjuntando el listener de clic...");
        
        // Le añadimos la instrucción de qué hacer al recibir un clic
        forgotLink.addEventListener('click', function(event) {
            // Prevenimos que el enlace recargue la página
            event.preventDefault();
            
            // Mostramos una alerta para confirmar que todo funciona
            alert('¡El clic desde app.js AHORA funciona!');
        });

    } else {
        // Si no lo encontramos, mostramos un error claro en la consola
        console.error("❌ ERROR CRÍTICO: No se pudo encontrar el enlace con id 'forgot-password-link' desde app.js");
    }
});
