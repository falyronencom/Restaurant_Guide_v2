import 'dart:io';

import 'package:dio/dio.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_registration_provider.dart';
import 'package:restaurant_guide_mobile/screens/partner/steps/media_step.dart';

import '../support/wire_stand.dart';

/// Что читает партнёр, когда фото или PDF меню не загрузились (шаг «Медиа»
/// мастера — и при создании карточки, и при правке).
///
/// До 13.10.2026 красная плашка показывала `Ошибка при загрузке фото:
/// Exception: <текст>`: сервис загрузки заворачивал отказ в `Exception`, а
/// экран печатал его `toString()` после своей приставки. Хуже того, сервис
/// брал текст прямо из ответа сервера в обход транспорта — при сбое сервера
/// партнёр читал внутренний английский текст бэкенда.
///
/// Правило то же, что у правки карточки (Координатор, 07.10.2026 «1А»;
/// 13.10.2026 — для загрузки): готовая фраза сервера или транспорта целиком,
/// без приставки; без готовой фразы — общая русская по действию (фразы —
/// решение Координатора 13.10.2026, повторяют тексты успеха: «Фото успешно
/// загружено» → «Не удалось загрузить фото…»).
///
/// Проверяется текст самой плашки, точным равенством, после настоящего
/// нажатия «+ Добавить …»: экран, сервис загрузки и `ApiClient` исполняются
/// целиком, подменены только выбор файла и транспорт.
///
/// Ответы — в форме маршрута загрузки бэкенда (`tempMediaRoutes.js`): текст
/// отказа лежит в `message` верхнего уровня, в `error` — только код.

/// Выбор фото из галереи: платформенная реализация `image_picker` под
/// `flutter test` не регистрируется, и вызов уходит в этот канал.
const _imagePickerChannel = MethodChannel('plugins.flutter.io/image_picker');

/// Выбор PDF: у `file_picker` реализация по умолчанию не задана вовсе.
class _PickedPdf extends FilePicker {
  _PickedPdf(this.path);

  final String path;

  @override
  Future<FilePickerResult?> pickFiles({
    String? dialogTitle,
    String? initialDirectory,
    FileType type = FileType.any,
    List<String>? allowedExtensions,
    Function(FilePickerStatus)? onFileLoading,
    bool allowCompression = true,
    int compressionQuality = 30,
    bool allowMultiple = false,
    bool withData = false,
    bool withReadStream = false,
    bool lockParentWindow = false,
    bool readSequential = false,
  }) async =>
      FilePickerResult([PlatformFile(path: path, name: 'menu.pdf', size: 4)]);
}

/// Сбой сервера. Для программной ошибки бэкенд отдаёт в `message` текст
/// исключения как есть — английский и внутренний; партнёру он не годится.
ResponseBody _serverFailure(RequestOptions _) => jsonBody(<String, dynamic>{
      'success': false,
      'message': "Cannot read properties of undefined (reading 'secure_url')",
      'error': <String, dynamic>{'code': 'INTERNAL_ERROR'},
      'timestamp': '2026-10-13T10:00:00.000Z',
    }, status: 500);

ResponseBody _noNetwork(RequestOptions options) => throw DioException(
      requestOptions: options,
      type: DioExceptionType.connectionError,
    );

