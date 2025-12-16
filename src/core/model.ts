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
