@echo off
setlocal EnableExtensions

pushd "%~dp0" >nul 2>&1
if errorlevel 1 (
  echo ERROR: Cannot switch to the project directory.
  exit /b 1
)

REM Usage: bench.bat [depth] [play^|analysis^|both] [latest^|cpuperf^|profile]
set "DEPTH=%~1"
if "%DEPTH%"=="" set "DEPTH=12"
set "MODE=%~2"
if "%MODE%"=="" set "MODE=play"
set "PATHMODE=%~3"
if "%PATHMODE%"=="" set "PATHMODE=latest"

set "NON_DIGIT="
for /f "delims=0123456789" %%A in ("%DEPTH%") do set "NON_DIGIT=%%A"
if defined NON_DIGIT (
  echo ERROR: Invalid depth "%DEPTH%". Expected an integer from 1 to 255.
  goto :fail
)
set /a DEPTH_VALUE=%DEPTH% >nul 2>&1
if errorlevel 1 (
  echo ERROR: Invalid depth "%DEPTH%". Expected an integer from 1 to 255.
  goto :fail
)
if %DEPTH_VALUE% LSS 1 (
  echo ERROR: Invalid depth "%DEPTH%". Expected an integer from 1 to 255.
  goto :fail
)
if %DEPTH_VALUE% GTR 255 (
  echo ERROR: Invalid depth "%DEPTH%". Expected an integer from 1 to 255.
  goto :fail
)

if /I "%MODE%"=="play" goto :mode_ok
if /I "%MODE%"=="analysis" goto :mode_ok
if /I "%MODE%"=="both" goto :mode_ok
echo ERROR: Invalid mode "%MODE%". Expected play, analysis, or both.
goto :fail

:mode_ok
if /I "%PATHMODE%"=="latest" (
  set "OUT=scripts\bench-d%DEPTH%-latest.txt"
  goto :path_ok
)
if /I "%PATHMODE%"=="cpuperf" (
  set "OUT=scripts\bench-d%DEPTH%-cpuperf.txt"
  goto :path_ok
)
if /I "%PATHMODE%"=="profile" (
  set "OUT=scripts\bench-d%DEPTH%-profile.txt"
  goto :path_ok
)
echo ERROR: Invalid path "%PATHMODE%". Expected latest, cpuperf, or profile.
goto :fail

:path_ok
where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: node.exe was not found in PATH.
  goto :fail
)
if not exist "scripts\bench-search.mjs" (
  echo ERROR: scripts\bench-search.mjs was not found.
  goto :fail
)
if not exist "scripts\bench-worker.mjs" (
  echo ERROR: scripts\bench-worker.mjs was not found.
  goto :fail
)
if not exist "src\engine\js\search.js" (
  echo ERROR: src\engine\js\search.js was not found.
  goto :fail
)

echo Running modular engine benchmark: depth=%DEPTH%, mode=%MODE%, path=%PATHMODE%
echo Output will be written to: %OUT%
echo.

node scripts/bench-search.mjs %DEPTH% %MODE% %PATHMODE% > "%OUT%" 2>&1
set "EXIT_CODE=%ERRORLEVEL%"

if exist "%OUT%" (
  type "%OUT%"
) else (
  echo ERROR: Benchmark did not create %OUT%.
  set "EXIT_CODE=1"
)

echo.
echo Log saved: %OUT%
if not "%EXIT_CODE%"=="0" echo ERROR: Benchmark exited with code %EXIT_CODE%.
echo Press any key to exit...
pause >nul

popd
endlocal & exit /b %EXIT_CODE%

:fail
echo.
echo Benchmark was not started.
echo Press any key to exit...
pause >nul
popd
endlocal & exit /b 1

