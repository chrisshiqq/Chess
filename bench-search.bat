@echo off
setlocal

pushd "%~dp0" >nul 2>&1
if errorlevel 1 (
  echo ERROR: Cannot switch to the project directory.
  exit /b 1
)

REM Usage: bench-search.bat [depth] [play^|analysis^|both] [cpuperf^|profile]
set "DEPTH=%~1"
if "%DEPTH%"=="" set "DEPTH=8"
set "MODE=%~2"
if "%MODE%"=="" set "MODE=play"
set "PATHMODE=%~3"
if "%PATHMODE%"=="" set "PATHMODE=cpuperf"

if /I "%PATHMODE%"=="profile" (
  set "OUT=scripts\bench-d%DEPTH%-profile.txt"
) else (
  set "OUT=scripts\bench-d%DEPTH%-cpuperf.txt"
)

echo Running benchmark: depth=%DEPTH%, mode=%MODE%, path=%PATHMODE%
echo Output will be written to: %OUT%
echo.

node scripts/bench-search.mjs %DEPTH% %MODE% %PATHMODE% > "%OUT%" 2>&1
set "EXIT_CODE=%ERRORLEVEL%"

if exist "%OUT%" (
  type "%OUT%"
) else (
  echo ERROR: Benchmark did not create %OUT%.
)

echo.
echo Log saved: %OUT%
if not "%EXIT_CODE%"=="0" echo ERROR: Benchmark exited with code %EXIT_CODE%.
echo Press any key to exit...
pause >nul

popd
endlocal & exit /b %EXIT_CODE%
