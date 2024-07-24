import * as THREE from 'three'

export default class VoxelWorld {
    constructor(options) {
        this.cellSize = options.cellSize;
        this.tileSize = options.tileSize;
        this.tileTextureWidth = options.tileTextureWidth;
        this.tileTextureHeight = options.tileTextureHeight;
        this.cellSliceSize = this.cellSize * this.cellSize;
        this.cells = {};
    }

    computeVoxelOffset(x, y, z) {
        const { cellSize, cellSliceSize } = this;
        const voxelX = THREE.MathUtils.euclideanModulo(x, cellSize) | 0;
        const voxelY = THREE.MathUtils.euclideanModulo(y, cellSize) | 0;
        const voxelZ = THREE.MathUtils.euclideanModulo(z, cellSize) | 0;
        return voxelY * cellSliceSize + voxelZ * cellSize + voxelX;
    }

    computeCellId(x, y, z) {
        const { cellSize } = this;
        const cellX = Math.floor(x / cellSize);
        const cellY = Math.floor(y / cellSize);
        const cellZ = Math.floor(z / cellSize);
        return `${cellX},${cellY},${cellZ}`;
    }

    addCellForVoxel(x, y, z) {
        const cellId = this.computeCellId(x, y, z);
        let cell = this.cells[cellId];
        if (!cell) {
            const { cellSize } = this;
            cell = new Uint8Array(cellSize * cellSize * cellSize);
            this.cells[cellId] = cell;
        }
        return cell;
    }

    getCellForVoxel(x, y, z) {
        return this.cells[this.computeCellId(x, y, z)];
    }

    setVoxel(x, y, z, v, addCell = true) {
        let cell = this.getCellForVoxel(x, y, z);
        if (!cell) {
            if (!addCell) {
                return;
            }
            cell = this.addCellForVoxel(x, y, z);
        }
        const voxelOffset = this.computeVoxelOffset(x, y, z);
        cell[voxelOffset] = v;
    }

    getVoxel(x, y, z) {
        const cell = this.getCellForVoxel(x, y, z);
        if (!cell) {
            return 0;
        }
        const voxelOffset = this.computeVoxelOffset(x, y, z);
        return cell[voxelOffset];
    }

    generateGeometryDataForCell(cellX, cellY, cellZ) {
        const { cellSize, tileSize, tileTextureWidth, tileTextureHeight } = this;
        const positions = [];
        const normals = [];
        const uvs = [];
        const indices = [];
        const startX = cellX * cellSize;
        const startY = cellY * cellSize;
        const startZ = cellZ * cellSize;

        for (let y = 0; y < cellSize; ++y) {
            const voxelY = startY + y;
            for (let z = 0; z < cellSize; ++z) {
                const voxelZ = startZ + z;
                for (let x = 0; x < cellSize; ++x) {
                    const voxelX = startX + x;
                    const voxel = this.getVoxel(voxelX, voxelY, voxelZ);
                    if (voxel) {
                        const uvVoxel = voxel - 1;
                        for (const { dir, corners, uvRow } of VoxelWorld.faces) {
                            const neighbor = this.getVoxel(
                                voxelX + dir[0],
                                voxelY + dir[1],
                                voxelZ + dir[2]);
                            if (!neighbor) {
                                const ndx = positions.length / 3;
                                for (const { pos, uv } of corners) {
                                    positions.push(pos[0] + x, pos[1] + y, pos[2] + z);
                                    normals.push(...dir);
                                    uvs.push(
                                        (uvVoxel + uv[0]) * tileSize / tileTextureWidth,
                                        1 - (uvRow + 1 - uv[1]) * tileSize / tileTextureHeight);
                                }
                                indices.push(
                                    ndx, ndx + 1, ndx + 2,
                                    ndx + 2, ndx + 1, ndx + 3,
                                );
                            }
                        }
                    }
                }
            }
        }

        return {
            positions,
            normals,
            uvs,
            indices,
        };
    }
}

VoxelWorld.faces = [
    { // left
        uvRow: 0,
        dir: [ -1,  0,  0, ],
        corners: [
            { pos: [ 0, 1, 0 ], uv: [ 0, 1 ], },
            { pos: [ 0, 0, 0 ], uv: [ 0, 0 ], },
            { pos: [ 0, 1, 1 ], uv: [ 1, 1 ], },
            { pos: [ 0, 0, 1 ], uv: [ 1, 0 ], },
        ],
    },
    { // right
        uvRow: 0,
        dir: [  1,  0,  0, ],
        corners: [
            { pos: [ 1, 1, 1 ], uv: [ 0, 1 ], },
            { pos: [ 1, 0, 1 ], uv: [ 0, 0 ], },
            { pos: [ 1, 1, 0 ], uv: [ 1, 1 ], },
            { pos: [ 1, 0, 0 ], uv: [ 1, 0 ], },
        ],
    },
    { // bottom
        uvRow: 1,
        dir: [  0, -1,  0, ],
        corners: [
            { pos: [ 1, 0, 1 ], uv: [ 1, 0 ], },
            { pos: [ 0, 0, 1 ], uv: [ 0, 0 ], },
            { pos: [ 1, 0, 0 ], uv: [ 1, 1 ], },
            { pos: [ 0, 0, 0 ], uv: [ 0, 1 ], },
        ],
    },
    { // top
        uvRow: 2,
        dir: [  0,  1,  0, ],
        corners: [
            { pos: [ 0, 1, 1 ], uv: [ 1, 1 ], },
            { pos: [ 1, 1, 1 ], uv: [ 0, 1 ], },
            { pos: [ 0, 1, 0 ], uv: [ 1, 0 ], },
            { pos: [ 1, 1, 0 ], uv: [ 0, 0 ], },
        ],
    },
    { // back
        uvRow: 0,
        dir: [  0,  0, -1, ],
        corners: [
            { pos: [ 1, 0, 0 ], uv: [ 0, 0 ], },
            { pos: [ 0, 0, 0 ], uv: [ 1, 0 ], },
            { pos: [ 1, 1, 0 ], uv: [ 0, 1 ], },
            { pos: [ 0, 1, 0 ], uv: [ 1, 1 ], },
        ],
    },
    { // front
        uvRow: 0,
        dir: [  0,  0,  1, ],
        corners: [
            { pos: [ 0, 0, 1 ], uv: [ 0, 0 ], },
            { pos: [ 1, 0, 1 ], uv: [ 1, 0 ], },
            { pos: [ 0, 1, 1 ], uv: [ 0, 1 ], },
            { pos: [ 1, 1, 1 ], uv: [ 1, 1 ], },
        ],
    },
];