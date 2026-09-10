import { hmMakeTableFromLngs, table256, zlDecode } from './code';
import { Vec3 } from './vector';
import { Composit, Bone } from './model';
import { buildModel } from './mog3d';

/**
 * Loader for the old (pre-JSON) mog format.
 *
 * The file is a text tree in the "spio" syntax with the voxel maps embedded as raw
 * binary blocks. It matches `loadMOG_v1` of the MOG3D editor; the current format
 * (see `mog3d.ts`) is the JSON one written by `saveMOG_v2`.
 */

type NodeType = 'txt' | 'bin' | 'obj';

interface SpioNode {
    name: string;
    type: NodeType;
    text: string;
    data: Uint8Array;
    children: SpioNode[];
}

/** `(name)` opens a text node, `{name}` a binary node and `[name]` an object node */
const OPENERS: { [code: number]: NodeType } = { 0x28: 'txt', 0x7b: 'bin', 0x5b: 'obj' };
const CLOSERS = [0x29, 0x7d, 0x5d];

const NEWLINE = 0x0a;
const COMMA = 0x2c;

function ascii(bin: Uint8Array, start: number, end: number): string {
    let text = '';
    for (let i = start; i < end; i++) {
        if (bin[i] !== 0x0d) text += String.fromCharCode(bin[i]);
    }
    return text;
}

/**
 * Builds the node tree. Nesting is given by the indent of each line, so a node
 * indented by `n` spaces is a child of the most recent node indented by `n - 1`.
 */
function parseSpio(bin: Uint8Array): SpioNode {
    const root: SpioNode = { name: '', type: 'obj', text: '', data: new Uint8Array(0), children: [] };
    const parents: SpioNode[] = [root];

    let i = 0;
    while (i < bin.length) {
        let pos = i;
        while (pos < bin.length && OPENERS[bin[pos]] === undefined) pos++;
        if (pos >= bin.length) break;

        const indent = pos - i;
        const type = OPENERS[bin[pos]];
        pos++;

        const npos = pos;
        while (pos < bin.length && CLOSERS.indexOf(bin[pos]) < 0) pos++;
        const node: SpioNode = { name: ascii(bin, npos, pos), type, text: '', data: new Uint8Array(0), children: [] };
        pos++;

        const spos = pos;
        if (type === 'bin') {
            while (pos < bin.length && bin[pos] !== COMMA) pos++;
            const size = Math.max(0, parseInt(ascii(bin, spos, pos), 10) || 0);
            pos++;
            node.data = bin.slice(pos, pos + size);
            pos += size + 1;
        } else {
            while (pos < bin.length && bin[pos] !== NEWLINE) pos++;
            if (type === 'txt') node.text = ascii(bin, spos, pos);
            pos++;
        }

        parents[Math.min(indent, parents.length - 1)].children.push(node);
        parents[Math.min(indent, parents.length - 1) + 1] = node;
        i = pos;
    }
    return root;
}

function childs(node: SpioNode, name: string): SpioNode[] {
    return node.children.filter(child => child.name === name);
}

function child(node: SpioNode | null, name: string): SpioNode | null {
    return node ? (childs(node, name)[0] ?? null) : null;
}

/** the comma separated elements of a text node */
function texts(node: SpioNode | null): string[] {
    return (node && node.text.length > 0) ? node.text.split(',') : [];
}

function numbers(node: SpioNode | null): number[] {
    return texts(node).map(text => Number(text) || 0);
}

/** sequential reader over a binary node */
class Cursor {
    private pos: number = 0;

    constructor(private bin: Uint8Array) {}

    get rest(): number {
        return this.bin.length - this.pos;
    }

    int32(): number {
        const view = new DataView(this.bin.buffer, this.bin.byteOffset, this.bin.byteLength);
        const value = this.rest >= 4 ? view.getInt32(this.pos, true) : 0;
        this.pos += 4;
        return value;
    }

    byte(): number {
        return this.bin[this.pos++] ?? 0;
    }

