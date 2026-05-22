# ai-coding-ssh

> [中文](./README.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

This project has a **single workflow**: on **Windows**, use an **SSH reverse port forward (`-R`)** to send remote TCP back to your local **Clash** (or any **HTTP `CONNECT`-capable** listener), then **merge** `HTTP_PROXY` / `HTTPS_PROXY` into the remote **`~/.claude/settings.json`** that **Claude Code** reads.

We **removed** the old embedded Node path-based API relay, `ANTHROPIC_BASE_URL` shell env automation, and the legacy all-in-one `bin/ai-coding-ssh` script.

## Prereqs

- Local: Clash (or similar) listening on e.g. `127.0.0.1:7890` for HTTP/MIXED.
- Remote: OpenSSH server; `claude` CLI (install helper: `ai-coding-ssh-install-remote`).
- Prefer **`C:\Windows\System32\OpenSSH\ssh.exe`**. If you use WSL/Git Bash `ssh`, ensure `-R ...:127.0.0.1:7890` reaches the **Windows** listener.

## Batch template (no Electron)

See [`scripts/windows/ClaudeSSH隧道.example.bat`](./scripts/windows/ClaudeSSH隧道.example.bat).

## Electron app

```bash
npm install
npm start
```

On Windows you can double-click **`start-app.bat`** in the repo root after `npm install` (same as `npm start`).

Flow: set local outbound (Clash) → save SSH server + remote reverse port → **Connect** → **Write Claude settings** (merges `~/.claude/settings.json`).

```bash
npm run package
npm run make
```

### Windows system tray

On **Windows**, **minimize** or the window **Close** button **hides** the main UI to the **notification area** (by the clock); SSH tunnels keep running until you choose **Exit** from the tray menu (or quit fully). Left-click the tray icon to show the window again.

## Remote Claude Code install (optional)

```bash
npx ai-coding-ssh-install-remote user@host
# or after setup.sh
ai-coding-ssh-install-remote --offline user@host
```

## License

MIT
