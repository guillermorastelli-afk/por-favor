const video = document.getElementById('webcam');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const limonSpan = document.getElementById('limones');
const naranjasSpan = document.getElementById('naranjas');

let classifierModule = null;

// 1. Inicializar el WebAssembly de Edge Impulse
// El nombre "Module" u "EdgeImpulseClassifier" depende de cómo exportaste el SDK.
// Usualmente se auto-ejecuta al cargar el script de Emscripten.
Module().then(module => {
    classifierModule = module;
    console.log("Modelo cargado exitosamente.");
    startCamera();
});

// 2. Encender la cámara trasera del celular
function startCamera() {
    const constraints = {
        video: {
            // "environment" fuerza el uso de la cámara trasera del celular
            facingMode: "environment", 
            width: { ideal: 640 },
            height: { ideal: 480 }
        },
        audio: false
    };

    navigator.mediaDevices.getUserMedia(constraints)
        .then(stream => {
            video.srcObject = stream;
            video.addEventListener('loadedmetadata', () => {
                // Ajustar resolución del lienzo al tamaño de la cámara
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                // Comenzar ciclo de procesamiento
                requestAnimationFrame(processFrame);
            });
        })
        .catch(err => {
            console.error("Error accediendo a la cámara del celular: ", err);
            alert("Por favor, permite el acceso a la cámara.");
        });
}

// 3. Procesar cuadro por cuadro de la cámara
function processFrame() {
    if (!classifierModule) return;

    // Dibujar el cuadro actual de la cámara en el Canvas invisible
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Obtener los píxeles de la cámara para pasárselos al modelo
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    // Convertir la imagen a formato de entrada que espera Edge Impulse (usualmente RGB en array plano)
    // El SDK de Edge Impulse provee funciones para clasificar directamente desde arrays de píxeles:
    
    // NOTA: La firma exacta de la función depende de la versión de tu SDK. 
    // Usualmente ejecutas algo como:
    let result = classifierModule.classify(imgData.data, canvas.width, canvas.height);

    if (result && result.bounding_boxes) {
        drawAndCount(result.bounding_boxes);
    }

    // Repetir en el siguiente cuadro (loop continuo)
    requestAnimationFrame(processFrame);
}

// 4. Dibujar los cuadros de detección y actualizar los contadores
function drawAndCount(boxes) {
    let limonesDetectados = 0;
    let naranjasDetectados = 0;

    boxes.forEach(box => {
        // Filtro de confianza: Ajusta este valor (0.60 = 60%) según la precisión que busques
        if (box.value > 0.60) {
            
            // Dibujar rectángulo alrededor de la fruta detectada
            ctx.strokeStyle = box.label.includes('limon') ? '#FFD700' : '#FF8C00';
            ctx.lineWidth = 4;
            ctx.strokeRect(box.x, box.y, box.width, box.height);

            // Dibujar etiqueta de texto encima del rectángulo
            ctx.fillStyle = ctx.strokeStyle;
            ctx.font = '16px Arial';
            ctx.fillText(`${box.label} (${Math.round(box.value * 100)}%)`, box.x, box.y > 20 ? box.y - 5 : 20);

            // Clasificación del conteo (Fíjate si tus labels se llaman exactamente así en Edge Impulse)
            if (box.label === 'limon' || box.label === 'lemon') {
                limonesDetectados++;
            } else if (box.label === 'naranja' || box.label === 'orange') {
                naranjasDetectados++;
            }
        }
    });

    // Actualizar el texto en el HUD de la pantalla del celular
    limonSpan.innerText = limonesDetectados;
    naranjasSpan.innerText = naranjasDetectados;
}