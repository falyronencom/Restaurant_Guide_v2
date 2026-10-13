import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/providers/approved_provider.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/providers/suspended_provider.dart';
import 'package:restaurant_guide_admin_web/screens/moderation/approved_screen.dart';
import 'package:restaurant_guide_admin_web/screens/moderation/suspended_screen.dart';

import '../helpers/stub_auth.dart';

// Две независимые паузы (решение Координатора 07.10.2026, вариант A) — что
// видит модератор в шапке карточки.
//
// Пауза партнёра — его: включает её только партнёр, поэтому «Возобновить» у
// неё нет, а «Приостановить» есть — модератор может закрепить паузу своей
// причиной. Своя приостановка модератора снимается «Возобновить» и второй
// раз не ставится. Черновик и архив не приостанавливаются. Сервер держит те
// же правила (backend adminService); здесь — что кнопки им не противоречат.
//
// Стенд — как в viewer_gating_test: провайдер с уже загруженной карточкой,
// сеть не нужна.

const String _moderatorReason = 'Жалобы посетителей';

EstablishmentDetail _detail({
  required String status,
  String? reason,
  String? from = 'active',
}) =>
    EstablishmentDetail(
      id: 'a41f9c02-1234-5678-9abc-def012345678',
      partnerId: 'p-1',
      name: 'Кухмістр',
      status: status,
      city: 'Минск',
      categories: const <String>['Ресторан'],
      cuisines: const <String>['Народная'],
      moderationNotes: reason == null
          ? null
          : <String, dynamic>{
              'suspend_reason': reason,
              'suspended_at': '2026-10-01T11:40:00.000Z',
              if (from != null) 'suspended_from': from,
            },
    );

class _StubBadges extends BadgesProvider {
  @override
  Future<void> load() async {}
}

class _StubApprovedProvider extends ApprovedProvider {
  final EstablishmentDetail _detail;

  _StubApprovedProvider(this._detail);

  @override
  Future<void> loadActiveEstablishments({int page = 1}) async {}

  @override
  String? get selectedId => _detail.id;

  @override
  EstablishmentDetail? get selectedDetail => _detail;

  @override
  bool get isLoadingDetail => false;

  @override
  String? get detailError => null;
}

class _StubSuspendedProvider extends SuspendedProvider {
  final EstablishmentDetail _detail;
  final List<SuspendedEstablishmentItem> _items;

  _StubSuspendedProvider(this._detail, {List<SuspendedEstablishmentItem> items = const []})
      : _items = items;

  @override
  Future<void> loadSuspendedEstablishments({int page = 1}) async {}

  @override
  List<SuspendedEstablishmentItem> get establishments => _items;

  @override
  int get totalCount => _items.length;

  @override
  String? get selectedId => _detail.id;

  @override
  EstablishmentDetail? get selectedDetail => _detail;

  @override
  bool get isLoadingDetail => false;

  @override
  String? get detailError => null;
}

