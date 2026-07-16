const video = document.getElementById('webcam');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const limonSpan = document.getElementById('limones');
const naranjasSpan = document.getElementById('naranjas');

let classifier = null;

// Reportar cualquier error en pantalla de forma visual
window.onerror = function(message, source, lineno, colno, error) {
    alert("Error: " + message + " en línea " + lineno);
    return false;
};

// 1. Inicializar la librería de clasificación
window.addEventListener('load', async () => {
    console.log("Inicializando clasificador...");
    
    try {
        // EdgeImpulseClassifier es proveído por la librería 'run-impulse.js' que añadimos al HTML
        if (typeof EdgeImpulseClassifier === 'undefined') {
            alert("Falta cargar la librería run-impulse.js de Edge Impulse.");
            return;
        }

        // Inicializar el clasificador utilizando tu módulo WebAssembly de Emscripten
        classifier = new EdgeImpulseClassifier();
        await classifier.init();
        
        alert("¡Modelo de Edge Impulse cargado correctamente! Iniciando cámara...");
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
            alert("Error al abrir la cámara: " + err.name);
        });
}

// 3. Procesar cuadro de video y clasificar
async function processFrame() {
    if (!classifier) return;

    // Dibujar cámara en canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Capturar píxeles
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    try {
        // Enviar píxeles al clasificador de Edge Impulse
        // El SDK requiere un array plano con datos de color
        const result = await classifier.classify(imgData.data);
        
        if (result && result.results) {
            // Dibujar cuadros si es detección de objetos
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
        // Filtrar predicciones que tengan más del 60% de certeza
        if (prediction.value > 0.60) {
            
            // Si tu modelo es de "detección de objetos" (bounding boxes)
            if (prediction.x !== undefined && prediction.y !== undefined) {
                ctx.strokeStyle = prediction.label.toLowerCase().includes('limon') || prediction.label.toLowerCase().includes('lemon') ? '#FFD700' : '#FF8C00';
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

    // Actualizar números en el celular
    limonSpan.innerText = limonesDetectados;
    naranjasSpan.innerText = naranjasDetectados;
}