import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls';
import { createNoise2D, createNoise3D } from 'simplex-noise';
import LZString from 'lz-string';
import { InstancedUniformsMesh } from 'three-instanced-uniforms-mesh';
import VoxelWorld from './voxelworld';

const chunkWorker = new Worker(new URL('./chunkWorker.js', import.meta.url), {
    type: 'module'
  })

let scene, camera, renderer, controls;
let chunks = {};
const CHUNK_SIZE = 16;
const RENDER_DISTANCE = 3;
const WATER_LEVEL = 4; // Niveau de l'eau
const WATER_COLOR = 0x0000cc; // Couleur de l'eau

const simplex2D = createNoise2D();
const simplex3D = createNoise3D();

let woodMaterial, leavesMaterial;
let woodInstances = [], leavesInstances = [], waterInstances = [];

const INITIAL_RENDER_DISTANCE = RENDER_DISTANCE * 2;
let lastPlayerChunk = { x: 0, y: 0, z: 0 };
const CHUNK_UPDATE_INTERVAL = 500; // Millisecondes
let lastChunkUpdateTime = 0;

const STREAMING_DISTANCE = RENDER_DISTANCE + 5;

// const waterMaterial =  createWaterMaterial();
const waterMaterial = new THREE.MeshPhongMaterial({
    color: 0x0077be,
    side:THREE.DoubleSide,
    transparent: true,
    opacity: 0.95,
});

const instanced_mesh_geometry = new THREE.BoxGeometry(1, 1, 1);
const instanced_water_geometry = new THREE.PlaneGeometry(1, 1, 1);
instanced_water_geometry.rotateX( -Math.PI / 2)


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

    setupLighting();
    loadTextures().then(() => {
        generateInitialChunks();
        placePlayer();
        animate();
    });

    setupEventListeners();
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
        loadTexture('acacia_log.png'),
        loadTexture('acacia_leaves.png'),
    ]).then(([ woodTexture, leavesTexture]) => {
        woodMaterial = new THREE.MeshLambertMaterial({ map: woodTexture });
        leavesMaterial = new THREE.MeshLambertMaterial({ map: leavesTexture, transparent:true, color:0x00AA00 });
    });
}

function setupLighting() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.05);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 3);
    directionalLight.position.set(10, 100, 10);
    scene.add(directionalLight);
}



function generateInitialChunks() {
    const playerChunk = getPlayerChunk();
    for (let x = -STREAMING_DISTANCE; x <= STREAMING_DISTANCE; x++) {
        for (let y = -STREAMING_DISTANCE; y <= STREAMING_DISTANCE; y++) {
            for (let z = -STREAMING_DISTANCE; z <= STREAMING_DISTANCE; z++) {
                requestChunk(playerChunk.x, playerChunk.y, playerChunk.z);
            }
        }
    }
    lastPlayerChunk = playerChunk;
}

function getPlayerChunk() {
    const position = controls.getObject().position;
    return {
        x: Math.floor(position.x / CHUNK_SIZE),
        y: Math.floor(position.y / CHUNK_SIZE),
        z: Math.floor(position.z / CHUNK_SIZE)
    };
}

function requestChunk(chunkX, chunkY, chunkZ) {
    const chunkKey = `${chunkX},${chunkY},${chunkZ}`;
    if (chunks[chunkKey]) return;

    const cachedChunk = loadChunkFromCache(chunkKey);
    if (cachedChunk) {
        addChunkToScene(cachedChunk, chunkX, chunkY, chunkZ);
    } else {
        chunkWorker.postMessage({ chunkX, chunkY, chunkZ, CHUNK_SIZE });
    }
}

chunkWorker.onmessage = function(e) {
    const { chunk, chunkX, chunkY, chunkZ } = e.data;
    addChunkToScene(chunk, chunkX, chunkY, chunkZ);
    // saveChunkToCache(`${chunkX},${chunkY},${chunkZ}`, chunk);
};

function addChunkToScene(chunk, chunkX, chunkY, chunkZ) {
    const chunkGroup = createChunkGroup(chunk, chunkX, chunkY, chunkZ);
    scene.add(chunkGroup);
    chunks[`${chunkX},${chunkY},${chunkZ}`] = { chunkGroup };
}

