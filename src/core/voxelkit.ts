import { Composit } from './model';
import { parseMOG } from './mog3d';
import { parseMOGOld } from './mog3d_old';
import { convertOBJ } from './obj';
import { convertVRM } from './vrm';
import { VRMMeta, buildVRMMeta } from './vrm_meta';

/**
 * Default jitter, as a ratio of the voxel size.
 *
 * Voxel models put a lot of surfaces on exactly the same plane. Most of all,
 * a model's layers are meshed one at a time, so where two layers touch both
 * of them emit the shared face and the two land at the same depth. Moving each
 * layer by this much, in a random direction, keeps them apart. The layer moves
 * as one piece, so nothing about its own surface changes.
 *
 * A hundredth of a voxel is small enough to be invisible — a tenth of a pixel
 * at the size a model is usually drawn — and large enough to clear the depth
 * buffer's resolution. Under a perspective camera with a near plane close to
 * the viewer, one step of a 24-bit depth buffer can be a few thousandths of a
 * voxel, so anything smaller than that rounds back onto the same depth and
 * changes nothing.
 */
const JITTER = 0.01;

export const voxelkit = {
    load(path: string, { scale = null, chamfer = 0.0, jitter = JITTER }: { scale?: number | null, chamfer?: number, jitter?: number } = {}): any {
        const extension = path.split('.').pop()?.toLowerCase();
        return fetch(path).then((response: Response) => response.blob())
        .then((blob: Blob) => {
            return voxelkit.parse(blob, { scale, chamfer, jitter, extension });
        })
    },
    parse(blob: Blob, { scale = null, chamfer = 0.0, jitter = JITTER, extension = 'mog' }: { scale?: number | null, chamfer?: number, jitter?: number, extension?: string } = {}) {
        switch (extension) {
            case 'mog': {
                // the old format is a text tree starting with '(', the current one is JSON
                return blob.slice(0, 1).text().then((head: string) => {
                    return head === '(' ? parseMOGOld(blob, scale, chamfer, jitter) : parseMOG(blob, scale, chamfer, jitter);
                });
            }

            // case 'vox':
            //     return loadVoxFormat(path);
            // case 'qb':
            //     return loadQubicleFormat(path);

            default:
                return Promise.reject(new Error(`Unsupported file format: ${extension}`));
        }
    },

    /**
     * Converts to VRM 1.0. The meta starts from the defaults, takes what the
     * `.mog` carries under `meta`, then whatever is passed here — the model's
     * name lives outside the file, so it comes in this way. Malformed values are ignored rather than written.
     */
    convertVRM(composit: Composit, { meta = {} }: { meta?: Partial<VRMMeta> } = {}) {
        return convertVRM(composit.models, composit.bones, buildVRMMeta(composit.meta, meta));
    },

    /**
     * Converts to Wavefront OBJ and its MTL. Bones are ignored: the mesh is
     * written in the pose it was modelled in. `mtlName` is the file name the
     * OBJ refers to, so save the MTL under the same name next to it.
     */
    convertOBJ(composit: Composit, { mtlName = 'model.mtl' }: { mtlName?: string } = {}) {
        return convertOBJ(composit.models, mtlName);
    }
};
