import { Vec3 } from './vector';
import { Model, Bone } from './model';

export async function convertVRM(models: Model[], bones: Bone[]): Promise<Uint8Array> {
    const size = models.reduce((a, b) => a + b.indices.length, 0);
    const model = new Model('composit', size);

    const joints: number[] = []; // unsigned short x4
    const weights: number[] = []; // float x4
    const invmats: number[] = []; // float x16

    for (let i = 0; i < models.length; i++) {
        const layer = models[i];
        const offset = models.slice(0, i).reduce((a, b) => a + b.indices.length, 0);
        model.indices.set(layer.indices.map(v => v + offset), offset);
        model.vertexs.set(layer.vertexs, offset * 3);
        model.normals.set(layer.normals, offset * 3);
        model.colors.set(layer.colors, offset * 3);
        if (bones.length === 0) continue;

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
                        if (bones[nid0].name.indexOf('left') === 0 && bones[k].name.indexOf('right') === 0) continue;
                        if (bones[nid0].name.indexOf('right') === 0 && bones[k].name.indexOf('left') === 0) continue;

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
    if (!ctx) throw new Error('Could not get 2d context');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(imgdata), width, height), 0, 0);

    const pngdata = await new Promise<Uint8Array>((resolve) => {
        canvas.toBlob((blob) => {
            if (!blob) throw new Error('Could not create blob');
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
        bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: model.indices.length * 4, target: 34963 }); offset += model.indices.length * 4;
        bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: model.vertexs.length * 4, target: 34962 }); offset += model.vertexs.length * 4;
        bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: model.normals.length * 4, target: 34962 }); offset += model.normals.length * 4;
        bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: model.coords.length * 4, target: 34962 }); offset += model.coords.length * 4;
        bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: joints.length * 2, target: 34962 }); offset += joints.length * 2;
        bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: weights.length * 4, target: 34962 }); offset += weights.length * 4;
        bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: invmats.length * 4 }); offset += invmats.length * 4;
        bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: pngdata.length }); offset += pngdata.length;
    }

    let [max, min] = [[-1000, -1000, -1000], [+1000, +1000, +1000]];
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

    const nodes: any[] = bones.map(bone => {
        const translation = bone.parent ? Vec3.add(bone.vec0, bone.parent.vec1).array() : bone.vec0.array();
        const children = [...bones.keys()].filter(j => bones[j].parent === bone);
        return { name: bone.name, translation, children: children.length > 0 ? children : undefined };
    });

    // model node
    nodes.push({ mesh: 0, name: "model", skin: 0 });

    const gltf: any = {
        asset: { version: "2.0", generator: "mog3d.js vrm converter", },
        buffers: [ { byteLength: binSize, }, ],
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