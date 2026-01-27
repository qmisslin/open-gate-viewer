import * as THREE from 'three';

/**
 * Handles saving and loading the scene state to/from JSON.
 * Includes support for Voxel Data via Base64 encoding.
 */
export class SceneSerializer {

    /**
     * Serializes the current scene state into a JSON string.
     * @param {RadiationSceneManager} manager - The main manager instance.
     * @returns {string} JSON representation of the scene.
     */
    serialize(manager) {
        const state = {
            meta: {
                version: 1.1,
                timestamp: new Date().toISOString(),
                appName: "GateSimulationDesigner"
            },
            config: manager.simulationConfig,
            camera: {
                position: manager.camera.position.toArray(),
                target: manager.orbitControls.target.toArray()
            },
            sources: [],
            assets: [],
            volumes: [] // New: Store voxel fields
        };

        // 1. Serialize Radiation Sources
        manager.sources.forEach(src => {
            state.sources.push({
                position: src.mesh.position.toArray(),
                radius: src.radius,
                doseCenter: src.doseCenter,
                dosePeriphery: src.dosePeriphery,
                falloff: src.falloff
            });
        });

        // 2. Serialize Meshes (Assets)
        manager.meshes.forEach(mesh => {
            if (mesh.userData.isAsset) {
                state.assets.push({
                    type: 'library_asset',
                    path: mesh.userData.path,
                    name: mesh.userData.name,
                    position: mesh.position.toArray(),
                    rotation: mesh.rotation.toArray(),
                    scale: mesh.scale.toArray()
                });
            } else {
                console.warn("Local STL import ignored in save file.");
            }
        });

        // 3. Serialize Imported Volumes (Voxel Fields)
        // Warning: This can generate large JSON files.
        manager.importedVolumes.forEach(points => {
            if (points.userData && points.userData.isVolume) {
                const ud = points.userData;

                // Convert Float32Array to Base64 String
                const base64Data = this.float32ToBase64(ud.data);

                state.volumes.push({
                    header: ud.header,
                    params: ud.params,
                    dataBase64: base64Data
                });
            }
        });

        return JSON.stringify(state, null, 2);
    }

    /**
     * Restores the scene from a JSON string.
     */
    deserialize(jsonString, manager) {
        try {
            const state = JSON.parse(jsonString);

            // 1. Clear existing scene
            manager.clearScene();

            // 2. Restore Configuration
            if (state.config) {
                manager.simulationConfig.domainSize = state.config.domainSize;
                manager.simulationConfig.voxelResolution = state.config.voxelResolution;
                manager.simulationConfig.offset = state.config.offset;
                manager.updateDoseBoxVisual();
            }

            // 3. Restore Camera
            if (state.camera) {
                manager.camera.position.fromArray(state.camera.position);
                manager.orbitControls.target.fromArray(state.camera.target);
                manager.orbitControls.update();
            }

            // 4. Restore Sources
            if (state.sources && Array.isArray(state.sources)) {
                state.sources.forEach(srcData => {
                    const newSourceData = manager.addSource();
                    newSourceData.mesh.position.fromArray(srcData.position);
                    newSourceData.radius = srcData.radius;
                    newSourceData.doseCenter = srcData.doseCenter;
                    newSourceData.dosePeriphery = srcData.dosePeriphery;
                    newSourceData.falloff = srcData.falloff;
                    newSourceData.mesh.scale.setScalar(srcData.radius);
                });
            }

            // 5. Restore Assets
            if (state.assets && Array.isArray(state.assets)) {
                state.assets.forEach(assetData => {
                    if (assetData.type === 'library_asset') {
                        manager.loadAssetFromUrl(assetData.path, assetData.name, (mesh) => {
                            mesh.position.fromArray(assetData.position);
                            mesh.rotation.fromArray(assetData.rotation);
                            mesh.scale.fromArray(assetData.scale);
                        });
                    }
                });
            }

            // 6. Restore Volumes (Voxels)
            if (state.volumes && Array.isArray(state.volumes)) {
                console.log(`Restoring ${state.volumes.length} volume(s)...`);
                state.volumes.forEach(volData => {
                    // Convert Base64 back to Float32Array
                    const floatArray = this.base64ToFloat32(volData.dataBase64);

                    const restoredData = {
                        header: volData.header,
                        params: volData.params,
                        data: floatArray
                    };

                    // Use MHDHandler to restore visualization
                    // We need access to the handler. We can assume manager exposes it.
                    if (manager.mhdHandler) {
                        const points = manager.mhdHandler.restore(restoredData, manager.scene, manager.gui);
                        if (points) manager.importedVolumes.push(points);
                    }
                });
            }

            console.log("Scene loaded successfully.");

        } catch (e) {
            console.error("Failed to load scene:", e);
            alert("Invalid scene file format or file too large.");
        }
    }

    // --- Helpers for Binary Encoding ---

    float32ToBase64(float32Array) {
        // Create a Uint8Array view on the same buffer
        const uint8Array = new Uint8Array(float32Array.buffer);
        let binary = '';
        const len = uint8Array.byteLength;
        // Process in chunks to avoid call stack size exceeded
        const CHUNK_SIZE = 0x8000;
        for (let i = 0; i < len; i += CHUNK_SIZE) {
            binary += String.fromCharCode.apply(null, uint8Array.subarray(i, i + CHUNK_SIZE));
        }
        return window.btoa(binary);
    }

    base64ToFloat32(base64) {
        const binary_string = window.atob(base64);
        const len = binary_string.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary_string.charCodeAt(i);
        }
        return new Float32Array(bytes.buffer);
    }
}