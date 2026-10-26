import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
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
/// прочее — фраза экрана «Не удалось запустить распознавание». Кроме одного
/// отказа с русской фразой — перезапуск не поставил ни одного файла
/// (`OCR_RESTART_FAILED`, 25.10.2026).
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

  // Шапка обещает фразу транспорта при любом «нет ответа сервера» — и у
  // таймаута она своя (`ApiClient._enhanceError`).
  for (final type in const [
    DioExceptionType.connectionTimeout,
    DioExceptionType.sendTimeout,
    DioExceptionType.receiveTimeout,
  ]) {
    testWidgets('таймаут (${type.name}): русская фраза транспорта',
        (tester) async {
      retry = (options) =>
          throw DioException(requestOptions: options, type: type);

      final text = await pressRetry(tester);

      expect(text, 'Сервер не отвечает. Проверьте подключение.');
    });
  }

  /// Цвет плашки, что сейчас на экране.
  Color? snackColor(WidgetTester tester) =>
      tester.widget<SnackBar>(find.byType(SnackBar)).backgroundColor;

  // Находка Н40 (25.10.2026): постановка упала у всех файлов. Сервер отвечал
  // 202 «поставлено 0», экран — зелёным «Распознавание уже выполняется».
  // Теперь сервер отказывает (500 OCR_RESTART_FAILED, фраза для партнёра).
  testWidgets(
      'перезапуск не поставил ни одного файла (отказ сервера) → его фраза, '
      'красным, не «уже выполняется»', (tester) async {
    retry = (_) => jsonBody(
          _refusal('Не удалось запустить распознавание. Попробуйте позже.',
              'OCR_RESTART_FAILED'),
          status: 500,
        );

    final text = await pressRetry(tester);

    expect(text, 'Не удалось запустить распознавание. Попробуйте позже.');
    expect(snackColor(tester), Colors.red);
    expect(find.text('Распознавание уже выполняется'), findsNothing);
  });

  testWidgets(
      'прежний сервер: 202 «поставлено 0» → тот же отказ, не зелёное '
      '«уже выполняется»', (tester) async {
    retry = (_) => jsonBody({
          'success': true,
          'data': {'enqueuedJobs': 0, 'totalPdfs': 2},
          'message': 'Enqueued 0 OCR job(s)',
        }, status: 202);

    final text = await pressRetry(tester);

    expect(text, 'Не удалось запустить распознавание. Попробуйте позже.');
    expect(snackColor(tester), Colors.red);
  });

  testWidgets('поставлен хотя бы один файл → зелёное «запущено N из M», как было',
      (tester) async {
    retry = (_) => jsonBody({
          'success': true,
          'data': {'enqueuedJobs': 1, 'totalPdfs': 2},
          'message': 'Enqueued 1 OCR job(s)',
        }, status: 202);

    final text = await pressRetry(tester);

    expect(text, 'Распознавание запущено (1 из 2)');
    expect(snackColor(tester), AppTheme.statusGreen);
    // Через 5 с экран сам обновляет список — дать этому таймеру сработать.
    await tester.pump(const Duration(seconds: 6));
    await tester.pump(const Duration(milliseconds: 100));
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
