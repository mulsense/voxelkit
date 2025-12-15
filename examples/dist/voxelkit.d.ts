interface MOG3DJSON {
    models: VoxelJSON[];
}
interface VoxelJSON {
    dsize: [number, number, number];
    palette: string;
    layers: LayerJSON[];
    bones?: BoneJSON[];
}
interface LayerJSON {
    name: string;
    gmap: string;
    cmap: string;
}
interface BoneJSON {
    parent: number;
    name: string;
    refs: number[];
    vec0: [number, number, number];
    vec1: [number, number, number];
}
declare class Model {
    dsize: [number, number, number];
    palette: Uint8Array;
    layers: Layer[];
    bones: Bone[];
    constructor(json: MOG3DJSON);
    convertVRM(): Promise<Uint8Array>;
}
declare class Layer {
    name: string;
    vertexs: Uint16Array;
    normals: Int8Array;
    colors: Int8Array;
    constructor(name: string, dsize: [number, number, number], palette: Uint8Array, gmap: Uint8Array, cmap: Uint8Array);
}
declare class Bone {
    parent: Bone | null;
    name: string;
    refs: number[];
    vec0: [number, number, number];
    vec1: [number, number, number];
    constructor(json: BoneJSON, bones: Bone[]);
    basePosition(): [number, number, number];
    distance(vec: number[]): number;
}

declare const voxelkit: {
    load(path: string): Promise<Model>;
};

export { voxelkit as default };
