import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/screens/profile/delete_account_screen.dart';

import '../support/secure_storage_stand.dart';
import '../support/wire_stand.dart';

/// Экран «Удалить учётную запись» (бриф В1, 18.10.2026).
///
/// Что видит человек: сначала ответ сервера «можно ли»; владельцу карточек —
/// текст сервера и «Написать в поддержку» (решение 3), без поля для слова;
/// остальным — предупреждение и кнопка, доступная только со словом УДАЛИТЬ
/// (решение 4). После удаления — главный экран гостем и «Учётная запись удалена».
void main() {
  const ownsCardsText = 'У вас есть карточки заведений. Удалить учётную запись можно, '
      'когда их передадут другому владельцу, — напишите в поддержку: '
      'support@nirivio.by';

  late int signOuts;

  setUp(() {
    signOuts = 0;
  });

  ResponseBody allowed(RequestOptions options) => jsonBody({
        'success': true,
        'data': {'allowed': true, 'refusal': null},
      });

  Future<void> pumpScreen(WidgetTester tester, {bool mentionDrafts = false}) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(420, 1600);
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(
      routes: {
        '/home': (_) => const Scaffold(body: Center(child: Text('Главный экран'))),
      },
      home: DeleteAccountScreen(
        mentionDrafts: mentionDrafts,
        signOut: () async {
          signOuts += 1;
        },
      ),
    ));
    await tester.pumpAndSettle();
  }

  ElevatedButton deleteButton(WidgetTester tester) =>
      tester.widget<ElevatedButton>(find.byKey(const Key('delete-account-button')));

  testWidgets('«можно» — предупреждение; без слова кнопка недоступна', (tester) async {
    installWireStand(allowed, accessToken: 'valid');

    await pumpScreen(tester);

    expect(find.text('Что удалится'), findsOneWidget);
    expect(find.text('Что останется без вашего имени'), findsOneWidget);
    expect(find.text('Ваши отзывы и оценки — автором будет «Гость», без фото'), findsOneWidget);
    expect(find.text('Чтобы подтвердить, введите слово УДАЛИТЬ'), findsOneWidget);
    expect(deleteButton(tester).onPressed, isNull);

    await tester.enterText(find.byKey(const Key('delete-account-word')), 'удали');
    await tester.pump();
    expect(deleteButton(tester).onPressed, isNull);
  });

  testWidgets('со словом — удаление, выход на телефоне, главный экран и «Учётная запись удалена»',
      (tester) async {
    final wire = installWireStand((options) {
      if (options.method == 'DELETE') {
        return jsonBody({'success': true, 'data': {'deleted': true}});
      }
      return allowed(options);
    }, accessToken: 'valid');
    await pumpScreen(tester);

    await tester.enterText(find.byKey(const Key('delete-account-word')), 'удалить');
    await tester.pump();
    expect(deleteButton(tester).onPressed, isNotNull);
    await tester.tap(find.byKey(const Key('delete-account-button')));
    await tester.pumpAndSettle();

    final sent = wire.requests.last;
    expect(sent.method, 'DELETE');
    expect(sent.uri.path, '/api/v1/auth/account');
    expect(sent.data, {'confirmation': 'удалить'});
    expect(signOuts, 1);
    expect(find.text('Главный экран'), findsOneWidget);
    expect(find.text('Учётная запись удалена'), findsOneWidget);
    expect(find.byType(DeleteAccountScreen), findsNothing);
  });

  testWidgets('сеанс погас без ответа «удалена» — выход, главный экран и «Сеанс завершён»',
      (tester) async {
    // Ответ на первую попытку потерялся: учётной записи уже нет, повтор получает 401,
    // продление сеанса — тоже 401, и транспорт стирает токены. Что учётная запись
    // удалена, сервер не подтвердил — экран этого и не говорит.
    installWireStand((options) {
      final path = options.uri.path;
      if (path == '/api/v1/auth/account' && options.method == 'DELETE') {
        return jsonBody({
          'success': false,
          'message': 'User account is inactive',
          'error': {'code': 'ACCOUNT_INACTIVE'},
        }, status: 401);
      }
      if (path == '/api/v1/auth/refresh') {
        return jsonBody({
          'success': false,
          'error': {'code': 'INVALID_REFRESH_TOKEN', 'message': 'Invalid refresh token'},
        }, status: 401);
      }
      return allowed(options);
    });
    installSecureStorageStand({'access_token': 'valid', 'refresh_token': 'alive'});
    await pumpScreen(tester);

    await tester.enterText(find.byKey(const Key('delete-account-word')), 'УДАЛИТЬ');
    await tester.pump();
    await tester.tap(find.byKey(const Key('delete-account-button')));
    await tester.pumpAndSettle();

    expect(signOuts, 1);
    expect(find.text('Главный экран'), findsOneWidget);
    expect(find.text('Сеанс завершён'), findsOneWidget);
    expect(find.text('Учётная запись удалена'), findsNothing);
  });

  testWidgets('владельцу карточек — текст сервера и «Написать в поддержку», поля для слова нет',
      (tester) async {
    installWireStand(
      (_) => jsonBody({
        'success': true,
        'data': {
          'allowed': false,
          'refusal': {'code': 'ACCOUNT_OWNS_ESTABLISHMENTS', 'message': ownsCardsText},
        },
      }),
      accessToken: 'valid',
    );

    await pumpScreen(tester);

    expect(find.text('Сейчас учётную запись удалить нельзя'), findsOneWidget);
    expect(find.text(ownsCardsText), findsOneWidget);
    expect(find.text('Написать в поддержку'), findsOneWidget);
    expect(find.byKey(const Key('delete-account-word')), findsNothing);
    expect(find.byKey(const Key('delete-account-button')), findsNothing);
  });

  testWidgets('отказ при удалении — текст сервера под кнопкой, экран на месте, выхода нет',
      (tester) async {
    installWireStand((options) {
      if (options.method == 'DELETE') {
        return jsonBody({
          'success': false,
          'message': ownsCardsText,
          'error': {'code': 'ACCOUNT_OWNS_ESTABLISHMENTS'},
        }, status: 409);
      }
      return allowed(options);
    }, accessToken: 'valid');
    await pumpScreen(tester);

    await tester.enterText(find.byKey(const Key('delete-account-word')), 'УДАЛИТЬ');
    await tester.pump();
    await tester.tap(find.byKey(const Key('delete-account-button')));
    await tester.pumpAndSettle();

    expect(
      tester.widget<Text>(find.byKey(const Key('delete-account-error'))).data,
      ownsCardsText,
    );
    expect(signOuts, 0);
    expect(find.byType(DeleteAccountScreen), findsOneWidget);
    expect(find.text('Главный экран'), findsNothing);
  });

  testWidgets('проверка сорвалась — «Повторить» спрашивает сервер снова', (tester) async {
    var calls = 0;
    installWireStand((options) {
      calls += 1;
      if (calls == 1) {
        throw DioException(requestOptions: options, type: DioExceptionType.connectionError);
      }
      return allowed(options);
    }, accessToken: 'valid');
    await pumpScreen(tester);

    expect(find.text('Не удалось проверить учётную запись. Проверьте интернет.'), findsOneWidget);
    await tester.tap(find.text('Повторить'));
    await tester.pumpAndSettle();

    expect(find.text('Что удалится'), findsOneWidget);
    expect(calls, 2);
  });

  testWidgets('черновики карточек названы только тому, у кого они могут быть', (tester) async {
    const draftsLine = 'Черновики карточек заведений, которые не публиковались';

    installWireStand(allowed, accessToken: 'valid');
    await pumpScreen(tester, mentionDrafts: true);
    expect(find.text(draftsLine), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
    installWireStand(allowed, accessToken: 'valid');
    await pumpScreen(tester);
    expect(find.text(draftsLine), findsNothing);
  });
}
