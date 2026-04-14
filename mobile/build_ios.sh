#!/bin/bash
# Build iOS release for TestFlight
# Usage: ./build_ios.sh
# Then open Xcode: Archive → Upload to App Store Connect

flutter build ios \
  --dart-define=YANDEX_CLIENT_ID=bad2912d12db4c59a71511239a68c564
