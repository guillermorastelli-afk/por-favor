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
            
            // Asignar memoria en WebAssembly para las características procesadas
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

// 3. Procesar cuadro, convertir píxeles a RGB y clasificar
async function processFrame() {
    if (!classifier) return;

    // Dibujar el cuadro actual de la cámara en el canvas visible
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Obtener los datos RGBA crudos de la imagen
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;

    // CONVERSIÓN CRÍTICA: Edge Impulse necesita RGB plano (no RGBA).
    // Convertimos cada píxel eliminando el canal Alpha y normalizándolo de 0 a 1 si es necesario.
    const numPixels = canvas.width * canvas.height;
    const rgbData = new Float32Array(numPixels * 3);

    let rgbIndex = 0;
    for (let i = 0; i < data.length; i += 4) {
        // Obtenemos los valores de Rojo, Verde y Azul (RGB)
        // Convertimos el rango de 0-255 a 0-1 flotante dividiendo por 255.
        // (La mayoría de los modelos de Edge Impulse esperan esta normalización)
        rgbData[rgbIndex++] = data[i] / 255.0;     // R
        rgbData[rgbIndex++] = data[i + 1] / 255.0; // G
        rgbData[rgbIndex++] = data[i + 2] / 255.0; // B
        // Saltamos data[i+3] que es el canal Alpha (transparencia)
    }
    
    try {
        // Enviar el nuevo array RGB plano optimizado al clasificador
        const result = await classifier.classify(rgbData);
        
        // Si tu modelo es de detección de objetos, las cajas vienen en "bounding_boxes"
        // Si es clasificación clásica de imagen completa, viene en "results"
        if (result) {
            const predictions = result.bounding_boxes || result.results || [];
            drawAndCount(predictions);
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
        // Filtrar predicciones que tengan más del 50% de certeza (0.50)
        // Bajamos ligeramente a 50% para asegurarnos de que pinte algo si el modelo está dudando
        if (prediction.value > 0.50) {
            
            // Dibujar cuadros si es detección de objetos (bounding boxes)
            if (prediction.x !== undefined && prediction.y !== undefined) {
                const labelLower = prediction.label.toLowerCase();
                const esLimon = labelLower.includes('limon') || labelLower.includes('lemon');
                
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

    // Actualizar números en la pantalla del celular
    limonSpan.innerText = limonesDetectados;
    naranjasSpan.innerText = naranjasDetectados;
}