import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls';
import { createNoise2D, createNoise3D } from 'simplex-noise';
import { InstancedUniformsMesh } from 'three-instanced-uniforms-mesh';
import VoxelWorld from './voxelworld';
import LZString from 'lz-string';


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
        loadTexture('acacia_log.png'),
        loadTexture('acacia_leaves.png'),
    ]).then(([ woodTexture, leavesTexture]) => {
        woodMaterial = new THREE.MeshLambertMaterial({ map: woodTexture });
        leavesMaterial = new THREE.MeshLambertMaterial({ map: leavesTexture, transparent:true, color:0x00AA00 });
    });
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
        // side: THREE.DoubleSide,
        // alphaTest: 0.1,
        transparent: true,
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

    const hillNoise = simplex2D(x * 0.08, z * 0.08) + 0.5;
    const mountainNoise = simplex2D(x * 0.015, z * 0.015)  + 0.5;

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

// function generateChunk(chunkX, chunkY, chunkZ) {
function generateChunk(chunkX, chunkY, chunkZ) {
    const chunkKey = `${chunkX},${chunkY},${chunkZ}`;
    if (chunks[chunkKey]) return;

    const world = new VoxelWorld({
        cellSize: CHUNK_SIZE,
        tileSize: 16,
        tileTextureWidth: 112,
        tileTextureHeight: 48,
    });

    woodInstances = [], leavesInstances = [], waterInstances = []

    // Remplir le monde de voxels
    for (let y = 0; y < CHUNK_SIZE; y++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            for (let x = 0; x < CHUNK_SIZE; x++) {
                const worldX = chunkX * CHUNK_SIZE + x;
                const worldY = chunkY * CHUNK_SIZE + y;
                const worldZ = chunkZ * CHUNK_SIZE + z;
                const surfaceHeight = generateSurfaceHeight(worldX, worldZ);

                if (shouldGenerateBlock(worldX, worldY, worldZ)) 
                {
                    let voxelType = 1; // Par défaut, bloc de terre
                    if (worldY === surfaceHeight) 
                    {
                        if (isNearWater(worldX, worldY, worldZ)) {
                            voxelType = 2; // Sable
                        } 
                        else if (isMountain(surfaceHeight)) 
                        {
                            voxelType = isSnowCapped(surfaceHeight) ? 3 : 4; // Neige ou pierre
                        } 
                        else 
                        {
                            voxelType = 5; // Herbe
                            // Génération aléatoire d'arbres (seulement sur l'herbe)
                            if (worldY === surfaceHeight && worldY > WATER_LEVEL && voxelType === 5 && Math.random() < 0.02) {
                                generateTree(x, y + 1, z);
                            }
                        }
                    } 
                    else if (isInCavity(worldX, worldY, worldZ)) 
                    {
                        voxelType = 6; // Caverne
                    }
                    world.setVoxel(x, y, z, voxelType);
                }
                else if(worldY == WATER_LEVEL)
                {
                    waterInstances.push(new THREE.Vector3(x+0.5, y+0.2, z+0.5))
                }
            }
        }
    }

    // Voxels
    const { positions, normals, uvs, indices } = world.generateGeometryDataForCell(0, 0, 0);

    const geometry = new THREE.BufferGeometry();
    const material = createChunkMaterial();

    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geometry.setIndex(indices);

    const mesh = new THREE.Mesh(geometry, material);

    // Instanced Meshes
    const matrix = new THREE.Matrix4();
    function setInstancedMeshPositions(mesh, instances) {
        instances.forEach((pos, i) => {
            matrix.setPosition(pos);
            mesh.setMatrixAt(i, matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
    }
    
    const woodMesh = createInstancedMesh(instanced_mesh_geometry, woodMaterial, woodInstances.length);
    const leavesMesh = createInstancedMesh(instanced_mesh_geometry, leavesMaterial, leavesInstances.length);
    const waterMesh = createInstancedMesh(instanced_water_geometry, waterMaterial, waterInstances.length);
    setInstancedMeshPositions(woodMesh, woodInstances);
    setInstancedMeshPositions(leavesMesh, leavesInstances);
    setInstancedMeshPositions(waterMesh, waterInstances);


    const chunkGroup = new THREE.Group();
    chunkGroup.add(mesh, woodMesh, leavesMesh, waterMesh);
    chunkGroup.position.set(chunkX * CHUNK_SIZE, chunkY * CHUNK_SIZE, chunkZ * CHUNK_SIZE);
    scene.add(chunkGroup);

    chunks[chunkKey] = { chunkGroup };
}
function generateInitialChunks() {
    const playerChunk = getPlayerChunk();
    for (let x = -INITIAL_RENDER_DISTANCE; x <= INITIAL_RENDER_DISTANCE; x++) {
        for (let y = -INITIAL_RENDER_DISTANCE; y <= INITIAL_RENDER_DISTANCE; y++) {
            for (let z = -INITIAL_RENDER_DISTANCE; z <= INITIAL_RENDER_DISTANCE; z++) {
                generateChunk(playerChunk.x + x, playerChunk.y + y, playerChunk.z + z);
            }
        }
    }
    lastPlayerChunk = playerChunk;
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

function getPlayerChunk() {
    const position = controls.getObject().position;
    return {
        x: Math.floor(position.x / CHUNK_SIZE),
        y: Math.floor(position.y / CHUNK_SIZE),
        z: Math.floor(position.z / CHUNK_SIZE)
    };
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

function updateChunks() {
    const currentTime = Date.now();
    if (currentTime - lastChunkUpdateTime < CHUNK_UPDATE_INTERVAL) return;

    const playerChunk = getPlayerChunk();
    if (playerChunk.x !== lastPlayerChunk.x || 
        playerChunk.y !== lastPlayerChunk.y || 
        playerChunk.z !== lastPlayerChunk.z) {
        
        for (let x = -RENDER_DISTANCE; x <= RENDER_DISTANCE; x++) {
            for (let y = -RENDER_DISTANCE; y <= RENDER_DISTANCE; y++) {
                for (let z = -RENDER_DISTANCE; z <= RENDER_DISTANCE; z++) {
                    const chunkX = playerChunk.x + x;
                    const chunkY = playerChunk.y + y;
                    const chunkZ = playerChunk.z + z;
                    const chunkKey = `${chunkX},${chunkY},${chunkZ}`;
                    
                    if (!chunks[chunkKey] && isChunkVisible(chunkX, chunkY, chunkZ)) {
                        generateChunk(chunkX, chunkY, chunkZ);
                    }
                }
            }
        }

        // Supprimer les chunks trop éloignés
        for (let chunkKey in chunks) {
            const [cx, cy, cz] = chunkKey.split(',').map(Number);
            if (Math.abs(cx - playerChunk.x) > RENDER_DISTANCE ||
                Math.abs(cy - playerChunk.y) > RENDER_DISTANCE ||
                Math.abs(cz - playerChunk.z) > RENDER_DISTANCE) {
                scene.remove(chunks[chunkKey].chunkGroup);
                delete chunks[chunkKey];
            }
        }

        lastPlayerChunk = playerChunk;
    }

    lastChunkUpdateTime = currentTime;
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
        renderer.setClearColor(0x87ceeb); // Couleur du ciel
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