    bytes(size: number): Uint8Array {
        const dst = this.bin.slice(this.pos, this.pos + size);
        this.pos += size;
        return dst;
    }
}

/** a block is stored as a byte count plus the number of padding bits in its last byte */
function readBits(cursor: Cursor): Uint8Array {
    const size = Math.max(0, cursor.int32());
    const padding = cursor.byte();
    const data = cursor.bytes(size);

    const bits = Math.max(0, size * 8 - padding);
    return Uint8Array.from({ length: bits }, (_, i) => (data[i >> 3] >> (i % 8)) & 1);
}

interface Rect3 {
    dbase: [number, number, number];
    dsize: [number, number, number];
}

/** whether the 8x8x8 block at `base` overlaps `rect` */
function overlaps(rect: Rect3, base: number[], step: number): boolean {
    for (let i = 0; i < 3; i++) {
        const low = Math.max(rect.dbase[i], base[i]);
        const high = Math.min(rect.dbase[i] + rect.dsize[i], base[i] + step);
        if (high - low <= 0) return false;
    }
    return true;
}

/**
 * Expands the three compressed streams into an occupancy map (bit 0x40) and a palette index map.
 *
 * `memA` holds one bit per 8x8x8 block telling whether the block has any voxel,
 * `memB` one bit per voxel of a non-empty block and `memC` one palette index per filled voxel.
 * Blocks outside `rect` are not stored at all, so they consume nothing.
 */
function decodeMaps(
    dsize: [number, number, number],
    rect: Rect3,
    memA: Uint8Array,
    memB: number[],
    memC: number[])
    : { gmap: Uint8Array, cmap: Uint8Array }
{
    const step = 8;
    const gmap = new Uint8Array(dsize[0] * dsize[1] * dsize[2]).fill(0);
    const cmap = new Uint8Array(dsize[0] * dsize[1] * dsize[2]).fill(0);

    let [a, b, c] = [0, 0, 0];
    for (let z = 0; z < Math.ceil(dsize[2] / step); z++) {
        for (let y = 0; y < Math.ceil(dsize[1] / step); y++) {
            for (let x = 0; x < Math.ceil(dsize[0] / step); x++) {
                if (overlaps(rect, [x * step, y * step, z * step], step) === false) continue;

                const filled = (memA[a >> 3] >> (a % 8)) & 1;
                a++;
                if (filled === 0) continue;

                let bits = 0;
                for (let iz = 0; iz < step; iz++) {
                    for (let iy = 0; iy < step; iy++) {
                        for (let ix = 0; ix < step; ix++) {
                            if (ix === 0) bits = memB[b++] ?? 0;

                            const [vx, vy, vz] = [x * step + ix, y * step + iy, z * step + iz];
                            if (vx >= dsize[0] || vy >= dsize[1] || vz >= dsize[2]) continue;
                            if ((bits >> ix & 1) === 0) continue;

                            const p = vz * dsize[0] * dsize[1] + vy * dsize[0] + vx;
                            gmap[p] = 0x40;
                            // a short memC means a single color for the whole layer, so the index is clamped
                            cmap[p] = Math.max(0, memC[Math.min(c, memC.length - 1)] ?? 0);
                            c++;
                        }
                    }
                }
            }
        }
    }

    return { gmap, cmap };
}

/** the occupancy streams, stored as a raw bit block followed by a huffman coded one */
function decodeVmap(node: SpioNode): { memA: Uint8Array, memB: number[] } {
    const cursor = new Cursor(node.data);

    const size = Math.max(0, cursor.int32());
    cursor.byte();
    const memA = cursor.bytes(size);

    const bits = readBits(cursor);
    // the old format weights the escape code as 2^7 rather than the 2^8 the current one uses
    const memB = bits.length > 0 ? zlDecode(table256(2 ** 7), bits, 256, 8, 8) : [];

    return { memA, memB };
}

const PALETTE_CODE = 256;