void main() {
  late ResponseBody Function(RequestOptions options) respond;
  late StubAdapter wire;

  // Настоящие файлы: сервис проверяет, что файл есть, и меряет его перед
  // отправкой.
  late Directory dir;
  late File photo;
  late File pdf;

  setUpAll(() {
    dir = Directory.systemTemp.createTempSync('media_step_test');
    photo = File('${dir.path}/photo.jpg')
      ..writeAsBytesSync([0xFF, 0xD8, 0xFF, 0xD9]);
    pdf = File('${dir.path}/menu.pdf')..writeAsBytesSync([0x25, 0x50]);
  });

  tearDownAll(() {
    // Без гарантии: сборка тела запроса открывает файл на чтение сразу, а
    // отказ транспорта приходит раньше, чем чтение закончится. На Windows
    // открытый файл не удалить — удаление после каждого теста валило бы
    // тест не по его утверждению.
    try {
      dir.deleteSync(recursive: true);
    } on FileSystemException {
      // Остаток во временном каталоге системы.
    }
  });

  setUp(() {
    respond = (options) =>
        throw StateError('ответ не задан: ${options.method} ${options.path}');
    wire = installWireStand((options) => respond(options));

    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(_imagePickerChannel, (call) async {
      if (call.method == 'pickImage') return photo.path;
      return null;
    });
    addTearDown(
        () => messenger.setMockMethodCallHandler(_imagePickerChannel, null));
    FilePicker.platform = _PickedPdf(pdf.path);
  });

  Future<void> tapAdd(WidgetTester tester, String label) async {
    await tester.pumpWidget(ChangeNotifierProvider(
      create: (_) => PartnerRegistrationProvider(),
      child: const MaterialApp(home: Scaffold(body: MediaStep())),
    ));
    final button = find.text(label);
    await tester.ensureVisible(button);
    await tester.pumpAndSettle();
    await tester.tap(button);
    await tester.pump();
  }

  /// Текст красной плашки — целиком.
  ///
  /// Проверка файла и его размера перед отправкой — настоящий ввод-вывод: он
  /// завершается только в настоящем цикле событий, а `pump` ведёт
  /// поддельное время теста. Поэтому шаги чередуются: немного настоящего
  /// времени (`runAsync`) — и кадр с поддельным временем, в котором
  /// продолжается код загрузки и идёт пауза транспорта перед повтором 5xx.
  ///
  /// Сам повтор загрузки до провода не доходит: тело запроса (`FormData`)
  /// израсходовано первой попыткой, повтор падает до отправки, и наверх
  /// уходит исходный отказ dio без готовой фразы — на проводе один запрос
  /// (наблюдено пробой 13.10.2026). Это поведение транспорта, правило текста
  /// от него не зависит, поэтому число запросов здесь не закреплено.
  Future<String> snackBarText(WidgetTester tester) async {
    for (var i = 0; i < 100 && find.byType(SnackBar).evaluate().isEmpty; i++) {
      await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 20)));
      await tester.pump(const Duration(milliseconds: 100));
    }
    await tester.pumpAndSettle();
    final bar = tester.widget<SnackBar>(find.byType(SnackBar));
    return (bar.content as Text).data!;
  }

  group('Фото интерьера', () {
    testWidgets('без сети — фраза транспорта', (tester) async {
      respond = _noNetwork;

      await tapAdd(tester, '+ Добавить фото');

      expect(await snackBarText(tester),
          'Нет связи. Проверьте подключение к интернету.');
      expect(wire.requests.first.path, '/api/v1/partner/media/upload');
    });

    testWidgets('отказ сервера — его фраза целиком, без приставки',
        (tester) async {
      // Ответ маршрута загрузки на файл больше 10 МБ. Тексты этого маршрута
      // сегодня английские (перевод текстов сервера — отдельная задача);
      // правило одно — после перевода партнёр прочтёт русский без правки
      // приложения.
      respond = (_) => jsonBody(<String, dynamic>{
            'success': false,
            'message': 'File size exceeds 10MB limit',
            'error': <String, dynamic>{'code': 'FILE_TOO_LARGE'},
          }, status: 413);

      await tapAdd(tester, '+ Добавить фото');

      expect(await snackBarText(tester), 'File size exceeds 10MB limit');
      expect(wire.requests.single.path, '/api/v1/partner/media/upload');
    });

    testWidgets('сбой сервера — общая фраза, а не текст исключения бэкенда',
        (tester) async {
      respond = _serverFailure;

      await tapAdd(tester, '+ Добавить фото');

      expect(await snackBarText(tester),
          'Не удалось загрузить фото. Попробуйте ещё раз.',
          reason: 'у исходного отказа dio после 5xx нет готовой фразы; '
              'текст из ответа сервера — внутренний английский текст '
              'бэкенда');
    });
  });

  group('Фото меню', () {
    testWidgets('отказ сервера — его фраза целиком, без приставки',
        (tester) async {
      // Правило шапки — для каждой загрузки, и у фото меню своя ветка
      // отказа. Ответ — как у маршрута загрузки сегодня (`tempMediaRoutes.js`,
      // фото больше 10 МБ).
      respond = (_) => jsonBody(<String, dynamic>{
            'success': false,
            'message': 'Фото больше 10 МБ. Выберите фото поменьше.',
            'error': <String, dynamic>{'code': 'FILE_TOO_LARGE'},
          }, status: 422);

      await tapAdd(tester, '+ Добавить фото меню');

      expect(await snackBarText(tester),
          'Фото больше 10 МБ. Выберите фото поменьше.');
      expect(wire.requests.single.path, '/api/v1/partner/media/upload');
    });

    testWidgets('сбой сервера — общая фраза', (tester) async {
      respond = _serverFailure;

      await tapAdd(tester, '+ Добавить фото меню');

      expect(await snackBarText(tester),
          'Не удалось загрузить фото меню. Попробуйте ещё раз.');
    });
  });

  group('PDF меню', () {
    testWidgets('отказ сервера — его фраза целиком, без приставки',
        (tester) async {
      respond = (_) => jsonBody(<String, dynamic>{
            'success': false,
            'message': 'PDF file size exceeds 60MB limit',
            'error': <String, dynamic>{'code': 'FILE_TOO_LARGE'},
          }, status: 422);

      await tapAdd(tester, '+ Добавить PDF меню');

      expect(await snackBarText(tester), 'PDF file size exceeds 60MB limit');
      expect(wire.requests.single.path, '/api/v1/partner/media/upload');
    });

    testWidgets('сбой сервера — общая фраза', (tester) async {
      respond = _serverFailure;

      await tapAdd(tester, '+ Добавить PDF меню');

      expect(await snackBarText(tester),
          'Не удалось загрузить PDF меню. Попробуйте ещё раз.');
    });
  });
}
