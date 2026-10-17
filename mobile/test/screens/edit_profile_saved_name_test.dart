import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/screens/profile/edit_profile_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/session_events.dart';

import '../support/secure_storage_stand.dart';
import '../support/wire_stand.dart';

/// Выбор фото: платформенная реализация `image_picker` под `flutter test` не
/// регистрируется, и вызов уходит в этот канал.
const _imagePickerChannel = MethodChannel('plugins.flutter.io/image_picker');

/// Правка профиля и уже сохранённое имя.
///
/// Правило имени действует на запись НОВОГО имени; сохранённые имена не
/// трогаем (решение Trunk 17.10.2026). Имя от Google или Яндекса — начало
/// адреса почты вроде «ivan.petrov2001» — правилу не отвечает. Пока правка
/// профиля проверяла и отправляла имя всегда, такой человек сменил аватар —
/// и «Сохранить» не срабатывал: под полем отказ правила, экран не
/// закрывается, пока не переименуешь себя.
///
/// Поверх настоящих `AuthProvider`, `AuthService` и `ApiClient`; подменены
/// провод и выбор фото — тест читает тела запросов, ушедших на сервер.
void main() {
  late Directory dir;
  late File photo;
  late StubAdapter wire;

  /// Имя, которое хранит сервер.
  late String storedName;

  setUpAll(() {
    dir = Directory.systemTemp.createTempSync('edit_profile_avatar_test');
    photo = File('${dir.path}/avatar.jpg')
      ..writeAsBytesSync([0xFF, 0xD8, 0xFF, 0xD9]);
  });

  tearDownAll(() {
    // Без гарантии: тело запроса с файлом открывает его на чтение, и на
    // Windows открытый файл не удалить.
    try {
      dir.deleteSync(recursive: true);
    } on FileSystemException {
      // Остаток во временном каталоге системы.
    }
  });

  setUp(() {
    SessionEvents.debugReset();
    AccountScope.debugReset();
    storedName = 'ivan.petrov2001';

    Map<String, dynamic> user() => {
          'success': true,
          'data': {
            'user': {
              'id': 'u-1',
              'email': 'ivan.petrov2001@example.com',
              'name': storedName,
            },
          },
        };

    wire = installWireStand((options) {
      final path = options.uri.path;
      if (path.endsWith('/auth/me') || path.endsWith('/auth/avatar')) {
        return jsonBody(user());
      }
      if (path.endsWith('/auth/profile')) {
        final name = (options.data as Map)['name'];
        if (name is String) storedName = name;
        return jsonBody(user());
      }
      throw StateError('ответ не задан: ${options.method} $path');
    });
    installSecureStorageStand({
      'access_token': 'valid',
      'refresh_token': 'alive',
    });

    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(_imagePickerChannel, (call) async {
      if (call.method == 'pickImage') return photo.path;
      return null;
    });
    addTearDown(
        () => messenger.setMockMethodCallHandler(_imagePickerChannel, null));
  });

  /// Шаги настоящего времени вперемежку с кадрами: чтение файла и ответы
  /// провода приходят в настоящем цикле событий, а не в поддельном времени
  /// теста (память `feedback_flutter_widget_test_real_io_and_snackbar`).
  Future<void> waitFor(
    WidgetTester tester,
    bool Function() done,
    String what,
  ) async {
    for (var i = 0; i < 100 && !done(); i++) {
      await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 20)));
      await tester.pump(const Duration(milliseconds: 100));
    }
    expect(done(), isTrue, reason: 'не дождались: $what');
  }

  /// Вошедший пользователь на экране «Редактировать профиль», открытом
  /// поверх экрана «Профиль».
  Future<AuthProvider> openEditProfile(WidgetTester tester) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(400, 900);
    addTearDown(tester.view.reset);

    final auth = (await tester.runAsync(() async {
      final auth = AuthProvider();
      for (var i = 0; i < 200 && auth.isLoading; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 5));
      }
      return auth;
    }))!;
    addTearDown(auth.dispose);
    expect(auth.currentUser?.name, 'ivan.petrov2001',
        reason: 'предусловие: вошёл, имя от сервиса входа');

    await tester.pumpWidget(ChangeNotifierProvider<AuthProvider>.value(
      value: auth,
      child: MaterialApp(
        theme: AppTheme.lightTheme,
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: TextButton(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                      builder: (_) => const EditProfileScreen()),
                ),
                child: const Text('Профиль'),
              ),
            ),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('Профиль'));
    await tester.pumpAndSettle();
    expect(find.byType(EditProfileScreen), findsOneWidget);
    expect(
      tester.widget<TextFormField>(find.byType(TextFormField).first)
          .controller
          ?.text,
      'ivan.petrov2001',
      reason: 'предусловие: поле заполнено сохранённым именем',
    );
    return auth;
  }

  Future<void> save(WidgetTester tester) async {
    final button = find.text('Сохранить');
    await tester.ensureVisible(button);
    await tester.pumpAndSettle();
    await tester.tap(button);
    await tester.pump();
  }

  /// Тела запросов, в которых ушло имя.
  List<String> requestsWithName() => [
        for (final request in wire.requests)
          if ((request.data is Map &&
                  (request.data as Map).containsKey('name')) ||
              (request.data is FormData &&
                  (request.data as FormData)
                      .fields
                      .any((field) => field.key == 'name')))
            '${request.method} ${request.uri.path}',
      ];

  testWidgets(
      'имя от сервиса входа без изменений + новый аватар: сохраняется, '
      'имени в запросах нет', (tester) async {
    await openEditProfile(tester);

    // Новый аватар: «Поменять фото» → «Галерея».
    await tester.tap(find.text('Поменять фото'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Галерея'));
    await tester.pump();
    await waitFor(
      tester,
      () => find.text('Аватар успешно обновлён').evaluate().isNotEmpty,
      'аватар загружен',
    );
    // Плашка об аватаре уходит — она не должна перекрыть «Сохранить».
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();

    final avatar = wire.requests
        .where((r) => r.uri.path.endsWith('/auth/avatar'))
        .single;
    expect((avatar.data as FormData).files.single.key, 'avatar',
        reason: 'предусловие: аватар ушёл файлом');

    await save(tester);
    await waitFor(
      tester,
      () => find.byType(EditProfileScreen).evaluate().isEmpty,
      'экран правки закрылся',
    );

    expect(find.text('Профиль'), findsOneWidget,
        reason: 'сохранение прошло — экран закрыт');
    expect(requestsWithName(), isEmpty,
        reason: 'неизменённое имя на сервер не отправляется');
    expect(storedName, 'ivan.petrov2001');
  });

  testWidgets('изменённое имя проверяется правилом и уходит на сервер',
      (tester) async {
    await openEditProfile(tester);

    await tester.enterText(find.byType(TextFormField).first, 'Иван Петров');
    await save(tester);
    await waitFor(
      tester,
      () => find.byType(EditProfileScreen).evaluate().isEmpty,
      'экран правки закрылся',
    );

    expect(requestsWithName(), ['PUT /api/v1/auth/profile']);
    expect(storedName, 'Иван Петров');
  });
}
