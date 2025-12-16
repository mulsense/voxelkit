export class Vec3 {
    constructor(public x: number, public y: number, public z: number) {}

    public length(): number {
        return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    }
    
    public array(): [number, number, number] {
        return [this.x, this.y, this.z];
    }

    static add(vec0: Vec3, vec1: Vec3): Vec3 {
        return new Vec3(vec0.x + vec1.x, vec0.y + vec1.y, vec0.z + vec1.z);
    }
    static sub(vec0: Vec3, vec1: Vec3): Vec3 {
        return new Vec3(vec0.x - vec1.x, vec0.y - vec1.y, vec0.z - vec1.z);
    }
    static mul(vec0: Vec3, scale: number): Vec3 {
        return new Vec3(vec0.x * scale, vec0.y * scale, vec0.z * scale);
    }
    static dot(vec0: Vec3, vec1: Vec3): number {
        return vec0.x * vec1.x + vec0.y * vec1.y + vec0.z * vec1.z;
    }
}