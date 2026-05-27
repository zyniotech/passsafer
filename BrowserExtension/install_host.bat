@echo off
set MANIFEST_PATH=%~dp0de.passsafer.helper.json

echo Installing PassSafer Native Messaging Host...
echo Path: %MANIFEST_PATH%

:: Google Chrome
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\de.passsafer.helper" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul

:: Brave Browser
reg add "HKCU\Software\BraveSoftware\Brave\NativeMessagingHosts\de.passsafer.helper" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul

:: Microsoft Edge
reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\de.passsafer.helper" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul

echo.
echo Installation complete for Chrome, Brave, and Edge!
echo Please restart your browser for changes to take effect.
echo.
pause