function createChunkGroup(chunk, chunkX, chunkY, chunkZ) {
    const chunkGroup = new THREE.Group();
    chunkGroup.position.set(chunkX * CHUNK_SIZE, chunkY * CHUNK_SIZE, chunkZ * CHUNK_SIZE);

    // Créer la géométrie principale du chunk
    const geometry = createChunkGeometry(chunk);
    const material = createChunkMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    chunkGroup.add(mesh);

    // Ajouter les instances d'eau
    const waterInstances = [];
    for (let y = 0; y < CHUNK_SIZE; y++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            for (let x = 0; x < CHUNK_SIZE; x++) {
                const voxel = chunk[x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE];
                if (voxel === 7) { // 7 représente l'eau
                    waterInstances.push(new THREE.Vector3(x + 0.5, y, z + 0.5));
                }
            }
        }
    }
    const matrix = new THREE.Matrix4();
    if (waterInstances.length > 0) {
        const waterInstancedMesh = new THREE.InstancedMesh(
            instanced_water_geometry,
            waterMaterial,
            waterInstances.length
        );
        waterInstances.forEach((pos, i) => {
            matrix.setPosition(pos);
            waterInstancedMesh.setMatrixAt(i, matrix);
        });
        chunkGroup.add(waterInstancedMesh);
    }

    // Ajouter les instances d'arbres (si nécessaire)
    // Cette partie dépendrait de la façon dont vous générez et stockez les arbres
    // Voici un exemple simplifié :
    const treePositions = getTreePositions(chunk);
    if (treePositions.length > 0) {
        const trunkInstancedMesh = new THREE.InstancedMesh(
            instanced_mesh_geometry,
            woodMaterial,
            treePositions.length
        );
        const leavesInstancedMesh = new THREE.InstancedMesh(
            instanced_mesh_geometry,
            leavesMaterial,
            treePositions.length * 27 // Supposons un cube de feuilles 3x3x3
        );

        let leafIndex = 0;
        treePositions.forEach((pos, i) => {
            // Placer le tronc
            matrix.setPosition(pos.x, pos.y, pos.z);
            trunkInstancedMesh.setMatrixAt(i, matrix);

            // Placer les feuilles
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = 0; dy <= 2; dy++) {
                    for (let dz = -1; dz <= 1; dz++) {
                        matrix.setPosition(pos.x + dx, pos.y + 3 + dy, pos.z + dz);
                        leavesInstancedMesh.setMatrixAt(leafIndex++, matrix);
                    }
                }
            }
        });

        chunkGroup.add(trunkInstancedMesh, leavesInstancedMesh);
    }

    return chunkGroup;
}

function getTreePositions(chunk) {
    // Cette fonction devrait retourner les positions des arbres dans le chunk
    // Cela dépendrait de la façon dont vous générez et stockez les informations sur les arbres
    // Voici un exemple très simplifié :
    const treePositions = [];
    for (let y = 0; y < CHUNK_SIZE; y++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            for (let x = 0; x < CHUNK_SIZE; x++) {
                const voxel = chunk[x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE];
                if (voxel === 8) { // Supposons que 8 représente la base d'un arbre
                    treePositions.push(new THREE.Vector3(x, y, z));
                }
            }
        }
    }
    return treePositions;
}

function createChunkGeometry(chunk) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    let indexOffset = 0;

    for (let y = 0; y < CHUNK_SIZE; y++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            for (let x = 0; x < CHUNK_SIZE; x++) {
                const voxel = chunk[x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE];
                if (voxel !== 0) { // 0 représente l'air
                    addVoxelGeometry(x, y, z, voxel);
                }
            }
        }
    }

    function addVoxelGeometry(x, y, z, voxelType) {
        // Pour chaque face du cube
        [
            { dir: [-1, 0, 0], corners: [[0, 1, 0], [0, 0, 0], [0, 1, 1], [0, 0, 1]] },
            { dir: [1, 0, 0], corners: [[1, 1, 1], [1, 0, 1], [1, 1, 0], [1, 0, 0]] },
            { dir: [0, -1, 0], corners: [[1, 0, 1], [0, 0, 1], [1, 0, 0], [0, 0, 0]] },
            { dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]] },
            { dir: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]] },
            { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]] }
        ].forEach(({ dir, corners }) => {
            const neighborVoxel = getVoxel(x + dir[0], y + dir[1], z + dir[2]);
            if (neighborVoxel === 0) { // Si le voxel voisin est de l'air, on ajoute la face
                const ndx = positions.length / 3;
                corners.forEach(pos => {
                    positions.push(x + pos[0], y + pos[1], z + pos[2]);
                    normals.push(...dir);
                });
                
                // Ajouter les coordonnées UV en fonction du type de voxel
                const uvRow = Math.floor((voxelType - 1) / 16);
                const uvCol = (voxelType - 1) % 16;
                uvs.push(
                    uvCol / 16, uvRow / 16,
                    (uvCol + 1) / 16, uvRow / 16,
                    uvCol / 16, (uvRow + 1) / 16,
                    (uvCol + 1) / 16, (uvRow + 1) / 16
                );

                indices.push(
                    ndx, ndx + 1, ndx + 2,
                    ndx + 2, ndx + 1, ndx + 3
                );
            }
        });
    }

    function getVoxel(x, y, z) {
        if (x < 0 || x >= CHUNK_SIZE || y < 0 || y >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) {
            return 0; // Considérer l'extérieur du chunk comme de l'air
        }
        return chunk[x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE];
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);

    return geometry;
}

