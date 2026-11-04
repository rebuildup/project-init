@echo off
setlocal
bun "%USERPROFILE%\.dotfiles\script\ocr-go-key.ts"
exit /b %errorlevel%
