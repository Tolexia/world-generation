import './style.css'


class VoxelWorld {
  constructor(cellSize) {
    this.cellSize = cellSize;
  }

  generateGeometryDataForCell(cellX, cellY, cellZ) {
    const {cellSize} = this;

	const positions = [];
    const normals = [];
    const indices = [];

    const startX = cellX * cellSize;
    const startY = cellY * cellSize;
    const startZ = cellZ * cellSize;
 
    for (let y = 0; y < cellSize; ++y) 
	{
		const voxelY = startY + y;
		for (let z = 0; z < cellSize; ++z) 
		{
			const voxelZ = startZ + z;
			for (let x = 0; x < cellSize; ++x) 
			{
				const voxelX = startX + x;
				const voxel = this.getVoxel(voxelX, voxelY, voxelZ);
				if (voxel) 
				{
					for (const {dir, corners} of VoxelWorld.faces) 
					{
						const neighbor = this.getVoxel(
							voxelX + dir[0],
							voxelY + dir[1],
							voxelZ + dir[2]);

						if (!neighbor) 
						{
							// this voxel has no neighbor in this direction so we need a face
							// here.
							const ndx = positions.length / 3;
							for (const pos of corners) 
							{
								positions.push(pos[0] + x, pos[1] + y, pos[2] + z);
								normals.push(...dir);
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
		indices,
	};
  }
}

VoxelWorld.faces = [
	{ // left
	  dir: [ -1,  0,  0, ],
	},
	{ // right
	  dir: [  1,  0,  0, ],
	},
	{ // bottom
	  dir: [  0, -1,  0, ],
	},
	{ // top
	  dir: [  0,  1,  0, ],
	},
	{ // back
	  dir: [  0,  0, -1, ],
	},
	{ // front
	  dir: [  0,  0,  1, ],
	},
  ];