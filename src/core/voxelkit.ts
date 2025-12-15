import { Model, loadMOG } from './mog3d';

export const voxelkit = {
    load(path: string): Promise<Model> {
        const extension = path.split('.').pop()?.toLowerCase();

        switch (extension) {
            case 'mog': return loadMOG(path);

            // 将来的に他のフォーマットをここに追加
            // case 'vox':
            //     return loadVoxFormat(path);
            // case 'qb':
            //     return loadQubicleFormat(path);

            default:
                return Promise.reject(new Error(`Unsupported file format: ${extension}`));
        }
    }
};
