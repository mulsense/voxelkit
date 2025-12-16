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
        ],
        watch: {
            clearScreen: false,
        }
    },
];