declare class Vec3 {
    x: number;
    y: number;
    z: number;
    constructor(x: number, y: number, z: number);
    length(): number;
    array(): [number, number, number];
    static add(vec0: Vec3, vec1: Vec3): Vec3;
    static sub(vec0: Vec3, vec1: Vec3): Vec3;
    static mul(vec0: Vec3, scale: number): Vec3;
    static dot(vec0: Vec3, vec1: Vec3): number;
}

/**
 * VRM 1.0 meta (`extensions.VRMC_vrm.meta`).
 *
 * The keys and values are the ones VRM 1.0 defines, so a `.mog` can carry
 * them as they are under `meta` and they go into the VRM unchanged. The
 * `meta` object and each key in it are optional; what is missing falls back
 * to {@link DEFAULT_VRM_META}.
 * `thumbnailImage` is left out: it points into the glTF's images, which only
 * the converter knows.
 */
interface VRMMeta {
    name: string;
    version?: string;
    authors: string[];
    copyrightInformation?: string;
    contactInformation?: string;
    references?: string[];
    thirdPartyLicenses?: string;
    licenseUrl: string;
    avatarPermission: 'onlyAuthor' | 'onlySeparatelyLicensedPerson' | 'everyone';
    allowExcessivelyViolentUsage: boolean;
    allowExcessivelySexualUsage: boolean;
    commercialUsage: 'personalNonProfit' | 'personalProfit' | 'corporation';
    allowPoliticalOrReligiousUsage: boolean;
    allowAntisocialOrHateUsage: boolean;
    creditNotation: 'required' | 'unnecessary';
    allowRedistribution?: boolean;
    modification: 'prohibited' | 'allowModification' | 'allowModificationRedistribution';
    otherLicenseUrl?: string;
}

interface Composit {
    models: Model[];
    bones: Bone[];
    dsize: [number, number, number];
    /** VRM meta the file carries under `meta` (only the well-formed keys) */
    meta?: Partial<VRMMeta>;
}
declare class Model {
    name: string;
    indices: Int32Array;
    vertexs: Float32Array;
    normals: Float32Array;
    coords: Float32Array;
    colors: Int8Array;
    constructor(name: string, size: number);
}
declare class Bone {
    parent: Bone | null;
    name: string;
    refs: number[];
    vec0: Vec3;
    vec1: Vec3;
    constructor(parent: Bone | null, name: string, vec0: Vec3, vec1: Vec3, refs: number[]);
    offset(): Vec3;
    distance(vec: Vec3): number;
}

declare const voxelkit: {
    load(path: string, { scale, chamfer, jitter }?: {
        scale?: number | null;
        chamfer?: number;
        jitter?: number;
    }): any;
    parse(blob: Blob, { scale, chamfer, jitter, extension }?: {
        scale?: number | null;
        chamfer?: number;
        jitter?: number;
        extension?: string;
    }): Promise<Composit[]>;
    /**
     * Converts to VRM 1.0. The meta starts from the defaults, takes what the
     * `.mog` carries under `meta`, then whatever is passed here — the model's
     * name lives outside the file, so it comes in this way. Malformed values are ignored rather than written.
     */
    convertVRM(composit: Composit, { meta }?: {
        meta?: Partial<VRMMeta>;
    }): Promise<Uint8Array<ArrayBufferLike>>;
};

export { voxelkit as default };
export type { Composit, VRMMeta };
