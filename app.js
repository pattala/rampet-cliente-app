// pwa/app.js - DIAGNÓSTICO FINAL (v2)

// Importamos solo el módulo de UI para poder mostrar la pantalla
import * as UI from './modules/ui.js';

document.addEventListener('DOMContentLoaded', function() {
    console.log("App de diagnóstico iniciada. Esperando un clic...");

    // ESTA ES LA LÍNEA QUE FALTABA: le decimos que muestre la pantalla de login
    UI.showScreen('login-screen');

    document.body.addEventListener('click', function(e) {
        
        console.log("¡Clic detectado! El elemento exacto que se clickeó fue:");
        console.log(e.target);

    });
});
