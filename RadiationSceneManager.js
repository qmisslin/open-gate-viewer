import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { MHDHandler } from './MHDHandler.js';
import { SceneSerializer } from './SceneSerializer.js';

const EasingFunctions = {
    Linear: t => t,
    InSine: t => 1 - Math.cos((t * Math.PI) / 2),
    OutSine: t => Math.sin((t * Math.PI) / 2),
    InOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
    InQuad: t => t * t,
    OutQuad: t => 1 - (1 - t) * (1 - t),
    InOutQuad: t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
    InCubic: t => t * t * t,
    OutCubic: t => 1 - Math.pow(1 - t, 3),
    InExpo: t => t === 0 ? 0 : Math.pow(2, 10 * t - 10),
    OutExpo: t => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
    InCirc: t => 1 - Math.sqrt(1 - Math.pow(t, 2)),
    OutCirc: t => Math.sqrt(1 - Math.pow(t - 1, 2)),
};

export class RadiationSceneManager {
    constructor(assetsConfig = [], domContainer = document.body) {
        this.container = domContainer;
        this.assetsLibrary = assetsConfig;

        this.sources = [];
        this.meshes = [];
        this.importedVolumes = [];

        this.mhdHandler = new MHDHandler();
        this.serializer = new SceneSerializer();

        this.simulationConfig = {
            domainSize: { x: 100000, y: 10000, z: 100000 },
            voxelResolution: { x: 50, y: 50, z: 50 },
            offset: { x: -50000, y: -5000, z: -50000 }
        };

        this.initScene();
        this.initLights();
        this.initGrid();
        this.initControls();
        this.initGUI();

        this.animate();
        window.addEventListener('resize', this.onWindowResize.bind(this));
    }

    initScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x222222);

        // World group containing grid and imported objects
        this.worldGroup = new THREE.Group();
        this.worldGroup.position.set(0, this.simulationConfig.offset.y, 0);
        this.scene.add(this.worldGroup);

        const aspect = this.container.clientWidth / this.container.clientHeight;

        // Camera setup for large scale scene
        this.camera = new THREE.PerspectiveCamera(45, aspect, 100, 5000000);
        this.camera.position.set(120000, 100000, 150000);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Local clipping enabled
        this.renderer.localClippingEnabled = true;

        this.container.appendChild(this.renderer.domElement);
    }

    initLights() {
        const ambientLight = new THREE.AmbientLight(0x404040, 2);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 2);
        dirLight.position.set(50000, 100000, 50000);
        dirLight.castShadow = true;

        const d = 100000;
        dirLight.shadow.camera.left = -d;
        dirLight.shadow.camera.right = d;
        dirLight.shadow.camera.top = d;
        dirLight.shadow.camera.bottom = -d;
        dirLight.shadow.camera.far = 300000;

        this.scene.add(dirLight);
    }

    initGrid() {
        const size = 200000;
        const divisions = 40;
        this.gridHelper = new THREE.GridHelper(size, divisions, 0x888888, 0x444444);
        this.worldGroup.add(this.gridHelper);
    }

    initControls() {
        this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
        this.orbitControls.enableDamping = true;
        this.orbitControls.maxPolarAngle = Math.PI / 2;

        this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
        this.transformControls.addEventListener('dragging-changed', (event) => {
            this.orbitControls.enabled = !event.value;
        });
        this.scene.add(this.transformControls);

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        this.renderer.domElement.addEventListener('pointerdown', (e) => this.onPointerDown(e));

        window.addEventListener('keydown', (event) => {
            switch (event.key.toLowerCase()) {
                case 't': this.transformControls.setMode('translate'); break;
                case 'r': this.transformControls.setMode('rotate'); break;
                case 'e': this.transformControls.setMode('scale'); break;
                case 'f': this.frameSelected(); break; // Frame Selected
                case 'escape': this.transformControls.detach(); break;
                case 'delete': this.deleteSelected(); break;
            }
        });
    }

    initGUI() {
        if (this.gui) this.gui.destroy();

        this.gui = new GUI({ title: 'Simulation Parameters', container: this.container });
        this.gui.domElement.style.position = 'absolute';
        this.gui.domElement.style.top = '10px';
        this.gui.domElement.style.right = '10px';
        this.gui.width = 320;

        const updateBox = () => this.updateDoseBoxVisual();

        // Folder: Grid & Scene Transform
        const gridFolder = this.gui.addFolder('Scene / Grid Transform');

        gridFolder.add(this.gridHelper, 'visible').name('Show Grid');

        ['x', 'z'].forEach(axis => {
            gridFolder.add(this.worldGroup.position, axis, -100000, 100000)
                .name(`Grid Pos ${axis.toUpperCase()}`)
                .listen();
        });

        // Folder: Voxel Domain
        const domainFolder = this.gui.addFolder('Voxel Domain (Scene Coords)');

        ['x', 'y', 'z'].forEach(axis => {
            domainFolder.add(this.simulationConfig.domainSize, axis, 100, 200000).name(`Size ${axis.toUpperCase()}`).onChange(updateBox);
        });
        ['x', 'y', 'z'].forEach(axis => {
            domainFolder.add(this.simulationConfig.voxelResolution, axis, 1, 500, 1).name(`Res ${axis.toUpperCase()} (Count)`).onChange(updateBox);
        });
        ['x', 'y', 'z'].forEach(axis => {
            domainFolder.add(this.simulationConfig.offset, axis, -200000, 200000).name(`Offset ${axis.toUpperCase()}`).onChange(updateBox);
        });

        if (this.doseBoxHelper) this.scene.remove(this.doseBoxHelper);
        this.doseBoxHelper = new THREE.Box3Helper(new THREE.Box3(), 0xffff00);

        // Visual fix: Disable depth test to see box through objects
        this.doseBoxHelper.material.depthTest = false;
        this.doseBoxHelper.material.transparent = true;

        this.scene.add(this.doseBoxHelper);
        domainFolder.add(this.doseBoxHelper, 'visible').name('Show Domain Box');

        this.updateDoseBoxVisual();
    }

    updateDoseBoxVisual() {
        const { domainSize, offset } = this.simulationConfig;

        const min = new THREE.Vector3(offset.x, offset.y, offset.z);
        const max = min.clone().add(new THREE.Vector3(domainSize.x, domainSize.y, domainSize.z));
        this.doseBoxHelper.box.set(min, max);

        this.worldGroup.position.y = offset.y;
    }

    // New: Frame Selected Object or Domain
    frameSelected() {
        const selected = this.transformControls.object;
        let box;

        if (selected) {
            // Frame the selected object
            // Note: setFromObject calculates world coordinates
            box = new THREE.Box3().setFromObject(selected);
            if (box.isEmpty()) return; // Protection
        } else {
            // Frame the entire Simulation Domain if nothing is selected
            const { domainSize, offset } = this.simulationConfig;
            const min = new THREE.Vector3(offset.x, offset.y, offset.z);
            const max = min.clone().add(new THREE.Vector3(domainSize.x, domainSize.y, domainSize.z));
            box = new THREE.Box3(min, max);
        }

        this.fitCameraToSelection(box);
    }

    fitCameraToSelection(box) {
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();

        box.getSize(size);
        box.getCenter(center);

        // Calculate the distance to fit the bounding box
        const maxSize = Math.max(size.x, size.y, size.z);
        const fitHeightDistance = maxSize / (2 * Math.atan(Math.PI * this.camera.fov / 360));
        const fitWidthDistance = fitHeightDistance / this.camera.aspect;
        const distance = 1.2 * Math.max(fitHeightDistance, fitWidthDistance); // 1.2 multiplier for padding

        // Determine direction from current camera position to the new center target
        const direction = this.camera.position.clone()
            .sub(this.orbitControls.target)
            .normalize()
            .multiplyScalar(distance);

        // Update Controls target
        this.orbitControls.target.copy(center);

        // Update Camera Position
        this.camera.position.copy(center).add(direction);

        // Adjust Near/Far planes to ensure object is not clipped
        this.camera.near = distance / 100;
        this.camera.far = distance * 100; // Ensure we see far enough
        this.camera.updateProjectionMatrix();

        this.orbitControls.update();
    }

    onPointerDown(event) {
        if (this.transformControls.dragging || this.transformControls.axis !== null) return;
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);

        const objectsToCheck = [...this.meshes, ...this.sources.map(s => s.mesh)];
        const intersects = this.raycaster.intersectObjects(objectsToCheck);

        if (intersects.length > 0) this.transformControls.attach(intersects[0].object);
        else this.transformControls.detach();
    }

    deleteSelected() {
        const selected = this.transformControls.object;
        if (!selected) return;
        if (this.meshes.includes(selected)) {
            if (selected.userData.guiFolder) selected.userData.guiFolder.destroy();
            this.worldGroup.remove(selected);
            this.meshes = this.meshes.filter(m => m !== selected);
            if (selected.geometry) selected.geometry.dispose();
            this.transformControls.detach();
            return;
        }
        const sourceRef = this.sources.find(s => s.mesh === selected);
        if (sourceRef) {
            if (sourceRef.guiFolder) sourceRef.guiFolder.destroy();
            this.worldGroup.remove(sourceRef.mesh);
            this.sources = this.sources.filter(s => s !== sourceRef);
            this.transformControls.detach();
            return;
        }
    }

    clearScene() {
        [...this.sources].forEach(s => {
            this.worldGroup.remove(s.mesh);
            if (s.guiFolder) s.guiFolder.destroy();
        });
        this.sources = [];

        [...this.meshes].forEach(m => {
            this.worldGroup.remove(m);
            if (m.geometry) m.geometry.dispose();
            if (m.userData.guiFolder) m.userData.guiFolder.destroy();
        });
        this.meshes = [];

        [...this.importedVolumes].forEach(v => {
            this.scene.remove(v);
            if (v.geometry) v.geometry.dispose();
            if (v.material) v.material.dispose();
        });
        this.importedVolumes = [];

        this.transformControls.detach();
        this.initGUI();
    }

    saveScene() {
        const json = this.serializer.serialize(this);
        const blob = new Blob([json], { type: 'application/json' });
        this.downloadBlob(blob, 'gate_scene.json');
    }

    loadScene(jsonString) {
        this.serializer.deserialize(jsonString, this);
    }

    loadAssetSTL(assetConfig) {
        this.loadAssetFromUrl(assetConfig.file, assetConfig.name);
    }

    loadAssetFromUrl(url, name, onLoadCallback) {
        const loader = new STLLoader();
        loader.load(url, (geometry) => {
            this.processLoadedGeometry(geometry, name, true, url, onLoadCallback);
        }, undefined, (err) => {
            console.error(err);
            alert(`Failed to load asset: ${url}`);
        });
    }

    loadLocalSTL(file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const loader = new STLLoader();
            try {
                const geometry = loader.parse(event.target.result);
                this.processLoadedGeometry(geometry, file.name, false, null, null);
            } catch (err) {
                console.error(err);
                alert("Failed to parse local STL.");
            }
        };
        reader.readAsArrayBuffer(file);
    }

    processLoadedGeometry(geometry, name, isAsset, assetPath, onLoadCallback) {
        geometry.computeBoundingBox();
        const center = new THREE.Vector3();
        geometry.boundingBox.getCenter(center);
        geometry.translate(-center.x, 0, -center.z);
        geometry.computeBoundingBox();
        geometry.translate(0, -geometry.boundingBox.min.y, 0);
        if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals();

        const material = new THREE.MeshPhongMaterial({ color: 0x607d8b, specular: 0x111111, shininess: 200 });
        const mesh = new THREE.Mesh(geometry, material);

        // Reverted: Removed 10x scale to keep original size
        // mesh.scale.set(10, 10, 10); 

        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.userData.isAsset = isAsset;
        mesh.userData.path = assetPath;
        mesh.userData.name = name;

        this.worldGroup.add(mesh);
        this.meshes.push(mesh);

        this.transformControls.attach(mesh);
        this.addMeshGUI(mesh, name);

        if (onLoadCallback) onLoadCallback(mesh);
    }

    addMeshGUI(mesh, name) {
        const folder = this.gui.addFolder(`Obj: ${name}`);
        folder.add(mesh, 'visible');
        folder.add({
            delete: () => {
                this.worldGroup.remove(mesh);
                this.meshes = this.meshes.filter(m => m !== mesh);
                folder.destroy();
                this.transformControls.detach();
                mesh.geometry.dispose();
            }
        }, 'delete').name("Delete Object");
        mesh.userData.guiFolder = folder;
    }

    addSource() {
        const sourceData = {
            radius: 1000,
            doseCenter: 100,
            dosePeriphery: 10,
            falloff: 'Linear',
            mesh: null,
            guiFolder: null
        };
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 32), new THREE.MeshPhongMaterial({ color: 0xff0000, transparent: true, opacity: 0.4 }));
        mesh.position.set(0, 1000, 0);
        mesh.scale.setScalar(sourceData.radius);
        mesh.userData.isSource = true;

        this.worldGroup.add(mesh);
        this.sources.push(sourceData);
        sourceData.mesh = mesh;

        const folder = this.gui.addFolder(`Source ${this.sources.length}`);
        sourceData.guiFolder = folder;
        folder.add(sourceData, 'radius', 10, 50000).name('Radius').listen().onChange(v => mesh.scale.setScalar(v));
        folder.add(sourceData, 'doseCenter', 0, 1000).listen();
        folder.add(sourceData, 'dosePeriphery', 0, 1000).listen();
        folder.add(sourceData, 'falloff', Object.keys(EasingFunctions)).listen();
        folder.add({
            delete: () => {
                this.worldGroup.remove(mesh);
                this.sources = this.sources.filter(s => s !== sourceData);
                folder.destroy();
                this.transformControls.detach();
            }
        }, 'delete');
        this.transformControls.attach(mesh);
        return sourceData;
    }

    loadMHD(fileList) {
        let mhdFile = null, rawFile = null;
        for (const f of fileList) {
            if (f.name.toLowerCase().endsWith('.mhd')) mhdFile = f;
            else if (f.name.toLowerCase().endsWith('.raw')) rawFile = f;
        }
        if (!mhdFile || !rawFile) {
            alert("Missing .mhd or .raw file.");
            return;
        }
        this.mhdHandler.load(mhdFile, rawFile, this.scene, this.gui)
            .then(points => {
                if (points) this.importedVolumes.push(points);
            });
    }

    calculateDoseAtPoint(point, worldSources) {
        let totalDose = 0;

        for (const s of worldSources) {
            const d = point.distanceTo(s.worldPosition);
            const r = s.data.mesh.scale.x;

            if (d <= r) {
                const t = d / r;
                const alpha = (EasingFunctions[s.data.falloff] || EasingFunctions.Linear)(t);
                totalDose += (1 - alpha) * s.data.doseCenter + alpha * s.data.dosePeriphery;
            }
        }
        return totalDose;
    }

    async exportGateFiles() {
        const conf = this.simulationConfig;

        const dimGateX = Math.floor(conf.voxelResolution.x);
        const dimGateY = Math.floor(conf.voxelResolution.z);
        const dimGateZ = Math.floor(conf.voxelResolution.y);

        const spacingX = conf.domainSize.x / dimGateX;
        const spacingY = conf.domainSize.z / dimGateY;
        const spacingZ = conf.domainSize.y / dimGateZ;

        const totalVoxels = dimGateX * dimGateY * dimGateZ;

        console.log(`Exporting: ${dimGateX}x${dimGateY}x${dimGateZ} (Spacing: ${spacingX.toFixed(2)}, ${spacingY.toFixed(2)}, ${spacingZ.toFixed(2)})`);

        const worldSources = this.sources.map(s => {
            const worldPos = new THREE.Vector3();
            s.mesh.getWorldPosition(worldPos);
            return { data: s, worldPosition: worldPos };
        });

        const buffer = new Float32Array(totalVoxels);
        let idx = 0;
        const worldPos = new THREE.Vector3();

        for (let k = 0; k < dimGateZ; k++) {
            for (let j = 0; j < dimGateY; j++) {
                for (let i = 0; i < dimGateX; i++) {
                    worldPos.x = conf.offset.x + i * spacingX;
                    worldPos.y = conf.offset.y + k * spacingZ;
                    worldPos.z = conf.offset.z + j * spacingY;

                    buffer[idx++] = this.calculateDoseAtPoint(worldPos, worldSources);
                }
            }
        }

        const rawFileName = 'simulation-Dose.raw';
        const rawBlob = new Blob([buffer], { type: 'application/octet-stream' });
        const mhdContent = [
            'ObjectType = Image', 'NDims = 3', 'BinaryData = True', 'BinaryDataByteOrderMSB = False',
            'TransformMatrix = 1 0 0 0 1 0 0 0 1',
            `Offset = ${conf.offset.x} ${conf.offset.z} ${conf.offset.y}`,
            `ElementSpacing = ${spacingX} ${spacingY} ${spacingZ}`,
            `DimSize = ${dimGateX} ${dimGateY} ${dimGateZ}`,
            'ElementType = MET_FLOAT', `ElementDataFile = ${rawFileName}`
        ].join('\r\n');

        this.downloadBlob(rawBlob, rawFileName);
        setTimeout(() => this.downloadBlob(new Blob([mhdContent], { type: 'text/plain' }), 'simulation-Dose.mhd'), 500);
    }

    downloadBlob(blob, filename) {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    onWindowResize() {
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    animate() {
        requestAnimationFrame(this.animate.bind(this));
        this.orbitControls.update();
        this.renderer.render(this.scene, this.camera);
    }
}