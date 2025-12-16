import { segment, hmMakeTableFromLngs, table256, zlDecode } from './code';
import { Vec3 } from './vector';
import { Bone } from './bone';
import { Model } from './model';

export async function loadMOG(path: string, scale: number): Promise<[Model[], Bone[]]> {
    const response = await fetch(path);
    const json = await response.json();

    const jsonmodel = json.models[0];
    const dsize = jsonmodel.dsize;
    const palette = Uint8Array.from(atob(jsonmodel.palette), c => c.charCodeAt(0));

    const models = jsonmodel.layers.map((jsonlayer: any) => {
        return decode(dsize, palette, jsonlayer.name, jsonlayer.gmap, jsonlayer.cmap, scale);
    });

    const bones: Bone[] = [];
    for(const jsonbone of (jsonmodel.bones ?? [])) {
        const parent = jsonbone.parent >= 0 ? bones[jsonbone.parent] : null
        const vec0 = Vec3.mul(new Vec3(jsonbone.vec0[0], jsonbone.vec0[1], jsonbone.vec0[2]), scale);
        const vec1 = Vec3.mul(new Vec3(jsonbone.vec1[0], jsonbone.vec1[1], jsonbone.vec1[2]), scale);
        bones.push(new Bone(parent, jsonbone.name, vec0, vec1, jsonbone.refs));
    }

    return [models, bones];
}

function decode(
    dsize: [number, number, number],
    palette: Uint8Array,
    name: string,
    codevmap: string,
    codecmap: string,
    scale: number)
    : Model
{
    const gmap = new Uint8Array(dsize[0] * dsize[1] * dsize[2]).fill(0);
    const cmap = new Uint8Array(dsize[0] * dsize[1] * dsize[2]).fill(0);

    const bin0 = Uint8Array.from(atob(codevmap), c => c.charCodeAt(0));
    const bin1 = Uint8Array.from(atob(codecmap), c => c.charCodeAt(0));
    if (bin0.length == 0) return new Model(name, 0);

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
    const model = new Model(name, cnt * 6);
    cnt = 0;
    for (let z = 0; z < dsize[2]; z++) {
        for (let y = 0; y < dsize[1]; y++) {
            for (let x = 0; x < dsize[0]; x++) {
                const p = z * dsize[0] * dsize[1] + y * dsize[0] + x;
                if ((gmap[p] & 0x3F) === 0) continue;

                const [x0, x1] = [(x + 0 - dsize[0] / 2) * scale, (x + 1 - dsize[0] / 2) * scale];
                const [y0, y1] = [(y + 0) * scale, (y + 1) * scale];
                const [z0, z1] = [(z + 0 - dsize[2] / 2) * scale, (z + 1 - dsize[2] / 2) * scale];

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

                    model.indices.set([cnt * 6 + 0, cnt * 6 + 1, cnt * 6 + 2, cnt * 6 + 3, cnt * 6 + 4, cnt * 6 + 5], cnt * 6);
                    model.vertexs.set(vtx, cnt * 18);
                    model.normals.set(nrm, cnt * 18);
                    model.colors.set(col, cnt * 18);
                    cnt++;
                }
            }
        }
    }

    return model;
}
