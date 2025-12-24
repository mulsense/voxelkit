import { Vec3 } from './vector';

export interface Composit {
    models: Model[];
    bones: Bone[];
    dsize: [number, number, number];
}

export class Model {
    public name: string;
    public indices: Int32Array;
    public vertexs: Float32Array;
    public normals: Float32Array;
    public coords: Float32Array;
    public colors: Int8Array;

    constructor(name: string, size: number) {
        this.name = name;
        this.indices = new Int32Array(size);
        this.vertexs = new Float32Array(size * 3);
        this.normals = new Float32Array(size * 3);
        this.coords = new Float32Array(size * 2);
        this.colors = new Int8Array(size * 3);
    }
}

export class Bone {
    public parent: Bone | null;
    public name: string;
    public refs: number[];
    public vec0: Vec3;
    public vec1: Vec3;

    constructor(parent: Bone | null, name: string, vec0: Vec3, vec1: Vec3, refs: number[]) {
        this.parent = parent;
        this.name = name;
        this.refs = refs;
        this.vec0 = vec0;
        this.vec1 = vec1;
    }

    offset(): Vec3 {
        let position: Vec3 = new Vec3(0.0, 0.0, 0.0);
        let bone: Bone = this;
        while (bone.parent) {
            position = Vec3.add(position, bone.parent.vec0);
            position = Vec3.add(position, bone.parent.vec1);
            bone = bone.parent;
        }
        return position;
    }

    distance(vec: Vec3): number {
        const vec0 = Vec3.add(this.offset(), this.vec0);
        const vec1 = Vec3.add(vec0, this.vec1);

        const line = Vec3.sub(vec1, vec0);

        const a = Vec3.sub(vec, vec0);
        const b = Vec3.sub(vec, vec1);

        const s = Vec3.dot(line, a) / (line.length() * line.length());
        let result: Vec3;
        if (s < 0.0 || s > 1.0) {
            result = s < 0.0 ? a : b;
        } else {
            result = Vec3.sub(vec, Vec3.add(vec0, Vec3.mul(line, s)));
        }
        return result.length();
    }
}
