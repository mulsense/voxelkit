import { Composit } from './model';
import { parseMOG } from './mog3d';
import { parseMOGOld } from './mog3d_old';
import { convertVRM } from './vrm';

export const voxelkit = {
    load(path: string, { scale = null, chamfer = 0.0 }: { scale?: number | null, chamfer?: number } = {}): any {
        const extension = path.split('.').pop()?.toLowerCase();
        return fetch(path).then((response: Response) => response.blob())
        .then((blob: Blob) => {
            return voxelkit.parse(blob, { scale, chamfer, extension });
        })
    },
    parse(blob: Blob, { scale = null, chamfer = 0.0, extension = 'mog' }: { scale?: number | null, chamfer?: number, extension?: string } = {}) {
        switch (extension) {
            case 'mog': {
                // the old format is a text tree starting with '(', the current one is JSON
                return blob.slice(0, 1).text().then((head: string) => {
                    return head === '(' ? parseMOGOld(blob, scale, chamfer) : parseMOG(blob, scale, chamfer);
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
