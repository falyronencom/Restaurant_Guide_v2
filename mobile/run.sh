#!/bin/bash
# Convenience script for running the app with all required --dart-define flags
# Usage: ./run.sh [additional flutter run arguments]
# Example: ./run.sh -d chrome
#          ./run.sh --release

flutter run \
  --dart-define=YANDEX_CLIENT_ID=bad2912d12db4c59a71511239a68c564 \
  "$@"
