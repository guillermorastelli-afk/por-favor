const video = document.getElementById('webcam');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const limonSpan = document.getElementById('limones');
const naranjasSpan = document.getElementById('naranjas');

let classifierModule = null;

// Forzar alertas en el celular para saber exactamente qué falla
window.onerror = function(message, source, lineno, colno, error) {
    alert("Error de JavaScript: " + message + " en línea " + lineno);
    return false;
};

// 1. Esperar a que la página cargue por completo
window.addEventListener('load', () => {
    console.log("Página cargada. Inicializando modelo...");
    
    // Comprobar si el script de Edge Impulse se cargó en el navegador
    if (typeof Module === 'undefined') {
        alert("Error crítico: El archivo 'edge-impulse-standalone.js' no se ha cargado. Verifica que el nombre en tu index.html sea exacto.");
        return;
    }

    // Inicializar el WebAssembly de Edge Impulse
    Module().then(module => {
        classifierModule = module;
        alert("¡Modelo cargado con éxito! Iniciando cámara...");
        startCamera();
    }).catch(err => {
        alert("Error al inicializar el WebAssembly: " + err.message);
    });
});

// 2. Encender la cámara trasera del celular de forma ultra-compatible
function startCamera() {
    const constraints = {
        video: {
            facingMode: "environment" // Fuerza la cámara trasera del celular
        },
        audio: false
    };

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Tu navegador o tu conexión (HTTP) no soporta el acceso a la cámara. Asegúrate de usar HTTPS.");
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
            alert("Error de hardware al abrir cámara: " + err.name + " - " + err.message);
        });
}

// 3. Procesar cuadro por cuadro
function processFrame() {
    if (!classifierModule) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    // Aquí ejecutamos la clasificación de tu SDK de Edge Impulse
    // Nota: Si el SDK de tu modelo requiere parámetros diferentes, lo veremos en la alerta
    try {
        let result = classifierModule.classify(imgData.data, canvas.width, canvas.height);
        if (result && result.bounding_boxes) {
            drawAndCount(result.bounding_boxes);
        }
    } catch (e) {
        // Evitamos alertas infinitas en el bucle de video, solo imprimimos en consola
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