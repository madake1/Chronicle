@echo off
setlocal
chcp 65001 >nul
if not exist "%~dp0runtime\node.exe" goto missing
if not exist "%~dp0app\portable-launch.mjs" goto missing
"%~dp0runtime\node.exe" "%~dp0app\portable-launch.mjs" start
if errorlevel 1 goto failed
exit /b 0
:missing
echo Chronicle: runtime or app files are missing. Re-extract the complete package.
:failed
if not "%CHRONICLE_NO_BROWSER%"=="1" pause
exit /b 1
