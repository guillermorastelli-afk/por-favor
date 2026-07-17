const debugDiv = document.createElement('div');
debugDiv.style.position = 'absolute';
debugDiv.style.bottom = '10px';
debugDiv.style.left = '10px';
debugDiv.style.right = '10px';
debugDiv.style.background = 'rgba(0,0,0,0.95)';
debugDiv.style.color = '#00FF00';
debugDiv.style.padding = '10px';
debugDiv.style.fontSize = '12px';
debugDiv.style.fontFamily = 'monospace';
debugDiv.style.zIndex = '9999';
debugDiv.style.maxHeight = '320px';
debugDiv.style.overflowY = 'auto';
document.body.appendChild(debugDiv);

function logToScreen(text) {
    debugDiv.innerHTML = text + "<br>" + debugDiv.innerHTML;
}

window.onerror = function(message) {
    logToScreen("ERROR: " + message);
    return false;
};

window.addEventListener('load', async () => {
    logToScreen("--- Escaneo de Métodos Públicos ---");
    
    if (typeof Module === 'undefined') {
        logToScreen("Error: 'Module' no definido.");
        return;
    }

    let activeModule = Module;
    if (typeof Module === 'function') {
        try {
            activeModule = await Module();
            logToScreen("Módulo inicializado.");
        } catch(e) {
            logToScreen("Error inicialización: " + e.message);
            return;
        }
    }

    // 1. Obtener absolutamente todas las funciones del objeto compilado
    const claves = Object.keys(activeModule);
    
    // Filtrar funciones útiles excluyendo las de sistema de Emscripten (las que empiezan con "__" o "dynCall")
    const funcionesInteresantes = claves.filter(key => {
        return typeof activeModule[key] === 'function' && 
               !key.startsWith('__') && 
               !key.startsWith('dynCall') &&
               key !== 'inspect';
    });

    logToScreen(`Funciones públicas totales: ${funcionesInteresantes.length}`);
    
    // Agrupamos en bloques para que quepan en la pantalla del celular
    const chunk = 35;
    for (let i = 0; i < funcionesInteresantes.length; i += chunk) {
        const slice = funcionesInteresantes.slice(i, i + chunk);
        logToScreen(`[Bloque ${Math.floor(i/chunk) + 1}]: ` + slice.join(', '));
    }
});