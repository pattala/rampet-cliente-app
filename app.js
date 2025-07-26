// pwa/app.js - DIAGNÓSTICO FINAL

document.addEventListener('DOMContentLoaded', function() {
    console.log("App de diagnóstico iniciada. Esperando un clic...");

    document.body.addEventListener('click', function(e) {
        
        console.log("¡Clic detectado! El elemento exacto que se clickeó fue:");
        console.log(e.target);

    });
});
