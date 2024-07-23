import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls';
import { createNoise2D, createNoise3D } from 'simplex-noise';
import { InstancedUniformsMesh } from 'three-instanced-uniforms-mesh';

let scene, camera, renderer, controls;
let chunks = {};
const CHUNK_SIZE = 16;
const RENDER_DISTANCE = 3;
const WATER_LEVEL = 4; // Niveau de l'eau
const WATER_COLOR = 0x0000cc; // Couleur de l'eau

const simplex2D = createNoise2D();
const simplex3D = createNoise3D();

let grassMaterial, earthMaterial, caveMaterial
let woodMaterial, leavesMaterial;
let woodInstances, leavesInstances;
let sandMaterial, stoneMaterial, snowMaterial;
let sandInstances, stoneInstances, snowInstances;
const waterMaterial =  createWaterMaterial();


function init() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    controls = new PointerLockControls(camera, document.body);
    scene.add(controls.getObject());

    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.FogExp2(0x111111, 0.01);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.05);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 3);
    directionalLight.position.set(10, 100, 10);
    scene.add(directionalLight);

    loadTextures().then(() => {
        generateInitialChunks();
        placePlayer();
        animate();
    });

    document.addEventListener('click', () => controls.lock());
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', onWindowResize);
}

function loadTextures() {
    const textureLoader = new THREE.TextureLoader();
    const loadTexture = (path) => {
        return new Promise((resolve) => {
            textureLoader.load(path, (texture) => {
                texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
                texture.repeat.set(1, 1);
                texture.magFilter = THREE.NearestFilter;
                texture.minFilter = THREE.NearestMipmapLinearFilter;
                resolve(texture);
            });
        });
    };

    return Promise.all([
        loadTexture('GRASS_COL.jpg'),
        loadTexture('EARTH_COL.jpg'),
        loadTexture('EARTH_DARK_COL.png'),
        loadTexture('acacia_log.png'),
        loadTexture('acacia_leaves.png'),
        loadTexture('sand.png'),
        loadTexture('stone.png'),
        loadTexture('snow.png'),
    ]).then(([grassTexture, earthTexture, caveTexture, woodTexture, leavesTexture, sandTexture, stoneTexture, snowTexture]) => {
        grassMaterial = new THREE.MeshLambertMaterial({ map: grassTexture });
        earthMaterial = new THREE.MeshLambertMaterial({ map: earthTexture });
        caveMaterial = new THREE.MeshLambertMaterial({ map: caveTexture });
        woodMaterial = new THREE.MeshLambertMaterial({ map: woodTexture });
        leavesMaterial = new THREE.MeshLambertMaterial({ map: leavesTexture, transparent:true, color:0x00AA00 });
        sandMaterial = new THREE.MeshLambertMaterial({ map: sandTexture });
        stoneMaterial = new THREE.MeshLambertMaterial({ map: stoneTexture });
        snowMaterial = new THREE.MeshLambertMaterial({ map: snowTexture });
    });
}

function createWaterMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 },
            color: { value: new THREE.Color(WATER_COLOR) },
        },
        vertexShader: `
            uniform float time;
            varying vec2 vUv;
            void main() {
                vUv = uv;
                vec3 pos = position;
                pos.y += sin(pos.x * 2.0 + time) * 0.5 + cos(pos.z * 2.0 + time) * 0.5;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 color;
            varying vec2 vUv;
            void main() {
                gl_FragColor = vec4(color, 0.1);
            }
        `,
        transparent: true
    });
}


function generateSurfaceHeight(x, z) {
    const baseHeight = 0;
    const hillHeight = 4;
    const mountainHeight = 20;

    const hillNoise = simplex2D(x * 0.05, z * 0.05) * 0.5 + 0.5;
    const mountainNoise = simplex2D(x * 0.015, z * 0.015) * 0.5 + 0.5;

    return Math.floor(baseHeight + hillHeight * hillNoise + mountainHeight * Math.pow(mountainNoise, 2));
}

function shouldGenerateBlock(x, y, z) {
    const surfaceHeight = generateSurfaceHeight(x, z);
    if (y <= surfaceHeight) {
        const caveNoise = simplex3D(x * 0.05, y * 0.05, z * 0.05);
        return caveNoise <= -0.1;
    }
    return false;
}

function isInCavity(x, y, z) {
    const caveNoise = simplex3D(x * 0.05, y * 0.05, z * 0.05);
    return caveNoise > -0.4 && caveNoise <= -0.1;
}

