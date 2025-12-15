import { Model, MOG3DJSON } from './mog3d';

export const voxelkit = {
    load(path: string): Promise<Model> {
        return fetch(path).then(response => response.json()).then((json: MOG3DJSON) => new Model(json));
    }
};
