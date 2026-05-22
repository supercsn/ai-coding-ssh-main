# ai-coding-ssh

> [English](./README_EN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

本项目**只做一件事**：在 **Windows** 上通过 **SSH 反向端口转发（`-R`）**，把云服务器上的 TCP 送回你本机的 **Clash（或其它支持 `HTTP CONNECT` 的 HTTP 代理）**，并在云上把代理环境变量写入 **Claude Code 读取的云端配置** — `~/.claude/settings.json`。  
不再内置 Node「API 路径中继」、`ANTHROPIC_BASE_URL` 那套 shell env，也不再提供旧的 `bin/ai-coding-ssh` 一体化脚本。

---

## 你需要先准备什么

- 本机：**Clash** 等已在 `127.0.0.1:7890`（或你的实际端口）监听 **HTTP/MIXED**。
- 远端：**OpenSSH 服务端**、`claude` CLI（可用本仓库 `ai-coding-ssh-install-remote` 安装）。
- 推荐用 **`C:\Windows\System32\OpenSSH\ssh.exe`**；若用 WSL/Git Bash 里的 ssh，请自行保证 `-R ...:127.0.0.1:7890` 能打到 **Windows 侧**的 Clash。

---

## 一键隧道（不想开 Electron 时）

范本：[`scripts/windows/ClaudeSSH隧道.example.bat`](./scripts/windows/ClaudeSSH隧道.example.bat)  
逻辑等价于：

```bat
ssh.exe -N -o ExitOnForwardFailure=yes -R 18080:127.0.0.1:7890 user@host
```

远端 `18080` **只应**被这条 SSH `-R` 监听，不要在同端口再跑其它本地中继。

---

## Electron 桌面客户端（推荐）

### 安装与运行

```bash
npm install
npm start
```

首次安装依赖后，也可在资源管理器中 **双击** 项目根目录下的 [`start-app.bat`](./start-app.bat)，等效于在该目录执行 `npm start`。

### 操作顺序

1. **本机出站**：填 Clash 监听地址（默认 `127.0.0.1:7890`）→ 保存。  
2. **SSH 服务器**：填写主机、用户名、**远端反向端口**（与下文 settings 一致）、私钥或密码 → 保存。  
3. **连接（反向隧道）**。  
4. **写入 Claude settings**：合并写入远端 `~/.claude/settings.json` 中的：

```json
{
  "env": {
    "HTTP_PROXY": "http://127.0.0.1:18080",
    "HTTPS_PROXY": "http://127.0.0.1:18080",
    "NO_PROXY": "localhost,127.0.0.1,::1"
  }
}
```

端口数字与你在界面里配置的 **远端反向端口** 一致。应用会 **合并 JSON**，尽量保留你已有的其它字段。

5. 云上自测：

```bash
curl -v -x http://127.0.0.1:18080 https://api.anthropic.com/ -o /dev/null
```

应看到 `CONNECT` / `200 Connection established`。

### 打包

```bash
npm run package
npm run make
```

产物在 `out/`。

### Windows 通知区域（托盘）

在 **Windows** 上：**最小化** 或点击窗口 **关闭** 时会把主窗口隐藏到 **任务栏右侧通知区域**，SSH 隧道会保持。**左键单击**托盘图标（或右键「显示主窗口」）可再次打开。**退出**必须用托盘右键菜单里的「退出」（或关闭前已完全退出）。

---

## 在远端安装 Claude Code CLI（可选）

```bash
# 需要本机有 ssh，且远端能访问 npm（在线）
npx ai-coding-ssh-install-remote ubuntu@your.host
# 或使用 setup.sh 安装脚本到 PATH 后：
ai-coding-ssh-install-remote ubuntu@your.host
ai-coding-ssh-install-remote --offline ubuntu@your.host
```

---

## 项目结构（精简后）

```
ai-coding-ssh/
├── bin/
│   └── ai-coding-ssh-install-remote
├── scripts/windows/
│   └── ClaudeSSH隧道.example.bat
├── src/                    # Electron + React
├── forge.config.cjs
├── package.json
├── start-app.bat           # Windows 双击 → npm start
├── setup.sh
├── README.md
└── README_EN.md
```

---

## License

MIT