function isNearWater(x, y, z) {
    return (y === 0 || y === 1) && (
        simplex2D((x+1) * 0.02, z * 0.02) < WATER_LEVEL / 16 ||
        simplex2D((x-1) * 0.02, z * 0.02) < WATER_LEVEL / 16 ||
        simplex2D(x * 0.02, (z+1) * 0.02) < WATER_LEVEL / 16 ||
        simplex2D(x * 0.02, (z-1) * 0.02) < WATER_LEVEL / 16
    );
}

function isMountain(height) {
    return height > 24; // Ajustez cette valeur selon vos besoins
}

function isSnowCapped(height) {
    return height > 28; // Ajustez cette valeur selon vos besoins
}

function createInstancedMesh(geometry, material, count) {
    return new THREE.InstancedMesh(geometry, material, count);
}

function generateTree(x, y, z) {
    const treeHeight = 6;
    const leavesStart = 4;
    const leavesHeight = 4;
    const leavesWidth = 3;

    for (let i = 0; i < treeHeight; i++) {
        woodInstances.push(new THREE.Vector3(x, y + i, z));
    }

    for (let ly = leavesStart; ly < treeHeight + leavesHeight; ly++) {
        for (let lx = -1; lx <= 2; lx++) {
            for (let lz = -1; lz <= 2; lz++) {
                if (Math.random() > 0.2) { // 80% chance to place a leaf block
                    leavesInstances.push(new THREE.Vector3(x + lx, y + ly, z + lz));
                }
            }
        }
    }
}

