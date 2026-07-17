// ==========================================
// ADAPTADOR EDGE IMPULSE (PUNTEROS DIRECTOS SIN CCALL)
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

        // 1. Reservar memoria para los datos de la imagen
        const bytesPerElement = Float32Array.BYTES_PER_ELEMENT;
        const nDataBytes = features.length * bytesPerElement;
        const dataPtr = this._module._malloc(nDataBytes);

        // 2. Copiar los datos de la imagen (Float32) al montón (heap)
        const dataHeap = new Uint8Array(this._module.HEAPU8.buffer, dataPtr, nDataBytes);
        dataHeap.set(new Uint8Array(features.buffer, features.byteOffset, nDataBytes));

        let resultStr = "";

        try {
            let resultPointer = 0;

            // Intentamos llamar a la función nativa directamente en el espacio global de C
            if (typeof this._module._run_classifier === 'function') {
                // Argumentos: puntero_datos, cantidad_datos, debug (0 = false)
                resultPointer = this._module._run_classifier(dataPtr, features.length, 0);
            } 
            else if (typeof this._module.run_classifier === 'function') {
                resultPointer = this._module.run_classifier(dataPtr, features.length, false);
            }
            else {
                throw new Error("No se encontró la función _run_classifier ni run_classifier en el módulo.");
            }

            if (resultPointer === 0) {
                throw new Error("La inferencia falló (puntero de respuesta nulo).");
            }

            // Convertir el puntero de la string JSON a string de JavaScript
            resultStr = this._module.UTF8ToString(resultPointer);

        } catch (e) {
            throw new Error("Error en ejecución de WASM: " + e.message);
        } finally {
            // Liberar memoria siempre
            this._module._free(dataPtr);
        }

        return JSON.parse(resultStr);
    }
}