/**
 * The palette index stream. Its huffman table is stored in front of it as symbol/length
 * pairs; a layer of a single color stores that color instead of a table.
 *
 * @param legacy true for the older `bin1` node, whose header counts pairs rather than bytes
 *               and keeps the length of the LZSS escape code in the padding field
 */
function decodeCmap(node: SpioNode, legacy: boolean): number[] {
    const cursor = new Cursor(node.data);

    const size = Math.max(0, cursor.int32());
    const padding = cursor.byte();

    const lngs = new Array(PALETTE_CODE + 1).fill(0);
    if (legacy === true) {
        for (let c = 0; c < size; c++) {
            lngs[cursor.byte()] = cursor.byte();
        }
        lngs[PALETTE_CODE] = padding;
    } else {
        if (size <= 1) return [cursor.byte()];

        for (let c = 0; c < size - 1; c += 2) {
            lngs[cursor.byte()] = cursor.byte();
        }
        lngs[PALETTE_CODE] = cursor.byte();
    }

    const bits = readBits(cursor);
    return bits.length > 0 ? zlDecode(hmMakeTableFromLngs(lngs), bits, PALETTE_CODE, 8, 8) : [];
}

/** the palette, padded with white up to the full 256 entries as the editor does */
function parsePalette(node: SpioNode | null): Uint8Array {
    const palette = new Uint8Array(256 * 4).fill(255);
    if (node === null) return palette;

    if (node.type === 'obj') {
        const size = numbers(child(node, 'size'))[0] ?? 0;
        const cols = child(node, 'cols');
        if (cols === null || size <= 0) return palette;

        const stride = (cols.data.length / size === 3) ? 3 : 4;
        for (let c = 0; c < size; c++) {
            for (let i = 0; i < 3; i++) {
                palette[c * 4 + i] = cols.data[c * stride + i];
            }
            palette[c * 4 + 3] = (stride === 4) ? cols.data[c * 4 + 3] : 255;
        }
    } else {
        palette.set(node.data.slice(0, Math.floor(node.data.length / 4) * 4));
    }
    return palette;
}

/** the bone names the editor used before it moved to the VRM humanoid ones */
const BONE_NAMES: { [name: string]: string } = {
    'center': 'hips',
    'Spine1': 'spine',
    'Spine2': 'chest',
    'Neck': 'neck',
    'Head': 'head',
    'Shoulder_L': 'leftShoulder',
    'UpperArm_L': 'leftUpperArm',
    'LowerArm_L': 'leftLowerArm',
    'Hand_L': 'leftHand',
    'Shoulder_R': 'rightShoulder',
    'UpperArm_R': 'rightUpperArm',
    'LowerArm_R': 'rightLowerArm',
    'Hand_R': 'rightHand',
    'UpperLeg_L': 'leftUpperLeg',
    'LowerLeg_L': 'leftLowerLeg',
    'Foot_L': 'leftFoot',
    'UpperLeg_R': 'rightUpperLeg',
    'LowerLeg_R': 'rightLowerLeg',
    'Foot_R': 'rightFoot',
};

interface RawBone {
    name: string;
    link: number;
    layers: number[];
    vec0: number[];
    vec1: number[];
}

/**
 * Reads the armature and brings it to the layout the current format stores.
 *
 * The old files place the hips at the pelvis and measure it from the center of the
 * grid, while the new ones start it at the ground and measure it from the bottom,
 * so the root and the legs are rebased here the same way the editor does on import.
 */
