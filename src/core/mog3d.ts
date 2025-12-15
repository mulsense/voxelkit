import { segment, hmMakeTableFromLngs, hmMakeNode, zlDecode } from './code';

// Type definitions
export interface MOG3DJSON {
    models: VoxelJSON[];
}
export interface VoxelJSON {
    dsize: [number, number, number];
    palette: string;
    layers: LayerJSON[];
    bones?: BoneJSON[];
}
export interface LayerJSON {
    name: string;
    gmap: string;
    cmap: string;
}

export interface BoneJSON {
    parent: number;
    name: string;
    refs: number[];
    vec0: [number, number, number];
    vec1: [number, number, number];
}

const scale: number = 1 / 32;

export function loadMOG(path: string): Promise<Model> {
    return fetch(path)
        .then(response => response.json())
        .then((json: MOG3DJSON) => new Model(json));
}

export class Model {
    dsize: [number, number, number];
    palette: Uint8Array;
    layers: Layer[];
    bones: Bone[];

    constructor(json: MOG3DJSON) {
        const jsonmodel = json.models[0];
        this.dsize = jsonmodel.dsize;
        this.palette = Uint8Array.from(atob(jsonmodel.palette), c => c.charCodeAt(0));

        this.layers = jsonmodel.layers.map((jsonlayer: LayerJSON) => {
            const [gmap, cmap] = decode(this.dsize, jsonlayer.gmap, jsonlayer.cmap);
            return new Layer(jsonlayer.name, this.dsize, this.palette, gmap, cmap);
        });

        this.bones = (jsonmodel.bones ?? []).reduce((bones: Bone[], jsonbone: BoneJSON) => [...bones, new Bone(jsonbone, bones)], [] as Bone[]);

        function decode(dsize: [number, number, number], codevmap: string, codecmap: string): [Uint8Array, Uint8Array] {
            const gmap = new Uint8Array(dsize[0] * dsize[1] * dsize[2]).fill(0);
            const cmap = new Uint8Array(dsize[0] * dsize[1] * dsize[2]).fill(0);

            const bin0 = Uint8Array.from(atob(codevmap), c => c.charCodeAt(0));
            const bin1 = Uint8Array.from(atob(codecmap), c => c.charCodeAt(0));
            if (bin0.length == 0) return [gmap, cmap];

            const memA = segment(bin0, 0, true);
            const memB = zlDecode(table256(), segment(bin0, 1, true), 256, 8, 8);

            const PALETTE_CODE = 256;
            const data = segment(bin1, 0);
            const lngs = new Array(PALETTE_CODE + 1).fill(0);
            for (let c = 0; c < data.length - 1; c += 2) {
                lngs[data[c + 0]] = data[c + 1];
            }
            lngs[PALETTE_CODE] = data[data.length - 1];

            const memC = zlDecode(hmMakeTableFromLngs(lngs), segment(bin1, 1, true), PALETTE_CODE, 8, 8);

            let [a, b, c] = [0, 0, 0];
            for (let z = 0; z < Math.ceil(dsize[2] / 8); z++) {
                for (let y = 0; y < Math.ceil(dsize[1] / 8); y++) {
                    for (let x = 0; x < Math.ceil(dsize[0] / 8); x++) {
                        if (memA[a++] === 0) continue;

                        for (let iz = 0; iz < Math.min(8, dsize[2] - 8 * z); iz++) {
                            for (let iy = 0; iy < Math.min(8, dsize[1] - 8 * y); iy++) {
                                for (let ix = 0; ix < Math.min(8, dsize[0] - 8 * x); ix++) {
                                    if ((memB[b + iz * 8 + iy] >> ix & 1) === 0) continue;
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
            return [gmap, cmap];
        }
    }

    async convertVRM(): Promise<Uint8Array> {
        const indices: number[] = []; // int
        const vertexs: number[] = []; // float x3
        const normals: number[] = []; // float x3
        const colors: number[] = []; // float x3
        const coords: number[] = []; // float x2
        const joints: number[] = []; // unsigned short x4
        const weights: number[] = []; // float x4
        const invmats: number[] = []; // float x16

        for (let i = 0; i < this.layers.length; i++) {
            const layer = this.layers[i];
            const offset = indices.length;
            for (let j = 0; j < layer.vertexs.length / 3; j++) {
                indices.push(offset + j);
                vertexs.push((layer.vertexs[j * 3 + 0] - this.dsize[0] / 2) * scale, layer.vertexs[j * 3 + 1] * scale, (layer.vertexs[j * 3 + 2] - this.dsize[2] / 2) * scale);
                normals.push(layer.normals[j * 3 + 0], layer.normals[j * 3 + 1], layer.normals[j * 3 + 2]);
                colors.push(layer.colors[j * 3 + 0], layer.colors[j * 3 + 1], layer.colors[j * 3 + 2]);
            }
            if (this.bones.length === 0) continue;

            const mask = [...new Array(this.bones.length).keys()]
            .map(j => this.bones[j].refs.length == 0 || this.bones[j].refs.some(ref => ref === i));

            for (let j = offset; j < vertexs.length / 3; j++) {
                let [nid0, nid1] = [-1, -1];
                let [min0, min1] = [1000, 1000];
                let wei = 1.0;
                {
                    for (let k = 1; k < this.bones.length; k++) {
                        if (mask[k]) {
                            const l = this.bones[k].distance(vertexs.slice(j * 3, j * 3 + 3));
                            if (l < min0) {
                                min0 = l;
                                nid0 = k;
                            }
                        }
                    }
                }
                if (nid0 >= 0) {
                    min1 = min0 * 2.0;
                    for (let k = 1; k < this.bones.length; k++) {
                        if (k !== nid0 && mask[k]) {
                            if (this.bones[nid0].name.indexOf('left') === 0 && this.bones[k].name.indexOf('right') === 0) continue;
                            if (this.bones[nid0].name.indexOf('right') === 0 && this.bones[k].name.indexOf('left') === 0) continue;

                            const l = this.bones[k].distance(vertexs.slice(j * 3, j * 3 + 3));
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

        for (let i = 0; i < this.bones.length; i++) {
            const bone = this.bones[i];
            const position = bone.basePosition();
            const vec0 = [position[0] + bone.vec0[0], position[1] + bone.vec0[1], position[2] + bone.vec0[2]];

            invmats.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -vec0[0], -vec0[1], -vec0[2], 1);
        }

        const width = 1024;
        const height = Math.pow(2, Math.ceil(Math.log2((4 * colors.length / 3 + width - 1) / width))) >> 0;
        const imgdata = new Uint8Array(width * height * 4).fill(255);

        for (let i = 0; i < colors.length / 3; i++) {
            const x = (i * 2) % (((width / 6) >> 0) * 6);
            const y = (((i * 2) / (((width / 6) >> 0) * 6)) >> 0) * 2;

            for (let iy = 0; iy < 2; iy++) {
                for (let ix = 0; ix < 2; ix++) {
                    imgdata[((y + iy) * width + (x + ix)) * 4 + 0] = colors[i * 3 + 0];
                    imgdata[((y + iy) * width + (x + ix)) * 4 + 1] = colors[i * 3 + 1];
                    imgdata[((y + iy) * width + (x + ix)) * 4 + 2] = colors[i * 3 + 2];
                }
            }
            coords.push((x + 1) / width, (y + 1) / height);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get 2d context');
        ctx.putImageData(new ImageData(new Uint8ClampedArray(imgdata), width, height), 0, 0);

        const pngdata = await new Promise<Uint8Array>((resolve) => {
            canvas.toBlob((blob) => {
                if (!blob) throw new Error('Could not create blob');
                blob.arrayBuffer().then(buffer => { resolve(new Uint8Array(buffer)); });
            }, 'image/png');
        });

        let binSize = 0;
        binSize += indices.length * 4;
        binSize += vertexs.length * 4;
        binSize += normals.length * 4;
        binSize += coords.length * 4;
        binSize += joints.length * 2;
        binSize += weights.length * 4;
        binSize += invmats.length * 4;
        binSize += pngdata.length;
        binSize = Math.ceil(binSize / 4) * 4;

        const binBuffer = new Uint8Array(binSize);
        {
            const view = new DataView(binBuffer.buffer);
            let offset = 0;
            indices.forEach(v => { view.setInt32(offset, v, true); offset += 4; });
            vertexs.forEach(v => { view.setFloat32(offset, v, true); offset += 4; });
            normals.forEach(v => { view.setFloat32(offset, v, true); offset += 4; });
            coords.forEach(v => { view.setFloat32(offset, v, true); offset += 4; });
            joints.forEach(v => { view.setUint16(offset, v, true); offset += 2; });
            weights.forEach(v => { view.setFloat32(offset, v, true); offset += 4; });
            invmats.forEach(v => { view.setFloat32(offset, v, true); offset += 4; });
            binBuffer.set(pngdata, offset);
        }

        const bufferViews = [];
        {
            let offset = 0;
            bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: indices.length * 4, target: 34963 }); offset += indices.length * 4;
            bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: vertexs.length * 4, target: 34962 }); offset += vertexs.length * 4;
            bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: normals.length * 4, target: 34962 }); offset += normals.length * 4;
            bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: coords.length * 4, target: 34962 }); offset += coords.length * 4;
            bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: joints.length * 2, target: 34962 }); offset += joints.length * 2;
            bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: weights.length * 4, target: 34962 }); offset += weights.length * 4;
            bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: invmats.length * 4 }); offset += invmats.length * 4;
            bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: pngdata.length }); offset += pngdata.length;
        }

        let [max, min] = [[+1000, +1000, +1000], [-1000, -1000, -1000]];
        for (let i = 0; i < vertexs.length / 3; i++) {
            min[0] = Math.min(min[0], vertexs[i * 3 + 0]);
            min[1] = Math.min(min[1], vertexs[i * 3 + 1]);
            min[2] = Math.min(min[2], vertexs[i * 3 + 2]);
            max[0] = Math.max(max[0], vertexs[i * 3 + 0]);
            max[1] = Math.max(max[1], vertexs[i * 3 + 1]);
            max[2] = Math.max(max[2], vertexs[i * 3 + 2]);
        }
        const accessors = [
            { bufferView: 0, byteOffset: 0, componentType: 5125, count: indices.length, type: "SCALAR", normalized: false },
            { bufferView: 1, byteOffset: 0, componentType: 5126, count: vertexs.length / 3, type: "VEC3", normalized: false, max, min },
            { bufferView: 2, byteOffset: 0, componentType: 5126, count: normals.length / 3, type: "VEC3", normalized: false },
            { bufferView: 3, byteOffset: 0, componentType: 5126, count: coords.length / 2, type: "VEC2", normalized: false },
            { bufferView: 4, byteOffset: 0, componentType: 5123, count: joints.length / 4, type: "VEC4", normalized: false },
            { bufferView: 5, byteOffset: 0, componentType: 5126, count: weights.length / 4, type: "VEC4", normalized: false },
            { bufferView: 6, byteOffset: 0, componentType: 5126, count: invmats.length / 16, type: "MAT4", normalized: false },
        ];

        const nodes: any[] = this.bones.map(bone => {
            const translation = bone.parent
                ? [bone.vec0[0] + bone.parent.vec1[0], bone.vec0[1] + bone.parent.vec1[1], bone.vec0[2] + bone.parent.vec1[2]]
                : bone.vec0;
            const children = [...this.bones.keys()].filter(j => this.bones[j].parent === bone);
            return { name: bone.name, translation, children: children.length > 0 ? children : undefined };
        });

        // model node
        nodes.push({ mesh: 0, name: "model", skin: 0 });

        const gltf: any = {
            asset: { version: "2.0", generator: "mog3d.js vrm converter", },
            buffers: [ { byteLength: binSize, }, ],
            bufferViews, accessors, nodes,
            skins: [{ inverseBindMatrices: 6, joints: [...new Array(this.bones.length).keys()] }],
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
            scenes: [{ nodes: [0, this.bones.length] }],
            scene: 0,
            textures: [{ sampler: 0, source: 0 }],
            samplers: [{ magFilter: 9729, minFilter: 9985, wrapS: 10497, wrapT: 10497 }],
            images: [{ bufferView: 7, name: "model_texture", mimeType: "image/png" }],
            extensions: {
                VRMC_vrm: {
                    specVersion: "1.0",
                    meta: {
                        name: "model",
                        version: "1.0",
                        authors: ["Author"],
                        allowAntisocialOrHateUsage: false,
                        allowExcessivelySexualUsage: false,
                        allowExcessivelyViolentUsage: false,
                        allowPoliticalOrReligiousUsage: false,
                        avatarPermission: "onlyAuthor",
                        commercialUsage: "personalNonProfit",
                        creditNotation: "required",
                        modification: "prohibited",
                        licenseUrl: "https://vrm.dev/licenses/1.0/",
                    },
                    humanoid: {
                        humanBones: {},
                    },
                },
            },
            extensionsUsed: ["VRMC_vrm", "KHR_texture_transform"],
        };

        // humanBones
        for (let i = 0; i < this.bones.length; i++) {
            gltf.extensions.VRMC_vrm.humanoid.humanBones[this.bones[i].name] = { node: i };
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
        vrmBuffer.set([0x67, 0x6C, 0x54, 0x46], vrmOffset); vrmOffset += 4; // "glTF"
        vrmView.setUint32(vrmOffset, 2, true); vrmOffset += 4; // version
        vrmView.setUint32(vrmOffset, vrmBuffer.length, true); vrmOffset += 4; // length

        // json
        vrmView.setUint32(vrmOffset, jsonSize, true); vrmOffset += 4;
        vrmBuffer.set([0x4A, 0x53, 0x4F, 0x4E], vrmOffset); vrmOffset += 4; // "JSON"
        vrmBuffer.set(jsonBuffer, vrmOffset);  vrmOffset += jsonBuffer.length; // jsonBuffer
        vrmBuffer.set(jsonPadding, vrmOffset);  vrmOffset += jsonPadding.length; // jsonPadding

        // binary
        vrmView.setUint32(vrmOffset, binSize, true); vrmOffset += 4;
        vrmBuffer.set([0x42, 0x49, 0x4E, 0x00], vrmOffset); vrmOffset += 4; // "BIN\0"
        vrmBuffer.set(binBuffer, vrmOffset); vrmOffset += binBuffer.length;

        return vrmBuffer;
    }
}

