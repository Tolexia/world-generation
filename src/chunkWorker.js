import { createNoise2D, createNoise3D } from 'simplex-noise';
import LZString from 'lz-string';

const simplex2D = createNoise2D();
const simplex3D = createNoise3D();

const CHUNK_SIZE = 16;
const WATER_LEVEL = 4;

self.onmessage = function(e) {
  const { chunkX, chunkY, chunkZ } = e.data;
  const chunk = generateChunk(chunkX, chunkY, chunkZ);
  const compressedChunk = LZString.compressToUint8Array(JSON.stringify(chunk));
  self.postMessage({ chunk: compressedChunk, chunkX, chunkY, chunkZ }, [compressedChunk.buffer]);
};

function generateChunk(chunkX, chunkY, chunkZ) {
  const chunk = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);

  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const worldX = chunkX * CHUNK_SIZE + x;
      const worldZ = chunkZ * CHUNK_SIZE + z;
      const surfaceHeight = generateSurfaceHeight(worldX, worldZ);

      for (let y = 0; y < CHUNK_SIZE; y++) {
        const worldY = chunkY * CHUNK_SIZE + y;
        const voxelType = getVoxelType(worldX, worldY, worldZ, surfaceHeight);
        if (voxelType !== 0) {
          const index = x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;
          chunk[index] = voxelType;
        }
      }
    }
  }

  return chunk;
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

  return Math.floor((noise + 1) * 0.5 * CHUNK_SIZE) + CHUNK_SIZE / 2;
}

function getVoxelType(x, y, z, surfaceHeight) {
  if (y > surfaceHeight) {
    return y <= WATER_LEVEL ? 7 : 0; // 7 for water, 0 for air
  }

  if (y === surfaceHeight) {
    if (y <= WATER_LEVEL + 1) {
      return 2; // Sand
    } else if (isMountain(surfaceHeight)) {
      return isSnowCapped(surfaceHeight) ? 3 : 4; // Snow or stone
    } else {
      return 5; // Grass
    }
  }

  if (y < surfaceHeight - 3) {
    return 6; // Stone
  }

  return 1; // Dirt
}

function isMountain(height) {
  return height > CHUNK_SIZE * 1.5;
}

function isSnowCapped(height) {
  return height > CHUNK_SIZE * 1.8;
}

function isInCavity(x, y, z) {
  const caveNoise = simplex3D(x * 0.05, y * 0.05, z * 0.05);
  return caveNoise > 0.7;
}