@echo off
REM 双击本文件：在本仓库根目录执行 npm start（需已安装 Node.js 且已在本目录执行过 npm install）
title Claude SSH 隧道 - npm start
cd /d "%~dp0"

where npm >nul 2>&1
if errorlevel 1 (
  echo 未找到 npm，请先安装 Node.js 并确保已加入 PATH。
  pause
  exit /b 1
)

if not exist "package.json" (
  echo 当前目录下没有 package.json，请勿移动本 bat 文件。
  pause
  exit /b 1
)

call npm start
if errorlevel 1 (
  echo.
  echo npm start 结束且返回错误，请查看上方输出。
  pause
)
