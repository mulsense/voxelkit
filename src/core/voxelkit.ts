import { Composit } from './model';
import { parseMOG } from './mog3d';
import { parseMOGOld } from './mog3d_old';
import { convertVRM } from './vrm';

/**
 * Default vertex jitter, as a ratio of the voxel size.
 *
 * Voxel models put a lot of surfaces on exactly the same plane. Most of all,
 * a model's layers are meshed one at a time, so where two layers touch both
 * of them emit the shared face and the two land at the same depth. A small
 * displacement keeps them apart. See `buildModel` for what it costs.
 */
const JITTER = 0.001;

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

    convertVRM(composit: Composit) {
        return convertVRM(composit.models, composit.bones);
    }
};
