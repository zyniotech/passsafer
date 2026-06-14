@echo off
setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
set NATIVE_HOST_BAT=%SCRIPT_DIR%native-host.bat
set MANIFEST_FILE=%SCRIPT_DIR%de.passsafer.helper.json

:: Backslashes verdoppeln für JSON
set "NATIVE_HOST_PATH=%NATIVE_HOST_BAT:\=\\%"

echo Installing PassSafer Native Messaging Host...
echo Script Dir: %SCRIPT_DIR%
echo Native Host: %NATIVE_HOST_BAT%

:: Generate de.passsafer.helper.json with absolute path
(
echo {
echo   "name": "de.passsafer.helper",
echo   "description": "PassSafer Native Messaging Host",
echo   "path": "%NATIVE_HOST_PATH%",
echo   "type": "stdio",
echo   "allowed_origins": [
echo     "chrome-extension://iimaibjnobgoecdbaeojkaikbkfbdhme/"
echo   ]
echo }
) > "%MANIFEST_FILE%"

echo Manifest written: %MANIFEST_FILE%

:: Google Chrome
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\de.passsafer.helper" /ve /t REG_SZ /d "%MANIFEST_FILE%" /f >nul

:: Brave Browser
reg add "HKCU\Software\BraveSoftware\Brave\NativeMessagingHosts\de.passsafer.helper" /ve /t REG_SZ /d "%MANIFEST_FILE%" /f >nul

:: Microsoft Edge
reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\de.passsafer.helper" /ve /t REG_SZ /d "%MANIFEST_FILE%" /f >nul

echo.
echo Installation complete for Chrome, Brave, and Edge!
echo Please restart your browser for changes to take effect.
echo.
pause
