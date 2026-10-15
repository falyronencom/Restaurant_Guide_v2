import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_menu_provider.dart';
import 'package:restaurant_guide_mobile/screens/partner/partner_menu_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';

import '../support/wire_stand.dart';

/// Что читает партнёр, когда «Перезапустить распознавание» не сработало.
///
/// До 13.10.2026 на любой отказ, кроме лимита и «нет файлов меню», плашка
/// печатала `e.message` dio. У отказа, пересобранного транспортом, его нет —
/// и партнёр читал «Ошибка сети» даже на 404 удалённой карточки, когда сеть
/// ни при чём. У сбоя сервера, исчерпавшего повторы, `message` есть — это
/// английский текст библиотеки («This exception was thrown because the
/// response has a status code of 500…»), и он шёл на экран как есть.
///
/// Тексты сервера по меню пока английские, поэтому их экран не показывает:
/// нет ответа сервера (нет связи, таймаут) — русская фраза транспорта, всё
/// прочее — фраза экрана «Не удалось запустить распознавание».
///
/// Ответы — в форме `errorHandler` бэкенда в production; через стенд провода
/// исполняется весь `ApiClient`, включая повторы 5xx.
const _est = '11111111-2222-3333-4444-555555555555';
const _retryPath = '/api/v1/partner/establishments/$_est/retry-ocr';

Map<String, dynamic> _refusal(String message, String code) => {
      'success': false,
      'message': message,
      'error': {'code': code},
      'timestamp': '2026-10-13T10:00:00.000Z',
    };

void main() {
  late ResponseBody Function(RequestOptions options) retry;
  late StubAdapter wire;

  setUp(() {
    AccountScope.debugReset();
    retry = (options) =>
        throw StateError('ответ не задан: ${options.method} ${options.path}');
    wire = installWireStand((options) {
      if (options.method == 'GET') {
        return jsonBody({'success': true, 'data': <dynamic>[]});
      }
      return retry(options);
    });
  });

  List<RequestOptions> retries() =>
      wire.requests.where((r) => r.path == _retryPath).toList();

  /// Открывает экран меню, жмёт «Перезапустить распознавание» и ждёт плашку.
  Future<String> pressRetry(WidgetTester tester) async {
    final provider = PartnerMenuProvider();
    addTearDown(provider.dispose);
    await tester.pumpWidget(ChangeNotifierProvider.value(
      value: provider,
      child: const MaterialApp(home: PartnerMenuScreen(establishmentId: _est)),
    ));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    await tester.tap(find.text('Перезапустить распознавание'));
    // Шаги с длительностью: паузы между повторами 5xx у транспорта —
    // таймеры поддельного времени.
    for (var i = 0; i < 60 && find.byType(SnackBar).evaluate().isEmpty; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    final content = tester.widget<SnackBar>(find.byType(SnackBar)).content;
    return (content as Text).data!;
  }

  testWidgets('карточку удалили: не «Ошибка сети», а фраза экрана',
      (tester) async {
    retry = (_) => jsonBody(
          _refusal('Establishment not found or access denied',
              'ESTABLISHMENT_NOT_FOUND'),
          status: 404,
        );

    final text = await pressRetry(tester);

    expect(text, 'Не удалось запустить распознавание');
    expect(retries(), hasLength(1));
  });

  testWidgets('сбой сервера: не английский текст dio, а фраза экрана',
      (tester) async {
    retry = (_) => jsonBody(
          _refusal("Cannot read properties of undefined (reading 'id')",
              'INTERNAL_ERROR'),
          status: 500,
        );

    final text = await pressRetry(tester);

    expect(text, 'Не удалось запустить распознавание');
    // Исходный запрос и три повтора: отказ пришёл с того пути, где транспорт
    // отдаёт наверх сырой отказ dio с английским `message`.
    expect(retries(), hasLength(4));
  });

  testWidgets('прочий отказ 400: фраза экрана', (tester) async {
    retry = (_) => jsonBody(
          _refusal('Invalid data format provided', 'INVALID_FORMAT'),
          status: 400,
        );

    final text = await pressRetry(tester);

    expect(text, 'Не удалось запустить распознавание');
  });

  testWidgets('нет связи: русская фраза транспорта', (tester) async {
    retry = (options) => throw DioException(
          requestOptions: options,
          type: DioExceptionType.connectionError,
        );

    final text = await pressRetry(tester);

    expect(text, 'Нет связи. Проверьте подключение к интернету.');
  });

  testWidgets('нет файлов меню: фраза экрана по коду отказа — фото тоже годятся',
      (tester) async {
    retry = (_) => jsonBody(
          _refusal(
              'No menu media (PDF or menu photos) to re-process for this '
              'establishment',
              'NO_PDF_MENUS'),
          status: 400,
        );

    final text = await pressRetry(tester);

    // Распознаются и фото меню, не только PDF: до 15.10.2026 фраза звала
    // загрузить именно PDF. Литерал — решение Координатора 15.10.2026.
    expect(text, 'Сначала добавьте фото меню или PDF в разделе «Медиа»');
  });
}
