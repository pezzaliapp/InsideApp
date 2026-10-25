@echo off
rem Avvia InsideApp dal checkout locale con il Node della toolchain isolata.
rem Non usa npx, npm install -g ne il Node globale. INSIDEAPP_NODE puo indicare
rem un altro node.exe compatibile con package.json#engines.
setlocal
set "INSIDEAPP_ROOT=%~dp0.."
for /f "usebackq delims=" %%v in ("%INSIDEAPP_ROOT%\.nvmrc") do set "INSIDEAPP_VERSION=%%v"
set "INSIDEAPP_ARCH=x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "INSIDEAPP_ARCH=arm64"
set "INSIDEAPP_NODE_EXE=%INSIDEAPP_NODE%"
if not defined INSIDEAPP_NODE_EXE set "INSIDEAPP_NODE_EXE=%USERPROFILE%\.insideapp\toolchain\node-v%INSIDEAPP_VERSION%-win-%INSIDEAPP_ARCH%\node.exe"
rem Nessun blocco tra parentesi: un percorso con ")" lo chiuderebbe.
if exist "%INSIDEAPP_NODE_EXE%" goto run
echo InsideApp: Node %INSIDEAPP_VERSION% non trovato in "%INSIDEAPP_NODE_EXE%". 1>&2
echo Installa la toolchain isolata, vedi README.md, o imposta INSIDEAPP_NODE. 1>&2
exit /b 1
:run
"%INSIDEAPP_NODE_EXE%" "%INSIDEAPP_ROOT%\scripts\rea.mjs" %*
exit /b %ERRORLEVEL%
