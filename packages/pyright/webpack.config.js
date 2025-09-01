/**
 * webpack.config-cli.js
 * Copyright: Microsoft 2018
 */

const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const webpack = require('webpack');
// Standalone build: avoid monorepo webpack helpers

const outPath = path.resolve(__dirname, 'dist');
const typeshedFallback = path.resolve(__dirname, '..', 'pyright-internal', 'typeshed-fallback');

/**@type {(env: any, argv: { mode: 'production' | 'development' | 'none' }) => import('webpack').Configuration}*/
module.exports = (_, { mode }) => {
    return {
        context: __dirname,
        entry: {
            pyright: './src/pyright.ts',
            'pyright-langserver': './src/langserver.ts',
        },
        target: 'node',
        output: {
            filename: '[name].js',
            path: outPath,
            devtoolModuleFilenameTemplate: '../[resource-path]',
            clean: true,
        },
        devtool: mode === 'development' ? 'source-map' : 'nosources-source-map',
        cache: false,
        stats: {
            all: false,
            errors: true,
            warnings: true,
            publicPath: true,
            timings: true,
        },
        resolve: {
            extensions: ['.ts', '.js', '.json'],
            alias: {
                'pyright-internal': path.resolve(__dirname, '..', 'pyright-internal', 'src'),
                '../../../../package.json': path.resolve(__dirname, '..', '..', 'package.json'),
            },
        },
        externals: {
            fsevents: 'commonjs2 fsevents',
        },
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    loader: 'ts-loader',
                    options: {
                        configFile: 'tsconfig.json',
                    },
                },
                {
                    // Transform pre-compiled JS files to use syntax available in Node 12+.
                    // esbuild is fast, so let it run on all JS files rather than matching
                    // only known-bad libs. ts-loader does this for us for TypeScript files.
                    test: /\.js$/,
                    loader: 'esbuild-loader',
                    options: {
                        target: 'node12',
                    },
                },
            ],
        },
        plugins: [
            new CopyPlugin({ patterns: [{ from: typeshedFallback, to: 'typeshed-fallback' }] }),
            // Map pyright-internal's '../../../../package.json' to this package's package.json
            new webpack.NormalModuleReplacementPlugin(
                /^\.\.\/\.\.\/\.\.\/package\.json$/,
                path.resolve(__dirname, 'package.json')
            ),
        ],
        optimization: {
            splitChunks: {
                cacheGroups: {
                    defaultVendors: {
                        name: 'vendor',
                        test: /[\\/]node_modules[\\/]/,
                        chunks: 'all',
                        priority: -10,
                    },
                    pyright: {
                        name: 'pyright-internal',
                        chunks: 'all',
                        test: /[\\/]pyright-internal[\\/]/,
                        priority: -20,
                    },
                },
            },
        },
    };
};
