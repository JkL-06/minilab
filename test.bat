@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js。请先安装 Node.js 20 或更高版本：https://nodejs.org/
  exit /b 1
)

if not exist node_modules (
  echo 首次运行，正在安装依赖…
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络后重试。
    exit /b 1
  )
)

echo 正在运行全部测试…
call npm test
endlocal
