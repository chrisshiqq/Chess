@echo off
setlocal

pushd "%~dp0" >nul 2>&1
if errorlevel 1 (
  echo ERROR: Cannot switch to the project directory.
  exit /b 1
)

REM Usage: bench-search.bat [depth] [play^|analysis^|both] [mode]
REM Modes: compare, zobrist, attackbits, relmasks, moveseq, leafeval,
REM        leafrelations, fastsort, piecelist, ttfifo, profile, cpuperf,
REM        incr, full, eager, grid

set "DEPTH=%~1"
if "%DEPTH%"=="" set "DEPTH=8"
set "MODE=%~2"
if "%MODE%"=="" set "MODE=play"
set "PATHMODE=%~3"
if "%PATHMODE%"=="" set "PATHMODE=cpuperf"

if /I "%PATHMODE%"=="compare" (
  set "OUT=scripts\bench-d%DEPTH%-legality-compare.txt"
) else if /I "%PATHMODE%"=="zobrist" (
  set "OUT=scripts\bench-d%DEPTH%-zobrist-compare.txt"
) else if /I "%PATHMODE%"=="hash" (
  set "OUT=scripts\bench-d%DEPTH%-zobrist-compare.txt"
) else if /I "%PATHMODE%"=="attackbits" (
  set "OUT=scripts\bench-d%DEPTH%-attackbits-compare.txt"
) else if /I "%PATHMODE%"=="bits" (
  set "OUT=scripts\bench-d%DEPTH%-attackbits-compare.txt"
) else if /I "%PATHMODE%"=="leafbits" (
  set "OUT=scripts\bench-d%DEPTH%-attackbits-compare.txt"
) else if /I "%PATHMODE%"=="relmasks" (
  set "OUT=scripts\bench-d%DEPTH%-relmasks-compare.txt"
) else if /I "%PATHMODE%"=="masks" (
  set "OUT=scripts\bench-d%DEPTH%-relmasks-compare.txt"
) else if /I "%PATHMODE%"=="relationmasks" (
  set "OUT=scripts\bench-d%DEPTH%-relmasks-compare.txt"
) else if /I "%PATHMODE%"=="leafrelations" (
  set "OUT=scripts\bench-d%DEPTH%-leafrelations-compare.txt"
) else if /I "%PATHMODE%"=="fastsort" (
  set "OUT=scripts\bench-d%DEPTH%-fastsort-compare.txt"
) else if /I "%PATHMODE%"=="piecelist" (
  set "OUT=scripts\bench-d%DEPTH%-piecelist-compare.txt"
) else if /I "%PATHMODE%"=="ttfifo" (
  set "OUT=scripts\bench-d%DEPTH%-ttfifo-compare.txt"
) else if /I "%PATHMODE%"=="profile" (
  set "OUT=scripts\bench-d%DEPTH%-profile.txt"
) else if /I "%PATHMODE%"=="cpuperf" (
  set "OUT=scripts\bench-d%DEPTH%-cpuperf.txt"
) else (
  set "OUT=scripts\bench-d%DEPTH%-latest.txt"
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
echo JSON is written by bench-search.mjs under scripts\
if not "%EXIT_CODE%"=="0" echo ERROR: Benchmark exited with code %EXIT_CODE%.
echo Press any key to exit...
pause >nul

popd
endlocal & exit /b %EXIT_CODE%
