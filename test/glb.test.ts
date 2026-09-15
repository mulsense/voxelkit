/**
 * @jest-environment node
 */
// jsdom has no TextEncoder, which the browsers the GLB is made in all have
import { buildModel } from '../src/core/mog3d';
import { convertGLB } from '../src/core/glb';

function voxels(dsize: [number, number, number], cells: [number, number, number, number][], palette: number[]) {
    const gmap = new Uint8Array(dsize[0] * dsize[1] * dsize[2]);
    const cmap = new Uint8Array(dsize[0] * dsize[1] * dsize[2]);
    for (const [x, y, z, c] of cells) {
        const p = z * dsize[0] * dsize[1] + y * dsize[0] + x;
        gmap[p] = 0x40;
        cmap[p] = c;
    }
    return buildModel('body', dsize, gmap, cmap, Uint8Array.from(palette), 1.0, 0.0, 0.0);
}

/** splits a GLB into its JSON and BIN chunks */
function unpack(glb: Uint8Array): { gltf: any, bin: DataView } {
    const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    expect(view.getUint32(0, true)).toBe(0x46546c67);
    expect(view.getUint32(4, true)).toBe(2);
    expect(view.getUint32(8, true)).toBe(glb.byteLength);
    expect(glb.byteLength % 4).toBe(0);

    const jsonSize = view.getUint32(12, true);
    expect(view.getUint32(16, true)).toBe(0x4e4f534a);
    const gltf = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonSize)));

    const at = 20 + jsonSize;
    if (at === glb.byteLength) return { gltf, bin: new DataView(new ArrayBuffer(0)) };
    expect(view.getUint32(at + 4, true)).toBe(0x004e4942);
    return { gltf, bin: new DataView(glb.buffer, glb.byteOffset + at + 8, view.getUint32(at, true)) };
}

describe('convertGLB', () => {
    test('shares corners within a primitive, and every index points at a vertex', () => {
        const { gltf, bin } = unpack(convertGLB([voxels([1, 1, 1], [[0, 0, 0, 0]], [255, 0, 0, 255])]));

        expect(gltf.asset.version).toBe('2.0');
        expect(gltf.nodes).toEqual([{ name: 'body', mesh: 0 }]);
        expect(gltf.skins).toBeUndefined();

        const [primitive] = gltf.meshes[0].primitives;
        const position = gltf.accessors[primitive.attributes.POSITION];
        const indices = gltf.accessors[primitive.indices];
        // a cube: 6 faces x 4 corners, each corner keeping its face's normal
        expect(position.count).toBe(24);
        expect(indices.count).toBe(36);
        expect(position.min).toHaveLength(3);
        expect(position.max).toHaveLength(3);

        const view = gltf.bufferViews[indices.bufferView];
        for (let i = 0; i < indices.count; i++) {
            const index = bin.getUint32(view.byteOffset + i * 4, true);
            expect(index).toBeLessThan(position.count);
        }
        expect(bin.byteLength).toBe(gltf.buffers[0].byteLength);
    });

    test('puts each color into its own material, as a linear factor', () => {
        const model = voxels([2, 1, 1], [[0, 0, 0, 0], [1, 0, 0, 1]], [255, 0, 0, 255, 0, 128, 255, 255]);
        const { gltf } = unpack(convertGLB([model]));

        expect(gltf.meshes[0].primitives).toHaveLength(2);
        const factors = Object.fromEntries(gltf.materials.map((m: any) => [m.name, m.pbrMetallicRoughness.baseColorFactor]));
        expect(factors.color_ff0000).toEqual([1, 0, 0, 1]);
        expect(factors.color_0080ff[1]).toBeCloseTo(0.2158605, 5);
    });

    test('keeps layers apart as nodes, shares materials between them and skips empty ones', () => {
        const first = voxels([1, 1, 1], [[0, 0, 0, 0]], [255, 0, 0, 255]);
        const empty = voxels([1, 1, 1], [], [255, 0, 0, 255]);
        const second = voxels([1, 1, 1], [[0, 0, 0, 0]], [255, 0, 0, 255]);
        second.name = '';

        const { gltf } = unpack(convertGLB([first, empty, second]));

        expect(gltf.nodes.map((node: any) => node.name)).toEqual(['body', 'layer_2']);
        expect(gltf.scenes[0].nodes).toEqual([0, 1]);
        expect(gltf.materials).toHaveLength(1);
    });

    test('writes a valid file without a BIN chunk when there is nothing to draw', () => {
        const { gltf } = unpack(convertGLB([voxels([1, 1, 1], [], [255, 0, 0, 255])]));

        expect(gltf.nodes).toEqual([]);
        expect(gltf.buffers).toBeUndefined();
    });
});
