// ==========================================
// ADAPTADOR EDGE IMPULSE (VÍA NATIVA EM_CCALL)
// ==========================================
class EdgeImpulseClassifier {
    constructor(module) {
        this._module = module;
    }

    async init() {
        if (typeof this._module === 'function') {
            this._module = await this._module();
        }
        return this;
    }

    classify(features) {
        if (!this._module) throw new Error("Módulo WebAssembly no inicializado.");

        // 1. Reservar memoria en el heap para las características de la imagen
        const bytesPerElement = Float32Array.BYTES_PER_ELEMENT;
        const nDataBytes = features.length * bytesPerElement;
        const dataPtr = this._module._malloc(nDataBytes);

        // 2. Escribir los datos de la imagen (Float32) en el espacio reservado
        const dataHeap = new Uint8Array(this._module.HEAPU8.buffer, dataPtr, nDataBytes);
        dataHeap.set(new Uint8Array(features.buffer, features.byteOffset, nDataBytes));

        let resultStr = "";

        try {
            // Usamos ccall para invocar 'run_classifier' de manera segura
            // Firma: run_classifier(puntero_features, tamaño_features, debug)
            // Devuelve: Un string en formato JSON (puntero de string)
            const resultPointer = this._module.ccall(
                'run_classifier', // Nombre de la función C++ exportada
                'number',         // Tipo de retorno (puntero numérico de memoria de la string)
                ['number', 'number', 'boolean'], // Tipos de los argumentos
                [dataPtr, features.length, false] // Argumentos reales
            );

            // Convertir el puntero de caracteres UTF-8 devuelto por C++ en una cadena JS
            resultStr = this._module.UTF8ToString(resultPointer);
        } catch (e) {
            throw new Error("Fallo en ccall run_classifier: " + e.message);
        } finally {
            // Muy importante: Liberar la memoria reservada para no colapsar el navegador del móvil
            this._module._free(dataPtr);
        }

        return JSON.parse(resultStr);
    }
}

// ==========================================
// CONTROL DE CÁMARA Y RENDERIZADO
// ==========================================
const video = document.getElementById('webcam');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const limonSpan = document.getElementById('limones');
const naranjasSpan = document.getElementById('naranjas');

let classifier = null;
const MODEL_WIDTH = 96; 
const MODEL_HEIGHT = 96;

const resizeCanvas = document.createElement('canvas');
resizeCanvas.width = MODEL_WIDTH;
resizeCanvas.height = MODEL_HEIGHT;
const resizeCtx = resizeCanvas.getContext('2d');

// Consola de diagnóstico visual flotante
const debugDiv = document.createElement('div');
debugDiv.style.position = 'absolute';
debugDiv.style.bottom = '10px';
debugDiv.style.left = '10px';
debugDiv.style.right = '10px';
debugDiv.style.background = 'rgba(0,0,0,0.95)';
debugDiv.style.color = '#00FF00';
debugDiv.style.padding = '10px';
debugDiv.style.fontSize = '11px';
debugDiv.style.fontFamily = 'monospace';
debugDiv.style.zIndex = '9999';
debugDiv.style.maxHeight = '140px';
debugDiv.style.overflowY = 'auto';
debugDiv.style.borderRadius = '5px';
document.body.appendChild(debugDiv);

function logToScreen(text) {
    debugDiv.innerHTML = text + "<br>" + debugDiv.innerHTML;
    const lines = debugDiv.innerHTML.split('<br>');
    if (lines.length > 6) debugDiv.innerHTML = lines.slice(0, 6).join('<br>');
}

window.onerror = function(message) {
    logToScreen("ERROR JS: " + message);
    return false;
};

// Carga del modelo al iniciar la página
window.addEventListener('load', async () => {
    logToScreen("Inicializando entorno...");
    try {
        if (typeof Module === 'undefined') {
            logToScreen("Falta 'edge-impulse-standalone.js' en el HTML.");
            return;
        }
        classifier = new EdgeImpulseClassifier(Module);
        await classifier.init();
        logToScreen("¡Módulo WebAssembly enlazado con éxito!");
        startCamera();
    } catch (err) {
        logToScreen("Fallo de arranque: " + err.message);
    }
});

function startCamera() {
    const constraints = { video: { facingMode: "environment" }, audio: false };
    if (!navigator.mediaDevices?.getUserMedia) {
        logToScreen("El navegador no da soporte a getUserMedia.");
        return;
    }
    navigator.mediaDevices.getUserMedia(constraints)
        .then(stream => {
            video.srcObject = stream;
            video.addEventListener('loadedmetadata', () => {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                logToScreen("Cámara iniciada: " + canvas.width + "x" + canvas.height);
                requestAnimationFrame(processFrame);
            });
        })
        .catch(err => logToScreen("Error abriendo cámara: " + err.message));
}

// Bucle continuo de procesamiento e inferencia
async function processFrame() {
    if (!classifier) return;

    // Pintar la cámara en el canvas principal
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Redimensionar al tamaño que espera tu modelo (96x96)
    resizeCtx.drawImage(video, 0, 0, MODEL_WIDTH, MODEL_HEIGHT);
    const imgData = resizeCtx.getImageData(0, 0, MODEL_WIDTH, MODEL_HEIGHT);
    const data = imgData.data;

    const numPixels = MODEL_WIDTH * MODEL_HEIGHT;
    const rgbData = new Float32Array(numPixels * 3);

    // Normalizar píxeles a rango 0.0 - 1.0 (Formato de entrada estándar de Edge Impulse)
    let rgbIndex = 0;
    for (let i = 0; i < data.length; i += 4) {
        rgbData[rgbIndex++] = data[i] / 255.0;     // R
        rgbData[rgbIndex++] = data[i + 1] / 255.0; // G
        rgbData[rgbIndex++] = data[i + 2] / 255.0; // B
    }
    
    try {
        const result = classifier.classify(rgbData);
        if (result) {
            // Unificar predicciones de cajas de delimitación u clasificación tradicional
            const predictions = result.bounding_boxes || result.results || [];
            drawAndCount(predictions);
        }
    } catch (e) {
        logToScreen("Error de inferencia: " + e.message);
    }

    requestAnimationFrame(processFrame);
}

// Renderizado de cuadros de detección y conteo en pantalla
function drawAndCount(predictions) {
    let limones = 0;
    let naranjas = 0;
    const scaleX = canvas.width / MODEL_WIDTH;
    const scaleY = canvas.height / MODEL_HEIGHT;

    predictions.forEach(prediction => {
        if (prediction.value > 0.35) {
            const labelLower = prediction.label.toLowerCase();
            const esLimon = labelLower.includes('limon') || labelLower.includes('lemon');

            // Si el modelo tiene localización (FOMO) dibuja las cajas
            if (prediction.x !== undefined) {
                const realX = prediction.x * scaleX;
                const realY = prediction.y * scaleY;
                const realWidth = prediction.width * scaleX;
                const realHeight = prediction.height * scaleY;

                ctx.strokeStyle = esLimon ? '#FFD700' : '#FF8C00';
                ctx.lineWidth = 4;
                ctx.strokeRect(realX, realY, realWidth, realHeight);

                ctx.fillStyle = ctx.strokeStyle;
                ctx.font = 'bold 16px Arial';
                ctx.fillText(`${prediction.label} (${Math.round(prediction.value * 100)}%)`, realX, realY > 20 ? realY - 5 : 20);
            }

            if (esLimon) limones++;
            else if (labelLower.includes('naranja') || labelLower.includes('orange')) naranjas++;
        }
    });

    limonSpan.innerText = limones;
    naranjasSpan.innerText = naranjas;
}