class Layer {
    name: string;
    vertexs: Uint16Array;
    normals: Int8Array;
    colors: Int8Array;

    constructor(name: string, dsize: [number, number, number], palette: Uint8Array, gmap: Uint8Array, cmap: Uint8Array) {
        this.name = name;
        const bits = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20];

        let cnt = 0;
        for (let z = 0; z < dsize[2]; z++) {
            for (let y = 0; y < dsize[1]; y++) {
                for (let x = 0; x < dsize[0]; x++) {
                    const p = z * dsize[0] * dsize[1] + y * dsize[0] + x;
                    if ((gmap[p] & 0x40) === 0) continue;

                    let bit = 0;
                    const s = [1, dsize[0], dsize[0] * dsize[1]];
                    if (x === 0 || (gmap[p - s[0]] & 0x40) === 0) bit |= bits[0];
                    if (y === 0 || (gmap[p - s[1]] & 0x40) === 0) bit |= bits[2];
                    if (z === 0 || (gmap[p - s[2]] & 0x40) === 0) bit |= bits[4];
                    if (x === dsize[0] - 1 || (gmap[p + s[0]] & 0x40) === 0) bit |= bits[1];
                    if (y === dsize[1] - 1 || (gmap[p + s[1]] & 0x40) === 0) bit |= bits[3];
                    if (z === dsize[2] - 1 || (gmap[p + s[2]] & 0x40) === 0) bit |= bits[5];
                    gmap[p] |= bit;
                    cnt += (bit >> 0 & 1) + (bit >> 1 & 1) + (bit >> 2 & 1) + (bit >> 3 & 1) + (bit >> 4 & 1) + (bit >> 5 & 1);
                }
            }
        }

