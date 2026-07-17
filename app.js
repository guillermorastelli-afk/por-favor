// ==========================================
// LIBRERÍA RUN-IMPULSE INTEGRADA
// ==========================================
(function() {
    class EdgeImpulseClassifier {
        constructor(module) {
            this._module = module || (typeof Module !== 'undefined' ? Module : null);
            if (!this._module) {
                throw new Error("No se encontró el módulo de WebAssembly (Module).");
            }
        }
        async init() {
            if (typeof this._module === 'function') {
                this._module = await this._module();
            }
            if (this._module.onRuntimeInitialized) {
                await new Promise((resolve) => {
                    const prev = this._module.onRuntimeInitialized;
                    this._module.onRuntimeInitialized = () => {
                        if (prev) prev();
                        resolve();
                    };
                });
            }
            return this;
        }
        classify(features, raw = false) {
            if (!this._module) throw new Error("Clasificador no inicializado.");
            const obj = this._arrayToHeap(features);
            let resultPointer = this._module._run_classifier(obj.buffer, obj.size, raw);
            this._module._free(obj.buffer);
            if (resultPointer === 0) {
                throw new Error("La inferencia del clasificador falló.");
            }
            const resultStr = this._module.UTF8ToString(resultPointer);
            return JSON.parse(resultStr);
        }
        _arrayToHeap(typedArray) {
            if (!(typedArray instanceof Float32Array)) {
                typedArray = new Float32Array(typedArray);
            }
            const nDataBytes = typedArray.length * typedArray.BYTES_PER_ELEMENT;
            const dataPtr = this._module._malloc(nDataBytes);
            const dataHeap = new Uint8Array(this._module.HEAPU8.buffer, dataPtr, nDataBytes);
            dataHeap.set(new Uint8Array(typedArray.buffer, typedArray.byteOffset, nDataBytes));
            return { buffer: dataPtr, size: typedArray.length };
        }
    }
    window.EdgeImpulseClassifier = EdgeImpulseClassifier;
})();

// ==========================================
// LÓGICA DE LA CÁMARA Y CONTEO
// ==========================================
const video = document.getElementById('webcam');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const limonSpan = document.getElementById('limones');
const naranjasSpan = document.getElementById('naranjas');

let classifier = null;

// Forzar dimensiones comunes para el redimensionado
const MODEL_WIDTH = 96; 
const MODEL_HEIGHT = 96;

const resizeCanvas = document.createElement('canvas');
resizeCanvas.width = MODEL_WIDTH;
resizeCanvas.height = MODEL_HEIGHT;
const resizeCtx = resizeCanvas.getContext('2d');

// Div de diagnóstico flotante para ver respuestas crudas del sistema en el celular
const debugDiv = document.createElement('div');
debugDiv.style.position = 'absolute';
debugDiv.style.bottom = '10px';
debugDiv.style.left = '10px';
debugDiv.style.right = '10px';
debugDiv.style.background = 'rgba(0,0,0,0.85)';
debugDiv.style.color = '#00FF00';
debugDiv.style.padding = '10px';
debugDiv.style.fontSize = '12px';
debugDiv.style.fontFamily = 'monospace';
debugDiv.style.zIndex = '999';
debugDiv.style.maxHeight = '140px';
debugDiv.style.overflowY = 'auto';
debugDiv.style.borderRadius = '5px';
document.body.appendChild(debugDiv);

function logToScreen(text) {
    debugDiv.innerHTML = text + "<br>" + debugDiv.innerHTML;
    const lines = debugDiv.innerHTML.split('<br>');
    if (lines.length > 6) debugDiv.innerHTML = lines.slice(0, 6).join('<br>');
}

window.onerror = function(message, source, lineno, colno, error) {
    logToScreen("ERROR JS: " + message);
    return false;
};

// 1. Inicializar clasificador
window.addEventListener('load', async () => {
    logToScreen("Cargando modelo...");
    try {
        if (typeof Module === 'undefined') {
            logToScreen("Error: 'edge-impulse-standalone.js' no cargado.");
            return;
        }
        classifier = new window.EdgeImpulseClassifier(Module);
        await classifier.init();
        logToScreen("¡Modelo cargado con éxito!");
        startCamera();
    } catch (err) {
        logToScreen("Fallo carga: " + err.message);
    }
});