void main() {
  Future<void> pumpScreen<P extends ChangeNotifier>(
    WidgetTester tester, {
    required P provider,
    required Widget screen,
  }) async {
    tester.view.physicalSize = const Size(1440, 820);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    // `.value` не освобождает переданное — это делает создатель.
    addTearDown(provider.dispose);

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
    await tester.pump();
  }

  group('Приостановленные', () {
    testWidgets('своя приостановка: «Возобновить», второй раз не приостановить',
        (tester) async {
      await pumpScreen<SuspendedProvider>(
        tester,
        provider: _StubSuspendedProvider(
          _detail(status: 'suspended', reason: _moderatorReason),
        ),
        screen: const SuspendedScreen(),
      );

      expect(find.text('Возобновить'), findsOneWidget);
      expect(find.text('Приостановить'), findsNothing);
      expect(find.text(_moderatorReason), findsOneWidget);
      expect(find.text('Пауза партнёра'), findsNothing);
    });

    testWidgets('пауза партнёра: «Приостановить» вместо «Возобновить», пояснение в карточке',
        (tester) async {
      await pumpScreen<SuspendedProvider>(
        tester,
        provider: _StubSuspendedProvider(_detail(status: 'suspended')),
        screen: const SuspendedScreen(),
      );

      expect(find.text('Приостановить'), findsOneWidget);
      expect(find.text('Возобновить'), findsNothing);
      expect(find.text('Пауза партнёра'), findsOneWidget);
    });

    // «Возобновить» возвращает карточку туда, где она была до приостановки, —
    // диалог подтверждения обязан сказать куда, а не обещать сайт всегда.
    for (final (from, expected) in <(String?, String)>[
      ('suspended', 'Заведение вернётся на паузу партнёра — включить его сможет только партнёр.'),
      ('pending', 'Заведение вернётся в очередь проверки.'),
      ('rejected', 'Заявка останется отклонённой — партнёр исправит замечания и отправит её снова.'),
      ('active', 'Заведение снова появится в поиске и каталоге.'),
      (null, 'Заведение снова появится в поиске и каталоге.'),
    ]) {
      testWidgets('диалог «Возобновить» говорит, куда вернётся карточка: $from',
          (tester) async {
        await pumpScreen<SuspendedProvider>(
          tester,
          provider: _StubSuspendedProvider(
            _detail(status: 'suspended', reason: _moderatorReason, from: from),
          ),
          screen: const SuspendedScreen(),
        );

        await tester.tap(find.text('Возобновить'));
        await tester.pump();
        await tester.pump();

        expect(find.text('Возобновить заведение?'), findsOneWidget);
        expect(find.text(expected), findsOneWidget);
      });
    }

    testWidgets('строка списка без причины подписана «пауза партнёра»',
        (tester) async {
      final item = SuspendedEstablishmentItem.fromJson(<String, dynamic>{
        'id': 'a41f9c02-1234-5678-9abc-def012345678',
        'name': 'Кухмістр',
        'city': 'Минск',
        'moderation_notes': null,
      });
      await pumpScreen<SuspendedProvider>(
        tester,
        provider: _StubSuspendedProvider(
          _detail(status: 'suspended'),
          items: <SuspendedEstablishmentItem>[item],
        ),
        screen: const SuspendedScreen(),
      );

      expect(find.text('пауза партнёра'), findsOneWidget);
      expect(find.text('причина не указана'), findsNothing);
    });
  });

  group('Одобренные (поиском приходят карточки любого статуса)', () {
    Future<void> pumpApproved(WidgetTester tester, EstablishmentDetail detail) =>
        pumpScreen<ApprovedProvider>(
          tester,
          provider: _StubApprovedProvider(detail),
          screen: const ApprovedScreen(),
        );

    for (final status in <String>['active', 'pending', 'rejected']) {
      testWidgets('$status: «Приостановить», без «Возобновить»', (tester) async {
        await pumpApproved(tester, _detail(status: status));

        expect(find.text('Приостановить'), findsOneWidget);
        expect(find.text('Возобновить'), findsNothing);
      });
    }

    testWidgets('пауза партнёра: «Приостановить», без «Возобновить»',
        (tester) async {
      await pumpApproved(tester, _detail(status: 'suspended'));

      expect(find.text('Приостановить'), findsOneWidget);
      expect(find.text('Возобновить'), findsNothing);
    });

    testWidgets('своя приостановка: «Возобновить», без «Приостановить»',
        (tester) async {
      await pumpApproved(tester, _detail(status: 'suspended', reason: _moderatorReason));

      expect(find.text('Возобновить'), findsOneWidget);
      expect(find.text('Приостановить'), findsNothing);
    });

    for (final status in <String>['draft', 'archived']) {
      testWidgets('$status: приостановить нельзя', (tester) async {
        await pumpApproved(tester, _detail(status: status));

        expect(find.text('Приостановить'), findsNothing);
        expect(find.text('Возобновить'), findsNothing);
      });
    }
  });
}
