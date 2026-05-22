import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const SERVERS_FILE = 'servers.json';
const SECRETS_FILE = 'secrets.enc.json';

function serversPath() {
  return path.join(app.getPath('userData'), SERVERS_FILE);
}

function secretsPath() {
  return path.join(app.getPath('userData'), SECRETS_FILE);
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

export function encryptionAvailable() {
  return safeStorage.isEncryptionAvailable();
}

export function listServers() {
  const data = readJson(serversPath(), { servers: [] });
  return Array.isArray(data.servers) ? data.servers : [];
}

export function saveServerRecord(record) {
  const all = listServers();
  const idx = all.findIndex((s) => s.id === record.id);
  if (idx >= 0) all[idx] = record;
  else all.push(record);
  writeJson(serversPath(), { servers: all });
  return record;
}

export function deleteServerRecord(id) {
  const all = listServers().filter((s) => s.id !== id);
  writeJson(serversPath(), { servers: all });
  const sec = readJson(secretsPath(), {});
  if (sec[id]) {
    delete sec[id];
    writeJson(secretsPath(), sec);
  }
}

/** @typedef {{ password?: string, privateKey?: string, passphrase?: string }} SecretFields */

/**
 * Persist SSH secrets only (加密存储)。
 * @param {string} id
 * @param {SecretFields} fields
 * @returns {boolean}
 */
export function saveSecrets(id, fields) {
  if (!encryptionAvailable()) return false;
  const sec = readJson(secretsPath(), {});
  const entry = sec[id] || {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === '') {
      delete entry[k];
      continue;
    }
    if (typeof v !== 'string') continue;
    const enc = safeStorage.encryptString(v);
    entry[k] = Buffer.from(enc).toString('base64');
  }
  sec[id] = entry;
  writeJson(secretsPath(), sec);
  return true;
}

/**
 * @param {string} id
 * @returns {SecretFields}
 */
export function loadSecrets(id) {
  if (!encryptionAvailable()) return {};
  const sec = readJson(secretsPath(), {});
  const entry = sec[id];
  if (!entry) return {};
  /** @type {SecretFields} */
  const out = {};
  for (const [k, b64] of Object.entries(entry)) {
    try {
      const buf = Buffer.from(String(b64), 'base64');
      out[k] = safeStorage.decryptString(buf);
    } catch {
      /* skip */
    }
  }
  return out;
}
