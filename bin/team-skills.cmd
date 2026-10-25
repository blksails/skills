@echo off
setlocal
where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  py -3 "%~dp0..\scripts\team_skills.py" %*
) else (
  python "%~dp0..\scripts\team_skills.py" %*
)
exit /b %ERRORLEVEL%
