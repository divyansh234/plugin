@echo off
for %%v in (9 10 11 12 13) do reg add HKCU\Software\Adobe\CSXS.%%v /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
rmdir /S /Q "%APPDATA%\Adobe\CEP\extensions\FolderDrop" 2>nul
set DEST=%APPDATA%\Adobe\CEP\extensions\Dropzone
mkdir "%DEST%" 2>nul
xcopy /E /I /Y "%~dp0Dropzone" "%DEST%"
echo.
echo Installed. Restart Premiere Pro, then open Window ^> Extensions ^> Dropzone
pause
