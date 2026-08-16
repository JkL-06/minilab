@echo off
rem MiniLab launcher: make sure the local service is up, then open the dashboard.
set DATABASE_PATH=E:\MiniLab\data\minilab.db
set MINILAB_OPEN_BROWSER=1
netstat -ano | findstr ":3000 .*LISTENING" >nul
if errorlevel 1 (
  start "" "E:\MiniLab\dist-exe\MiniLab.exe"
  timeout /t 4 /nobreak >nul
)
start "" "http://localhost:3000"
