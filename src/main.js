import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls';
import {createNoise3D} from 'simplex-noise';

let scene, camera, renderer, controls, playerLight;

let ambientLight, surfaceAmbientLight, caveAmbientLight;
let caveFog;
const CAVE_FOG_COLOR = 0x000000; // Couleur noire pour le fog des cavernes
const CAVE_FOG_DENSITY = 0.15; // Ajustez cette valeur pour plus ou moins de fog

let chunks = {};
const CHUNK_SIZE = 16;
const RENDER_DISTANCE = 3;
const simplex = createNoise3D();

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
            // displacementScale: 0.1,
            // transparent: false,
            // depthWrite: true,
            // polygonOffset: true,
            // polygonOffsetFactor: -4,
        });

        earthMaterial = new THREE.MeshStandardMaterial({
            map: earthCol,
            displacementMap: earthDisp,
            normalMap: earthNrm,
            displacementScale: 0,
            // transparent: false,
            // depthWrite: true,
            // polygonOffset: true,
            // polygonOffsetFactor: -4,
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
    earthMaterial.fog = true;
    grassMaterial.fog = true;


    for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            const worldX = chunkX * CHUNK_SIZE + x;
            const worldZ = chunkZ * CHUNK_SIZE + z;
            let surfaceY = 0;

            for (let y = CHUNK_SIZE - 1; y >= 0; y--) {
                const worldY = chunkY * CHUNK_SIZE + y;
                if (worldY <= 0 && shouldGenerateBlock(worldX, worldY, worldZ)) {
                    if (isBlockVisible(worldX, worldY, worldZ)) 
                        {
                        matrix.setPosition(x, y, z);
                        earthMesh.setMatrixAt(earthMesh.count, matrix);
                        earthMesh.count++;

                        if (worldY === 0 && surfaceY === 0) {
                            surfaceY = y;
                        }
                    }
                }else if (worldY === 0 && surfaceY === 0) {
                    surfaceY = -1; // Marquer comme une entrée de caverne
                }
            }

            if (surfaceY == -1)  {
                matrix.setPosition(x, surfaceY, z);
                grassMesh.setMatrixAt(grassMesh.count, matrix);
                grassMesh.count++;
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

function shouldGenerateBlock(x, y, z) {
    const scale = 0.075;
    const threshold = 0.123;
    const noiseValue = simplex(x * scale, y * scale, z * scale);
    return noiseValue < threshold;
}

function placePlayer() {
    controls.getObject().position.set(CHUNK_SIZE/2, 2, CHUNK_SIZE/2);
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
    
    if (playerPosition.y < 0) {
        // Joueur dans une caverne
        surfaceAmbientLight.visible = false;
        caveAmbientLight.visible = true;
        scene.fog = caveFog;
    } else {
        // Joueur en surface
        surfaceAmbientLight.visible = true;
        caveAmbientLight.visible = false;
        scene.fog = null;
    }
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