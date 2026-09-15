import { Model } from './model';

/**
 * Converts to glTF 2.0 binary (GLB).
 *
 * GLB is for taking the shape somewhere else, like OBJ, so bones are not
 * written: the mesh comes out in the pose it was modelled in. Use VRM when the
 * model should move.
 *
 * Colors go into materials, one per distinct color, rather than into vertex
 * colors or a texture. `COLOR_0` is not wired into the material by every
 * importer, and a texture needs a canvas to encode; a flat `baseColorFactor`
 * is read everywhere. The factor is linear, so the sRGB palette is converted.
 *
 * Each layer becomes its own node and mesh so the parts stay apart, with one
 * primitive per color. The meshes arrive as separate triangles, so identical
 * position and normal pairs are shared within a primitive to keep the file
 * small.
 */
export function convertGLB(models: Model[]): Uint8Array {
    const chunks: Uint8Array[] = [];
    let binSize = 0;

    const bufferViews: any[] = [];
    const accessors: any[] = [];
    const materials: any[] = [];
    const materialIndices = new Map<string, number>();
    const meshes: any[] = [];
    const nodes: any[] = [];

    /** appends the bytes as a buffer view and returns its index */
    const addView = (bytes: Uint8Array, target: number): number => {
        chunks.push(bytes);
        bufferViews.push({ buffer: 0, byteOffset: binSize, byteLength: bytes.length, target });
        binSize += bytes.length; // float32 and uint32 only, so it stays 4-byte aligned
        return bufferViews.length - 1;
    };

    for (const model of models) {
        const count = model.vertexs.length / 3;
        if (count < 3) continue;

        /** triangles of this layer, grouped by color, as vertex numbers */
        const groups = new Map<string, number[]>();
        for (let i = 0; i + 2 < count; i += 3) {
            const key = colorKey(model.colors, i);
            let corners = groups.get(key);
            if (corners === undefined) {
                corners = [];
                groups.set(key, corners);
            }
            corners.push(i, i + 1, i + 2);
        }

        const primitives: any[] = [];
        for (const [key, corners] of groups) {
            let material = materialIndices.get(key);
            if (material === undefined) {
                const rgb = [0, 1, 2].map(k => model.colors[corners[0] * 3 + k] & 0xff);
                materials.push({
                    name: `color_${key}`,
                    pbrMetallicRoughness: {
                        baseColorFactor: [...rgb.map(c => round(srgbToLinear(c / 255))), 1],
                        metallicFactor: 0,
                        roughnessFactor: 1,
                    },
                });
                material = materials.length - 1;
                materialIndices.set(key, material);
            }

            const shared = new Map<string, number>();
            const positions: number[] = [];
            const normals: number[] = [];
            const indices = new Uint32Array(corners.length);
            corners.forEach((j, n) => {
                const p = [0, 1, 2].map(k => model.vertexs[j * 3 + k]);
                const v = [0, 1, 2].map(k => model.normals[j * 3 + k]);
                const id = [...p, ...v].map(round).join(' ');
                let index = shared.get(id);
                if (index === undefined) {
                    index = positions.length / 3;
                    positions.push(...p);
                    normals.push(...v);
                    shared.set(id, index);
                }
                indices[n] = index;
            });

            const vertexCount = positions.length / 3;
            // POSITION needs its bounds. A loop, not spread: a layer can hold more values than the call stack
            const [min, max] = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
            positions.forEach((value, i) => {
                min[i % 3] = Math.min(min[i % 3], value);
                max[i % 3] = Math.max(max[i % 3], value);
            });

            accessors.push(
                { bufferView: addView(bytesOf(new Float32Array(positions)), 34962), componentType: 5126, count: vertexCount, type: 'VEC3', min, max },
                { bufferView: addView(bytesOf(new Float32Array(normals)), 34962), componentType: 5126, count: vertexCount, type: 'VEC3' },
                { bufferView: addView(bytesOf(indices), 34963), componentType: 5125, count: indices.length, type: 'SCALAR' },
            );
            const base = accessors.length - 3;
            primitives.push({ attributes: { POSITION: base, NORMAL: base + 1 }, indices: base + 2, material, mode: 4 });
        }

        const name = objectName(model.name, nodes.length);
        meshes.push({ name, primitives });
        nodes.push({ name, mesh: meshes.length - 1 });
    }

    const gltf: any = {
        asset: { version: '2.0', generator: 'voxelkit' },
        scene: 0,
        scenes: [{ nodes: [...nodes.keys()] }],
        nodes,
    };
    if (meshes.length > 0) {
        Object.assign(gltf, { meshes, materials, accessors, bufferViews, buffers: [{ byteLength: binSize }] });
    }

    const bin = new Uint8Array(binSize);
    let offset = 0;
    for (const chunk of chunks) {
        bin.set(chunk, offset);
        offset += chunk.length;
    }
    return packGLB(gltf, bin);
}

/**
 * Lays out the GLB container: the header, the JSON chunk padded with spaces
 * and, when there is anything in it, the BIN chunk padded with zeros.
 */
function packGLB(gltf: object, bin: Uint8Array): Uint8Array {
    const json = new TextEncoder().encode(JSON.stringify(gltf));
    const jsonSize = align4(json.length);
    const binSize = align4(bin.length);

    const length = 12 + 8 + jsonSize + (bin.length > 0 ? 8 + binSize : 0);
    const buffer = new Uint8Array(length);
    const view = new DataView(buffer.buffer);

    view.setUint32(0, 0x46546c67, true); // "glTF"
    view.setUint32(4, 2, true);
    view.setUint32(8, length, true);

    view.setUint32(12, jsonSize, true);
    view.setUint32(16, 0x4e4f534a, true); // "JSON"
    buffer.fill(0x20, 20, 20 + jsonSize);
    buffer.set(json, 20);

    if (bin.length > 0) {
        const at = 20 + jsonSize;
        view.setUint32(at, binSize, true);
        view.setUint32(at + 4, 0x004e4942, true); // "BIN\0"
        buffer.set(bin, at + 8);
    }
    return buffer;
}

const align4 = (size: number): number => Math.ceil(size / 4) * 4;

function bytesOf(array: Float32Array | Uint32Array): Uint8Array {
    return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}

/** the hex of vertex `i`'s color. The colors are bytes stored signed */
function colorKey(colors: Int8Array, i: number): string {
    return [0, 1, 2].map(k => (colors[i * 3 + k] & 0xff).toString(16).padStart(2, '0')).join('');
}

function srgbToLinear(c: number): number {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** six decimals, far below a voxel at any size a model is written out at. `-0` becomes `0` */
function round(value: number): number {
    return Number(value.toFixed(6)) + 0;
}

/** an empty layer name gets a number */
function objectName(name: string, index: number): string {
    const trimmed = name.trim();
    return trimmed === '' ? `layer_${index + 1}` : trimmed;
}
