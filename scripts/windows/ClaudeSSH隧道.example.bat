@echo off
REM 使用前请修改为：你的密钥路径、远端用户与主机。
REM Windows 推荐使用 %SystemRoot%\System32\OpenSSH\ssh.exe，并且先启动本机 Clash（常见 MIXED PORT 默认 7890）。
title Claude SSH Reverse Tunnel — remote 18080 -> local HTTP proxy

set SSH=C:\Windows\System32\OpenSSH\ssh.exe
set KEY=%USERPROFILE%\.ssh\id_ed25519_example
set USER_HOST=ubuntu@your.cloud.host

"%SSH%" ^
  -N ^
  -o ExitOnForwardFailure=yes ^
  -o ServerAliveInterval=60 ^
  -o ServerAliveCountMax=3 ^
  -i "%KEY%" ^
  -R 18080:127.0.0.1:7890 ^
  "%USER_HOST%"

echo Tunnel exited with errorlevel %ERRORLEVEL%.
pause
