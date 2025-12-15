declare const voxelkit: {
    load(path: any): Promise<Model>;
};
declare class Model {
    constructor(json: any);
    convertVRM(): Promise<string | Uint8Array<ArrayBuffer>>;
}

export { voxelkit as default };
