import * as THREE from 'three';

/**
 * Handles parsing, visualization, and restoration of MetaImage (MHD/RAW) files.
 */
export class MHDHandler {
    constructor() {
        this.header = {};
    }

    /**
     * Load files from disk inputs.
     */
    async load(mhdFile, rawFile, scene, gui) {
        // 1. Read and Parse Header
        const headerText = await this.readFileAsText(mhdFile);
        this.header = this.parseHeader(headerText);

        console.log("MHD Header Parsed:", this.header);

        // 2. Read Binary Data
        const rawBuffer = await this.readFileAsBuffer(rawFile);

        // 3. Parse Raw Data
        const data = this.parseRawData(rawBuffer, this.header);

        if (!data) return null;

        // 4. Create Visualization
        return this.createVisualization(data, this.header, scene, gui);
    }

    /**
     * Recreates a volume from saved JSON data (Restoration).
     */
    restore(savedData, scene, gui) {
        const { header, data, params } = savedData;

        // Recreate the visualization
        // Note: 'data' coming from JSON might be a standard Array, we convert back to Float32Array
        const float32Data = new Float32Array(data);

        const points = this.createVisualization(float32Data, header, scene, gui);

        // Restore specific GUI/Material params
        if (params) {
            // Apply threshold settings stored in params
            // We need to access the update method attached to userData or the GUI folder
            // Since createVisualization initializes with default, we rely on the user to adjust or 
            // we could expose the update function.
            // For simplicity, we assume createVisualization sets up the basics.

            // If we stored exact visual params, we could apply them here:
            if (points.material) points.material.size = params.pointSize || 1.0;
            points.visible = params.visible !== undefined ? params.visible : true;
        }

        return points;
    }

    parseHeader(text) {
        const header = {};
        const lines = text.split(/\r?\n/);
        lines.forEach(line => {
            if (!line.trim()) return;
            const parts = line.split('=');
            if (parts.length >= 2) {
                const key = parts[0].trim();
                const val = parts[1].trim();
                header[key] = val;
            }
        });
        return header;
    }

    parseRawData(buffer, header) {
        const isBigEndian = (header['BinaryDataByteOrderMSB'] === 'True');
        const type = header['ElementType'];

        const dims = header['DimSize'].split(/\s+/).map(Number);
        const expectedCount = dims[0] * dims[1] * dims[2];

        console.log(`Loading Raw: Type=${type}, MSB=${isBigEndian}, Count=${expectedCount}`);

        const dataView = new DataView(buffer);
        let resultData = null;

        try {
            resultData = new Float32Array(expectedCount);
            let byteOffset = 0;
            const getter = this.getDataGetter(type, dataView);
            const step = this.getTypeSize(type);

            if (!getter) {
                alert(`Unsupported ElementType: ${type}`);
                return null;
            }

            if (buffer.byteLength < expectedCount * step) {
                console.warn(`Buffer size warning: Expected ${expectedCount * step}, got ${buffer.byteLength}.`);
            }

            for (let i = 0; i < expectedCount; i++) {
                resultData[i] = getter.call(dataView, byteOffset, !isBigEndian);
                byteOffset += step;
            }

        } catch (e) {
            console.error("Binary parsing error:", e);
            alert("Error parsing RAW file.");
            return null;
        }

        return resultData;
    }

    getTypeSize(type) {
        switch (type) {
            case 'MET_UCHAR': case 'MET_CHAR': return 1;
            case 'MET_USHORT': case 'MET_SHORT': return 2;
            case 'MET_UINT': case 'MET_INT': case 'MET_FLOAT': return 4;
            case 'MET_DOUBLE': return 8;
            default: return 4;
        }
    }

    getDataGetter(type, dataView) {
        switch (type) {
            case 'MET_UCHAR': return dataView.getUint8;
            case 'MET_CHAR': return dataView.getInt8;
            case 'MET_USHORT': return dataView.getUint16;
            case 'MET_SHORT': return dataView.getInt16;
            case 'MET_UINT': return dataView.getUint32;
            case 'MET_INT': return dataView.getInt32;
            case 'MET_FLOAT': return dataView.getFloat32;
            case 'MET_DOUBLE': return dataView.getFloat64;
            default: return null;
        }
    }

