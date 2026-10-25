import 'dart:js_interop';

@JS('window.location.reload')
external void _locationReload();

/// Перезагружает вкладку: браузер заново спросит `index.html` и бандл —
/// `Cache-Control: no-cache` у Caddy отдаст новую сборку с первого раза.
void reloadPage() => _locationReload();
