import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls';
import {createNoise2D, createNoise3D} from 'simplex-noise';

let scene, camera, renderer, controls, playerLight;

let ambientLight, surfaceAmbientLight, caveAmbientLight;
let caveFog;
const CAVE_FOG_COLOR = 0x000000; // Couleur noire pour le fog des cavernes
const CAVE_FOG_DENSITY = 0.15; // Ajustez cette valeur pour plus ou moins de fog
const SURFACE_HEIGHT = -2;
const FOG_TRANSITION_HEIGHT = 5; // Hauteur au-dessus de la surface où le fog commence à apparaître
const MAX_FOG_DENSITY = 0.15; // La densité maximale du fog dans les cavernes profondes

let chunks = {};
const CHUNK_SIZE = 16;
const RENDER_DISTANCE = 3;
const simplex3D = createNoise3D();
const simplex2D = createNoise2D();

let grassMaterial, earthMaterial;

// Nouvelle structure pour gérer les lumières de caverne
const caveLights = {};
const CAVE_LIGHT_DISTANCE = 10; // Distance maximale à laquelle une lumière est unload
const CAVE_LIGHT_INTENSITY = 25.75; // Intensité de la lumière de caverne
const MAX_CAVE_LIGHTS = 10
let current_cave_lights = 0

function loadTextures() {
    const textureLoader = new THREE.TextureLoader();
    const loadTexture = (path) => {
        return new Promise((resolve) => {
            textureLoader.load(path, (texture) => {
                texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
                texture.repeat.set(1, 1);
                // Ajoutez ces lignes pour éviter les artefacts aux bords
                texture.magFilter = THREE.NearestFilter;
                texture.minFilter = THREE.NearestMipmapLinearFilter;
                resolve(texture);
            });
        });
    };

    return Promise.all([
        loadTexture('GRASS_COL.jpg'),
        loadTexture('GRASS_DISP.jpg'),
        loadTexture('GRASS_NRM.jpg'),
        loadTexture('EARTH_COL.jpg'),
        loadTexture('EARTH_DISP.jpg'),
        loadTexture('EARTH_NRM.jpg')
    ]).then(([grassCol, grassDisp, grassNrm, earthCol, earthDisp, earthNrm]) => {
        grassMaterial = new THREE.MeshStandardMaterial({
            map: grassCol,
            displacementMap: grassDisp,
            normalMap: grassNrm,
            displacementScale: 0,
        });

        earthMaterial = new THREE.MeshStandardMaterial({
            map: earthCol,
            displacementMap: earthDisp,
            normalMap: earthNrm,
            displacementScale: 0,
        });
    });
}

async function init() {
    await loadTextures();

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    controls = new PointerLockControls(camera, document.body);
    scene.add(controls.getObject());

    // Éclairage de surface
    surfaceAmbientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(surfaceAmbientLight);

    // Éclairage de caverne (initialement éteint)
    caveAmbientLight = new THREE.AmbientLight(0xffffff, 0.1);
    caveAmbientLight.visible = false;
    scene.add(caveAmbientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(1, 1, 1);
    scene.add(directionalLight);

    // Créer le fog pour les cavernes (initialement désactivé)
    caveFog = new THREE.FogExp2(CAVE_FOG_COLOR, CAVE_FOG_DENSITY);
    
    document.addEventListener('click', () => {
        if(!controls.isLocked)
            controls.lock() 
        else{
            if(controls.getObject().position.y < 0)
            {
                updateCaveLights()
            }
        }
    });
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    generateChunk(0, 0, 0);
    placePlayer();
    animate();
}

const geometry = new THREE.BoxGeometry(1, 1, 1);

function generateChunk(chunkX, chunkY, chunkZ) {
    const chunkKey = `${chunkX},${chunkY},${chunkZ}`;
    if (chunks[chunkKey]) return;

    const earthMesh = new THREE.InstancedMesh(geometry, earthMaterial, CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);
    const grassMesh = new THREE.InstancedMesh(geometry, grassMaterial, CHUNK_SIZE * CHUNK_SIZE);
    earthMesh.count = 0;
    grassMesh.count = 0;
    const matrix = new THREE.Matrix4();

    for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            const worldX = chunkX * CHUNK_SIZE + x;
            const worldZ = chunkZ * CHUNK_SIZE + z;
            const surfaceHeight = generateSurfaceHeight(worldX, worldZ);

            for (let y = 0; y < CHUNK_SIZE; y++) {
                const worldY = chunkY * CHUNK_SIZE + y;
                
                if (shouldGenerateBlock(worldX, worldY, worldZ)) {
                    if (isBlockVisible(worldX, worldY, worldZ)) {
                        if (worldY === surfaceHeight) {
                            // C'est un bloc de surface, on utilise la texture d'herbe
                            matrix.setPosition(x, y, z);
                            grassMesh.setMatrixAt(grassMesh.count, matrix);
                            grassMesh.count++;
                        } else {
                            // C'est un bloc sous la surface ou dans une caverne, on utilise la texture de terre
                            matrix.setPosition(x, y, z);
                            earthMesh.setMatrixAt(earthMesh.count, matrix);
                            earthMesh.count++;
                        }
                    }
                }
            }
        }
    }

    earthMesh.instanceMatrix.needsUpdate = true;
    grassMesh.instanceMatrix.needsUpdate = true;
    earthMesh.position.set(chunkX * CHUNK_SIZE, chunkY * CHUNK_SIZE, chunkZ * CHUNK_SIZE);
    grassMesh.position.set(chunkX * CHUNK_SIZE, chunkY * CHUNK_SIZE, chunkZ * CHUNK_SIZE);
    scene.add(earthMesh);
    scene.add(grassMesh);
    chunks[chunkKey] = { earthMesh, grassMesh };
}

