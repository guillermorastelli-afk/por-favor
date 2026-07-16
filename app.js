const video = document.getElementById('webcam');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const limonSpan = document.getElementById('limones');
const naranjasSpan = document.getElementById('naranjas');

let classifierModule = null;
let classifierInstance = null;

// Forzar alertas en el celular si ocurre algún fallo en JS
window.onerror = function(message, source, lineno, colno, error) {
    alert("Error de JavaScript: " + message + " en línea " + lineno);
    return false;
};

// 1. Esperar a que la página cargue por completo
window.addEventListener('load', () => {
    console.log("Página cargada. Inicializando modelo...");
    
    if (typeof Module === 'undefined') {
        alert("Error crítico: El archivo 'edge-impulse-standalone.js' no se ha cargado.");
        return;
    }

    try {
        if (typeof Module === 'function') {
            Module().then(module => {
                classifierModule = module;
                detectSDKMethods(module);
            }).catch(err => {
                alert("Error al inicializar (Función): " + err.message);
            });
        } else if (typeof Module === 'object') {
            classifierModule = Module;
            if (Module.onRuntimeInitialized) {
                Module.onRuntimeInitialized = function() {
                    detectSDKMethods(Module);
                };
            } else {
                detectSDKMethods(Module);
            }
        }
    } catch (err) {
        alert("Error durante la inicialización del modelo: " + err.message);
    }
});

// Función para diagnosticar cómo inicializar el clasificador de Edge Impulse
function detectSDKMethods(module) {
    let metodosDisponibles = [];
    
    // Buscar funciones típicas en el módulo
    if (typeof EdgeImpulseClassifier !== 'undefined') {
        try {
            classifierInstance = new EdgeImpulseClassifier(module);
            metodosDisponibles.push("Instanciado con EdgeImpulseClassifier");
        } catch(e) {
            metodosDisponibles.push("Fallo EdgeImpulseClassifier: " + e.message);
        }
    }
    
    for (let prop in module) {
        if (typeof module[prop] === 'function' && (prop.includes('classify') || prop.includes('run') || prop.includes('Classifier'))) {
            metodosDisponibles.push(prop);
        }
    }
    
    if (metodosDisponibles.length > 0) {
        alert("Métodos detectados en tu SDK: \n" + metodosDisponibles.join("\n") + "\n\nIniciando cámara...");
    } else {
        alert("No se detectó un método de clasificación obvio. Revisaremos la consola de comandos. Iniciando cámara...");
    }
    
    startCamera();
}

// 2. Encender la cámara trasera del celular
function startCamera() {
    const constraints = {
        video: { facingMode: "environment" },
        audio: false
    };

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Tu navegador no soporta el acceso a la cámara.");
        return;
    }

    navigator.mediaDevices.getUserMedia(constraints)
        .then(stream => {
            video.srcObject = stream;
            video.addEventListener('loadedmetadata', () => {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                requestAnimationFrame(processFrame);
            });
        })
        .catch(err => {
            alert("Error de hardware al abrir cámara: " + err.name);
        });
}

// 3. Procesar cuadro por cuadro
function processFrame() {
    if (!classifierModule) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    try {
        let result = null;
        
        // Intentar clasificar usando el método que se haya detectado
        if (classifierInstance && typeof classifierInstance.classify === 'function') {
            result = classifierInstance.classify(imgData.data, canvas.width, canvas.height);
        } else if (typeof classifierModule.classify === 'function') {
            result = classifierModule.classify(imgData.data, canvas.width, canvas.height);
        }
        
        if (result && result.bounding_boxes) {
            drawAndCount(result.bounding_boxes);
        }
    } catch (e) {
        console.error("Error en inferencia:", e);
    }

    requestAnimationFrame(processFrame);
}

// 4. Dibujar y contar
function drawAndCount(boxes) {
    let limonesDetectados = 0;
    let naranjasDetectados = 0;

    boxes.forEach(box => {
        if (box.value > 0.60) {
            ctx.strokeStyle = box.label.includes('limon') ? '#FFD700' : '#FF8C00';
            ctx.lineWidth = 4;
            ctx.strokeRect(box.x, box.y, box.width, box.height);

            ctx.fillStyle = ctx.strokeStyle;
            ctx.font = '16px Arial';
            ctx.fillText(`${box.label} (${Math.round(box.value * 100)}%)`, box.x, box.y > 20 ? box.y - 5 : 20);

            if (box.label === 'limon' || box.label === 'lemon') {
                limonesDetectados++;
            } else if (box.label === 'naranja' || box.label === 'orange') {
                naranjasDetectados++;
            }
        }
    });

    limonSpan.innerText = limonesDetectados;
    naranjasSpan.innerText = naranjasDetectados;
}