    createVisualization(data, header, scene, gui) {
        const dims = header['DimSize'].split(/\s+/).map(Number);
        const spacing = header['ElementSpacing'].split(/\s+/).map(Number);
        const offset = header['Offset'].split(/\s+/).map(Number);

        // Calculate Range
        let minVal = Infinity, maxVal = -Infinity;
        for (let i = 0; i < data.length; i++) {
            if (data[i] > maxVal) maxVal = data[i];
            if (data[i] < minVal) minVal = data[i];
        }

        console.log(`Data Range: [${minVal}, ${maxVal}]`);

        const geometry = new THREE.BufferGeometry();
        const colorObj = new THREE.Color();

        // Pre-calculate world positions
        // MAPPING: GATE X->X, GATE Y->Z, GATE Z->Y
        const allPositions = new Float32Array(data.length * 3);
        const allValues = data;

        let idx = 0;
        for (let z = 0; z < dims[2]; z++) {
            for (let y = 0; y < dims[1]; y++) {
                for (let x = 0; x < dims[0]; x++) {

                    const gateX = offset[0] + x * spacing[0];
                    const gateY = offset[1] + y * spacing[1];
                    const gateZ = offset[2] + z * spacing[2];

                    // AXIS SWAP
                    const pIdx = idx * 3;
                    allPositions[pIdx] = gateX;
                    allPositions[pIdx + 1] = gateZ;
                    allPositions[pIdx + 2] = gateY;

                    idx++;
                }
            }
        }

        const updateGeometry = (minThresh, maxThresh) => {
            const tempPos = [];
            const tempCol = [];
            const range = (maxVal - minVal) || 1;

            for (let i = 0; i < allValues.length; i++) {
                const val = allValues[i];

                if (val >= minThresh && val <= maxThresh) {
                    tempPos.push(allPositions[i * 3], allPositions[i * 3 + 1], allPositions[i * 3 + 2]);

                    const n = (val - minVal) / range;
                    colorObj.setHSL((1.0 - n) * 0.66, 1.0, 0.5);
                    tempCol.push(colorObj.r, colorObj.g, colorObj.b);
                }
            }

            geometry.setAttribute('position', new THREE.Float32BufferAttribute(tempPos, 3));
            geometry.setAttribute('color', new THREE.Float32BufferAttribute(tempCol, 3));
            geometry.computeBoundingSphere();
        };

        const material = new THREE.PointsMaterial({
            size: spacing[0] * 0.9,
            vertexColors: true,
            sizeAttenuation: true
        });

        const points = new THREE.Points(geometry, material);

        // --- CRITICAL: Store data for Serialization ---
        points.userData = {
            isVolume: true,
            header: header,
            data: data, // Keep reference to Float32Array
            params: {
                minThreshold: minVal + (maxVal - minVal) * 0.1,
                maxThreshold: maxVal,
                pointSize: spacing[0] * 0.9,
                visible: true
            }
        };

        scene.add(points);

        // GUI
        const folder = gui.addFolder(`Volume (${dims.join('x')})`);

        // Link params to userData for persistence
        const params = points.userData.params;

        updateGeometry(params.minThreshold, params.maxThreshold);

        folder.add(params, 'visible').name('Visible').onChange(v => points.visible = v);
        folder.add(params, 'pointSize', 0.1, spacing[0] * 5).name('Point Size').onChange(v => material.size = v);

        folder.add(params, 'minThreshold', minVal, maxVal).name('Min Dose')
            .onChange(v => {
                if (v > params.maxThreshold) params.maxThreshold = v;
                updateGeometry(v, params.maxThreshold);
            });

        folder.add(params, 'maxThreshold', minVal, maxVal).name('Max Dose')
            .onChange(v => {
                if (v < params.minThreshold) params.minThreshold = v;
                updateGeometry(params.minThreshold, v);
            });

        folder.add({
            remove: () => {
                scene.remove(points);
                geometry.dispose();
                material.dispose();
                folder.destroy();
                // Note: Remove from manager list handled in manager
            }
        }, 'remove').name('Remove Volume');

        return points;
    }

    readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    readFileAsBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }
}