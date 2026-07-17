// Pantalla de logs flotante
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
debugDiv.style.maxHeight = '250px';
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
    logToScreen("--- Analizando Módulo ---");
    
    if (typeof Module === 'undefined') {
        logToScreen("Error: 'Module' no está definido en el ámbito global.");
        return;
    }

    let activeModule = Module;

    // Si Module es una función constructora de Emscripten, la inicializamos
    if (typeof Module === 'function') {
        logToScreen("Module es una función. Inicializando...");
        try {
            activeModule = await Module();
            logToScreen("Módulo inicializado con éxito.");
        } catch(e) {
            logToScreen("Error al inicializar Module(): " + e.message);
        }
    }

    // Extraer y listar propiedades y funciones del módulo compilado
    const todasLasPropiedades = Object.keys(activeModule);
    logToScreen(`Propiedades totales encontradas: ${todasLasPropiedades.length}`);

    // Buscar específicamente funciones que tengan nombres parecidos a run, classifier o exportadas de C++
    const funcionesClave = todasLasPropiedades.filter(key => {
        const lower = key.toLowerCase();
        return typeof activeModule[key] === 'function' && 
               (lower.includes('run') || lower.includes('class') || lower.includes('infer') || key.startsWith('_'));
    });

    if (funcionesClave.length > 0) {
        logToScreen("Funciones encontradas que coinciden:");
        funcionesClave.slice(0, 15).forEach(f => {
            logToScreen(`- ${f} (${typeof activeModule[f]})`);
        });
    } else {
        logToScreen("No se encontraron funciones clave típicas.");
    }
});