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
            return {
                buffer: dataPtr,
                size: typedArray.length
            };
        }
    }
    window.EdgeImpulseClassifier = EdgeImpulseClassifier;
})();

// ==========================================
// LÓGICA DE LA CÁMARA Y CONTEO DE FRUTAS
// ==========================================
const video = document.getElementById('webcam');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const limonSpan = document.getElementById('limones');
const naranjasSpan = document.getElementById('naranjas');

let classifier = null;

// Tamaño del modelo (por defecto 96x96, FOMO de Edge Impulse)
const MODEL_WIDTH = 320; 
const MODEL_HEIGHT = 320;

const resizeCanvas = document.createElement('canvas');
resizeCanvas.width = MODEL_WIDTH;
resizeCanvas.height = MODEL_HEIGHT;
const resizeCtx = resizeCanvas.getContext('2d');

// Elemento flotante para ver logs en tiempo real en la pantalla del celular
const debugDiv = document.createElement('div');
debugDiv.style.position = 'absolute';
debugDiv.style.bottom = '20px';
debugDiv.style.left = '10px';
debugDiv.style.right = '10px';
debugDiv.style.background = 'rgba(0,0,0,0.85)';
debugDiv.style.color = '#00FF00';
debugDiv.style.padding = '10px';
debugDiv.style.fontSize = '12px';
debugDiv.style.fontFamily = 'monospace';
debugDiv.style.zIndex = '999';
debugDiv.style.maxHeight = '150px';
debugDiv.style.overflowY = 'auto';
debugDiv.style.borderRadius = '5px';
document.body.appendChild(debugDiv);

function logToScreen(text) {
    debugDiv.innerHTML = text + "<br>" + debugDiv.innerHTML;
    // Mantener solo los últimos mensajes para no saturar
    const lines = debugDiv.innerHTML.split('<br>');
    if (lines.length > 8) {
        debugDiv.innerHTML = lines.slice(0, 8).join('<br>');
    }
}

window.onerror = function(message, source, lineno, colno, error) {
    logToScreen("ERROR JS: " + message + " en línea " + lineno);
    return false;
};

// 1. Inicializar clasificador
window.addEventListener('load', async () => {
    logToScreen("Iniciando carga de componentes...");
    try {
        if (typeof Module === 'undefined') {
            logToScreen("Error: No se detectó 'edge-impulse-standalone.js'");
            return;
        }

        classifier = new window.EdgeImpulseClassifier(Module);
        await classifier.init();
        logToScreen("¡Modelo cargado correctamente!");
        startCamera();
        
    } catch (err) {
        logToScreen("Error cargando el modelo: " + err.message);
    }
});

// 2. Encender cámara trasera
function startCamera() {
    const constraints = {
        video: { facingMode: "environment" },
        audio: false
    };

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        logToScreen("Dispositivo no soporta getUserMedia");
        return;
    }

    navigator.mediaDevices.getUserMedia(constraints)
        .then(stream => {
            video.srcObject = stream;
            video.addEventListener('loadedmetadata', () => {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                logToScreen("Cámara activa: " + canvas.width + "x" + canvas.height);
                requestAnimationFrame(processFrame);
            });
        })
        .catch(err => {
            logToScreen("Error cámara: " + err.name);
        });
}

let counter = 0;

// 3. Redimensionar y clasificar
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
        const result = await classifier.classify(rgbData);
        
        counter++;
        // Cada 60 cuadros (aprox 2 segundos), mostramos qué responde el modelo
        if (counter % 60 === 0) {
            logToScreen("Respuesta raw del modelo: " + JSON.stringify(result).substring(0, 100));
        }

        if (result) {
            const predictions = result.bounding_boxes || result.results || [];
            drawAndCount(predictions);
        }
    } catch (e) {
        logToScreen("Fallo en inferencia: " + e.message);
    }

    requestAnimationFrame(processFrame);
}

// 4. Dibujar predicciones
function drawAndCount(predictions) {
    let limonesDetectados = 0;
    let naranjasDetectados = 0;

    const scaleX = canvas.width / MODEL_WIDTH;
    const scaleY = canvas.height / MODEL_HEIGHT;

    predictions.forEach(prediction => {
        // Umbral bajo (10%) solo para ver si está detectando algo en depuración
        if (prediction.value > 0.10) {
            
            if (prediction.x !== undefined && prediction.y !== undefined) {
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
            }

            const labelClean = prediction.label.toLowerCase();
            if (labelClean === 'limon' || labelClean === 'lemon') {
                limonesDetectados++;
            } else if (labelClean === 'naranja' || labelClean === 'orange') {
                naranjasDetectados++;
            }
        }
    });

    limonSpan.innerText = limonesDetectados;
    naranjasSpan.innerText = naranjasDetectados;
}