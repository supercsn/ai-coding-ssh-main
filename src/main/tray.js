import { Tray, Menu, nativeImage } from 'electron';

/** @type {Electron.Tray | null} */
let tray = null;

/**
 * Windows 托盘 16×16 BGRA 位图（避免依赖额外 PNG/ICO 资源文件）。
 */
function createTrayNativeImage() {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  // #2d8cff 左右色 / 不透明
  const b = 0xff;
  const g = 0x8c;
  const r = 0x2d;
  const a = 0xff;
  for (let i = 0; i < size * size; i++) {
    const o = i * 4;
    buf[o] = b;
    buf[o + 1] = g;
    buf[o + 2] = r;
    buf[o + 3] = a;
  }
  return nativeImage.createFromBitmap(buf, {
    width: size,
    height: size,
  });
}

/**
 * @param {object} api
 * @param {() => void} api.showMainWindow
 * @param {() => void} api.quitApp 完全退出（将关闭 SSH 隧道）
 */
export function setupTray({ showMainWindow, quitApp }) {
  if (tray) return;

  tray = new Tray(createTrayNativeImage());
  tray.setToolTip('Claude SSH 隧道');

  const menu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => showMainWindow(),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => quitApp(),
    },
  ]);

  tray.setContextMenu(menu);

  tray.on('click', () => showMainWindow());
}

export function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
