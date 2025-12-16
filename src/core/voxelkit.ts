import { loadMOG } from './mog3d';
import { convertVRM } from './vrm';

export const voxelkit = {
    load(path: string, options: { format: string, scale: number } = { format: 'vrm', scale: 1 / 32 }): any {
        const extension = path.split('.').pop()?.toLowerCase();

        switch (extension) {
            case 'mog': {
                return loadMOG(path, options.scale).then(([models, bones]) => {
                    return convertVRM(models, bones);
                });
            }

            // case 'vox':
            //     return loadVoxFormat(path);
            // case 'qb':
            //     return loadQubicleFormat(path);

            default:
                return Promise.reject(new Error(`Unsupported file format: ${extension}`));
        }
    }
};
