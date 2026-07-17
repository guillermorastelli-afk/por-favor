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

// ========================================================
// ⚠️ AJUSTA AQUÍ EL TAMAÑO DE ENTRADA DE TU MODELO
// La mayoría de proyectos FOMO en Edge Impulse usan 96x96.
// Si usaste MobileNet, podría ser 160x160 o 320x320.
// ========================================================
const MODEL_WIDTH = 320; 
const MODEL_HEIGHT = 320;

// Crear un pequeño canvas oculto en memoria para redimensionar la imagen
const resizeCanvas = document.createElement('canvas');
resizeCanvas.width = MODEL_WIDTH;
resizeCanvas.height = MODEL_HEIGHT;
const resizeCtx = resizeCanvas.getContext('2d');

window.onerror = function(message, source, lineno, colno, error) {
    alert("Error: " + message + " en línea " + lineno);
    return false;
};

// 1. Inicializar clasificador
window.addEventListener('load', async () => {
    try {
        if (typeof Module === 'undefined') {
            alert("Error crítico: No se detectó 'edge-impulse-standalone.js'.");
            return;
        }

        classifier = new window.EdgeImpulseClassifier(Module);
        await classifier.init();
        
        alert("¡Modelo cargado! Tamaño esperado: " + MODEL_WIDTH + "x" + MODEL_HEIGHT + ". Iniciando cámara...");
        startCamera();
        
    } catch (err) {
        alert("Error cargando el modelo: " + err.message);
    }
});

// 2. Encender cámara trasera
function startCamera() {
    const constraints = {
        video: { facingMode: "environment" },
        audio: false
    };

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Navegador incompatible con cámara web.");
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
            alert("Error al abrir cámara: " + err.name);
        });
}

// 3. Redimensionar y clasificar
async function processFrame() {
    if (!classifier) return;

    // A. Dibujar el video en el canvas grande de la pantalla
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // B. Dibujar el video en tamaño miniatura para el modelo (ej. 96x96)
    resizeCtx.drawImage(video, 0, 0, MODEL_WIDTH, MODEL_HEIGHT);
    
    // C. Tomar píxeles de la miniatura
    const imgData = resizeCtx.getImageData(0, 0, MODEL_WIDTH, MODEL_HEIGHT);
    const data = imgData.data;

    // D. Convertir RGBA miniatura a RGB normalizado de 0 a 1 para Edge Impulse
    const numPixels = MODEL_WIDTH * MODEL_HEIGHT;
    const rgbData = new Float32Array(numPixels * 3);

    let rgbIndex = 0;
    for (let i = 0; i < data.length; i += 4) {
        rgbData[rgbIndex++] = data[i] / 255.0;     // R
        rgbData[rgbIndex++] = data[i + 1] / 255.0; // G
        rgbData[rgbIndex++] = data[i + 2] / 255.0; // B
    }
    
    try {
        // Ejecutar inferencia con la miniatura procesada
        const result = await classifier.classify(rgbData);
        
        if (result) {
            const predictions = result.bounding_boxes || result.results || [];
            drawAndCount(predictions);
        }
    } catch (e) {
        console.error("Error inferencia:", e);
    }

    requestAnimationFrame(processFrame);
}

// 4. Dibujar predicciones (y re-escalar las coordenadas de vuelta a la pantalla)
function drawAndCount(predictions) {
    let limonesDetectados = 0;
    let naranjasDetectados = 0;

    // Factor de escala para convertir las coordenadas del mini-canvas (96x96) al canvas visible (celular)
    const scaleX = canvas.width / MODEL_WIDTH;
    const scaleY = canvas.height / MODEL_HEIGHT;

    predictions.forEach(prediction => {
        // Reducimos el umbral de detección a 40% (0.40) para maximizar la probabilidad de que muestre algo
        if (prediction.value > 0.40) {
            
            if (prediction.x !== undefined && prediction.y !== undefined) {
                // Ajustar posición del cuadro del tamaño miniatura al tamaño real del celular
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