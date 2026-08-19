import 'dart:js_interop';

@JS('window.open')
external void _windowOpen(JSString url, JSString target);

/// Открывает ссылку в новой вкладке браузера.
void openInNewTab(String url) {
  if (url.isEmpty) return;
  _windowOpen(url.toJS, '_blank'.toJS);
}
