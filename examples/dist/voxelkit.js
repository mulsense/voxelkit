(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
    typeof define === 'function' && define.amd ? define(factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.voxelkit = factory());
})(this, (function () { 'use strict';

    /******************************************************************************
    Copyright (c) Microsoft Corporation.

    Permission to use, copy, modify, and/or distribute this software for any
    purpose with or without fee is hereby granted.

    THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
    REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
    AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
    INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
    LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
    OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
    PERFORMANCE OF THIS SOFTWARE.
    ***************************************************************************** */
    /* global Reflect, Promise, SuppressedError, Symbol, Iterator */


    function __awaiter(thisArg, _arguments, P, generator) {
        function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
        return new (P || (P = Promise))(function (resolve, reject) {
            function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
            function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
            function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
            step((generator = generator.apply(thisArg, _arguments || [])).next());
        });
    }

    typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
        var e = new Error(message);
        return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
    };

    function segment(bin, p, bitarray = false) {
        const view = new DataView(bin.buffer);
        let offset = 0;
        for (let i = 0; i < p; i++) {
            offset += ((view.getInt32(offset, true) + 7) >> 3) + 4;
        }
        const length = view.getInt32(offset, true);
        const slice = bin.slice(offset + 4, offset + 4 + ((length + 7) >> 3));
        return bitarray ? Uint8Array.from({ length }, (_, i) => (slice[i >> 3] >> (i % 8)) & 1) : slice;
    }
    function hmMakeNode(table) {
        const nodes = [{ val: -1, child: [-1, -1] }];
        for (let i = 0; i < table.length; i++) {
            if (table[i].length === 0)
                continue;
            let node = nodes[0];
            for (const bit of table[i]) {
                if (node.child[bit] === -1) {
                    node.child[bit] = nodes.length;
                    node = { val: -1, child: [-1, -1] };
                    nodes.push(node);
                }
                else {
                    node = nodes[node.child[bit]];
                }
            }
            node.val = i;
        }
        return nodes;
    }
    function hmMakeTableFromLngs(lngs) {
        const table = Array.from({ length: lngs.length }, () => []);
        const nonZero = lngs.filter(n => n > 0);
        if (nonZero.length === 0)
            return table;
        const [maxv, minv] = [Math.max(...nonZero), Math.min(...nonZero)];
        const bits = new Array(minv).fill(0);
        let prev = 0;
        for (let s = minv; s <= maxv; s++) {
            for (let i = 0; i < lngs.length; i++) {
                if (lngs[i] !== s)
                    continue;
                if (prev > 0) {
                    for (let j = bits.length - 1; j >= 0; j--) {
                        if (bits[j] === 0) {
                            bits[j] = 1;
                            break;
                        }
                        bits[j] = 0;
                    }
                    bits.push(...new Array(s - prev).fill(0));
                }
                prev = s;
                table[i] = [...bits];
            }
        }
        return table;
    }
    function zlDecode(table, src, code, v0, v1) {
        const result = [];
        const nodes = hmMakeNode(table);
        let node = nodes[0];
        for (let i = 0; i < src.length; i++) {
            if ((node = nodes[node.child[src[i]]]).val < 0)
                continue;
            if (node.val < code) {
                result.push(node.val);
            }
            else if (node.val === code) {
                const search = src.slice(i + 1, i + 1 + v0).map((v, s) => v << s).reduce((a, b) => a + b);
                i += v0;
                const length = src.slice(i + 1, i + 1 + v1).map((v, s) => v << s).reduce((a, b) => a + b);
                i += v1;
                for (let j = 0; j < length; j++) {
                    result.push(result[result.length - search]);
                }
            }
            node = nodes[0];
        }
        return result;
    }
    /**
     * The fixed huffman table used for the occupancy stream.
     *
     * @param escape the weight given to the LZSS escape code; the old mog format used 2^7 here
     */
    function table256(escape = Math.pow(2, 8)) {
        const nodes = [];
        for (let i = 0; i < 256; i++) {
            const sum = [...new Array(7).keys()].map(s => ((i >> s) ^ (i >> (s + 1))) & 1).reduce((a, b) => a + b);
            nodes.push({ cnt: Math.pow(2, (7 - sum)), parent: null });
        }
        nodes.push({ cnt: escape, parent: null });
        for (let i = 0; i < 256 + 1 - 1; i++) {
            const node = { cnt: 0, parent: null };
            for (let j = 0; j < 2; j++) {
                const select = nodes.reduce((a, b) => (a.parent !== null || (b.parent === null && b.cnt < a.cnt)) ? b : a);
                node.cnt += select.cnt;
                select.parent = node;
            }
            nodes.push(node);
        }
        const lngs = new Array(256 + 1).fill(0);
        for (let i = 0; i < 256 + 1; i++) {
            let node = nodes[i];
            while (node = node.parent) {
                lngs[i]++;
            }
        }
        return hmMakeTableFromLngs(lngs);
    }

    class Vec3 {
        constructor(x, y, z) {
            this.x = x;
            this.y = y;
            this.z = z;
        }
        length() {
            return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
        }
        array() {
            return [this.x, this.y, this.z];
        }
        static add(vec0, vec1) {
            return new Vec3(vec0.x + vec1.x, vec0.y + vec1.y, vec0.z + vec1.z);
        }
        static sub(vec0, vec1) {
            return new Vec3(vec0.x - vec1.x, vec0.y - vec1.y, vec0.z - vec1.z);
        }
        static mul(vec0, scale) {
            return new Vec3(vec0.x * scale, vec0.y * scale, vec0.z * scale);
        }
        static dot(vec0, vec1) {
            return vec0.x * vec1.x + vec0.y * vec1.y + vec0.z * vec1.z;
        }
    }

    class Model {
        constructor(name, size) {
            this.name = name;
            this.indices = new Int32Array(size);
            this.vertexs = new Float32Array(size * 3);
            this.normals = new Float32Array(size * 3);
            this.coords = new Float32Array(size * 2);
            this.colors = new Int8Array(size * 3);
        }
    }
    class Bone {
        constructor(parent, name, vec0, vec1, refs) {
            this.parent = parent;
            this.name = name;
            this.refs = refs;
            this.vec0 = vec0;
            this.vec1 = vec1;
        }
        offset() {
            let position = new Vec3(0.0, 0.0, 0.0);
            let bone = this;
            while (bone.parent) {
                position = Vec3.add(position, bone.parent.vec0);
                position = Vec3.add(position, bone.parent.vec1);
                bone = bone.parent;
            }
            return position;
        }
        distance(vec) {
            const vec0 = Vec3.add(this.offset(), this.vec0);
            const vec1 = Vec3.add(vec0, this.vec1);
            const line = Vec3.sub(vec1, vec0);
            const a = Vec3.sub(vec, vec0);
            const b = Vec3.sub(vec, vec1);
            const s = Vec3.dot(line, a) / (line.length() * line.length());
            let result;
            if (s < 0.0 || s > 1.0) {
                result = s < 0.0 ? a : b;
            }
            else {
                result = Vec3.sub(vec, Vec3.add(vec0, Vec3.mul(line, s)));
            }
            return result.length();
        }
    }

    /**
     * What was written before meta could be given, and what a model without any
     * gets: the narrowest terms VRM offers.
     */
    const DEFAULT_VRM_META = {
        name: 'model',
        version: '1.0',
        authors: ['Author'],
        allowAntisocialOrHateUsage: false,
        allowExcessivelySexualUsage: false,
        allowExcessivelyViolentUsage: false,
        allowPoliticalOrReligiousUsage: false,
        avatarPermission: 'onlyAuthor',
        commercialUsage: 'personalNonProfit',
        creditNotation: 'required',
        modification: 'prohibited',
        licenseUrl: 'https://vrm.dev/licenses/1.0/',
    };
    const CHOICES = {
        avatarPermission: ['onlyAuthor', 'onlySeparatelyLicensedPerson', 'everyone'],
        commercialUsage: ['personalNonProfit', 'personalProfit', 'corporation'],
        creditNotation: ['required', 'unnecessary'],
        modification: ['prohibited', 'allowModification', 'allowModificationRedistribution'],
    };
    const TEXTS = ['name', 'version', 'copyrightInformation', 'contactInformation', 'thirdPartyLicenses', 'licenseUrl', 'otherLicenseUrl'];
    const LISTS = ['authors', 'references'];
    const FLAGS = [
        'allowExcessivelyViolentUsage',
        'allowExcessivelySexualUsage',
        'allowPoliticalOrReligiousUsage',
        'allowAntisocialOrHateUsage',
        'allowRedistribution',
    ];
    /**
     * Keeps only the VRM meta keys whose values have the right shape. Anything
     * else — unknown keys, a choice VRM does not define, an empty string or list,
     * a flag that is not a boolean — is dropped, so it falls back to whatever the
     * meta is merged onto instead of ending up in the file.
     */
    function pickVRMMeta(raw) {
        if (raw === null || typeof raw !== 'object')
            return {};
        const source = raw;
        const meta = {};
        for (const key of TEXTS) {
            const value = source[key];
            if (typeof value === 'string' && value !== '')
                meta[key] = value;
        }
        for (const key of LISTS) {
            const value = source[key];
            if (Array.isArray(value)) {
                const items = value.filter((item) => typeof item === 'string' && item !== '');
                if (items.length > 0)
                    meta[key] = items;
            }
        }
        for (const key of FLAGS) {
            if (typeof source[key] === 'boolean')
                meta[key] = source[key];
        }
        for (const [key, choices] of Object.entries(CHOICES)) {
            if (choices.includes(source[key]))
                meta[key] = source[key];
        }
        return meta;
    }
    /**
     * The meta written into a VRM: the defaults, then each given layer over the
     * previous one (typically the `.mog`'s own meta, then what the caller passes).
     */
    function buildVRMMeta(...layers) {
        return layers.reduce((meta, layer) => (Object.assign(Object.assign({}, meta), pickVRMMeta(layer))), Object.assign({}, DEFAULT_VRM_META));
    }

    /** face index: 0:-x 1:+x 2:-y 3:+y 4:-z 5:+z (opposite face is `index ^ 1`) */
    const FACE_DIRS = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];
    /** in-plane axes (u, v) of each face, as face indices. cross(u, v) equals the face normal */
    const FACE_AXES = [[5, 3], [3, 5], [1, 5], [5, 1], [3, 1], [1, 3]];
    /** the 12 edges of a voxel, as pairs of perpendicular faces */
    const EDGE_PAIRS = [
        [0, 2], [0, 3], [0, 4], [0, 5], [1, 2], [1, 3],
        [1, 4], [1, 5], [2, 4], [2, 5], [3, 4], [3, 5],
    ];
    /** the 8 corners of a voxel, as triples of perpendicular faces */
    const CORNER_TRIPLES = [
        [0, 2, 4], [0, 2, 5], [0, 3, 4], [0, 3, 5],
        [1, 2, 4], [1, 2, 5], [1, 3, 4], [1, 3, 5],
    ];
    function cross(vec0, vec1) {
        return [
            vec0[1] * vec1[2] - vec0[2] * vec1[1],
            vec0[2] * vec1[0] - vec0[0] * vec1[2],
            vec0[0] * vec1[1] - vec0[1] * vec1[0],
        ];
    }
    function dot(vec0, vec1) {
        return vec0[0] * vec1[0] + vec0[1] * vec1[1] + vec0[2] * vec1[2];
    }
    function unit(vec) {
        const length = Math.sqrt(dot(vec, vec));
        return [vec[0] / length, vec[1] / length, vec[2] / length];
    }
    /** a vector of the given length pointing somewhere at random */
    function displacement(length) {
        if (length <= 0)
            return [0, 0, 0];
        // a direction drawn evenly over the sphere
        const z = Math.random() * 2 - 1;
        const angle = Math.random() * 2 * Math.PI;
        const r = Math.sqrt(1 - z * z);
        return [r * Math.cos(angle) * length, r * Math.sin(angle) * length, z * length];
    }
    function parseMOG(blob_1, scale_1) {
        return __awaiter(this, arguments, void 0, function* (blob, scale, chamfer = 0.0, jitter = 0.0) {
            var _a;
            const text = yield blob.text();
            const json = JSON.parse(text);
            const composits = [];
            const dsize = json.dsize;
            const s = (scale !== null ? scale : (dsize[1] / 32 * 20)) * 0.001;
            const palette = Uint8Array.from(atob(json.palette), c => c.charCodeAt(0));
            const models = json.layers.map((jsonlayer) => {
                return decode(dsize, palette, jsonlayer.name, jsonlayer.data, s, chamfer, jitter);
            });
            const bones = [];
            for (const jsonbone of ((_a = json.bones) !== null && _a !== void 0 ? _a : [])) {
                const parent = jsonbone.parent >= 0 ? bones[jsonbone.parent] : null;
                const vec0 = Vec3.mul(new Vec3(jsonbone.vector[0], jsonbone.vector[1], jsonbone.vector[2]), s);
                const vec1 = Vec3.mul(new Vec3(jsonbone.vector[3], jsonbone.vector[4], jsonbone.vector[5]), s);
                bones.push(new Bone(parent, jsonbone.name, vec0, vec1, jsonbone.layers));
            }
            // `meta` (VRM meta) is optional, and so is every key in it
            composits.push({ models, bones, dsize, meta: pickVRMMeta(json.meta) });
            return composits;
        });
    }
    function decode(dsize, palette, name, data, scale, chamfer, jitter = 0.0) {
        const { gmap, cmap } = decodeGrid(dsize, data);
        return buildModel(name, dsize, gmap, cmap, palette, scale, chamfer, jitter);
    }
    /**
     * Expands the compressed layer data into an occupancy map (bit 0x40) and a palette index map.
     */
    function decodeGrid(dsize, data) {
        const gmap = new Uint8Array(dsize[0] * dsize[1] * dsize[2]).fill(0);
        const cmap = new Uint8Array(dsize[0] * dsize[1] * dsize[2]).fill(0);
        const mapbin = Uint8Array.from(atob(data), c => c.charCodeAt(0));
        if (mapbin.length == 0)
            return { gmap, cmap };
        const memA = segment(mapbin, 0, true);
        const memB = zlDecode(table256(), segment(mapbin, 1, true), 256, 8, 8);
        const PALETTE_CODE = 256;
        const sag = segment(mapbin, 2);
        const lngs = new Array(PALETTE_CODE + 1).fill(0);
        for (let c = 0; c < sag.length - 1; c += 2) {
            lngs[sag[c + 0]] = sag[c + 1];
        }
        lngs[PALETTE_CODE] = sag[sag.length - 1];
        const memC = zlDecode(hmMakeTableFromLngs(lngs), segment(mapbin, 3, true), PALETTE_CODE, 8, 8);
        let [a, b, c] = [0, 0, 0];
        for (let z = 0; z < Math.ceil(dsize[2] / 8); z++) {
            for (let y = 0; y < Math.ceil(dsize[1] / 8); y++) {
                for (let x = 0; x < Math.ceil(dsize[0] / 8); x++) {
                    if (memA[a++] === 0)
                        continue;
                    for (let iz = 0; iz < Math.min(8, dsize[2] - 8 * z); iz++) {
                        for (let iy = 0; iy < Math.min(8, dsize[1] - 8 * y); iy++) {
                            for (let ix = 0; ix < Math.min(8, dsize[0] - 8 * x); ix++) {
                                if ((memB[b + iz * 8 + iy] >> ix & 1) === 0)
                                    continue;
                                const p = (z * 8 + iz) * dsize[0] * dsize[1] + (y * 8 + iy) * dsize[0] + (x * 8 + ix);
                                gmap[p] = 0x40;
                                cmap[p] = memC[c++];
                            }
                        }
                    }
                    b += 8 * 8;
                }
            }
        }
        return { gmap, cmap };
    }
    /**
     * Builds the surface mesh of a voxel grid.
     *
     * `chamfer` is the bevel width as a ratio of the voxel size (0.0 disables it).
     * Edges are beveled only where the model as a whole is convex there, so a flat
     * run of voxels stays flat instead of every voxel being beveled on its own.
     *
     * `jitter` moves the whole model by that ratio of the voxel size, in a
     * direction drawn at random (0.0 disables it). A model is meshed one layer at
     * a time, so where two layers touch both of them emit the shared face and the
     * two land on exactly the same plane, fighting over which one is drawn. One
     * displacement per call — that is, per layer — is enough to separate them.
     *
     * It is a single offset rather than per-vertex noise on purpose: every vertex
     * of the layer moves by the same amount, so the surface stays as watertight and
     * as straight-edged as it was built. The direction is random but the distance
     * is exactly `jitter`, so no layer is left where it was.
     *
     * @param gmap occupancy map (bit 0x40 marks a filled voxel)
     * @param cmap palette index per voxel
     */
    function buildModel(name, dsize, gmap, cmap, palette, scale, chamfer = 0.0, jitter = 0.0) {
        const half = scale / 2;
        const width = Math.min(Math.max(chamfer, 0.0), 0.5) * scale;
        const noise = Math.max(jitter, 0.0) * scale;
        const solid = (x, y, z) => {
            if (x < 0 || y < 0 || z < 0 || x >= dsize[0] || y >= dsize[1] || z >= dsize[2])
                return false;
            return (gmap[z * dsize[0] * dsize[1] + y * dsize[0] + x] & 0x40) !== 0;
        };
        /** whether the voxel edge shared by faces `i` and `j` is a convex edge of the model */
        const convex = (x, y, z, i, j) => {
            const [di, dj] = [FACE_DIRS[i], FACE_DIRS[j]];
            return !solid(x + di[0], y + di[1], z + di[2])
                && !solid(x + dj[0], y + dj[1], z + dj[2])
                && !solid(x + di[0] + dj[0], y + di[1] + dj[1], z + di[2] + dj[2]);
        };
        const beveled = new Array(6 * 6).fill(false);
        /**
         * Walks every surface element of the grid: exposed faces, convex edges, convex corners
         * and the seams where a neighbour bevels an edge that this voxel does not.
         * It is run twice, first to count the vertices and then to fill the buffers.
         */
        const traverse = (onFace, onEdge, onCorner, onSeam) => {
            for (let z = 0; z < dsize[2]; z++) {
                for (let y = 0; y < dsize[1]; y++) {
                    for (let x = 0; x < dsize[0]; x++) {
                        const p = z * dsize[0] * dsize[1] + y * dsize[0] + x;
                        if ((gmap[p] & 0x40) === 0)
                            continue;
                        for (let i = 0; i < 6; i++) {
                            const d = FACE_DIRS[i];
                            if (!solid(x + d[0], y + d[1], z + d[2]))
                                onFace(x, y, z, p, i);
                        }
                        if (width <= 0.0)
                            continue;
                        for (const [i, j] of EDGE_PAIRS) {
                            const cut = convex(x, y, z, i, j);
                            beveled[i * 6 + j] = beveled[j * 6 + i] = cut;
                            if (cut)
                                onEdge(x, y, z, p, i, j);
                        }
                        for (const [i, j, k] of CORNER_TRIPLES) {
                            if (beveled[i * 6 + j] && beveled[i * 6 + k] && beveled[j * 6 + k])
                                onCorner(x, y, z, p, i, j, k);
                        }
                        // A bevel is cut out of both voxels sharing the edge. Where the neighbour bevels
                        // an edge that this voxel keeps sharp (a step in the surface), the neighbour's cut
                        // uncovers a triangle of this voxel's shared face, which has to be filled in.
                        for (let k = 0; k < 6; k++) {
                            const d = FACE_DIRS[k];
                            const [nx, ny, nz] = [x + d[0], y + d[1], z + d[2]];
                            if (!solid(nx, ny, nz))
                                continue;
                            const [u, v] = FACE_AXES[k];
                            for (const i of [u, u ^ 1]) {
                                for (const j of [v, v ^ 1]) {
                                    if (!beveled[i * 6 + j] && convex(nx, ny, nz, i, j))
                                        onSeam(x, y, z, p, i, j, k);
                                }
                            }
                        }
                    }
                }
            }
        };
        let [faces, edges, corners, seams] = [0, 0, 0, 0];
        traverse(() => { faces++; }, () => { edges++; }, () => { corners++; }, () => { seams++; });
        const model = new Model(name, faces * 6 + edges * 6 + corners * 3 + seams * 3);
        /**
         * A corner of face `i`, pulled inward along its two side directions `du` / `dv`
         * by the bevel width, but only on the sides where the model is convex.
         */
        const corner = (x, y, z, i, du, dv) => {
            const inset = (d) => convex(x, y, z, i, d) ? width : 0.0;
            const [su, sv] = [half - inset(du), half - inset(dv)];
            const [n, u, v] = [FACE_DIRS[i], FACE_DIRS[du], FACE_DIRS[dv]];
            return [
                (x + 0.5 - dsize[0] / 2) * scale + half * n[0] + su * u[0] + sv * v[0],
                (y + 0.5) * scale + half * n[1] + su * u[1] + sv * v[1],
                (z + 0.5 - dsize[2] / 2) * scale + half * n[2] + su * u[2] + sv * v[2],
            ];
        };
        /** an uncut corner of the voxel, in the three given directions */
        const vertex = (x, y, z, i, j, k) => {
            const [di, dj, dk] = [FACE_DIRS[i], FACE_DIRS[j], FACE_DIRS[k]];
            return [
                (x + 0.5 - dsize[0] / 2) * scale + half * (di[0] + dj[0] + dk[0]),
                (y + 0.5) * scale + half * (di[1] + dj[1] + dk[1]),
                (z + 0.5 - dsize[2] / 2) * scale + half * (di[2] + dj[2] + dk[2]),
            ];
        };
        /** the two corners of face `i` along its edge with face `j`, ordered low to high along `e` */
        const edgeCorners = (x, y, z, i, j, e) => {
            const [u, v] = FACE_AXES[i];
            const free = (u >> 1) === (j >> 1) ? v : u;
            const low = dot(FACE_DIRS[free], e) < 0 ? free : free ^ 1;
            return [corner(x, y, z, i, j, low), corner(x, y, z, i, j, low ^ 1)];
        };
        // One displacement for the whole model, in a random direction. buildModel()
        // is called once per layer, so this moves the layers apart from each other
        // while the surface within a layer stays exactly as it was built.
        const shift = displacement(noise);
        let vp = 0;
        const emit = (points, normal, p) => {
            const c = cmap[p];
            const color = [palette[c * 4 + 0], palette[c * 4 + 1], palette[c * 4 + 2]];
            for (const point of points) {
                model.indices[vp] = vp;
                model.vertexs[vp * 3 + 0] = point[0] + shift[0];
                model.vertexs[vp * 3 + 1] = point[1] + shift[1];
                model.vertexs[vp * 3 + 2] = point[2] + shift[2];
                // the normal is left alone: the whole model moves as one, so no
                // face changes the way it is turned
                model.normals.set(normal, vp * 3);
                model.colors.set(color, vp * 3);
                vp++;
            }
        };
        /** a quad given as [c00, c10, c01, c11], wound so that cross(c10 - c00, c01 - c00) points outward */
        const quad = (c00, c10, c01, c11, normal, p) => {
            emit([c00, c10, c01, c11, c01, c10], normal, p);
        };
        traverse((x, y, z, p, i) => {
            const [u, v] = FACE_AXES[i];
            quad(corner(x, y, z, i, u ^ 1, v ^ 1), corner(x, y, z, i, u, v ^ 1), corner(x, y, z, i, u ^ 1, v), corner(x, y, z, i, u, v), FACE_DIRS[i], p);
        }, (x, y, z, p, i, j) => {
            const e = cross(FACE_DIRS[i], FACE_DIRS[j]);
            const [i0, i1] = edgeCorners(x, y, z, i, j, e);
            const [j0, j1] = edgeCorners(x, y, z, j, i, e);
            const [di, dj] = [FACE_DIRS[i], FACE_DIRS[j]];
            quad(i0, j0, i1, j1, unit([di[0] + dj[0], di[1] + dj[1], di[2] + dj[2]]), p);
        }, (x, y, z, p, i, j, k) => {
            const [di, dj, dk] = [FACE_DIRS[i], FACE_DIRS[j], FACE_DIRS[k]];
            const points = [corner(x, y, z, i, j, k), corner(x, y, z, j, i, k), corner(x, y, z, k, i, j)];
            const normal = unit([di[0] + dj[0] + dk[0], di[1] + dj[1] + dk[1], di[2] + dj[2] + dk[2]]);
            emit(dot(cross(di, dj), dk) > 0 ? points : [points[0], points[2], points[1]], normal, p);
        }, (x, y, z, p, i, j, k) => {
            const [di, dj, dk] = [FACE_DIRS[i], FACE_DIRS[j], FACE_DIRS[k]];
            const base = vertex(x, y, z, i, j, k);
            const points = [
                base,
                [base[0] - width * di[0], base[1] - width * di[1], base[2] - width * di[2]],
                [base[0] - width * dj[0], base[1] - width * dj[1], base[2] - width * dj[2]],
            ];
            emit(dot(cross(di, dj), dk) > 0 ? points : [points[0], points[2], points[1]], dk, p);
        });
        return model;
    }

    /** `(name)` opens a text node, `{name}` a binary node and `[name]` an object node */
    const OPENERS = { 0x28: 'txt', 0x7b: 'bin', 0x5b: 'obj' };
    const CLOSERS = [0x29, 0x7d, 0x5d];
    const NEWLINE = 0x0a;
    const COMMA = 0x2c;
    function ascii(bin, start, end) {
        let text = '';
        for (let i = start; i < end; i++) {
            if (bin[i] !== 0x0d)
                text += String.fromCharCode(bin[i]);
        }
        return text;
    }
    /**
     * Builds the node tree. Nesting is given by the indent of each line, so a node
     * indented by `n` spaces is a child of the most recent node indented by `n - 1`.
     */
    function parseSpio(bin) {
        const root = { name: '', type: 'obj', text: '', data: new Uint8Array(0), children: [] };
        const parents = [root];
        let i = 0;
        while (i < bin.length) {
            let pos = i;
            while (pos < bin.length && OPENERS[bin[pos]] === undefined)
                pos++;
            if (pos >= bin.length)
                break;
            const indent = pos - i;
            const type = OPENERS[bin[pos]];
            pos++;
            const npos = pos;
            while (pos < bin.length && CLOSERS.indexOf(bin[pos]) < 0)
                pos++;
            const node = { name: ascii(bin, npos, pos), type, text: '', data: new Uint8Array(0), children: [] };
            pos++;
            const spos = pos;
            if (type === 'bin') {
                while (pos < bin.length && bin[pos] !== COMMA)
                    pos++;
                const size = Math.max(0, parseInt(ascii(bin, spos, pos), 10) || 0);
                pos++;
                node.data = bin.slice(pos, pos + size);
                pos += size + 1;
            }
            else {
                while (pos < bin.length && bin[pos] !== NEWLINE)
                    pos++;
                if (type === 'txt')
                    node.text = ascii(bin, spos, pos);
                pos++;
            }
            parents[Math.min(indent, parents.length - 1)].children.push(node);
            parents[Math.min(indent, parents.length - 1) + 1] = node;
            i = pos;
        }
        return root;
    }
    function childs(node, name) {
        return node.children.filter(child => child.name === name);
    }
    function child(node, name) {
        var _a;
        return node ? ((_a = childs(node, name)[0]) !== null && _a !== void 0 ? _a : null) : null;
    }
    /** the comma separated elements of a text node */
    function texts(node) {
        return (node && node.text.length > 0) ? node.text.split(',') : [];
    }
    function numbers(node) {
        return texts(node).map(text => Number(text) || 0);
    }
    /** sequential reader over a binary node */
    class Cursor {
        constructor(bin) {
            this.bin = bin;
            this.pos = 0;
        }
        get rest() {
            return this.bin.length - this.pos;
        }
        int32() {
            const view = new DataView(this.bin.buffer, this.bin.byteOffset, this.bin.byteLength);
            const value = this.rest >= 4 ? view.getInt32(this.pos, true) : 0;
            this.pos += 4;
            return value;
        }
        byte() {
            var _a;
            return (_a = this.bin[this.pos++]) !== null && _a !== void 0 ? _a : 0;
        }
        bytes(size) {
            const dst = this.bin.slice(this.pos, this.pos + size);
            this.pos += size;
            return dst;
        }
    }
    /** a block is stored as a byte count plus the number of padding bits in its last byte */
    function readBits(cursor) {
        const size = Math.max(0, cursor.int32());
        const padding = cursor.byte();
        const data = cursor.bytes(size);
        const bits = Math.max(0, size * 8 - padding);
        return Uint8Array.from({ length: bits }, (_, i) => (data[i >> 3] >> (i % 8)) & 1);
    }
    /** whether the 8x8x8 block at `base` overlaps `rect` */
    function overlaps(rect, base, step) {
        for (let i = 0; i < 3; i++) {
            const low = Math.max(rect.dbase[i], base[i]);
            const high = Math.min(rect.dbase[i] + rect.dsize[i], base[i] + step);
            if (high - low <= 0)
                return false;
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
    function decodeMaps(dsize, rect, memA, memB, memC) {
        var _a, _b;
        const step = 8;
        const gmap = new Uint8Array(dsize[0] * dsize[1] * dsize[2]).fill(0);
        const cmap = new Uint8Array(dsize[0] * dsize[1] * dsize[2]).fill(0);
        let [a, b, c] = [0, 0, 0];
        for (let z = 0; z < Math.ceil(dsize[2] / step); z++) {
            for (let y = 0; y < Math.ceil(dsize[1] / step); y++) {
                for (let x = 0; x < Math.ceil(dsize[0] / step); x++) {
                    if (overlaps(rect, [x * step, y * step, z * step], step) === false)
                        continue;
                    const filled = (memA[a >> 3] >> (a % 8)) & 1;
                    a++;
                    if (filled === 0)
                        continue;
                    let bits = 0;
                    for (let iz = 0; iz < step; iz++) {
                        for (let iy = 0; iy < step; iy++) {
                            for (let ix = 0; ix < step; ix++) {
                                if (ix === 0)
                                    bits = (_a = memB[b++]) !== null && _a !== void 0 ? _a : 0;
                                const [vx, vy, vz] = [x * step + ix, y * step + iy, z * step + iz];
                                if (vx >= dsize[0] || vy >= dsize[1] || vz >= dsize[2])
                                    continue;
                                if ((bits >> ix & 1) === 0)
                                    continue;
                                const p = vz * dsize[0] * dsize[1] + vy * dsize[0] + vx;
                                gmap[p] = 0x40;
                                // a short memC means a single color for the whole layer, so the index is clamped
                                cmap[p] = Math.max(0, (_b = memC[Math.min(c, memC.length - 1)]) !== null && _b !== void 0 ? _b : 0);
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
    function decodeVmap(node) {
        const cursor = new Cursor(node.data);
        const size = Math.max(0, cursor.int32());
        cursor.byte();
        const memA = cursor.bytes(size);
        const bits = readBits(cursor);
        // the old format weights the escape code as 2^7 rather than the 2^8 the current one uses
        const memB = bits.length > 0 ? zlDecode(table256(Math.pow(2, 7)), bits, 256, 8, 8) : [];
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
    function decodeCmap(node, legacy) {
        const cursor = new Cursor(node.data);
        const size = Math.max(0, cursor.int32());
        const padding = cursor.byte();
        const lngs = new Array(PALETTE_CODE + 1).fill(0);
        if (legacy === true) {
            for (let c = 0; c < size; c++) {
                lngs[cursor.byte()] = cursor.byte();
            }
            lngs[PALETTE_CODE] = padding;
        }
        else {
            if (size <= 1)
                return [cursor.byte()];
            for (let c = 0; c < size - 1; c += 2) {
                lngs[cursor.byte()] = cursor.byte();
            }
            lngs[PALETTE_CODE] = cursor.byte();
        }
        const bits = readBits(cursor);
        return bits.length > 0 ? zlDecode(hmMakeTableFromLngs(lngs), bits, PALETTE_CODE, 8, 8) : [];
    }
    /** the palette, padded with white up to the full 256 entries as the editor does */
    function parsePalette(node) {
        var _a;
        const palette = new Uint8Array(256 * 4).fill(255);
        if (node === null)
            return palette;
        if (node.type === 'obj') {
            const size = (_a = numbers(child(node, 'size'))[0]) !== null && _a !== void 0 ? _a : 0;
            const cols = child(node, 'cols');
            if (cols === null || size <= 0)
                return palette;
            const stride = (cols.data.length / size === 3) ? 3 : 4;
            for (let c = 0; c < size; c++) {
                for (let i = 0; i < 3; i++) {
                    palette[c * 4 + i] = cols.data[c * stride + i];
                }
                palette[c * 4 + 3] = (stride === 4) ? cols.data[c * 4 + 3] : 255;
            }
        }
        else {
            palette.set(node.data.slice(0, Math.floor(node.data.length / 4) * 4));
        }
        return palette;
    }
    /** the bone names the editor used before it moved to the VRM humanoid ones */
    const BONE_NAMES = {
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
    /**
     * Reads the armature and brings it to the layout the current format stores.
     *
     * The old files place the hips at the pelvis and measure it from the center of the
     * grid, while the new ones start it at the ground and measure it from the bottom,
     * so the root and the legs are rebased here the same way the editor does on import.
     */
    function parseBones(node, dsize, scale) {
        const raws = childs(node, 'bone').map((n, b) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
            const label = (_b = (_a = child(n, 'name')) === null || _a === void 0 ? void 0 : _a.text) !== null && _b !== void 0 ? _b : '';
            const name = (_c = BONE_NAMES[label]) !== null && _c !== void 0 ? _c : label;
            const vecs = numbers(child(n, 'vecs'));
            const vec0 = [(_d = vecs[0]) !== null && _d !== void 0 ? _d : 0, (_e = vecs[1]) !== null && _e !== void 0 ? _e : 0, (_f = vecs[2]) !== null && _f !== void 0 ? _f : 0];
            const vec1 = [(_g = vecs[3]) !== null && _g !== void 0 ? _g : 0, (_h = vecs[4]) !== null && _h !== void 0 ? _h : 0, (_j = vecs[5]) !== null && _j !== void 0 ? _j : 0];
            // the root gained a unit of length, and the hips/spine joint moved down by one
            if (b === 0)
                vec1[1] += 1.0;
            if (name === 'leftUpperLeg' || name === 'rightUpperLeg')
                vec0[1] -= 1.0;
            if (name === 'spine')
                vec1[1] -= 1.0;
            return { name, link: (_k = numbers(child(n, 'link'))[0]) !== null && _k !== void 0 ? _k : -1, layers: numbers(child(n, 'refs')), vec0, vec1 };
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
        const bones = [];
        for (const raw of raws) {
            const parent = (raw.link >= 0 && raw.link < bones.length) ? bones[raw.link] : null;
            const vec0 = Vec3.mul(new Vec3(raw.vec0[0], raw.vec0[1], raw.vec0[2]), scale);
            const vec1 = Vec3.mul(new Vec3(raw.vec1[0], raw.vec1[1], raw.vec1[2]), scale);
            bones.push(new Bone(parent, raw.name, vec0, vec1, raw.layers));
        }
        return bones;
    }
    function parseUnit(node, version, scale, chamfer, jitter) {
        var _a, _b, _c, _d;
        const size = numbers(child(node, 'size'));
        let dsize = [(_a = size[0]) !== null && _a !== void 0 ? _a : 0, (_b = size[1]) !== null && _b !== void 0 ? _b : 0, (_c = size[2]) !== null && _c !== void 0 ? _c : 0];
        const s = (scale !== null ? scale : (dsize[1] / 32 * 20)) * 0.001;
        const palette = parsePalette((_d = child(node, 'palette')) !== null && _d !== void 0 ? _d : child(node, 'color'));
        // a layer may carry its own size; the composit follows the first one, as the current format does
        let base = dsize;
        const models = childs(node, 'model').map((n, m) => {
            var _a, _b, _c;
            const rect = { dbase: [0, 0, 0], dsize: [dsize[0], dsize[1], dsize[2]] };
            const msize = numbers(child(n, 'size'));
            if (msize.length >= 3)
                dsize = [msize[0], msize[1], msize[2]];
            if (m === 0)
                base = dsize;
            const mrect = numbers(child(n, 'rect'));
            if (mrect.length >= 6) {
                rect.dbase = [mrect[0], mrect[1], mrect[2]];
                rect.dsize = [mrect[3], mrect[4], mrect[5]];
            }
            const name = (_b = (_a = child(n, 'name')) === null || _a === void 0 ? void 0 : _a.text) !== null && _b !== void 0 ? _b : '';
            const vmap = (_c = child(n, 'bin0')) !== null && _c !== void 0 ? _c : child(n, 'vmap');
            const legacy = child(n, 'bin1') !== null;
            const cmap = legacy ? child(n, 'bin1') : child(n, 'cmap');
            if (vmap === null) {
                const empty = new Uint8Array(dsize[0] * dsize[1] * dsize[2]);
                return buildModel(name, dsize, empty, empty, palette, s, chamfer, jitter);
            }
            const { memA, memB } = decodeVmap(vmap);
            const memC = cmap !== null ? decodeCmap(cmap, legacy) : [];
            const { gmap, cmap: indices } = decodeMaps(dsize, rect, memA, memB, memC);
            return buildModel(name, dsize, gmap, indices, palette, s, chamfer, jitter);
        });
        const bones = (version === '0.3' || version === '1.0') ? parseBones(node, base, s) : [];
        return { models, bones, dsize: base };
    }
    function parseMOGOld(blob_1, scale_1) {
        return __awaiter(this, arguments, void 0, function* (blob, scale, chamfer = 0.0, jitter = 0.0) {
            var _a, _b;
            const root = parseSpio(new Uint8Array(yield blob.arrayBuffer()));
            const version = (_b = (_a = child(root, '.mog')) === null || _a === void 0 ? void 0 : _a.text) !== null && _b !== void 0 ? _b : '';
            return childs(root, 'unit').map(node => parseUnit(node, version, scale, chamfer, jitter));
        });
    }

    function convertVRM(models_1, bones_1) {
        return __awaiter(this, arguments, void 0, function* (models, bones, meta = buildVRMMeta()) {
            const size = models.reduce((a, b) => a + b.indices.length, 0);
            const model = new Model('composit', size);
            const joints = []; // unsigned short x4
            const weights = []; // float x4
            const invmats = []; // float x16
            for (let i = 0; i < models.length; i++) {
                const layer = models[i];
                const offset = models.slice(0, i).reduce((a, b) => a + b.indices.length, 0);
                model.indices.set(layer.indices.map(v => v + offset), offset);
                model.vertexs.set(layer.vertexs, offset * 3);
                model.normals.set(layer.normals, offset * 3);
                model.colors.set(layer.colors, offset * 3);
                if (bones.length === 0)
                    continue;
                const mask = [...new Array(bones.length).keys()]
                    .map(j => bones[j].refs.length == 0 || bones[j].refs.some(ref => ref === i));
                for (let j = 0; j < layer.indices.length; j++) {
                    let [nid0, nid1] = [-1, -1];
                    let [min0, min1] = [1000, 1000];
                    let wei = 1.0;
                    {
                        for (let k = 1; k < bones.length; k++) {
                            if (mask[k]) {
                                const vec = new Vec3(layer.vertexs[j * 3 + 0], layer.vertexs[j * 3 + 1], layer.vertexs[j * 3 + 2]);
                                const l = bones[k].distance(vec);
                                if (l < min0) {
                                    min0 = l;
                                    nid0 = k;
                                }
                            }
                        }
                    }
                    if (nid0 >= 0) {
                        min1 = min0 * 2.0;
                        for (let k = 1; k < bones.length; k++) {
                            if (k !== nid0 && mask[k]) {
                                if (bones[nid0].name.indexOf('left') === 0 && bones[k].name.indexOf('right') === 0)
                                    continue;
                                if (bones[nid0].name.indexOf('right') === 0 && bones[k].name.indexOf('left') === 0)
                                    continue;
                                const vec = new Vec3(layer.vertexs[j * 3 + 0], layer.vertexs[j * 3 + 1], layer.vertexs[j * 3 + 2]);
                                const l = bones[k].distance(vec);
                                if (l < min1) {
                                    min1 = l;
                                    nid1 = k;
                                    wei = (2 * min0 - min1) / (2 * min0 + 0.001);
                                    wei = Math.sqrt(1.0 - wei);
                                }
                            }
                        }
                    }
                    joints.push(nid0 >= 0 ? nid0 : 0, nid1 >= 0 ? nid1 : 0, 0, 0);
                    weights.push(wei, 1.0 - wei, 0, 0);
                }
            }
            for (let i = 0; i < bones.length; i++) {
                const bone = bones[i];
                const t = Vec3.add(bone.offset(), bone.vec0);
                invmats.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -t.x, -t.y, -t.z, 1);
            }
            const width = 1024;
            const height = Math.pow(2, Math.ceil(Math.log2((model.colors.length / 3 + width - 1) / width))) >> 0;
            const imgdata = new Uint8Array(width * height * 4);
            for (let i = 0; i < model.colors.length / 3; i++) {
                const s = ((width / 6) >> 0) * 6; // align 6 (2 triangles)
                const [x, y] = [i % s, (i / s) >> 0];
                imgdata[(y * width + (x + 0)) * 4 + 0] = model.colors[i * 3 + 0];
                imgdata[(y * width + (x + 0)) * 4 + 1] = model.colors[i * 3 + 1];
                imgdata[(y * width + (x + 0)) * 4 + 2] = model.colors[i * 3 + 2];
                imgdata[(y * width + (x + 0)) * 4 + 3] = 255;
                model.coords.set([(x + 0.5) / width, (y + 0.5) / height], i * 2);
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx)
                throw new Error('Could not get 2d context');
            ctx.putImageData(new ImageData(new Uint8ClampedArray(imgdata), width, height), 0, 0);
            const pngdata = yield new Promise((resolve) => {
                canvas.toBlob((blob) => {
                    if (!blob)
                        throw new Error('Could not create blob');
                    blob.arrayBuffer().then(buffer => { resolve(new Uint8Array(buffer)); });
                }, 'image/png');
            });
            let binSize = 0;
            binSize += model.indices.length * 4;
            binSize += model.vertexs.length * 4;
            binSize += model.normals.length * 4;
            binSize += model.coords.length * 4;
            binSize += joints.length * 2;
            binSize += weights.length * 4;
            binSize += invmats.length * 4;
            binSize += pngdata.length;
            binSize = Math.ceil(binSize / 4) * 4;
            const binBuffer = new Uint8Array(binSize);
            {
                const view = new DataView(binBuffer.buffer);
                let offset = 0;
                model.indices.forEach(v => { view.setInt32(offset, v, true); offset += 4; });
                model.vertexs.forEach(v => { view.setFloat32(offset, v, true); offset += 4; });
                model.normals.forEach(v => { view.setFloat32(offset, v, true); offset += 4; });
                model.coords.forEach(v => { view.setFloat32(offset, v, true); offset += 4; });
                joints.forEach(v => { view.setUint16(offset, v, true); offset += 2; });
                weights.forEach(v => { view.setFloat32(offset, v, true); offset += 4; });
                invmats.forEach(v => { view.setFloat32(offset, v, true); offset += 4; });
                binBuffer.set(pngdata, offset);
            }
            const bufferViews = [];
            {
                let offset = 0;
                bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: model.indices.length * 4, target: 34963 });
                offset += model.indices.length * 4;
                bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: model.vertexs.length * 4, target: 34962 });
                offset += model.vertexs.length * 4;
                bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: model.normals.length * 4, target: 34962 });
                offset += model.normals.length * 4;
                bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: model.coords.length * 4, target: 34962 });
                offset += model.coords.length * 4;
                bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: joints.length * 2, target: 34962 });
                offset += joints.length * 2;
                bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: weights.length * 4, target: 34962 });
                offset += weights.length * 4;
                bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: invmats.length * 4 });
                offset += invmats.length * 4;
                bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: pngdata.length });
                offset += pngdata.length;
            }
            let [max, min] = [[-1e3, -1e3, -1e3], [1e3, 1e3, 1e3]];
            for (let i = 0; i < model.vertexs.length / 3; i++) {
                min[0] = Math.min(min[0], model.vertexs[i * 3 + 0]);
                min[1] = Math.min(min[1], model.vertexs[i * 3 + 1]);
                min[2] = Math.min(min[2], model.vertexs[i * 3 + 2]);
                max[0] = Math.max(max[0], model.vertexs[i * 3 + 0]);
                max[1] = Math.max(max[1], model.vertexs[i * 3 + 1]);
                max[2] = Math.max(max[2], model.vertexs[i * 3 + 2]);
            }
            const accessors = [
                { bufferView: 0, byteOffset: 0, componentType: 5125, count: model.indices.length, type: "SCALAR", normalized: false },
                { bufferView: 1, byteOffset: 0, componentType: 5126, count: model.vertexs.length / 3, type: "VEC3", normalized: false, max, min },
                { bufferView: 2, byteOffset: 0, componentType: 5126, count: model.normals.length / 3, type: "VEC3", normalized: false },
                { bufferView: 3, byteOffset: 0, componentType: 5126, count: model.coords.length / 2, type: "VEC2", normalized: false },
                { bufferView: 4, byteOffset: 0, componentType: 5123, count: joints.length / 4, type: "VEC4", normalized: false },
                { bufferView: 5, byteOffset: 0, componentType: 5126, count: weights.length / 4, type: "VEC4", normalized: false },
                { bufferView: 6, byteOffset: 0, componentType: 5126, count: invmats.length / 16, type: "MAT4", normalized: false },
            ];
            const nodes = bones.map(bone => {
                const translation = bone.parent ? Vec3.add(bone.vec0, bone.parent.vec1).array() : bone.vec0.array();
                const children = [...bones.keys()].filter(j => bones[j].parent === bone);
                return { name: bone.name, translation, children: children.length > 0 ? children : undefined };
            });
            // model node
            nodes.push({ mesh: 0, name: "model", skin: 0 });
            const gltf = {
                asset: { version: "2.0", generator: "mog3d.js vrm converter", },
                buffers: [{ byteLength: binSize, },],
                bufferViews, accessors, nodes,
                skins: [{ inverseBindMatrices: 6, joints: [...new Array(bones.length).keys()] }],
                materials: [
                    {
                        alphaMode: "OPAQUE",
                        name: "Material",
                        pbrMetallicRoughness: {
                            baseColorFactor: [1.0, 1.0, 1.0, 1.0],
                            metallicFactor: 0.0,
                            roughnessFactor: 1.0,
                            baseColorTexture: {
                                extensions: { KHR_texture_transform: { offset: [0, 0], scale: [1, 1] } },
                                index: 0,
                                texCoord: 0,
                            },
                        },
                        doubleSided: false,
                    },
                ],
                meshes: [
                    {
                        name: "model",
                        primitives: [
                            {
                                attributes: { POSITION: 1, NORMAL: 2, TEXCOORD_0: 3, JOINTS_0: 4, WEIGHTS_0: 5 },
                                indices: 0,
                                material: 0,
                                mode: 4,
                            },
                        ],
                    },
                ],
                scenes: [{ nodes: [0, bones.length] }],
                scene: 0,
                textures: [{ sampler: 0, source: 0 }],
                samplers: [{ magFilter: 9728, minFilter: 9728, wrapS: 10497, wrapT: 10497 }],
                images: [{ bufferView: 7, name: "model_texture", mimeType: "image/png" }],
                extensions: {
                    VRMC_vrm: {
                        specVersion: "1.0",
                        meta,
                        humanoid: {
                            humanBones: {},
                        },
                    },
                },
                extensionsUsed: ["VRMC_vrm", "KHR_texture_transform"],
            };
            // humanBones
            for (let i = 0; i < bones.length; i++) {
                gltf.extensions.VRMC_vrm.humanoid.humanBones[bones[i].name] = { node: i };
            }
            const gltfString = JSON.stringify(gltf);
            const jsonBuffer = new TextEncoder().encode(gltfString);
            const jsonSize = Math.ceil(jsonBuffer.length / 4) * 4;
            const jsonPadding = new Uint8Array(jsonSize - jsonBuffer.length);
            jsonPadding.fill(0x20); // space
            // VRM(glTF)
            const vrmBuffer = new Uint8Array(12 + 8 + jsonSize + 8 + binSize);
            const vrmView = new DataView(vrmBuffer.buffer);
            let vrmOffset = 0;
            // header
            vrmBuffer.set([0x67, 0x6C, 0x54, 0x46], vrmOffset);
            vrmOffset += 4; // "glTF"
            vrmView.setUint32(vrmOffset, 2, true);
            vrmOffset += 4; // version
            vrmView.setUint32(vrmOffset, vrmBuffer.length, true);
            vrmOffset += 4; // length
            // json
            vrmView.setUint32(vrmOffset, jsonSize, true);
            vrmOffset += 4;
            vrmBuffer.set([0x4A, 0x53, 0x4F, 0x4E], vrmOffset);
            vrmOffset += 4; // "JSON"
            vrmBuffer.set(jsonBuffer, vrmOffset);
            vrmOffset += jsonBuffer.length; // jsonBuffer
            vrmBuffer.set(jsonPadding, vrmOffset);
            vrmOffset += jsonPadding.length; // jsonPadding
            // binary
            vrmView.setUint32(vrmOffset, binSize, true);
            vrmOffset += 4;
            vrmBuffer.set([0x42, 0x49, 0x4E, 0x00], vrmOffset);
            vrmOffset += 4; // "BIN\0"
            vrmBuffer.set(binBuffer, vrmOffset);
            vrmOffset += binBuffer.length;
            return vrmBuffer;
        });
    }

    /**
     * Default jitter, as a ratio of the voxel size.
     *
     * Voxel models put a lot of surfaces on exactly the same plane. Most of all,
     * a model's layers are meshed one at a time, so where two layers touch both
     * of them emit the shared face and the two land at the same depth. Moving each
     * layer by this much, in a random direction, keeps them apart. The layer moves
     * as one piece, so nothing about its own surface changes.
     *
     * A hundredth of a voxel is small enough to be invisible — a tenth of a pixel
     * at the size a model is usually drawn — and large enough to clear the depth
     * buffer's resolution. Under a perspective camera with a near plane close to
     * the viewer, one step of a 24-bit depth buffer can be a few thousandths of a
     * voxel, so anything smaller than that rounds back onto the same depth and
     * changes nothing.
     */
    const JITTER = 0.01;
    const voxelkit = {
        load(path, { scale = null, chamfer = 0.0, jitter = JITTER } = {}) {
            var _a;
            const extension = (_a = path.split('.').pop()) === null || _a === void 0 ? void 0 : _a.toLowerCase();
            return fetch(path).then((response) => response.blob())
                .then((blob) => {
                return voxelkit.parse(blob, { scale, chamfer, jitter, extension });
            });
        },
        parse(blob, { scale = null, chamfer = 0.0, jitter = JITTER, extension = 'mog' } = {}) {
            switch (extension) {
                case 'mog': {
                    // the old format is a text tree starting with '(', the current one is JSON
                    return blob.slice(0, 1).text().then((head) => {
                        return head === '(' ? parseMOGOld(blob, scale, chamfer, jitter) : parseMOG(blob, scale, chamfer, jitter);
                    });
                }
                // case 'vox':
                //     return loadVoxFormat(path);
                // case 'qb':
                //     return loadQubicleFormat(path);
                default:
                    return Promise.reject(new Error(`Unsupported file format: ${extension}`));
            }
        },
        /**
         * Converts to VRM 1.0. The meta starts from the defaults, takes what the
         * `.mog` carries under `meta`, then whatever is passed here — the model's
         * name lives outside the file, so it comes in this way. Malformed values are ignored rather than written.
         */
        convertVRM(composit, { meta = {} } = {}) {
            return convertVRM(composit.models, composit.bones, buildVRMMeta(composit.meta, meta));
        }
    };

    return voxelkit;

}));
