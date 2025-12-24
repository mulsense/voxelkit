import { Composit } from './model';
import { loadMOG } from './mog3d';
import { convertVRM } from './vrm';

export const voxelkit = {
    load(path: string, { scale = null }: { scale?: number | null } = {}): any {
        const extension = path.split('.').pop()?.toLowerCase();

        switch (extension) {
            case 'mog': {
                return loadMOG(path, scale);
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
