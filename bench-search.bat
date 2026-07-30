@echo off
setlocal
REM Usage: bench-search.bat [depth] [play|analysis|both]
REM Example: bench-search.bat 8 play

set "DEPTH=%~1"
if "%DEPTH%"=="" set "DEPTH=8"
set "MODE=%~2"
if "%MODE%"=="" set "MODE=play"

set "OUT=scripts\bench-d%DEPTH%-latest.txt"

REM Tee-Object 是 PowerShell 命令，不能直接写在 cmd 的 .bat 里
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "node scripts/bench-search.mjs %DEPTH% %MODE% 2>&1 | Tee-Object -FilePath '%OUT%'"

echo.
echo Saved: %OUT%
pause