function generateChunk(chunkX, chunkY, chunkZ) {
    const chunkKey = `${chunkX},${chunkY},${chunkZ}`;
    if (chunks[chunkKey]) return;

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    
    const grassInstances = [];
    const earthInstances = [];
    const caveInstances = [];
    woodInstances = [];
    leavesInstances = [];
    sandInstances = [];
    stoneInstances = [];
    snowInstances = [];

    for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            const worldX = chunkX * CHUNK_SIZE + x;
            const worldZ = chunkZ * CHUNK_SIZE + z;
            const surfaceHeight = generateSurfaceHeight(worldX, worldZ);

            for (let y = 0; y < CHUNK_SIZE; y++) {
                const worldY = chunkY * CHUNK_SIZE + y;
                
                if (shouldGenerateBlock(worldX, worldY, worldZ)) {
                    const position = new THREE.Vector3(x, y, z);
                    if (worldY === surfaceHeight) {
                        if (isNearWater(worldX, worldY, worldZ)) {
                            sandInstances.push(position);
                        } else if (isMountain(surfaceHeight)) {
                            if (isSnowCapped(surfaceHeight)) {
                                snowInstances.push(position);
                            } else {
                                stoneInstances.push(position);
                            }
                        } else {
                            grassInstances.push(position);
                            
                            // Génération aléatoire d'arbres (seulement sur l'herbe)
                            if (Math.random() < 0.02 && worldY > WATER_LEVEL) {
                                generateTree(x, y + 1, z);
                            }
                        }
                    } else if (isInCavity(worldX, worldY, worldZ)) {
                        caveInstances.push(position);
                    } else {
                        earthInstances.push(position);
                    }
                }
            }
        }
    }

    const grassMesh = createInstancedMesh(geometry, grassMaterial, grassInstances.length);
    const earthMesh = createInstancedMesh(geometry, earthMaterial, earthInstances.length);
    const caveMesh = new InstancedUniformsMesh(geometry, caveMaterial, caveInstances.length);
    const woodMesh = createInstancedMesh(geometry, woodMaterial, woodInstances.length);
    const leavesMesh = createInstancedMesh(geometry, leavesMaterial, leavesInstances.length);
    const sandMesh = createInstancedMesh(geometry, sandMaterial, sandInstances.length);
    const stoneMesh = createInstancedMesh(geometry, stoneMaterial, stoneInstances.length);
    const snowMesh = createInstancedMesh(geometry, snowMaterial, snowInstances.length);

    const matrix = new THREE.Matrix4();
    
    function setInstancedMeshPositions(mesh, instances) {
        instances.forEach((pos, i) => {
            matrix.setPosition(pos);
            mesh.setMatrixAt(i, matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
    }

    setInstancedMeshPositions(grassMesh, grassInstances);
    setInstancedMeshPositions(earthMesh, earthInstances);
    setInstancedMeshPositions(woodMesh, woodInstances);
    setInstancedMeshPositions(leavesMesh, leavesInstances);
    setInstancedMeshPositions(sandMesh, sandInstances);
    setInstancedMeshPositions(stoneMesh, stoneInstances);
    setInstancedMeshPositions(snowMesh, snowInstances);

    caveInstances.forEach((pos, i) => {
        matrix.setPosition(pos);
        caveMesh.setMatrixAt(i, matrix);
        
        const darkness = Math.random() * 0.5 + 0.5;
        caveMesh.setUniformAt('darkness', i, darkness);
    });
    caveMesh.instanceMatrix.needsUpdate = true;

    const chunkGroup = new THREE.Group();
    chunkGroup.add(grassMesh, earthMesh, caveMesh, woodMesh, leavesMesh, sandMesh, stoneMesh, snowMesh);
    chunkGroup.position.set(chunkX * CHUNK_SIZE, chunkY * CHUNK_SIZE, chunkZ * CHUNK_SIZE);
    scene.add(chunkGroup);

    // Water (inchangé)
    const waterGeometry = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE);
    const waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
    waterMesh.rotation.x = -Math.PI / 2;
    waterMesh.position.set(
        CHUNK_SIZE / 2,
        WATER_LEVEL - chunkY * CHUNK_SIZE,
        CHUNK_SIZE / 2
    );
    chunkGroup.add(waterMesh);

    chunks[chunkKey] = { chunkGroup };
}

function generateInitialChunks() {
    for (let x = -RENDER_DISTANCE; x <= RENDER_DISTANCE; x++) {
        for (let y = -RENDER_DISTANCE; y <= RENDER_DISTANCE; y++) {
            for (let z = -RENDER_DISTANCE; z <= RENDER_DISTANCE; z++) {
                generateChunk(x, y, z);
            }
        }
    }
}

function placePlayer() {
    const startX = CHUNK_SIZE / 2;
    const startZ = CHUNK_SIZE / 2;
    const startY = generateSurfaceHeight(startX, startZ) + 2;
    controls.getObject().position.set(startX, startY, startZ);
}

const moveState = { forward: false, backward: false, left: false, right: false };
let isSprinting = false;

function onKeyDown(event) {
    switch (event.code) {
        case 'KeyW': moveState.forward = true; break;
        case 'KeyS': moveState.backward = true; break;
        case 'KeyA': moveState.left = true; break;
        case 'KeyD': moveState.right = true; break;
        case 'ShiftLeft': isSprinting = true; break;
    }
}

function onKeyUp(event) {
    switch (event.code) {
        case 'KeyW': moveState.forward = false; break;
        case 'KeyS': moveState.backward = false; break;
        case 'KeyA': moveState.left = false; break;
        case 'KeyD': moveState.right = false; break;
        case 'ShiftLeft': isSprinting = false; break;
    }
}

function updatePlayerPosition() {
    const speed = isSprinting ? 0.3 : 0.1;
    const direction = new THREE.Vector3();
    controls.getDirection(direction);
    
    if (moveState.forward) controls.getObject().position.addScaledVector(direction, speed);
    if (moveState.backward) controls.getObject().position.addScaledVector(direction, -speed);
    if (moveState.left) controls.getObject().position.addScaledVector(direction.cross(new THREE.Vector3(0, 1, 0)).normalize(), -speed);
    if (moveState.right) controls.getObject().position.addScaledVector(direction.cross(new THREE.Vector3(0, 1, 0)).normalize(), speed);
}

function updateChunks() {
    const position = controls.getObject().position;
    const playerChunkX = Math.floor(position.x / CHUNK_SIZE);
    const playerChunkY = Math.floor(position.y / CHUNK_SIZE);
    const playerChunkZ = Math.floor(position.z / CHUNK_SIZE);

    for (let x = -RENDER_DISTANCE; x <= RENDER_DISTANCE; x++) {
        for (let y = -RENDER_DISTANCE; y <= RENDER_DISTANCE; y++) {
            for (let z = -RENDER_DISTANCE; z <= RENDER_DISTANCE; z++) {
                generateChunk(playerChunkX + x, playerChunkY + y, playerChunkZ + z);
            }
        }
    }

    for (let chunkKey in chunks) {
        const [cx, cy, cz] = chunkKey.split(',').map(Number);
        if (Math.abs(cx - playerChunkX) > RENDER_DISTANCE ||
            Math.abs(cy - playerChunkY) > RENDER_DISTANCE ||
            Math.abs(cz - playerChunkZ) > RENDER_DISTANCE) {
            scene.remove(chunks[chunkKey].earthMesh);
            scene.remove(chunks[chunkKey].grassMesh);
            scene.remove(chunks[chunkKey].waterMesh);
            delete chunks[chunkKey];
        }
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
const clock = new THREE.Clock()
function animate() {
    updatePlayerPosition();
    updateChunks();

    const time = clock.getElapsedTime()
    waterMaterial.uniforms.time.value = time * 0.5;
    // caveMaterial.uniforms.time.value = time;

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
}

init();