@echo off
REM Convenience script for running the app with all required --dart-define flags
REM Usage: run.bat [additional flutter run arguments]
REM Example: run.bat -d chrome
REM          run.bat --release

flutter run --dart-define=YANDEX_CLIENT_ID=bad2912d12db4c59a71511239a68c564 %*
