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
///
/// [size] — размер, который сообщает выбор файла; по нему экран и решает,
/// отправлять ли файл. Сам файл на диске — два байта.
class _PickedPdf extends FilePicker {
  _PickedPdf(this.path, {this.size = 4});

  final String path;
  final int size;

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
      FilePickerResult(
          [PlatformFile(path: path, name: 'menu.pdf', size: size)]);
}

const _invalidTypeRefusal = 'Этот формат не подходит: фото — JPG, PNG, WebP '
    'или HEIC, меню — ещё и PDF.';

/// Сбой сервера. С 13.10.2026 на любой сбой без готовой фразы бэкенд отдаёт
/// в `message` одну общую (`SERVER_FAILURE_MESSAGE`, `errorHandler.js`), а
/// текст исключения оставляет в журнале.
ResponseBody _serverFailure(RequestOptions _) => jsonBody(<String, dynamic>{
      'success': false,
      'message': 'Сбой на сервере. Попробуйте ещё раз через минуту.',
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
    testWidgets('загрузилось — фото в карточке интерьера, плашка успеха',
        (tester) async {
      // Путь «загрузилось → фото в карточке» не исполнял ни один тест: тест
      // предела фото подменяет загрузку прямым вызовом провайдера. Ответ —
      // как у маршрута загрузки (`tempMediaRoutes.js`, 201): три адреса
      // разных размеров (`generateAllResolutions`), и в карточку идёт
      // исходный, а не превью и не миниатюра.
      const base = 'https://res.cloudinary.com/demo/image/upload';
      const url = '$base/c_limit,w_1920/f_auto,q_auto/temp/u1/new';
      respond = (_) => jsonBody(<String, dynamic>{
            'success': true,
            'data': <String, dynamic>{
              'url': url,
              'preview_url': '$base/c_limit,w_800/f_auto,q_auto/temp/u1/new',
              'thumbnail_url': '$base/c_fill,w_200/f_auto,q_auto/temp/u1/new',
              'public_id': 'temp/u1/new',
              'file_type': 'image',
            },
          }, status: 201);

      await tapAdd(tester, '+ Добавить фото');

      expect(await snackBarText(tester), 'Фото успешно загружено');
      final provider = tester
          .element(find.byType(MediaStep))
          .read<PartnerRegistrationProvider>();
      expect(provider.data.interiorPhotos, [url]);
      expect(provider.data.menuPhotos, isEmpty);
    });

    testWidgets('без сети — фраза транспорта', (tester) async {
      respond = _noNetwork;

      await tapAdd(tester, '+ Добавить фото');

      expect(await snackBarText(tester),
          'Нет связи. Проверьте подключение к интернету.');
      expect(wire.requests.first.path, '/api/v1/partner/media/upload');
    });

    testWidgets('отказ сервера — его фраза целиком, без приставки',
        (tester) async {
      // Ответ маршрута загрузки на фото больше 10 МБ (`tempMediaRoutes.js`,
      // `UPLOAD_REFUSALS.photoTooLarge`; русский — с 19.10.2026).
      respond = (_) => jsonBody(<String, dynamic>{
            'success': false,
            'message': 'Фото больше 10 МБ. Выберите фото поменьше.',
            'error': <String, dynamic>{'code': 'FILE_TOO_LARGE'},
          }, status: 422);

      await tapAdd(tester, '+ Добавить фото');

      expect(await snackBarText(tester),
          'Фото больше 10 МБ. Выберите фото поменьше.');
      expect(wire.requests.single.path, '/api/v1/partner/media/upload');
    });

    testWidgets('сбой сервера — общая фраза, а не текст исключения бэкенда',
        (tester) async {
      respond = _serverFailure;

      await tapAdd(tester, '+ Добавить фото');

      expect(await snackBarText(tester),
          'Не удалось загрузить фото. Попробуйте ещё раз.',
          reason: 'у исходного отказа dio после 5xx нет готовой фразы; '
              'текст из ответа сервера на плашку не идёт');
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
      // Ответ маршрута загрузки на файл не того формата (`tempMediaRoutes.js`,
      // `UPLOAD_REFUSALS.invalidFileType`).
      respond = (_) => jsonBody(<String, dynamic>{
            'success': false,
            'message': _invalidTypeRefusal,
            'error': <String, dynamic>{'code': 'INVALID_FILE_TYPE'},
          }, status: 422);

      await tapAdd(tester, '+ Добавить PDF меню');

      expect(await snackBarText(tester), _invalidTypeRefusal);
      expect(wire.requests.single.path, '/api/v1/partner/media/upload');
    });

    testWidgets('сбой сервера — общая фраза', (tester) async {
      respond = _serverFailure;

      await tapAdd(tester, '+ Добавить PDF меню');

      expect(await snackBarText(tester),
          'Не удалось загрузить PDF меню. Попробуйте ещё раз.');
    });
  });

  /// Предел PDF меню — предел облака на сегодняшнем тарифе, 10 МБ (мегабайт
  /// — 1024 × 1024 байта, как у сервера). До 20.10.2026 приложение
  /// пропускало PDF до 60 МБ: файл больше 10 МБ целиком ехал на сервер,
  /// чтобы получить отказ, а подсказка под кнопкой обещала 60 МБ. Текст
  /// отказа — фраза сервера (`UPLOAD_REFUSALS.pdfOverCloudLimit`),
  /// утверждённая Координатором 17.10.2026; здесь — литералом, точным
  /// равенством.
  group('PDF меню: предел 10 МБ', () {
    const tenMb = 10 * 1024 * 1024;

    testWidgets('ровно 10 МБ — файл уходит на сервер', (tester) async {
      FilePicker.platform = _PickedPdf(pdf.path, size: tenMb);
      respond = (_) => jsonBody(<String, dynamic>{
            'success': true,
            'data': <String, dynamic>{
              'url': 'https://res.cloudinary.com/demo/image/upload/menu.pdf',
              'thumbnail_url':
                  'https://res.cloudinary.com/demo/image/upload/pg_1/menu.jpg',
              'preview_url':
                  'https://res.cloudinary.com/demo/image/upload/pg_1/menu.jpg',
              'file_type': 'pdf',
            },
          }, status: 201);

      await tapAdd(tester, '+ Добавить PDF меню');

      expect(await snackBarText(tester), 'PDF меню загружено');
      expect(wire.requests.single.path, '/api/v1/partner/media/upload');
    });

    testWidgets('10 МБ и 1 байт — отказ до сервера, фразой сервера',
        (tester) async {
      FilePicker.platform = _PickedPdf(pdf.path, size: tenMb + 1);

      await tapAdd(tester, '+ Добавить PDF меню');

      expect(
          await snackBarText(tester),
          'Файл PDF больше 10 МБ — уменьшите его или загрузите меню '
          'фотографиями');
      expect(wire.requests, isEmpty,
          reason: 'файл больше предела не должен уходить на сервер');
    });

    testWidgets('подсказка под кнопкой называет тот же предел',
        (tester) async {
      await tester.pumpWidget(ChangeNotifierProvider(
        create: (_) => PartnerRegistrationProvider(),
        child: const MaterialApp(home: Scaffold(body: MediaStep())),
      ));

      expect(find.text('Формат PDF, до 10 мб, максимум 2 файла'),
          findsOneWidget);
    });
  });
}
