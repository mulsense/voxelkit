import { Model } from './model';

export interface OBJFiles {
    /** the Wavefront OBJ text. It points at the material library by `mtlName` */
    obj: string;
    /** the material library (MTL) holding one material per color */
    mtl: string;
}

/**
 * Converts to Wavefront OBJ, with its materials in a separate MTL.
 *
 * OBJ is for taking the shape somewhere else, so bones are not written: the
 * mesh comes out in the pose it was modelled in.
 *
 * Colors go into materials, one per distinct color, rather than into vertex
 * colors. Vertex colors on `v` lines are an extension that many importers
 * drop, while `usemtl` with a diffuse color is read everywhere.
 *
 * The meshes arrive as separate triangles, so identical positions and normals
 * are shared here to keep the file small. Faces are grouped by material, and
 * each layer becomes its own object (`o`) so the parts stay apart.
 *
 * @param mtlName the file name the OBJ refers to in `mtllib`
 */
export function convertOBJ(models: Model[], mtlName: string = 'model.mtl'): OBJFiles {
    const positions = new Index();
    const normals = new Index();
    const colors = new Map<string, number[]>();

    const objects: string[] = [];
    for (const model of models) {
        const count = model.vertexs.length / 3;
        if (count < 3) continue;

        /** triangles of this layer, grouped by material, as `f` lines */
        const faces = new Map<string, string[]>();
        for (let i = 0; i + 2 < count; i += 3) {
            const material = colorName(model.colors, i);
            if (!colors.has(material)) {
                colors.set(material, [0, 1, 2].map(k => model.colors[i * 3 + k] & 0xff));
            }

            const corners = [i, i + 1, i + 2].map(j => {
                const v = positions.of(model.vertexs, j);
                const n = normals.of(model.normals, j);
                return `${v}//${n}`;
            });
            let lines = faces.get(material);
            if (lines === undefined) {
                lines = [];
                faces.set(material, lines);
            }
            lines.push(`f ${corners.join(' ')}`);
        }

        const body = [...faces].map(([material, lines]) => `usemtl ${material}\n${lines.join('\n')}`);
        objects.push(`o ${objectName(model.name, objects.length)}\n${body.join('\n')}`);
    }

    const obj = [
        '# voxelkit',
        `mtllib ${mtlName}`,
        ...positions.values.map(v => `v ${v}`),
        ...normals.values.map(n => `vn ${n}`),
        ...objects,
        '',
    ].join('\n');

    const mtl = [
        '# voxelkit',
        ...[...colors].map(([name, rgb]) => [
            '',
            `newmtl ${name}`,
            `Kd ${rgb.map(c => number(c / 255)).join(' ')}`,
            'Ka 0 0 0',
            'Ks 0 0 0',
            'd 1',
            'illum 1',
        ].join('\n')),
        '',
    ].join('\n');

    return { obj, mtl };
}

/** hands out 1-based OBJ indices, the same one for the same triple */
class Index {
    public values: string[] = [];
    private indices = new Map<string, number>();

    of(array: Float32Array, i: number): number {
        const key = [0, 1, 2].map(k => number(array[i * 3 + k])).join(' ');
        let index = this.indices.get(key);
        if (index === undefined) {
            this.values.push(key);
            index = this.values.length;
            this.indices.set(key, index);
        }
        return index;
    }
}

/**
 * A number short enough to keep the file small. Six decimals is far below a
 * voxel at any size a model is written out at (a micrometre in metres).
 * `-0` is written as `0`.
 */
function number(value: number): string {
    const text = String(Number(value.toFixed(6)));
    return text === '-0' ? '0' : text;
}

/** the material for the color of vertex `i`. The colors are bytes stored signed */
function colorName(colors: Int8Array, i: number): string {
    const hex = [0, 1, 2].map(k => (colors[i * 3 + k] & 0xff).toString(16).padStart(2, '0')).join('');
    return `color_${hex}`;
}

/** OBJ names end at whitespace, so it is replaced; an empty name gets a number */
function objectName(name: string, index: number): string {
    const trimmed = name.trim().replace(/\s+/g, '_');
    return trimmed === '' ? `layer_${index + 1}` : trimmed;
}
