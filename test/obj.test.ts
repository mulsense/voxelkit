import { buildModel } from '../src/core/mog3d';
import { convertOBJ } from '../src/core/obj';

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

function lines(text: string, head: string): string[] {
    return text.split('\n').filter(line => line.startsWith(`${head} `));
}

describe('convertOBJ', () => {
    test('shares corners and normals, and writes every triangle', () => {
        const { obj } = convertOBJ([voxels([1, 1, 1], [[0, 0, 0, 0]], [255, 0, 0, 255])], 'cube.mtl');

        expect(obj).toContain('mtllib cube.mtl');
        expect(lines(obj, 'v')).toHaveLength(8);
        expect(lines(obj, 'vn')).toHaveLength(6);
        expect(lines(obj, 'f')).toHaveLength(12);
        expect(lines(obj, 'o')).toEqual(['o body']);

        const count = lines(obj, 'v').length;
        for (const face of lines(obj, 'f')) {
            const indices = face.slice(2).split(' ').map(corner => Number(corner.split('//')[0]));
            expect(indices.every(index => index >= 1 && index <= count)).toBe(true);
        }
    });

    test('puts each color into its own material', () => {
        const model = voxels([2, 1, 1], [[0, 0, 0, 0], [1, 0, 0, 1]], [255, 0, 0, 255, 0, 128, 255, 255]);
        const { obj, mtl } = convertOBJ([model]);

        expect(lines(obj, 'usemtl').sort()).toEqual(['usemtl color_0080ff', 'usemtl color_ff0000']);
        expect(mtl).toContain('newmtl color_ff0000\nKd 1 0 0');
        expect(mtl).toContain('newmtl color_0080ff\nKd 0 0.501961 1');
    });

    test('keeps layers apart as objects and skips empty ones', () => {
        const first = voxels([1, 1, 1], [[0, 0, 0, 0]], [255, 0, 0, 255]);
        const empty = voxels([1, 1, 1], [], [255, 0, 0, 255]);
        const second = voxels([1, 1, 1], [[0, 0, 0, 0]], [255, 0, 0, 255]);
        second.name = '';

        const { obj, mtl } = convertOBJ([first, empty, second]);

        expect(lines(obj, 'o')).toEqual(['o body', 'o layer_2']);
        expect(lines(mtl, 'newmtl')).toEqual(['newmtl color_ff0000']);
    });
});