function isBlockVisible(x, y, z) {
    const directions = [
        [1, 0, 0], [-1, 0, 0],
        [0, 1, 0], [0, -1, 0],
        [0, 0, 1], [0, 0, -1]
    ];

    for (let [dx, dy, dz] of directions) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (!shouldGenerateBlock(nx, ny, nz)) return true;
    }
    return false;
}

function generateSurfaceHeight(x, z) {
    const baseHeight = 0;
    const hillHeight = 16;
    const mountainHeight = 32;
    const caveEntranceDepth = 16; // Augmenté pour des entrées plus profondes

    const hillNoise = simplex2D(x * 0.01, z * 0.01) * 0.5 + 0.5;
    const mountainNoise = simplex2D(x * 0.005, z * 0.005) * 0.5 + 0.5;
    
    const caveEntranceNoise = simplex2D(x * 0.02, z * 0.02);

    let height = baseHeight + 
                 hillHeight * hillNoise + 
                 mountainHeight * Math.pow(mountainNoise, 3);

    if (caveEntranceNoise > 0.75) {
        height -= caveEntranceDepth * (caveEntranceNoise - 0.75) / 0.25;
    }

    return Math.max(0, Math.floor(height));
}

function shouldGenerateBlock(x, y, z) {
    const surfaceHeight = generateSurfaceHeight(x, z);
    const caveNoise = simplex3D(x * 0.075, y * 0.075, z * 0.075);

    if (y <= surfaceHeight) {
        if (y >= 4) {
            return true;
        } else {
            const transitionFactor = Math.min(1, (surfaceHeight - y) / surfaceHeight);
            const surfaceInfluence = Math.max(0, 1 - transitionFactor);
            
            const lowestCaveBlock = findLowestCaveBlock(x, z, surfaceHeight);
            
            if (surfaceHeight - lowestCaveBlock > 3) {
                // Créer une transition plus graduelle
                const transitionNoise = simplex3D(x * 0.1, y * 0.1, z * 0.1);
                return transitionNoise < (0.5 + surfaceInfluence * 0.3);
            } else {
                return caveNoise < (0.123 + surfaceInfluence * 0.5);
            }
        }
    }
    
    return false;
}

function findLowestCaveBlock(x, z, surfaceHeight) {
    for (let y = surfaceHeight - 1; y >= 0; y--) {
        const caveNoise = simplex3D(x * 0.075, y * 0.075, z * 0.075);
        if (caveNoise >= 0.05) { // Seuil réduit pour plus de connexions
            return y + 1;
        }
    }
    return 0;
}

function placePlayer() {
    const startX = CHUNK_SIZE / 2;
    const startZ = CHUNK_SIZE / 2;
    const startY = generateSurfaceHeight(startX, startZ) + 2; // +2 pour être au-dessus du sol
    console.log("startY", startY)
    controls.getObject().position.set(startX, startY, startZ);
}

function updatePlayerLight() {
    // Obtenir la direction actuelle de la caméra
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    
    // Positionner la lumière légèrement au-dessus et devant le joueur
    playerLight.position.copy(cameraDirection).add(new THREE.Vector3(0, 2, 0));
    playerLight.target.position.copy(camera.position).add(cameraDirection);
    
    // S'assurer que la cible de la lumière est mise à jour
    playerLight.target.updateMatrixWorld();
}


let isSprinting = false;
const moveState = { forward: false, backward: false, left: false, right: false };

function onKeyDown(event) {
    switch (event.code) {
        case 'KeyW': moveState.forward = true; break;
        case 'KeyS': moveState.backward = true; break;
        case 'KeyA': moveState.left = true; break;
        case 'KeyD': moveState.right = true; break;
        case 'ControlLeft': isSprinting = true; break;
    }
}

function onKeyUp(event) {
    switch (event.code) {
        case 'KeyW': moveState.forward = false; break;
        case 'KeyS': moveState.backward = false; break;
        case 'KeyA': moveState.left = false; break;
        case 'KeyD': moveState.right = false; break;
        case 'ControlLeft': isSprinting = false; break;
    }
}

