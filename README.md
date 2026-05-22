# Claude SSH 隧道（Windows）

> [English](./README_EN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Windows 桌面客户端：通过 **SSH 反向端口转发（`-R`）**，把云服务器上的 TCP 流量转回你本机的 **Clash**（或其它支持 `HTTP CONNECT` 的 HTTP 代理），并一键合并写入远端 **Claude Code** 读取的配置 `~/.claude/settings.json`。

![Claude SSH 隧道界面](./demo.png)

---

## 适用场景

在腾讯云、AWS 等 VPS 上运行 **Claude Code / `claude` CLI**，但希望 API 请求走 **Windows 本机 Clash 出站**。本工具用图形界面完成 SSH 隧道建立、连接状态管理与远端代理配置写入，无需手敲 `ssh -R`。

---

## 你需要先准备什么

| 位置 | 要求 |
|------|------|
| **本机 Windows** | Clash 等已在 `127.0.0.1:7890`（或你的实际端口）监听 **HTTP/MIXED** |
| **云服务器** | OpenSSH 服务端；已安装或可安装 `claude` CLI |
| **SSH 凭据** | 私钥文件路径，或密码（可同时配置，任一有效即可） |

> 隧道进程需能访问 **Windows 侧**的 Clash。若用 WSL/Git Bash 里的 `ssh`，请自行确认 `-R ...:127.0.0.1:7890` 能打到本机代理。

---

## 安装与运行

```bash
npm install
npm start
```

首次 `npm install` 后，也可 **双击** 项目根目录 [`start-app.bat`](./start-app.bat)，等效于 `npm start`。

**环境要求**：Node.js ≥ 18

---

## 使用步骤

界面分为三块，按顺序操作即可：

### 1. 本机出站（Clash）

填写 Clash 的 **HTTP/MIXED** 监听地址（默认 `127.0.0.1:7890`）→ **保存出站设置**。  
顶部绿色状态 pill 显示 `TCP 可达` 表示本机代理已就绪。

### 2. SSH 服务器

填写主机、用户名、SSH 端口、**远端反向端口**（默认 `18080`）、私钥路径或密码 → **保存配置**。

### 3. 连接与写入 Claude 配置

1. 选择已保存的服务器 → **连接（反向隧道）**
2. 连接成功后 → **写入 Claude settings**

写入内容会 **合并** 到远端 `~/.claude/settings.json`（保留你已有的其它字段）：

```json
{
  "env": {
    "HTTP_PROXY": "http://127.0.0.1:18080",
    "HTTPS_PROXY": "http://127.0.0.1:18080",
    "NO_PROXY": "localhost,127.0.0.1,::1"
  }
}
```

其中 `18080` 需与你在界面配置的 **远端反向端口** 一致。

### 4. 云上自测

```bash
curl -v -x http://127.0.0.1:18080 https://api.anthropic.com/ -o /dev/null
```

应看到 `CONNECT` / `200 Connection established`。

---

## Windows 托盘说明

- **最小化** 或点击窗口 **关闭**：主窗口隐藏到任务栏右侧通知区域，**SSH 隧道保持运行**
- **左键单击**托盘图标：重新显示主窗口
- **真正退出**：托盘右键 → **退出**（会先清理 SSH 隧道）

> 请勿只关窗口后再双击 `start-app.bat` 以为「重启」——旧进程可能仍在托盘里占用远端端口。本应用已启用 **单实例锁**，重复启动会聚焦已有窗口。

---

## 常见问题

### WiFi / 网络中断后「断开」无反应

网络断开后 SSH 可能僵死。本版本已做以下处理：

- 断开操作 **8 秒超时** 后强制关闭连接
- SSH **keepalive** 自动检测断线并更新界面状态
- 连接/断开按钮显示 **进行中** 状态

若仍无法重连，请 **托盘右键退出** 后再启动。

### 重连提示远端端口被占用

占用的通常是 **云服务器上的远端反向端口**（如 `18080`），不是本机 `7890`。  
在云上检查：

```bash
ss -tlnp | grep 18080
```

结束残留的 `sshd` 会话，或等待服务端释放端口后再连。远端该端口 **只应** 被本条 SSH `-R` 使用。

---

## 命令行替代（可选）

不想开 Electron 时，可参考 [`scripts/windows/ClaudeSSH隧道.example.bat`](./scripts/windows/ClaudeSSH隧道.example.bat)：

```bat
ssh.exe -N -o ExitOnForwardFailure=yes -R 18080:127.0.0.1:7890 user@host
```

---

## 在远端安装 Claude Code CLI（可选）

```bash
npx ai-coding-ssh-install-remote ubuntu@your.host
# 或 setup.sh 安装到 PATH 后：
ai-coding-ssh-install-remote ubuntu@your.host
ai-coding-ssh-install-remote --offline ubuntu@your.host
```

---

## 打包

```bash
npm run package
npm run make
```

产物在 `out/`。

---

## 项目结构

```
ai-coding-ssh/
├── demo.png                # 界面截图
├── src/                    # Electron 主进程 + React 界面
├── scripts/windows/        # 命令行隧道范本
├── bin/                    # 远端 Claude CLI 安装脚本
├── start-app.bat           # Windows 双击启动
├── forge.config.cjs
└── package.json
```

---

## License

MIT
