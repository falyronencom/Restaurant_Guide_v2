library;

/// Перезагрузка вкладки панели — чтобы подтянуть новую сборку.
///
/// Реализация выбирается по платформе по той же причине, что у
/// `open_url.dart`: `dart:js_interop` недоступен на Dart VM, где идут тесты.
export 'page_reload_stub.dart' if (dart.library.js_interop) 'page_reload_web.dart';