function updatePlayerPosition() {
    const direction = new THREE.Vector3();
    const moveSpeed = isSprinting ? 0.25 : 0.1;
    controls.getDirection(direction);
    if (moveState.forward) controls.getObject().position.addScaledVector(direction, moveSpeed);
    if (moveState.backward) controls.getObject().position.addScaledVector(direction, -moveSpeed);
    if (moveState.left) controls.getObject().position.addScaledVector(direction.cross(new THREE.Vector3(0, 1, 0)).normalize(), -moveSpeed);
    if (moveState.right) controls.getObject().position.addScaledVector(direction.cross(new THREE.Vector3(0, 1, 0)).normalize(), moveSpeed);
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
            delete chunks[chunkKey];
        }
    }
}

function updateCaveLights() {
    const playerPosition = controls.getObject().position;
    
    if (playerPosition.y < 0) {
        const direction = new THREE.Vector3();
        controls.getDirection(direction);
        
        const raycaster = new THREE.Raycaster(playerPosition, direction);
        
        const sceneObjects = [];
        scene.traverse((object) => {
            if (object.isMesh) {
                sceneObjects.push(object);
            }
        });
        
        const intersects = raycaster.intersectObjects(sceneObjects);
        
        if (intersects.length > 0) {
            const intersection = intersects[0];
            
            if (true) {
            // if (intersection.distance <= CAVE_LIGHT_DISTANCE) {
                // Calculer la position de la lumière entre le joueur et le point d'intersection
                const lightPosition = new THREE.Vector3().addVectors(
                    playerPosition,
                    direction.multiplyScalar(intersection.distance * 0.8) // 90% de la distance vers le bloc
                );
                
                // Vérifier si la nouvelle lumière est suffisamment éloignée des lumières existantes
                let isTooClose = false;
                // for (const key in caveLights) {
                //     if (caveLights[key].position.distanceTo(lightPosition) < CAVE_LIGHT_DISTANCE) {
                //         isTooClose = true;
                //         break;
                //     }
                // }
                
                if (!isTooClose && current_cave_lights < MAX_CAVE_LIGHTS) {
                    const lightKey = `${Math.round(lightPosition.x)},${Math.round(lightPosition.y)},${Math.round(lightPosition.z)}`;
                    
                    if (!caveLights[lightKey]) {
                        const light = new THREE.PointLight(0xffaa00, CAVE_LIGHT_INTENSITY, CAVE_LIGHT_DISTANCE);
                        light.position.copy(lightPosition);
                        scene.add(light);
                        caveLights[lightKey] = light;
                        current_cave_lights++;
                    }
                }
            }
        }
    }
    
    // Supprimer les lumières trop éloignées
    for (const key in caveLights) {
        const light = caveLights[key];
        if (light.position.distanceTo(playerPosition) > CAVE_LIGHT_DISTANCE * 2) {
            scene.remove(light);
            delete caveLights[key];
            current_cave_lights--;
        }
    }
}
function updateLightingAndFog() {
    const playerPosition = controls.getObject().position;
    
    // Calculer la densité du fog en fonction de la position verticale du joueur
    let fogDensity;
    if (playerPosition.y >= SURFACE_HEIGHT + FOG_TRANSITION_HEIGHT) {
        fogDensity = 0; // Pas de fog en surface
    } else if (playerPosition.y <= SURFACE_HEIGHT) {
        fogDensity = MAX_FOG_DENSITY; // Fog complet dans les cavernes
    } else {
        // Transition progressive du fog
        const transitionProgress = (SURFACE_HEIGHT + FOG_TRANSITION_HEIGHT - playerPosition.y) / FOG_TRANSITION_HEIGHT;
        fogDensity = MAX_FOG_DENSITY * transitionProgress;
    }

    // Mettre à jour la densité du fog
    if (!scene.fog) {
        scene.fog = new THREE.FogExp2(CAVE_FOG_COLOR, fogDensity);
    } else {
        scene.fog.density = fogDensity;
    }

    // Ajuster l'éclairage en fonction de la position
    const surfaceLightIntensity = Math.max(0, Math.min(1, playerPosition.y / FOG_TRANSITION_HEIGHT));
    const caveLightIntensity = 1 - surfaceLightIntensity;

    surfaceAmbientLight.intensity = 0.5 * surfaceLightIntensity;
    caveAmbientLight.intensity = 0.1 * caveLightIntensity;

    // Rendre les deux lumières visibles en permanence pour une transition douce
    surfaceAmbientLight.visible = true;
    caveAmbientLight.visible = true;
}
function animate() {
    requestAnimationFrame(animate);
    updatePlayerPosition();
    updateChunks();
    updateLightingAndFog();
    // updateCaveLights();
    // updatePlayerLight();
    renderer.render(scene, camera);
}

init();