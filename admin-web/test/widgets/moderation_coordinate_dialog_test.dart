import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/providers/moderation_provider.dart';
import 'package:restaurant_guide_admin_web/services/moderation_service.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_detail_panel.dart';

// Окно «Исправить координаты» на вкладке «Адрес» панели модерации.
//
// Прежде окно создавало два поля ввода и не освобождало их: сторож течей
// (test/flutter_test_config.dart) роняет любой тест, открывший окно, поэтому
// кнопку не нажимал никто. Здесь проверено и освобождение, и то, что окно
// по-прежнему доносит до сервера введённые числа.

/// Сервис, записывающий правки координат. `noSuchMethod` роняет любой вызов,
/// которого проверяемый путь делать не должен.
class _RecordingModerationService implements ModerationService {
  final List<String> calls = <String>[];

  @override
  Future<EstablishmentDetail> getEstablishmentDetails(String id) async =>
      EstablishmentDetail(
        id: id,
        partnerId: 'p-1',
        name: 'Кухмістр',
        status: 'pending',
        city: 'Минск',
        address: 'пр. Независимости, 4',
        latitude: 53.893009,
        longitude: 27.567444,
      );

  @override
  Future<void> updateCoordinates({
    required String id,
    required double latitude,
    required double longitude,
  }) async {
    calls.add('$id $latitude $longitude');
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(
        'фейк не обслуживает ${invocation.memberName}',
      );
}

class _StubBadges extends BadgesProvider {
  @override
  Future<void> load() async {}
}

void main() {
  Future<_RecordingModerationService> openDialog(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final service = _RecordingModerationService();
    final provider = ModerationProvider(service: service);
    addTearDown(provider.dispose);
    await provider.selectEstablishment('est-1');

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<ModerationProvider>.value(value: provider),
          ChangeNotifierProvider<BadgesProvider>(create: (_) => _StubBadges()),
        ],
        child: MaterialApp(
          theme: AppTheme.lightTheme,
          home: const Scaffold(body: ModerationDetailPanel()),
        ),
      ),
    );
    await tester.pump();

    // Вкладки подписаны «Адрес 0/1» одним Text.rich — ищем по месту.
    await tester.tap(find.byType(Tab).at(3));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Исправить координаты'));
    await tester.pumpAndSettle();

    return service;
  }

  testWidgets('окно открывается с нынешними координатами', (tester) async {
    await openDialog(tester);

    final fields = tester.widgetList<TextField>(
      find.descendant(
        of: find.byType(AlertDialog),
        matching: find.byType(TextField),
      ),
    );
    expect(
      fields.map((f) => f.controller!.text).toList(),
      <String>['53.893009', '27.567444'],
    );
  });

  testWidgets('«Сохранить» уносит на сервер введённые числа', (tester) async {
    final service = await openDialog(tester);

    final fields = find.descendant(
      of: find.byType(AlertDialog),
      matching: find.byType(TextField),
    );
    await tester.enterText(fields.at(0), '53.9');
    await tester.enterText(fields.at(1), '27.55');
    await tester.tap(find.widgetWithText(ElevatedButton, 'Сохранить'));
    await tester.pumpAndSettle();

    expect(service.calls, <String>['est-1 53.9 27.55']);
    expect(find.byType(AlertDialog), findsNothing);
  });

  testWidgets('нечисло окно не закрывает и на сервер не уходит',
      (tester) async {
    final service = await openDialog(tester);

    final fields = find.descendant(
      of: find.byType(AlertDialog),
      matching: find.byType(TextField),
    );
    await tester.enterText(fields.at(0), 'пятьдесят три');
    await tester.tap(find.widgetWithText(ElevatedButton, 'Сохранить'));
    await tester.pumpAndSettle();

    expect(service.calls, isEmpty);
    expect(find.byType(AlertDialog), findsOneWidget);
  });

  testWidgets('«Отмена» после правки поля закрывает окно без ошибок',
      (tester) async {
    final service = await openDialog(tester);

    // Тронуть поле обязательно: нетронутое после закрытия не перестраивается,
    // и освобождение на попе маршрута не проявилось бы.
    await tester.enterText(
      find
          .descendant(
            of: find.byType(AlertDialog),
            matching: find.byType(TextField),
          )
          .first,
      '53.9',
    );
    await tester.tap(find.widgetWithText(TextButton, 'Отмена'));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.byType(AlertDialog), findsNothing);
    expect(service.calls, isEmpty);
  });
}
