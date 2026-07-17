// ==========================================
// ADAPTADOR DEL CLASIFICADOR EDGE IMPULSE
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

        // 1. Reservar memoria en el montón (Heap) de WebAssembly
        const bytesPerElement = Float32Array.BYTES_PER_ELEMENT;
        const nDataBytes = features.length * bytesPerElement;
        const dataPtr = this._module._malloc(nDataBytes);

        // 2. Copiar los datos de la imagen al espacio de memoria reservado
        const dataHeap = new Uint8Array(this._module.HEAPU8.buffer, dataPtr, nDataBytes);
        dataHeap.set(new Uint8Array(features.buffer, features.byteOffset, nDataBytes));

        let resultStr = "";

        try {
            // 3. Intentar invocar la función según la versión de Edge Impulse generada
            // Versión A: run_classifier clásico expuesto
            if (typeof this._module._run_classifier === 'function') {
                const resultPointer = this._module._run_classifier(dataPtr, features.length, false);
                resultStr = this._module.UTF8ToString(resultPointer);
            } 
            // Versión B: run_classifier_init / run_classifier sin guión bajo en wrappers modernos
            else if (typeof this._module.run_classifier === 'function') {
                const resultPointer = this._module.run_classifier(dataPtr, features.length, false);
                resultStr = this._module.UTF8ToString(resultPointer);
            }
            // Versión C: Métodos alternativos del SDK
            else if (typeof this._module._run_classifier_continuous === 'function') {
                const resultPointer = this._module._run_classifier_continuous(dataPtr, features.length, false);
                resultStr = this._module.UTF8ToString(resultPointer);
            }
            else {
                // Si no encuentra la función, listaremos qué tiene el módulo para solucionarlo
                const claves = Object.keys(this._module).filter(k => k.includes('classifier') || k.includes('run'));
                throw new Error("No se halló la función de inferencia. Funciones disponibles en tu WASM: " + claves.join(', '));
            }
        } finally {
            // Liberar siempre la memoria para evitar fugas (memory leaks)
            this._module._free(dataPtr);
        }

        return JSON.parse(resultStr);
    }
}

// ==========================================
// CAPTURA DE CÁMARA Y PROCESAMIENTO
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

// Pantalla de logs flotante
const debugDiv = document.createElement('div');
debugDiv.style.position = 'absolute';
debugDiv.style.bottom = '10px';
debugDiv.style.left = '10px';
debugDiv.style.right = '10px';
debugDiv.style.background = 'rgba(0,0,0,0.9)';
debugDiv.style.color = '#00FF00';
debugDiv.style.padding = '10px';
debugDiv.style.fontSize = '11px';
debugDiv.style.fontFamily = 'monospace';
debugDiv.style.zIndex = '9999';
debugDiv.style.maxHeight = '140px';
debugDiv.style.overflowY = 'auto';
document.body.appendChild(debugDiv);

function logToScreen(text) {
    debugDiv.innerHTML = text + "<br>" + debugDiv.innerHTML;
    const lines = debugDiv.innerHTML.split('<br>');
    if (lines.length > 6) debugDiv.innerHTML = lines.slice(0, 6).join('<br>');
}

window.onerror = function(message) {
    logToScreen("ERROR: " + message);
    return false;
};

window.addEventListener('load', async () => {
    logToScreen("Iniciando...");
    try {
        if (typeof Module === 'undefined') {
            logToScreen("Error: 'edge-impulse-standalone.js' no detectado.");
            return;
        }
        classifier = new EdgeImpulseClassifier(Module);
        await classifier.init();
        logToScreen("¡Módulo WebAssembly cargado!");
        startCamera();
    } catch (err) {
        logToScreen("Error inicialización: " + err.message);
    }
});

function startCamera() {
    const constraints = { video: { facingMode: "environment" }, audio: false };
    if (!navigator.mediaDevices?.getUserMedia) {
        logToScreen("Navegador sin soporte de cámara.");
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
        .catch(err => logToScreen("Error cámara: " + err.message));
}

async function processFrame() {
    if (!classifier) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    resizeCtx.drawImage(video, 0, 0, MODEL_WIDTH, MODEL_HEIGHT);
    
    const imgData = resizeCtx.getImageData(0, 0, MODEL_WIDTH, MODEL_HEIGHT);
    const data = imgData.data;

    const numPixels = MODEL_WIDTH * MODEL_HEIGHT;
    const rgbData = new Float32Array(numPixels * 3);

    let rgbIndex = 0;
    for (let i = 0; i < data.length; i += 4) {
        rgbData[rgbIndex++] = data[i] / 255.0;     // R
        rgbData[rgbIndex++] = data[i + 1] / 255.0; // G
        rgbData[rgbIndex++] = data[i + 2] / 255.0; // B
    }
    
    try {
        const result = classifier.classify(rgbData);
        if (result) {
            const predictions = result.bounding_boxes || result.results || [];
            drawAndCount(predictions);
        }
    } catch (e) {
        logToScreen("Fallo: " + e.message);
    }

    requestAnimationFrame(processFrame);
}

function drawAndCount(predictions) {
    let limones = 0;
    let naranjas = 0;
    const scaleX = canvas.width / MODEL_WIDTH;
    const scaleY = canvas.height / MODEL_HEIGHT;

    predictions.forEach(prediction => {
        if (prediction.value > 0.35) {
            const labelLower = prediction.label.toLowerCase();
            const esLimon = labelLower.includes('limon') || labelLower.includes('lemon');

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