// 2. Encender cámara
function startCamera() {
    const constraints = { video: { facingMode: "environment" }, audio: false };
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        logToScreen("Cámara no soportada.");
        return;
    }
    navigator.mediaDevices.getUserMedia(constraints)
        .then(stream => {
            video.srcObject = stream;
            video.addEventListener('loadedmetadata', () => {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                logToScreen("Video activo: " + canvas.width + "x" + canvas.height);
                requestAnimationFrame(processFrame);
            });
        })
        .catch(err => { logToScreen("Error cámara: " + err.name); });
}

let testNormalizado = true; // Alternará en caso de error de clasificación

// 3. Procesar y Clasificar (Soporta Normalizado, No Normalizado, FOMO y Clasificación clásica)
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
        // Si 'testNormalizado' es true divide por 255 (0 a 1), si no, pasa el color directo (0 a 255)
        const factor = testNormalizado ? 255.0 : 1.0;
        rgbData[rgbIndex++] = data[i] / factor;     // R
        rgbData[rgbIndex++] = data[i + 1] / factor; // G
        rgbData[rgbIndex++] = data[i + 2] / factor; // B
    }
    
    try {
        const result = await classifier.classify(rgbData);
        
        if (result) {
            // Caso A: El modelo es de detección de objetos (FOMO / Bounding Boxes)
            if (result.bounding_boxes && result.bounding_boxes.length > 0) {
                drawAndCountBoxes(result.bounding_boxes);
            } 
            // Caso B: El modelo es de clasificación de imagen completa
            else if (result.results && result.results.length > 0) {
                showClassificationResults(result.results);
            }
        }
    } catch (e) {
        console.error("Fallo clasificación:", e);
        // Si falla con decimales (0-1), intentamos con rango entero (0-255) en el siguiente frame
        testNormalizado = !testNormalizado;
    }

    requestAnimationFrame(processFrame);
}

// 4. Dibujar si tu modelo es de localización (Detección de Objetos)
function drawAndCountBoxes(predictions) {
    let limones = 0;
    let naranjas = 0;

    const scaleX = canvas.width / MODEL_WIDTH;
    const scaleY = canvas.height / MODEL_HEIGHT;

    predictions.forEach(prediction => {
        if (prediction.value > 0.40) {
            const realX = prediction.x * scaleX;
            const realY = prediction.y * scaleY;
            const realWidth = prediction.width * scaleX;
            const realHeight = prediction.height * scaleY;

            const labelLower = prediction.label.toLowerCase();
            const esLimon = labelLower.includes('limon') || labelLower.includes('lemon');
            
            ctx.strokeStyle = esLimon ? '#FFD700' : '#FF8C00';
            ctx.lineWidth = 4;
            ctx.strokeRect(realX, realY, realWidth, realHeight);

            ctx.fillStyle = ctx.strokeStyle;
            ctx.font = 'bold 18px Arial';
            ctx.fillText(`${prediction.label} (${Math.round(prediction.value * 100)}%)`, realX, realY > 20 ? realY - 5 : 20);

            if (esLimon) limones++;
            else naranjas++;
        }
    });

    limonSpan.innerText = limones;
    naranjasSpan.innerText = naranjas;
}

// 5. Mostrar texto si tu modelo clasifica la imagen completa (No usa cajas de selección)
function showClassificationResults(results) {
    let textoResultado = "Detectando: ";
    let limones = 0;
    let naranjas = 0;

    results.forEach(prediction => {
        const valuePercent = Math.round(prediction.value * 100);
        textoResultado += `${prediction.label}: ${valuePercent}% | `;

        // Si la certeza de lo que ve el celular supera el 60%
        if (prediction.value > 0.60) {
            const labelLower = prediction.label.toLowerCase();
            if (labelLower.includes('limon') || labelLower.includes('lemon')) {
                limones = 1; // Clasifica la escena como un limón
            } else if (labelLower.includes('naranja') || labelLower.includes('orange')) {
                naranjas = 1; // Clasifica la escena como una naranja
            }
        }
    });

    // Mostrar qué clase predomina arriba en los contadores
    limonSpan.innerText = limones;
    naranjasSpan.innerText = naranjas;

    // Pintar los porcentajes en texto gigante en el centro para depurar
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(10, canvas.height - 100, canvas.width - 20, 50);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "16px Arial";
    ctx.fillText(textoResultado, 20, canvas.height - 70);
}