const { VitePlugin } = require('@electron-forge/plugin-vite');
const { AutoUnpackNativesPlugin } = require('@electron-forge/plugin-auto-unpack-natives');

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  packagerConfig: {
    asar: true,
    /** 整包移出 asar；cpu-features 为 ssh2 可选原生依赖，一并解压 */
    asarUnpack: ['**/node_modules/ssh2/**', '**/node_modules/cpu-features/**'],
    name: 'ai-coding-ssh-desktop',
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'ai_coding_ssh_desktop',
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'win32'],
    },
  ],
  plugins: [
    new AutoUnpackNativesPlugin(),
    new VitePlugin({
      build: [
        {
          entry: 'src/main/main.js',
          config: 'vite.main.config.mjs',
        },
        {
          entry: 'src/preload/preload.js',
          config: 'vite.preload.config.mjs',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mjs',
        },
      ],
    }),
  ],
};
