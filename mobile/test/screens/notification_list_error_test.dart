import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/models/notification_model.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/notification_provider.dart';
import 'package:restaurant_guide_mobile/screens/notifications/notification_list_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/notification_service.dart';

import '../support/wire_stand.dart';

/// Экран ленты при сбое загрузки.
///
/// До 17.10.2026 экран не читал `errorMessage` провайдера вовсе: сорвалась
/// первая загрузка — список пуст, и экран писал «Нет уведомлений» (неправда:
/// уведомления есть, их не удалось получить); сорвалась догрузка — внизу
/// ничего, лента выглядела законченной.
///
/// Служба подставная, по сценарию: экран проверяется на том, что показывает
/// при каждом исходе, а разбор ответа сервера проверен на проводе
/// (`test/providers/notification_feed_paging_wire_test.dart`).
class _ScriptedService implements NotificationService {
  /// Исход каждого следующего запроса ленты: `null` — сбой связи.
  final List<Map<String, dynamic>?> outcomes;
  int calls = 0;

  _ScriptedService(this.outcomes);

  @override
  Future<Map<String, dynamic>> getNotifications({
    int page = 1,
    int limit = 20,
    bool? isRead,
    String? category,
  }) async {
    final outcome = outcomes[calls++];
    if (outcome == null) throw Exception('обрыв связи');
    return outcome;
  }

  @override
  Future<int> getUnreadCount() async => 0;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

Map<String, dynamic> _page(List<String> titles, {required int totalPages}) =>
    <String, dynamic>{
      'items': [
        for (final t in titles)
          NotificationModel(
            id: t,
            userId: 'u-1',
            type: NotificationType.partnerResponse,
            title: t,
            isRead: true,
            createdAt: DateTime.utc(2026, 10, 1, 10),
          ),
      ],
      'pagination': <String, dynamic>{'totalPages': totalPages},
    };

/// Несколько кадров вместо `pumpAndSettle`: пока впереди есть страница,
/// внизу списка крутится индикатор, и тишины не наступает никогда.
Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 3; i++) {
    await tester.pump();
  }
}

void main() {
  setUp(() {
    AccountScope.debugReset();
    installWireStand((_) => jsonBody(<String, dynamic>{}));
  });

  Future<NotificationProvider> pump(
    WidgetTester tester,
    _ScriptedService service,
  ) async {
    final provider = NotificationProvider(service: service);
    provider.startPolling();
    await tester.pumpWidget(MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>(create: (_) => AuthProvider()),
        ChangeNotifierProvider.value(value: provider),
      ],
      child: const MaterialApp(home: NotificationListScreen()),
    ));
    await _settle(tester);
    return provider;
  }

  testWidgets('сорвалась первая загрузка — экран говорит о сбое и даёт '
      '«Повторить», а не «Нет уведомлений»', (tester) async {
    final service = _ScriptedService([
      null,
      _page(['Заведение ответило на отзыв'], totalPages: 1),
    ]);
    final provider = await pump(tester, service);

    expect(find.text('Не удалось загрузить уведомления'), findsOneWidget);
    expect(find.text('Нет уведомлений'), findsNothing);

    await tester.tap(find.text('Повторить'));
    await _settle(tester);

    expect(find.text('Заведение ответило на отзыв'), findsOneWidget);
    expect(find.text('Не удалось загрузить уведомления'), findsNothing);
    expect(service.calls, 2);

    // Таймер опроса счётчика гасится в теле теста: проверка «таймер не
    // погашен» идёт раньше addTearDown.
    provider.dispose();
  });

  testWidgets('сорвалась догрузка — внизу списка сбой и «Повторить», '
      'по нажатию приходит следующая страница', (tester) async {
    final service = _ScriptedService([
      _page(['Первое'], totalPages: 2),
      null,
      _page(['Второе'], totalPages: 2),
    ]);
    final provider = await pump(tester, service);

    await provider.loadMore();
    await _settle(tester);

    expect(find.text('Первое'), findsOneWidget);
    expect(find.text('Не удалось загрузить уведомления'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing,
        reason: 'вместо вечного индикатора внизу — сбой');

    await tester.tap(find.text('Повторить'));
    await _settle(tester);

    expect(find.text('Второе'), findsOneWidget);
    expect(find.text('Первое'), findsOneWidget,
        reason: '«Повторить» дописывает следующую страницу, а не грузит заново');
    expect(find.text('Не удалось загрузить уведомления'), findsNothing);

    provider.dispose();
  });
}
