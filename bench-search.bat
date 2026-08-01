@echo off
setlocal
REM Usage: bench-search.bat [depth] [play|analysis|both] [compare|zobrist|attackbits|incr|full|eager|grid]
REM Examples:
REM   bench-search.bat 8 play
REM   bench-search.bat 8 play compare
REM   bench-search.bat 8 play zobrist
REM   bench-search.bat 8 play attackbits

set "DEPTH=%~1"
if "%DEPTH%"=="" set "DEPTH=8"
set "MODE=%~2"
if "%MODE%"=="" set "MODE=play"
set "PATHMODE=%~3"

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
) else (
  set "OUT=scripts\bench-d%DEPTH%-latest.txt"
)

REM Tee-Object 是 PowerShell 命令，不能直接写在 cmd 的 .bat 里
if "%PATHMODE%"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "node scripts/bench-search.mjs %DEPTH% %MODE% 2>&1 | Tee-Object -FilePath '%OUT%'"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "node scripts/bench-search.mjs %DEPTH% %MODE% %PATHMODE% 2>&1 | Tee-Object -FilePath '%OUT%'"
)

echo.
echo Saved: %OUT%
echo JSON also written by bench-search.mjs under scripts\
pause