function createChunkMaterial() {
    const loader = new THREE.TextureLoader();
    const texture = loader.load('./atlas.png');
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 1);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestMipmapLinearFilter;

    return new THREE.MeshLambertMaterial({
        map: texture,
        transparent: true,
    });
}

async function saveChunkToCache(chunkKey, chunk) {
    try{
        localStorage.setItem(`chunk_${chunkKey}`, LZString.compressToUTF16(JSON.stringify(chunk)));
    }
    catch(error)
    {
        console.log(LZString.compressToUTF16(JSON.stringify(chunk)).length)
    }
}

function loadChunkFromCache(chunkKey) {
    const cachedChunk = localStorage.getItem(`chunk_${chunkKey}`);
    return cachedChunk ? JSON.parse(LZString.decompressFromUTF16(cachedChunk)) : null;
}

function placePlayer() {
    const startX = CHUNK_SIZE / 2;
    const startZ = CHUNK_SIZE / 2;
    const startY = generateSurfaceHeight(startX, startZ) + 2;
    controls.getObject().position.set(startX, startY, startZ);
}

function generateSurfaceHeight(x, z) {
    const scale = 0.01;
    const octaves = 4;
    let noise = 0;
    let amplitude = 1;
    let frequency = 1;

    for (let i = 0; i < octaves; i++) {
        noise += simplex2D(x * scale * frequency, z * scale * frequency) * amplitude;
        amplitude *= 0.5;
        frequency *= 2;
    }

    return Math.floor((noise + 1) * 0.5 * CHUNK_SIZE);
}

function updateChunks() {
    const currentTime = Date.now();
    if (currentTime - lastChunkUpdateTime < CHUNK_UPDATE_INTERVAL) return;

    const playerChunk = getPlayerChunk();
    if (playerChunk.x !== lastPlayerChunk.x || 
        playerChunk.y !== lastPlayerChunk.y || 
        playerChunk.z !== lastPlayerChunk.z) {
        
        streamChunks(playerChunk);
        lastPlayerChunk = playerChunk;
    }

    lastChunkUpdateTime = currentTime;
}

function streamChunks(playerChunk) {
    for (let x = -STREAMING_DISTANCE; x <= STREAMING_DISTANCE; x++) {
        for (let y = -STREAMING_DISTANCE; y <= STREAMING_DISTANCE; y++) {
            for (let z = -STREAMING_DISTANCE; z <= STREAMING_DISTANCE; z++) {
                const chunkX = playerChunk.x + x;
                const chunkY = playerChunk.y + y;
                const chunkZ = playerChunk.z + z;
                const chunkKey = `${chunkX},${chunkY},${chunkZ}`;
                
                if (!chunks[chunkKey] && isChunkVisible(chunkX, chunkY, chunkZ)) {
                    requestChunk(chunkX, chunkY, chunkZ);
                }
            }
        }
    }

    // Unload distant chunks
    for (let chunkKey in chunks) {
        const [cx, cy, cz] = chunkKey.split(',').map(Number);
        if (Math.abs(cx - playerChunk.x) > STREAMING_DISTANCE ||
            Math.abs(cy - playerChunk.y) > STREAMING_DISTANCE ||
            Math.abs(cz - playerChunk.z) > STREAMING_DISTANCE) {
            unloadChunk(chunkKey);
        }
    }
}

function isChunkVisible(chunkX, chunkY, chunkZ) {
    const frustum = new THREE.Frustum();
    frustum.setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    );
    const chunkBox = new THREE.Box3(
        new THREE.Vector3(chunkX * CHUNK_SIZE, chunkY * CHUNK_SIZE, chunkZ * CHUNK_SIZE),
        new THREE.Vector3((chunkX + 1) * CHUNK_SIZE, (chunkY + 1) * CHUNK_SIZE, (chunkZ + 1) * CHUNK_SIZE)
    );
    return frustum.intersectsBox(chunkBox);
}

function unloadChunk(chunkKey) {
    scene.remove(chunks[chunkKey].chunkGroup);
    delete chunks[chunkKey];
}

const moveState = { forward: false, backward: false, left: false, right: false };
let isSprinting = false;

function setupEventListeners() {
    document.addEventListener('click', () => controls.lock());
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', onWindowResize);
}

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

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function updateUnderwaterEffect() {
    const playerY = controls.getObject().position.y;
    if (playerY <= WATER_LEVEL) {
        scene.fog = new THREE.FogExp2(0x0077be, 0.2);
        renderer.setClearColor(0x0077be);
    } else {
        scene.fog = null;
        renderer.setClearColor(0x87ceeb);
    }
}

const clock = new THREE.Clock()
function animate() {
    updateUnderwaterEffect();
    updatePlayerPosition();
    updateChunks();

    const time = clock.getElapsedTime();

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
}
init();