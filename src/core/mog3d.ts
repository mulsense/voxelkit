import { segment, hmMakeTableFromLngs, table256, zlDecode } from './code';
import { Vec3 } from './vector';
import { Composit, Model, Bone } from './model';

/** face index: 0:-x 1:+x 2:-y 3:+y 4:-z 5:+z (opposite face is `index ^ 1`) */
const FACE_DIRS: number[][] = [[-1, 0, 0], [+1, 0, 0], [0, -1, 0], [0, +1, 0], [0, 0, -1], [0, 0, +1]];

/** in-plane axes (u, v) of each face, as face indices. cross(u, v) equals the face normal */
const FACE_AXES: [number, number][] = [[5, 3], [3, 5], [1, 5], [5, 1], [3, 1], [1, 3]];

/** the 12 edges of a voxel, as pairs of perpendicular faces */
const EDGE_PAIRS: [number, number][] = [
    [0, 2], [0, 3], [0, 4], [0, 5], [1, 2], [1, 3],
    [1, 4], [1, 5], [2, 4], [2, 5], [3, 4], [3, 5],
];

/** the 8 corners of a voxel, as triples of perpendicular faces */
const CORNER_TRIPLES: [number, number, number][] = [
    [0, 2, 4], [0, 2, 5], [0, 3, 4], [0, 3, 5],
    [1, 2, 4], [1, 2, 5], [1, 3, 4], [1, 3, 5],
];

function cross(vec0: number[], vec1: number[]): number[] {
    return [
        vec0[1] * vec1[2] - vec0[2] * vec1[1],
        vec0[2] * vec1[0] - vec0[0] * vec1[2],
        vec0[0] * vec1[1] - vec0[1] * vec1[0],
    ];
}

function dot(vec0: number[], vec1: number[]): number {
    return vec0[0] * vec1[0] + vec0[1] * vec1[1] + vec0[2] * vec1[2];
}

function unit(vec: number[]): number[] {
    const length = Math.sqrt(dot(vec, vec));
    return [vec[0] / length, vec[1] / length, vec[2] / length];
}

export async function parseMOG(blob: Blob, scale: number | null, chamfer: number = 0.0): Promise<Composit[]> {
    const text = await blob.text();
    const json = JSON.parse(text);
    const composits: Composit[] = [];

    const dsize = json.dsize;
    const s = (scale !== null ? scale : (dsize[1] / 32 * 20)) * 0.001;
    const palette = Uint8Array.from(atob(json.palette), c => c.charCodeAt(0));

    const models = json.layers.map((jsonlayer: any) => {
        return decode(dsize, palette, jsonlayer.name, jsonlayer.data, s, chamfer);
    });

    const bones: Bone[] = [];
    for(const jsonbone of (json.bones ?? [])) {
        const parent = jsonbone.parent >= 0 ? bones[jsonbone.parent] : null
        const vec0 = Vec3.mul(new Vec3(jsonbone.vector[0], jsonbone.vector[1], jsonbone.vector[2]), s);
        const vec1 = Vec3.mul(new Vec3(jsonbone.vector[3], jsonbone.vector[4], jsonbone.vector[5]), s);
        bones.push(new Bone(parent, jsonbone.name, vec0, vec1, jsonbone.layers));
    }
    composits.push({ models, bones, dsize });
   
    return composits;
}

function decode(
    dsize: [number, number, number],
    palette: Uint8Array,
    name: string,
    data: string,
    scale: number,
    chamfer: number)
    : Model
{
    const { gmap, cmap } = decodeGrid(dsize, data);
    return buildModel(name, dsize, gmap, cmap, palette, scale, chamfer);
}

/**
 * Expands the compressed layer data into an occupancy map (bit 0x40) and a palette index map.
 */
export function decodeGrid(dsize: [number, number, number], data: string): { gmap: Uint8Array, cmap: Uint8Array } {
    const gmap = new Uint8Array(dsize[0] * dsize[1] * dsize[2]).fill(0);
    const cmap = new Uint8Array(dsize[0] * dsize[1] * dsize[2]).fill(0);

    const mapbin = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    if (mapbin.length == 0) return { gmap, cmap };

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

    return { gmap, cmap };
}

