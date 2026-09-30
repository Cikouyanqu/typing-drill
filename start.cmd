@echo off
REM ===========================================================================
REM  typing-drill - local static server launcher
REM
REM  Double-clicking index.html works fine. But some browsers disable
REM  localStorage on file:// URLs, which means practice records cannot be
REM  saved. Serving over http://127.0.0.1 gives the page a normal origin, so
REM  records persist normally. Use this when you care about keeping stats.
REM
REM  Close this window (or press Ctrl+C) to stop the server.
REM ===========================================================================

setlocal
cd /d "%~dp0"
set PORT=8777
set URL=http://127.0.0.1:%PORT%/

echo.
echo   typing-drill - local static server
echo   ---------------------------------
echo.

where python >nul 2>nul
if %ERRORLEVEL%==0 goto :runpython

where py >nul 2>nul
if %ERRORLEVEL%==0 goto :runpy

echo   Python was not found on PATH.
echo.
echo   You can still use the tool: just double-click index.html.
echo   The only difference is that practice records may not be saved.
echo   (Settings - Data has Export/Import JSON as a manual backup.)
echo.
pause
goto :eof

:runpython
echo   Serving: %URL%
echo   Files:   %CD%
echo.
echo   Opening browser...  Press Ctrl+C in this window to stop.
echo.
start "" "%URL%"
python -m http.server %PORT% --bind 127.0.0.1
goto :eof

:runpy
echo   Serving: %URL%
echo   Files:   %CD%
echo.
echo   Opening browser...  Press Ctrl+C in this window to stop.
echo.
start "" "%URL%"
py -m http.server %PORT% --bind 127.0.0.1
goto :eof
