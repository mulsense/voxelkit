import fs from 'node:fs';
import { buildModel, decodeGrid } from '../src/core/mog3d';

const PALETTE = Uint8Array.from([10, 20, 30, 255]);

function grid(dsize: [number, number, number], cells: [number, number, number][]) {
    const gmap = new Uint8Array(dsize[0] * dsize[1] * dsize[2]);
    const cmap = new Uint8Array(dsize[0] * dsize[1] * dsize[2]);
    for (const [x, y, z] of cells) {
        gmap[z * dsize[0] * dsize[1] + y * dsize[0] + x] = 0x40;
    }
    return { gmap, cmap };
}

function build(dsize: [number, number, number], cells: [number, number, number][], chamfer: number) {
    const { gmap, cmap } = grid(dsize, cells);
    return buildModel('test', dsize, gmap, cmap, PALETTE, 1.0, chamfer);
}

function positions(model: { vertexs: Float32Array }): string[] {
    const result: string[] = [];
    for (let i = 0; i < model.vertexs.length / 3; i++) {
        result.push([0, 1, 2].map(k => model.vertexs[i * 3 + k].toFixed(4)).join(',')); 
    }
    return result;
}

describe('buildModel', () => {
    test('chamfer 0.0 keeps the plain voxel surface', () => {
        const model = build([1, 1, 1], [[0, 0, 0]], 0.0);

        expect(model.vertexs.length / 3).toBe(6 * 6);
        expect(new Set(positions(model)).size).toBe(8);
    });

    test('chamfer adds one quad per convex edge and one triangle per convex corner', () => {
        const model = build([1, 1, 1], [[0, 0, 0]], 0.25);

        expect(model.vertexs.length / 3).toBe(6 * 6 + 12 * 6 + 8 * 3);
        expect(new Set(positions(model)).size).toBe(24);

        for (let i = 0; i < model.vertexs.length / 3; i++) {
            const [x, y, z] = [model.vertexs[i * 3 + 0], model.vertexs[i * 3 + 1], model.vertexs[i * 3 + 2]];
            expect(Math.abs(x)).toBeLessThanOrEqual(0.5 + 1e-6);
            expect(y).toBeGreaterThanOrEqual(-1e-6);
            expect(y).toBeLessThanOrEqual(1.0 + 1e-6);
            expect(Math.abs(z)).toBeLessThanOrEqual(0.5 + 1e-6);
        }
    });

    test.each([
        ['a single voxel', [1, 1, 1], [[0, 0, 0]]],
        ['a concave pair', [1, 2, 2], [[0, 0, 1], [0, 1, 0]]],
    ])('every triangle of %s faces outward', (_name, dsize, cells) => {
        const model = build(dsize as [number, number, number], cells as [number, number, number][], 0.25);

        for (let i = 0; i < model.vertexs.length / 3; i += 3) {
            const [a, b, c] = [0, 1, 2].map(k => [0, 1, 2].map(m => model.vertexs[(i + k) * 3 + m]));
            const [u, v] = [b.map((n, k) => n - a[k]), c.map((n, k) => n - a[k])];
            const face = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
            const normal = [0, 1, 2].map(k => model.normals[i * 3 + k]);

            expect(Math.sqrt(normal.reduce((s, n) => s + n * n, 0))).toBeCloseTo(1.0, 5);
            expect(face.reduce((s, n, k) => s + n * normal[k], 0)).toBeGreaterThan(0);
        }
    });

    test('flat runs of voxels are not beveled voxel by voxel', () => {
        const model = build([2, 1, 1], [[0, 0, 0], [1, 0, 0]], 0.25);

        // 10 exposed faces, 16 convex edges, 8 convex corners: the seam between the two voxels stays flat
        expect(model.vertexs.length / 3).toBe(10 * 6 + 16 * 6 + 8 * 3);

        // the faces run right up to the seam at x = 0, so no bevel is cut there
        const xs = [...new Set(positions(model).map(p => p.split(',')[0]))].map(Number).sort((a, b) => a - b);
        expect(xs).toEqual([-1, -0.75, 0, 0.75, 1]);
    });

    test('concave edges keep their sharp corner', () => {
        const model = build([1, 2, 2], [[0, 0, 1], [0, 1, 0]], 0.25);

        // the edge shared by the two voxels is concave, so neither voxel bevels it
        expect(model.vertexs.length / 3).toBe(12 * 6 + 22 * 6 + 12 * 3);
        // both voxels still meet on the sharp line y = 1, z = 0 (only its convex ends are cut back)
        expect(positions(model)).toContain('0.2500,1.0000,0.0000');
        expect(positions(model)).toContain('-0.2500,1.0000,0.0000');
    });
});

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

describe('buildModel watertightness', () => {
    test.each([0.0, 0.1, 0.25, 0.5])('a single voxel stays closed at chamfer %p', (chamfer) => {
        expect(openArea(build([1, 1, 1], [[0, 0, 0]], chamfer))).toBeLessThan(1e-6);
    });

    test('a step in the surface stays closed where the bevel runs out', () => {
        // the lower voxel bevels the edge that the upper one keeps sharp, so the seam has to be filled
        const model = build([2, 1, 2], [[0, 0, 0], [0, 0, 1], [1, 0, 1]], 0.25);

        expect(openArea(model)).toBeLessThan(1e-6);
        expect(positions(model)).toContain('0.0000,1.0000,0.0000');
        expect(positions(model)).toContain('-0.2500,1.0000,0.0000');
        expect(positions(model)).toContain('0.0000,0.7500,0.0000');
    });

    test.each([0.0, 0.1, 0.2])('the rei model stays closed at chamfer %p', (chamfer) => {
        const json = JSON.parse(fs.readFileSync(`${__dirname}/../examples/mog/rei.mog`, 'utf8'));
        const palette = Uint8Array.from(atob(json.palette), c => c.charCodeAt(0));

        for (const layer of json.layers) {
            const { gmap, cmap } = decodeGrid(json.dsize, layer.data);
            const model = buildModel(layer.name, json.dsize, gmap, cmap, palette, 1.0, chamfer);
            expect(openArea(model)).toBeLessThan(1e-6);
        }
    });
});