        this.vertexs = new Uint16Array(cnt * 18);
        this.normals = new Int8Array(cnt * 18);
        this.colors = new Int8Array(cnt * 18);

        cnt = 0;
        for (let z = 0; z < dsize[2]; z++) {
            for (let y = 0; y < dsize[1]; y++) {
                for (let x = 0; x < dsize[0]; x++) {
                    const p = z * dsize[0] * dsize[1] + y * dsize[0] + x;
                    if ((gmap[p] & 0x3F) === 0) continue;

                    const [x0, x1] = [x, x + 1];
                    const [y0, y1] = [y, y + 1];
                    const [z0, z1] = [z, z + 1];

                    for (let i = 0; i < 6; i++){
                        if ((gmap[p] & bits[i]) === 0) continue;

                        let vtx: number[];
                        switch(i){
                            case 0: vtx = [x0, y0, z0, x0, y0, z1, x0, y1, z0, x0, y1, z1, x0, y1, z0, x0, y0, z1]; break;
                            case 1: vtx = [x1, y0, z0, x1, y1, z0, x1, y0, z1, x1, y1, z1, x1, y0, z1, x1, y1, z0]; break;
                            case 2: vtx = [x0, y0, z0, x1, y0, z0, x0, y0, z1, x1, y0, z1, x0, y0, z1, x1, y0, z0]; break;
                            case 3: vtx = [x0, y1, z0, x0, y1, z1, x1, y1, z0, x1, y1, z1, x1, y1, z0, x0, y1, z1]; break;
                            case 4: vtx = [x0, y0, z0, x0, y1, z0, x1, y0, z0, x1, y1, z0, x1, y0, z0, x0, y1, z0]; break;
                            case 5: vtx = [x0, y0, z1, x1, y0, z1, x0, y1, z1, x1, y1, z1, x0, y1, z1, x1, y0, z1]; break;
                            default: vtx = []; break;
                        }

                        let nrm: number[];
                        switch(i) {
                            case 0: nrm = [-1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0]; break;
                            case 1: nrm = [+1, 0, 0, +1, 0, 0, +1, 0, 0, +1, 0, 0, +1, 0, 0, +1, 0, 0]; break;
                            case 2: nrm = [0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0]; break;
                            case 3: nrm = [0, +1, 0, 0, +1, 0, 0, +1, 0, 0, +1, 0, 0, +1, 0, 0, +1, 0]; break;
                            case 4: nrm = [0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1]; break;
                            case 5: nrm = [0, 0, +1, 0, 0, +1, 0, 0, +1, 0, 0, +1, 0, 0, +1, 0, 0, +1]; break;
                            default: nrm = []; break;
                        }

                        let col: number[] = [];
                        const c = cmap[p];
                        for (let k = 0; k < 6; k++) {
                            col.push(palette[c * 4 + 0], palette[c * 4 + 1], palette[c * 4 + 2]);
                        }

                        this.vertexs.set(vtx, cnt * 18);
                        this.normals.set(nrm, cnt * 18);
                        this.colors.set(col, cnt * 18);
                        cnt++;
                    }
                }
            }
        }
    }
}

