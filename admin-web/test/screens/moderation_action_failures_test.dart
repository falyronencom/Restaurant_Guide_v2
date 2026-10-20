import 'dart:async';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/providers/approved_provider.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/providers/suspended_provider.dart';
import 'package:restaurant_guide_admin_web/screens/moderation/approved_screen.dart';
import 'package:restaurant_guide_admin_web/screens/moderation/suspended_screen.dart';
import 'package:restaurant_guide_admin_web/services/api_client.dart';
import 'package:restaurant_guide_admin_web/services/moderation_service.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_error_toast.dart';

import '../helpers/stub_auth.dart';
import '../helpers/wire_stand.dart';

// Сбой действия в шапке «Одобренных» и «Приостановленных» (проход по панели
// модератора, 20.10, пункты A1-01, A1-03, A1-05).
//
// До 20.10 провайдер писал причину, а экран её не читал: окно закрывалось, и
// ничего не происходило — модератор не знал, приостановлено заведение или
// нет. Причина к тому же была всегда «Произошла ошибка»: разбор искал «400»
// в `toString()`, где статуса нет. Здесь ответ идёт по проводу: подставной
// транспорт, настоящие сервис, перехватчики, провайдер и экран.

const String _id = 'a41f9c02-1234-5678-9abc-def012345678';

Map<String, dynamic> _detail(String status, {Map<String, dynamic>? notes}) =>
    <String, dynamic>{
      'id': _id,
      'partner_id': 'p-1',
      'name': 'Кухмістр',
      'status': status,
      'city': 'Минск',
      'categories': <String>['Ресторан'],
      'cuisines': <String>['Народная'],
      'moderation_notes': notes,
    };

Map<String, dynamic> _list(List<Map<String, dynamic>> items) =>
    <String, dynamic>{
      'success': true,
      'data': items,
      'meta': <String, dynamic>{'total': items.length, 'page': 1, 'pages': 1},
    };

/// Сервер: списки и карточка отвечают, действия — тем, что задал тест.
class _Server {
  _Server({required this.status, this.notes});

  String status;
  Map<String, dynamic>? notes;

  /// Ответ на действие (приостановить / возобновить).
  ResponseBody Function()? action;

  /// Держит действие «в пути», пока тест не отпустит.
  Completer<void>? actionGate;

  /// Ответ вместо обычного — для сбоя загрузки.
  ResponseBody? Function(RequestOptions options)? override;

  final List<String> calls = <String>[];

  late final StubAdapter adapter = StubAdapter(_respond, maxRequests: 40);

  ResponseBody _respond(RequestOptions options) {
    final path = options.uri.path;
    calls.add('${options.method} $path');
    final special = override?.call(options);
    if (special != null) return special;
    if (path.endsWith('/active') || path.endsWith('/suspended')) {
      return jsonBody(_list(<Map<String, dynamic>>[
        <String, dynamic>{
          'id': _id,
          'name': 'Кухмістр',
          'city': 'Минск',
          'moderation_notes': notes,
        },
      ]));
    }
    if (path.endsWith('/suspend') || path.endsWith('/unsuspend')) {
      final respond = action;
      if (respond == null) throw StateError('действие без ответа: $path');
      return respond();
    }
    return jsonBody(<String, dynamic>{
      'success': true,
      'data': _detail(status, notes: notes),
    });
  }
}

/// Транспорт, который умеет держать запрос: `StubAdapter` отвечает сразу.
class _GatedAdapter implements HttpClientAdapter {
  _GatedAdapter(this.server);

