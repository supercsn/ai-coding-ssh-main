import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const PREFS_FILENAME = 'desktop-preferences.json';

function prefsPath() {
  return path.join(app.getPath('userData'), PREFS_FILENAME);
}

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * 隧道把远端 TCP 回送到本机的「CONNECT 出站」监听（常为 Clash 7890）。
 * @returns {{ localProxyHost: string, localProxyPort: number }}
 */
export function loadDesktopPreferences() {
  const merged = readJson(prefsPath(), {});

  const hostRaw =
    typeof merged.localProxyHost === 'string' && merged.localProxyHost.trim() !== ''
      ? merged.localProxyHost.trim()
      : typeof merged.forwardHost === 'string' && merged.forwardHost.trim() !== ''
        ? merged.forwardHost.trim()
        : '127.0.0.1';

  const portRaw =
    typeof merged.localProxyPort === 'number' && merged.localProxyPort > 0
      ? merged.localProxyPort
      : typeof merged.forwardPort === 'number' && merged.forwardPort > 0
        ? merged.forwardPort
        : 7890;

  return {
    localProxyHost: hostRaw,
    localProxyPort: portRaw,
  };
}

/**
 * @param {Partial<ReturnType<typeof loadDesktopPreferences>>} patch
 */
export function saveDesktopPreferences(patch) {
  const cur = loadDesktopPreferences();
  /** @typedef {ReturnType<typeof loadDesktopPreferences>} Prefs */
  const cleaned = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  );
  /** @type {Prefs} */
  const next = { ...cur, ...cleaned };

  /** 落盘仅存稳定字段名，顺带去掉历史 embedded 噪声 */
  writeJson(prefsPath(), {
    localProxyHost: next.localProxyHost,
    localProxyPort: next.localProxyPort,
  });
  return next;
}
