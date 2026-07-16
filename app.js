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
            
            // Asignar memoria en WebAssembly para las características de imagen
            const obj = this._arrayToHeap(features);
            
            // Invocar la clasificación en el WebAssembly compilado
            let resultPointer = this._module._run_classifier(obj.buffer, obj.size, raw);
            
            // Liberar la memoria reservada para no colapsar el celular
            this._module._free(obj.buffer);
            
            if (resultPointer === 0) {
                throw new Error("La inferencia del clasificador falló.");
            }
            
            // Retornar la respuesta mapeada como texto/JSON
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

// Reportar errores visuales en el celular
window.onerror = function(message, source, lineno, colno, error) {
    alert("Error: " + message + " en línea " + lineno);
    return false;
};

// 1. Inicializar el clasificador unificado
window.addEventListener('load', async () => {
    console.log("Inicializando clasificador unificado...");
    
    try {
        if (typeof Module === 'undefined') {
            alert("Error crítico: No se detectó 'edge-impulse-standalone.js'. Verifica que esté en la misma carpeta.");
            return;
        }

        // Crear instancia usando la clase que integramos arriba
        classifier = new window.EdgeImpulseClassifier(Module);
        await classifier.init();
        
        alert("¡Modelo cargado correctamente! Iniciando cámara...");
        startCamera();
        
    } catch (err) {
        alert("Error cargando el modelo: " + err.message);
    }
});

// 2. Encender la cámara del celular
function startCamera() {
    const constraints = {
        video: { facingMode: "environment" },
        audio: false
    };

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Tu navegador o conexión (HTTP) no soporta el acceso a la cámara.");
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
            alert("Error al abrir la cámara: " + err.name + " - " + err.message);
        });
}

// 3. Procesar cuadro y clasificar
async function processFrame() {
    if (!classifier) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    try {
        // Enviar píxeles al modelo unificado
        const result = await classifier.classify(imgData.data);
        
        if (result && result.results) {
            drawAndCount(result.results);
        }
    } catch (e) {
        console.error("Fallo durante la clasificación:", e);
    }

    requestAnimationFrame(processFrame);
}

// 4. Dibujar en pantalla y contar las frutas
function drawAndCount(predictions) {
    let limonesDetectados = 0;
    let naranjasDetectados = 0;

    predictions.forEach(prediction => {
        if (prediction.value > 0.60) {
            
            // Dibujar cuadros si es detección de objetos
            if (prediction.x !== undefined && prediction.y !== undefined) {
                const esLimon = prediction.label.toLowerCase().includes('limon') || prediction.label.toLowerCase().includes('lemon');
                ctx.strokeStyle = esLimon ? '#FFD700' : '#FF8C00';
                ctx.lineWidth = 4;
                ctx.strokeRect(prediction.x, prediction.y, prediction.width, prediction.height);

                ctx.fillStyle = ctx.strokeStyle;
                ctx.font = '16px Arial';
                ctx.fillText(`${prediction.label} (${Math.round(prediction.value * 100)}%)`, prediction.x, prediction.y > 20 ? prediction.y - 5 : 20);
            }

            // Sumar al conteo según la etiqueta del modelo
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