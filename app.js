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
debugDiv.style.maxHeight = '300px';
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
    logToScreen("--- Buscando Clases Embind ---");
    
    if (typeof Module === 'undefined') {
        logToScreen("Error: 'Module' no definido.");
        return;
    }

    let activeModule = Module;
    if (typeof Module === 'function') {
        try {
            activeModule = await Module();
        } catch(e) {
            logToScreen("Error al inicializar Module(): " + e.message);
            return;
        }
    }

    // 1. Buscar clases registradas por Embind en el módulo
    const claves = Object.keys(activeModule);
    
    // Las clases en Embind suelen registrarse como constructores directamente en el módulo.
    // Buscaremos clases comunes de Edge Impulse como "EdgeImpulse", "Classifier", "SDK", etc.
    const clasesCandidatas = claves.filter(key => {
        // Filtramos por constructores o funciones que empiezan con mayúscula y no son funciones nativas
        return typeof activeModule[key] === 'function' && 
               key[0] === key[0].toUpperCase() && 
               !key.startsWith('_') && 
               key !== 'Function' && 
               key !== 'Object';
    });

    if (clasesCandidatas.length > 0) {
        logToScreen("Clases encontradas:");
        clasesCandidatas.forEach(c => {
            logToScreen(`- ${c}`);
            // Listar prototipos de la clase para ver qué métodos tiene
            try {
                const proto = Object.getOwnPropertyNames(activeModule[c].prototype);
                logToScreen(`  Métodos: ${proto.filter(p => p !== 'constructor').join(', ')}`);
            } catch(e) {}
        });
    } else {
        logToScreen("No se encontraron clases con mayúscula.");
    }

    // 2. Imprimir cualquier otra clave sospechosa que no empiece con guion bajo
    const sospechosas = claves.filter(k => !k.startsWith('_') && typeof activeModule[k] === 'function');
    logToScreen("Otras funciones expuestas (sin guion bajo):");
    logToScreen(sospechosas.slice(0, 15).join(', '));
});