  final _Server server;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final gate = server.actionGate;
    final path = options.uri.path;
    if (gate != null &&
        (path.endsWith('/suspend') || path.endsWith('/unsuspend'))) {
      server.calls.add('${options.method} $path (ждёт)');
      await gate.future;
    }
    return server.adapter.fetch(options, requestStream, cancelFuture);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody _refusal(int status, String code, String message) => jsonBody(
      <String, dynamic>{
        'success': false,
        'message': message,
        'error': <String, dynamic>{'code': code},
      },
      status: status,
    );

class _StubBadges extends BadgesProvider {
  @override
  Future<void> load() async {}
}

ModerationService _service(_Server server) {
  final dio = Dio(BaseOptions(baseUrl: 'https://stub.invalid'))
    ..httpClientAdapter = _GatedAdapter(server);
  return ModerationService.withClient(ApiClient.withDio(dio));
}

/// Дать проводу и кадрам дойти до конца: ответ транспорта приходит
/// в поддельном времени теста только между кадрами, тост ставится на
/// следующем кадре.
Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

/// Дождаться [future], прокручивая кадры: просто `await` в теле
/// `testWidgets` ждал бы вечно — время теста стоит, пока его не двигают.
Future<T> _drive<T>(WidgetTester tester, Future<T> future) async {
  var done = false;
  late T value;
  unawaited(future.then((v) {
    value = v;
    done = true;
  }));
  for (var i = 0; i < 100 && !done; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
  expect(done, isTrue, reason: 'запрос не завершился за 5 с поддельного времени');
  await _settle(tester);
  return value;
}

void main() {
  setUp(() => installSecureStorageStand(initial: {'access_token': 'a-1'}));

  Future<void> pumpScreen<P extends ChangeNotifier>(
    WidgetTester tester,
    P provider,
    Widget screen,
  ) async {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<P>.value(value: provider),
          ChangeNotifierProvider<BadgesProvider>(create: (_) => _StubBadges()),
          ChangeNotifierProvider<AuthProvider>(
            create: (_) => StubAuthProvider.admin(),
          ),
        ],
        child: MaterialApp(
          theme: AppTheme.lightTheme,
          home: Scaffold(body: screen),
        ),
      ),
    );
    await _settle(tester);
  }

  group('Одобренные', () {
    testWidgets('отказ «Приостановить» — тост с причиной по коду сервера',
        (tester) async {
      final server = _Server(status: 'active');
      final provider = ApprovedProvider(service: _service(server));
      addTearDown(provider.dispose);
      await pumpScreen(tester, provider, const ApprovedScreen());
      await _drive(tester, provider.selectEstablishment(_id));
      server.calls.clear();

      // Другой модератор успел первым: сервер отвечает по-английски, с
      // кодом. Модератор видит русскую причину, а не «Произошла ошибка».
      server.action = () => _refusal(
            400,
            'INVALID_STATUS_FOR_SUSPEND',
            'Establishment is already suspended by a moderator.',
          );
      final ok = await _drive(
          tester, provider.suspendEstablishment('Жалобы посетителей'));

      expect(ok, isFalse);
      expect(find.byType(AdminErrorToast), findsOneWidget,
          reason: 'сбой действия обязан быть виден (A1-01)');
      expect(find.text('Заведение не приостановлено'), findsOneWidget);
      expect(
          find.text('Заведение уже приостановлено или в этом статусе его '
              'приостановить нельзя.'),
          findsOneWidget);
      expect(find.textContaining('Establishment'), findsNothing);
      expect(find.text('Произошла ошибка'), findsNothing);
      expect(
        server.calls,
        containsAll(<String>[
          'POST /api/v1/admin/establishments/$_id/suspend',
          'GET /api/v1/admin/establishments/active',
          'GET /api/v1/admin/establishments/$_id',
        ]),
        reason: 'отказ «уже не так» перечитывает раздел и карточку',
      );
    });

    testWidgets('5xx на действии: один запрос, тост «сервер не ответил»',
        (tester) async {
      final server = _Server(status: 'active');
      final provider = ApprovedProvider(service: _service(server));
      addTearDown(provider.dispose);
      await pumpScreen(tester, provider, const ApprovedScreen());
      await _drive(tester, provider.selectEstablishment(_id));
      server.calls.clear();

      server.action = () => jsonBody(
            <String, dynamic>{'success': false, 'error': 'bad gateway'},
            status: 502,
          );
      await _drive(tester, provider.suspendEstablishment('Жалобы посетителей'));

      expect(
        server.calls
            .where((c) => c.endsWith('/suspend'))
            .toList(),
        hasLength(1),
        reason: 'действие при 5xx не повторяется (A1-16)',
      );
      expect(find.text('Сервер не ответил. Попробуйте ещё раз через минуту.'),
          findsOneWidget);
    });

    testWidgets(
        'пока действие в пути: кнопки погашены, второй вызов запроса не шлёт',
        (tester) async {
      final server = _Server(status: 'active');
      final provider = ApprovedProvider(service: _service(server));
      addTearDown(provider.dispose);
      await pumpScreen(tester, provider, const ApprovedScreen());
      await _drive(tester, provider.selectEstablishment(_id));
      server.calls.clear();

      server.actionGate = Completer<void>();
      server.action = () => jsonBody(<String, dynamic>{'success': true});
      final first = provider.suspendEstablishment('Жалобы посетителей');
      await _settle(tester);

      // `OutlinedButton.icon` — закрытый подкласс: искать по предку.
      final suspend = tester.widget<ButtonStyleButton>(find.ancestor(
        of: find.text('Приостановить'),
        matching: find.byWidgetPredicate((w) => w is ButtonStyleButton),
      ));
      expect(suspend.onPressed, isNull,
          reason: 'кнопка гаснет на время запроса (A1-03)');
      expect(find.byKey(const ValueKey<String>('entity-action-busy')),
          findsOneWidget);

      final second = await provider.suspendEstablishment('Жалобы посетителей');
      expect(second, isFalse);
      expect(server.calls.where((c) => c.contains('/suspend')).toList(),
          hasLength(1),
          reason: 'защита от второго запроса — в провайдере');

      server.actionGate!.complete();
      await _drive(tester, first);
    });
  });

  group('Приостановленные', () {
    testWidgets('отказ «Возобновить» паузы партнёра — тост с причиной',
        (tester) async {
      final notes = <String, dynamic>{
        'suspend_reason': 'Жалобы посетителей',
        'suspended_from': 'active',
      };
      final server = _Server(status: 'suspended', notes: notes);
      final provider = SuspendedProvider(service: _service(server));
      addTearDown(provider.dispose);
      await pumpScreen(tester, provider, const SuspendedScreen());
      await _drive(tester, provider.selectEstablishment(_id));

      server.action = () => _refusal(
            400,
            'SUSPENDED_BY_PARTNER',
            'The partner paused this establishment; only the partner can resume it.',
          );
      final ok = await _drive(tester, provider.unsuspendEstablishment());

      expect(ok, isFalse);
      expect(find.text('Заведение не возобновлено'), findsOneWidget);
      expect(
          find.text(
              'Это пауза партнёра — включить заведение может только сам партнёр.'),
          findsOneWidget);
    });

    testWidgets('сбой карточки — «Повторить» загружает её снова',
        (tester) async {
      final server = _Server(status: 'suspended', notes: <String, dynamic>{
        'suspend_reason': 'Жалобы посетителей',
      });
      var failDetail = true;
      // Карточка отвечает 503, пока тест не разрешит.
      server.override = (options) => failDetail && options.uri.path.endsWith(_id)
          ? jsonBody(<String, dynamic>{
              'success': false,
              'message': 'Сбой на сервере. Попробуйте ещё раз через минуту.',
              'error': <String, dynamic>{'code': 'INTERNAL_ERROR'},
            }, status: 503)
          : null;
      final provider = SuspendedProvider(service: _service(server));
      addTearDown(provider.dispose);
      await pumpScreen(tester, provider, const SuspendedScreen());
      unawaited(provider.selectEstablishment(_id));
      // Чтение повторяется лестницей 0,5 / 1 / 1,5 с — время поддельное.
      for (var i = 0; i < 40; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }

      expect(find.text('Карточка не загрузилась'), findsOneWidget);
      expect(find.text('Сбой на сервере. Попробуйте ещё раз через минуту.'),
          findsOneWidget);

      failDetail = false;
      await tester.tap(find.widgetWithText(OutlinedButton, 'Повторить'));
      await _settle(tester);

      expect(find.text('Карточка не загрузилась'), findsNothing);
      expect(provider.selectedDetail?.id, _id,
          reason: '«Повторить» снова загрузило карточку (A1-15)');
    });
  });
}
