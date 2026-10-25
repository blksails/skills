@echo off
call "%~dp0..\bin\team-skills.cmd" check-update 2>nul
call "%~dp0..\bin\team-skills.cmd" check-policy 2>nul
exit /b 0
