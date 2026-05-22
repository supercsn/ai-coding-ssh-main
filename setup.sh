#!/usr/bin/env bash
# 仅安装远端 Claude Code 辅助脚本；SSH 隧道请用本仓库 Windows 桌面客户端或 scripts/windows 下 .bat 示例。

set -euo pipefail

GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

INSTALL_DIR="${HOME}/.ai-coding-ssh"
BIN_DIR="${HOME}/.local/bin"

echo -e "${CYAN}Installing ai-coding-ssh (install-remote helper only)...${NC}"

mkdir -p "$INSTALL_DIR/bin"
mkdir -p "$BIN_DIR"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cp "$SCRIPT_DIR/bin/ai-coding-ssh-install-remote" "$INSTALL_DIR/bin/"
chmod +x "$INSTALL_DIR/bin/ai-coding-ssh-install-remote"
ln -sf "$INSTALL_DIR/bin/ai-coding-ssh-install-remote" "$BIN_DIR/ai-coding-ssh-install-remote"

echo -e "${GREEN}[✓]${NC} Installed $INSTALL_DIR/bin/ai-coding-ssh-install-remote"
echo -e "${GREEN}[✓]${NC} Symlink: $BIN_DIR/ai-coding-ssh-install-remote"
echo ""
echo "Claude Code CLI on remote:"
echo -e "  ${CYAN}ai-coding-ssh-install-remote ubuntu@your.host${NC}"
echo ""
echo "Reverse tunnel + ~/.claude/settings.json: use the Electron app on Windows (npm start) or scripts/windows/ClaudeSSH隧道.example.bat"
