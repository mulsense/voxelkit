import fs from 'node:fs';
import { Blob as NodeBlob } from 'node:buffer';
import { parseMOGOld } from '../src/core/mog3d_old';
import { voxelkit } from '../src/core/voxelkit';

/** jsdom's Blob has no arrayBuffer(), so the node one stands in for it here */
function blob(path: string): Blob {
    return new NodeBlob([fs.readFileSync(path)]) as unknown as Blob;
}

/** the vertex positions of a model, deduplicated */
function corners(model: { vertexs: Float32Array }): Set<string> {
    const result = new Set<string>();
    for (let i = 0; i < model.vertexs.length / 3; i++) {
        result.add([0, 1, 2].map(k => model.vertexs[i * 3 + k].toFixed(4)).join(','));
    }
    return result;
}

/** sum of the triangle area vectors; zero on a closed surface, the hole's area vector otherwise */
function openArea(model: { vertexs: Float32Array }): number {
    const sum = [0, 0, 0];
    let total = 0;
    for (let i = 0; i < model.vertexs.length / 3; i += 3) {
        const [a, b, c] = [0, 1, 2].map(k => [0, 1, 2].map(m => model.vertexs[(i + k) * 3 + m]));
        const [u, v] = [b.map((n, k) => n - a[k]), c.map((n, k) => n - a[k])];
        const face = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        face.forEach((n, k) => { sum[k] += n; });
        total += Math.sqrt(face.reduce((s, n) => s + n * n, 0));
    }
    return Math.sqrt(sum.reduce((s, n) => s + n * n, 0)) / total;
}

describe('parseMOGOld', () => {
    /** 1000 mm per voxel, so the mesh comes out in voxel units */
    const load = () => parseMOGOld(blob(`${__dirname}/../examples/mog_old/miku.mog`), 1000.0, 0.0);

    test('reads the unit, its layers and its grid size', async () => {
        const [composit] = await load();

        expect(composit.dsize).toEqual([32, 32, 32]);
        expect(composit.models.map(model => model.name)).toEqual(['body', 'leg', 'arm', 'head', 'hair']);
    });

    test('every layer has a surface, and it fits inside the grid', async () => {
        const [composit] = await load();

        for (const model of composit.models) {
            expect(model.vertexs.length / 3).toBeGreaterThan(0);
            // one quad is 6 vertices, and the whole mesh is made of quads
            expect(model.vertexs.length / 3 % 6).toBe(0);

            for (let i = 0; i < model.vertexs.length / 3; i++) {
                const [x, y, z] = [0, 1, 2].map(k => model.vertexs[i * 3 + k]);
                expect(Math.abs(x)).toBeLessThanOrEqual(16.0);
                expect(y).toBeGreaterThanOrEqual(0.0);
                expect(y).toBeLessThanOrEqual(32.0);
                expect(Math.abs(z)).toBeLessThanOrEqual(16.0);
            }
        }
    });

    test('every layer decodes to a closed surface', async () => {
        const [composit] = await load();

        for (const model of composit.models) {
            expect(openArea(model)).toBeLessThan(1e-6);
        }
    });

    test('a layer of a single color decodes without a huffman table', async () => {
        const [composit] = await load();

        // the hair layer stores that one palette index in place of the table
        const hair = composit.models[4];
        const colors = new Set<string>();
        for (let i = 0; i < hair.colors.length / 3; i++) {
            colors.add([0, 1, 2].map(k => hair.colors[i * 3 + k]).join(','));
        }
        expect(colors.size).toBe(1);
    });

    test('each layer stays within the bounding box its rect declares', async () => {
        const [composit] = await load();

        // (rect)11,6,13,10,11,6 for the body layer, in voxels from the corner of the grid
        const points = [...corners(composit.models[0])].map(point => point.split(',').map(Number));
        const [xs, ys, zs] = [0, 1, 2].map(k => points.map(point => point[k]));

        expect(Math.min(...xs)).toBeGreaterThanOrEqual(11 - 16);
        expect(Math.max(...xs)).toBeLessThanOrEqual(11 + 10 - 16);
        expect(Math.min(...ys)).toBeGreaterThanOrEqual(6);
        expect(Math.max(...ys)).toBeLessThanOrEqual(6 + 11);
        expect(Math.min(...zs)).toBeGreaterThanOrEqual(13 - 16);
        expect(Math.max(...zs)).toBeLessThanOrEqual(13 + 6 - 16);
    });

    test('the armature is renamed and rebased the way the current format stores it', async () => {
        const [composit] = await load();

        expect(composit.bones.map(bone => bone.name)).toEqual([
            'hips', 'spine', 'chest', 'neck', 'head',
            'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
            'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
            'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
            'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
        ]);

        const bone = (name: string) => composit.bones.find(b => b.name === name)!;

        expect(bone('hips').parent).toBeNull();
        expect(bone('spine').parent).toBe(bone('hips'));
        expect(bone('leftFoot').parent).toBe(bone('leftLowerLeg'));
        expect(bone('leftUpperLeg').refs).toEqual([1]);

        // (center) ran from the pelvis down to the ground: 0,0,0 -> 0,-10,0
        // it now starts at the ground, 16 - (10 - 1) voxels up, and ends at the spine
        expect(bone('hips').vec0.array()).toEqual([0, 7, 0]);
        expect(bone('hips').vec1.array()).toEqual([0, 2, 0]);
        expect(bone('spine').vec0.array()).toEqual([0, 0, 0]);
        expect(bone('spine').vec1.array()).toEqual([0, 1, 0]);
        // (UpperLeg_L) 2,2,0 is lowered by one and rebased on the new hips end
        expect(bone('leftUpperLeg').vec0.array()).toEqual([2, -1, 0]);
        expect(bone('rightUpperLeg').vec0.array()).toEqual([-2, -1, 0]);
    });

    test('scale is applied to the mesh and the armature alike', async () => {
        const [composit] = await parseMOGOld(blob(`${__dirname}/../examples/mog_old/miku.mog`), null, 0.0);

        // the default scale is dsize[1] / 32 * 20 mm
        expect(composit.bones[0].vec0.y).toBeCloseTo(7 * 0.020, 6);
        expect(Math.max(...composit.models[0].vertexs)).toBeLessThan(32 * 0.020);
    });
});

describe('voxelkit.parse', () => {
    test('picks the loader from the content, not the extension', async () => {
        const old = await voxelkit.parse(blob(`${__dirname}/../examples/mog_old/miku.mog`), { scale: 1000.0 });
        expect(old[0].models.map((model: { name: string }) => model.name)).toEqual(['body', 'leg', 'arm', 'head', 'hair']);

        const current = await voxelkit.parse(blob(`${__dirname}/../examples/mog/miku.mog`), { scale: 1000.0 });
        expect(current[0].dsize).toEqual([31, 32, 32]);
    });
});