class Bone {
    parent: Bone | null;
    name: string;
    refs: number[];
    vec0: [number, number, number];
    vec1: [number, number, number];

    constructor(json: BoneJSON, bones: Bone[]) {
        this.parent = json.parent >= 0 ? bones[json.parent] : null;
        this.name = json.name;
        this.refs = json.refs;
        this.vec0 = [json.vec0[0] * scale, json.vec0[1] * scale, json.vec0[2] * scale];
        this.vec1 = [json.vec1[0] * scale, json.vec1[1] * scale, json.vec1[2] * scale];
    }

    basePosition(): [number, number, number] {
        let position: [number, number, number] = [0.0, 0.0, 0.0];
        let bone: Bone | null = this;
        while (bone && bone.parent) {
            const parent: Bone = bone.parent;
            position = [
                position[0] + parent.vec0[0] + parent.vec1[0],
                position[1] + parent.vec0[1] + parent.vec1[1],
                position[2] + parent.vec0[2] + parent.vec1[2]
            ];
            bone = parent;
        }
        return position;
    }

    distance(vec: number[]): number {
        const position = this.basePosition();
        const vec0 = [position[0] + this.vec0[0], position[1] + this.vec0[1], position[2] + this.vec0[2]];
        const vec1 = [vec0[0] + this.vec1[0], vec0[1] + this.vec1[1], vec0[2] + this.vec1[2]];

        const line = [vec1[0] - vec0[0], vec1[1] - vec0[1], vec1[2] - vec0[2]];
        const sq = line[0] * line[0] + line[1] * line[1] + line[2] * line[2];

        const a = [vec[0] - vec0[0], vec[1] - vec0[1], vec[2] - vec0[2]];
        const b = [vec[0] - vec1[0], vec[1] - vec1[1], vec[2] - vec1[2]];

        const s = (line[0] * a[0] + line[1] * a[1] + line[2] * a[2]) / sq;
        if (s < 0.0 || s > 1.0) {
            const x = s < 0.0 ? a : b;
            return Math.sqrt(x[0] * x[0] + x[1] * x[1] + x[2] * x[2]);
        } else {
            const x = [vec[0] - vec0[0] - line[0] * s, vec[1] - vec0[1] - line[1] * s, vec[2] - vec0[2] - line[2] * s];
            return Math.sqrt(x[0] * x[0] + x[1] * x[1] + x[2] * x[2]);
        }
    }
}

function table256(): number[][] {
    type NodeType = { cnt: number; parent: NodeType | null };
    const nodes: NodeType[] = [];
    for (let i = 0; i < 256; i++) {
        const sum = [...new Array(7).keys()].map(s => ((i >> s) ^ (i >> (s + 1))) & 1).reduce((a, b) => a + b);
        nodes.push({ cnt: 2 ** (7 - sum), parent: null });
    }
    nodes.push({ cnt: 2 ** 8, parent: null });

    for (let i = 0; i < 256 + 1 - 1; i++) {
        const node: NodeType = { cnt: 0, parent: null };
        for (let j = 0; j < 2; j++) {
            const select = nodes.reduce((a, b) => (a.parent !== null || (b.parent === null && b.cnt < a.cnt)) ? b : a);
            node.cnt += select.cnt;
            select.parent = node;
        }
        nodes.push(node);
    }

    const lngs = new Array(256 + 1).fill(0);
    for (let i = 0; i < 256 + 1; i++) {
        let node: NodeType | null = nodes[i];
        while (node = node.parent) { lngs[i]++; }
    }
    return hmMakeTableFromLngs(lngs);
}
