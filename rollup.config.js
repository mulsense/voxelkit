import typescript from '@rollup/plugin-typescript';
import { dts } from 'rollup-plugin-dts';
import { rmSync, cpSync } from 'fs';

function copyto(src, dst) {
    return {
        name: 'copyto',
        writeBundle() {
            cpSync(src, dst, { recursive: true, force: true });
        },
    };
}

export default [
    {
        input: './src/index.ts',
        output: [
            {
                file: './dist/voxelkit.js',
                format: 'umd',
                extend: true,
                name: 'voxelkit',
            },
            {
                file: './dist/voxelkit.mjs',
                format: 'es',
            },
        ],
        plugins: [
            typescript({ tsconfig: 'tsconfig.json' }),
            copyto('./dist/voxelkit.js', './examples/dist/voxelkit.js'),
            copyto('./dist/voxelkit.mjs', './examples/dist/voxelkit.mjs'),
        ],
        watch: {
            clearScreen: false,
        }
    },
    {
        input: './dist/types/index.d.ts',
        output: {
            file: './dist/voxelkit.d.ts',
            format: 'es',
        },
        plugins: [
            dts(),
            //cleanup('./dist/types'),
            copyto('./dist/voxelkit.d.ts', './examples/dist/voxelkit.d.ts'),
        ],
        watch: {
            clearScreen: false,
        }
    },
];