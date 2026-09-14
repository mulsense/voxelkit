import { voxelkit } from './core/voxelkit';

// types only: a runtime export here would move the UMD/CommonJS bundle's
// `voxelkit` under `.default`
export type { Composit } from './core/model';
export type { VRMMeta } from './core/vrm_meta';

export default voxelkit;
