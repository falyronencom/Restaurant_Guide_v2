import 'dart:js_interop';

import 'package:restaurant_guide_admin_web/utils/open_url_features.dart';

@JS('window.open')
external void _windowOpen(JSString url, JSString target, JSString features);

/// Открывает ссылку в новой вкладке браузера — без связи с вкладкой панели
/// ([kNewTabFeatures]).
void openInNewTab(String url) {
  if (url.isEmpty) return;
  _windowOpen(url.toJS, '_blank'.toJS, kNewTabFeatures.toJS);
}