/**
 * Builds the surface mesh of a voxel grid.
 *
 * `chamfer` is the bevel width as a ratio of the voxel size (0.0 disables it).
 * Edges are beveled only where the model as a whole is convex there, so a flat
 * run of voxels stays flat instead of every voxel being beveled on its own.
 *
 * @param gmap occupancy map (bit 0x40 marks a filled voxel)
 * @param cmap palette index per voxel
 */
export function buildModel(
    name: string,
    dsize: [number, number, number],
    gmap: Uint8Array,
    cmap: Uint8Array,
    palette: Uint8Array,
    scale: number,
    chamfer: number = 0.0)
    : Model
{
    const half = scale / 2;
    const width = Math.min(Math.max(chamfer, 0.0), 0.5) * scale;

    const solid = (x: number, y: number, z: number): boolean => {
        if (x < 0 || y < 0 || z < 0 || x >= dsize[0] || y >= dsize[1] || z >= dsize[2]) return false;
        return (gmap[z * dsize[0] * dsize[1] + y * dsize[0] + x] & 0x40) !== 0;
    };

    /** whether the voxel edge shared by faces `i` and `j` is a convex edge of the model */
    const convex = (x: number, y: number, z: number, i: number, j: number): boolean => {
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
    const traverse = (
        onFace: (x: number, y: number, z: number, p: number, i: number) => void,
        onEdge: (x: number, y: number, z: number, p: number, i: number, j: number) => void,
        onCorner: (x: number, y: number, z: number, p: number, i: number, j: number, k: number) => void,
        onSeam: (x: number, y: number, z: number, p: number, i: number, j: number, k: number) => void,
    ): void => {
        for (let z = 0; z < dsize[2]; z++) {
            for (let y = 0; y < dsize[1]; y++) {
                for (let x = 0; x < dsize[0]; x++) {
                    const p = z * dsize[0] * dsize[1] + y * dsize[0] + x;
                    if ((gmap[p] & 0x40) === 0) continue;

                    for (let i = 0; i < 6; i++) {
                        const d = FACE_DIRS[i];
                        if (!solid(x + d[0], y + d[1], z + d[2])) onFace(x, y, z, p, i);
                    }
                    if (width <= 0.0) continue;

                    for (const [i, j] of EDGE_PAIRS) {
                        const cut = convex(x, y, z, i, j);
                        beveled[i * 6 + j] = beveled[j * 6 + i] = cut;
                        if (cut) onEdge(x, y, z, p, i, j);
                    }
                    for (const [i, j, k] of CORNER_TRIPLES) {
                        if (beveled[i * 6 + j] && beveled[i * 6 + k] && beveled[j * 6 + k]) onCorner(x, y, z, p, i, j, k);
                    }

                    // A bevel is cut out of both voxels sharing the edge. Where the neighbour bevels
                    // an edge that this voxel keeps sharp (a step in the surface), the neighbour's cut
                    // uncovers a triangle of this voxel's shared face, which has to be filled in.
                    for (let k = 0; k < 6; k++) {
                        const d = FACE_DIRS[k];
                        const [nx, ny, nz] = [x + d[0], y + d[1], z + d[2]];
                        if (!solid(nx, ny, nz)) continue;

                        const [u, v] = FACE_AXES[k];
                        for (const i of [u, u ^ 1]) {
                            for (const j of [v, v ^ 1]) {
                                if (!beveled[i * 6 + j] && convex(nx, ny, nz, i, j)) onSeam(x, y, z, p, i, j, k);
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
    const corner = (x: number, y: number, z: number, i: number, du: number, dv: number): number[] => {
        const inset = (d: number): number => convex(x, y, z, i, d) ? width : 0.0;
        const [su, sv] = [half - inset(du), half - inset(dv)];
        const [n, u, v] = [FACE_DIRS[i], FACE_DIRS[du], FACE_DIRS[dv]];
        return [
            (x + 0.5 - dsize[0] / 2) * scale + half * n[0] + su * u[0] + sv * v[0],
            (y + 0.5) * scale + half * n[1] + su * u[1] + sv * v[1],
            (z + 0.5 - dsize[2] / 2) * scale + half * n[2] + su * u[2] + sv * v[2],
        ];
    };

    /** an uncut corner of the voxel, in the three given directions */
    const vertex = (x: number, y: number, z: number, i: number, j: number, k: number): number[] => {
        const [di, dj, dk] = [FACE_DIRS[i], FACE_DIRS[j], FACE_DIRS[k]];
        return [
            (x + 0.5 - dsize[0] / 2) * scale + half * (di[0] + dj[0] + dk[0]),
            (y + 0.5) * scale + half * (di[1] + dj[1] + dk[1]),
            (z + 0.5 - dsize[2] / 2) * scale + half * (di[2] + dj[2] + dk[2]),
        ];
    };

    /** the two corners of face `i` along its edge with face `j`, ordered low to high along `e` */
    const edgeCorners = (x: number, y: number, z: number, i: number, j: number, e: number[]): number[][] => {
        const [u, v] = FACE_AXES[i];
        const free = (u >> 1) === (j >> 1) ? v : u;
        const low = dot(FACE_DIRS[free], e) < 0 ? free : free ^ 1;
        return [corner(x, y, z, i, j, low), corner(x, y, z, i, j, low ^ 1)];
    };

    let vp = 0;
    const emit = (points: number[][], normal: number[], p: number): void => {
        const c = cmap[p];
        const color = [palette[c * 4 + 0], palette[c * 4 + 1], palette[c * 4 + 2]];
        for (const point of points) {
            model.indices[vp] = vp;
            model.vertexs.set(point, vp * 3);
            model.normals.set(normal, vp * 3);
            model.colors.set(color, vp * 3);
            vp++;
        }
    };

    /** a quad given as [c00, c10, c01, c11], wound so that cross(c10 - c00, c01 - c00) points outward */
    const quad = (c00: number[], c10: number[], c01: number[], c11: number[], normal: number[], p: number): void => {
        emit([c00, c10, c01, c11, c01, c10], normal, p);
    };

    traverse(
        (x, y, z, p, i) => {
            const [u, v] = FACE_AXES[i];
            quad(
                corner(x, y, z, i, u ^ 1, v ^ 1),
                corner(x, y, z, i, u, v ^ 1),
                corner(x, y, z, i, u ^ 1, v),
                corner(x, y, z, i, u, v),
                FACE_DIRS[i], p,
            );
        },
        (x, y, z, p, i, j) => {
            const e = cross(FACE_DIRS[i], FACE_DIRS[j]);
            const [i0, i1] = edgeCorners(x, y, z, i, j, e);
            const [j0, j1] = edgeCorners(x, y, z, j, i, e);
            const [di, dj] = [FACE_DIRS[i], FACE_DIRS[j]];
            quad(i0, j0, i1, j1, unit([di[0] + dj[0], di[1] + dj[1], di[2] + dj[2]]), p);
        },
        (x, y, z, p, i, j, k) => {
            const [di, dj, dk] = [FACE_DIRS[i], FACE_DIRS[j], FACE_DIRS[k]];
            const points = [corner(x, y, z, i, j, k), corner(x, y, z, j, i, k), corner(x, y, z, k, i, j)];
            const normal = unit([di[0] + dj[0] + dk[0], di[1] + dj[1] + dk[1], di[2] + dj[2] + dk[2]]);
            emit(dot(cross(di, dj), dk) > 0 ? points : [points[0], points[2], points[1]], normal, p);
        },
        (x, y, z, p, i, j, k) => {
            const [di, dj, dk] = [FACE_DIRS[i], FACE_DIRS[j], FACE_DIRS[k]];
            const base = vertex(x, y, z, i, j, k);
            const points = [
                base,
                [base[0] - width * di[0], base[1] - width * di[1], base[2] - width * di[2]],
                [base[0] - width * dj[0], base[1] - width * dj[1], base[2] - width * dj[2]],
            ];
            emit(dot(cross(di, dj), dk) > 0 ? points : [points[0], points[2], points[1]], dk, p);
        },
    );

    return model;
}