function parseBones(node: SpioNode, dsize: [number, number, number], scale: number): Bone[] {
    const raws: RawBone[] = childs(node, 'bone').map((n, b) => {
        const label = child(n, 'name')?.text ?? '';
        const name = BONE_NAMES[label] ?? label;
        const vecs = numbers(child(n, 'vecs'));
        const vec0 = [vecs[0] ?? 0, vecs[1] ?? 0, vecs[2] ?? 0];
        const vec1 = [vecs[3] ?? 0, vecs[4] ?? 0, vecs[5] ?? 0];

        // the root gained a unit of length, and the hips/spine joint moved down by one
        if (b === 0) vec1[1] += 1.0;
        if (name === 'leftUpperLeg' || name === 'rightUpperLeg') vec0[1] -= 1.0;
        if (name === 'spine') vec1[1] -= 1.0;

        return { name, link: numbers(child(n, 'link'))[0] ?? -1, layers: numbers(child(n, 'refs')), vec0, vec1 };
    });

    const hips = raws.find(raw => raw.name === 'hips');
    const spine = raws.find(raw => raw.name === 'spine');
    if (hips && spine) {
        // the hips used to run from the pelvis down to the ground; it now runs up to the spine
        hips.vec0 = [...hips.vec1];
        hips.vec1 = [...spine.vec0];
        spine.vec0 = [0.0, 0.0, 0.0];

        for (const raw of raws) {
            if (raw.name === 'leftUpperLeg' || raw.name === 'rightUpperLeg') {
                raw.vec0 = raw.vec0.map((v, i) => v - hips.vec1[i]);
            }
        }
        hips.vec0 = [hips.vec0[0], hips.vec0[1] + dsize[1] / 2, hips.vec0[2]];
    }

    const bones: Bone[] = [];
    for (const raw of raws) {
        const parent = (raw.link >= 0 && raw.link < bones.length) ? bones[raw.link] : null;
        const vec0 = Vec3.mul(new Vec3(raw.vec0[0], raw.vec0[1], raw.vec0[2]), scale);
        const vec1 = Vec3.mul(new Vec3(raw.vec1[0], raw.vec1[1], raw.vec1[2]), scale);
        bones.push(new Bone(parent, raw.name, vec0, vec1, raw.layers));
    }
    return bones;
}

function parseUnit(node: SpioNode, version: string, scale: number | null, chamfer: number): Composit {
    const size = numbers(child(node, 'size'));
    let dsize: [number, number, number] = [size[0] ?? 0, size[1] ?? 0, size[2] ?? 0];

    const s = (scale !== null ? scale : (dsize[1] / 32 * 20)) * 0.001;
    const palette = parsePalette(child(node, 'palette') ?? child(node, 'color'));

    // a layer may carry its own size; the composit follows the first one, as the current format does
    let base: [number, number, number] = dsize;

    const models = childs(node, 'model').map((n, m) => {
        const rect: Rect3 = { dbase: [0, 0, 0], dsize: [dsize[0], dsize[1], dsize[2]] };

        const msize = numbers(child(n, 'size'));
        if (msize.length >= 3) dsize = [msize[0], msize[1], msize[2]];
        if (m === 0) base = dsize;

        const mrect = numbers(child(n, 'rect'));
        if (mrect.length >= 6) {
            rect.dbase = [mrect[0], mrect[1], mrect[2]];
            rect.dsize = [mrect[3], mrect[4], mrect[5]];
        }

        const name = child(n, 'name')?.text ?? '';
        const vmap = child(n, 'bin0') ?? child(n, 'vmap');
        const legacy = child(n, 'bin1') !== null;
        const cmap = legacy ? child(n, 'bin1') : child(n, 'cmap');

        if (vmap === null) {
            const empty = new Uint8Array(dsize[0] * dsize[1] * dsize[2]);
            return buildModel(name, dsize, empty, empty, palette, s, chamfer);
        }

        const { memA, memB } = decodeVmap(vmap);
        const memC = cmap !== null ? decodeCmap(cmap, legacy) : [];
        const { gmap, cmap: indices } = decodeMaps(dsize, rect, memA, memB, memC);

        return buildModel(name, dsize, gmap, indices, palette, s, chamfer);
    });

    const bones = (version === '0.3' || version === '1.0') ? parseBones(node, base, s) : [];

    return { models, bones, dsize: base };
}

export async function parseMOGOld(blob: Blob, scale: number | null, chamfer: number = 0.0): Promise<Composit[]> {
    const root = parseSpio(new Uint8Array(await blob.arrayBuffer()));
    const version = child(root, '.mog')?.text ?? '';

    return childs(root, 'unit').map(node => parseUnit(node, version, scale, chamfer));
}
