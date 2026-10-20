import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/models/promotion.dart';
import 'package:restaurant_guide_mobile/providers/promotion_provider.dart';
import 'package:restaurant_guide_mobile/screens/partner/create_promotion_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';

import '../support/wire_stand.dart';

/// Что уходит на сервер о дате окончания, когда партнёр правит акцию.
///
/// До 20.10.2026 очищенная дата окончания не уходила вовсе: поле пропускалось,
/// сервер оставлял прежнюю дату, а партнёр думал, что срок снят. Сервер с
/// PR #86 читает пустое окончание (`valid_until: ''`) как «без срока»
/// (`promotionController.updatePromotion`).
///
/// Проверяется само тело запроса правки (поля формы на проводе) после
/// настоящих нажатий на экране: экран, провайдер и `ApiClient` исполняются
/// целиком, подменён только транспорт.
const _est = '11111111-2222-3333-4444-555555555555';
const _promoId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

Promotion _promotion({String? validUntil}) => Promotion.fromJson({
      'id': _promoId,
      'establishment_id': _est,
      'title': 'Скидка 20% на десерты',
      'status': 'active',
      'valid_from': '2026-10-01',
      if (validUntil != null) 'valid_until': validUntil,
      'created_at': '2026-10-01T10:00:00.000Z',
    });

void main() {
  late StubAdapter wire;

  setUp(() {
    AccountScope.debugReset();
    wire = installWireStand((options) {
      if (options.method == 'GET') {
        return jsonBody({'success': true, 'data': <Object>[]});
      }
      return jsonBody({'success': true, 'data': <String, dynamic>{}});
    });
  });

  /// Поля формы единственного запроса правки.
  Map<String, String> patchedFields() {
    final patch = wire.requests.where((r) => r.method == 'PATCH').single;
    expect(patch.path, '/api/v1/partner/promotions/$_promoId');
    return {
      for (final field in (patch.data as FormData).fields)
        field.key: field.value,
    };
  }

  /// Экран правки поверх пустого экрана — сохранение закрывает его, как в
  /// приложении.
  Future<void> openEdit(WidgetTester tester, Promotion promotion) async {
    // Высокий экран: форма — ленивый ListView, кнопка сохранения в 800×600
    // не строится.
    tester.view.physicalSize = const Size(800, 2000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    final provider = PromotionProvider();
    addTearDown(provider.dispose);
    await tester.pumpWidget(ChangeNotifierProvider.value(
      value: provider,
      child: const MaterialApp(home: Scaffold()),
    ));
    tester.state<NavigatorState>(find.byType(Navigator)).push(
          MaterialPageRoute<bool>(
            builder: (_) => CreatePromotionScreen(
              establishmentId: _est,
              existingPromotion: promotion,
            ),
          ),
        );
    await tester.pumpAndSettle();
  }

  Future<void> save(WidgetTester tester) async {
    await tester.tap(find.widgetWithText(ElevatedButton, 'Сохранить'));
    for (var i = 0;
        i < 60 && find.byType(CreatePromotionScreen).evaluate().isNotEmpty;
        i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    expect(find.byType(CreatePromotionScreen), findsNothing,
        reason: 'сохранение должно пройти и закрыть экран');
  }

  testWidgets('очищенная дата окончания уходит пустым окончанием',
      (tester) async {
    await openEdit(tester, _promotion(validUntil: '2026-10-31'));

    await tester.tap(find.byIcon(Icons.clear));
    await tester.pump();
    expect(find.text('Бессрочно (по умолчанию)'), findsOneWidget,
        reason: 'на экране дата окончания должна быть снята');
    await save(tester);

    expect(patchedFields()['valid_until'], '');
  });

  testWidgets('нетронутая дата окончания не уходит', (tester) async {
    await openEdit(tester, _promotion(validUntil: '2026-10-31'));

    await save(tester);

    final fields = patchedFields();
    expect(fields['title'], 'Скидка 20% на десерты',
        reason: 'запрос правки — тот самый, с полями формы');
    expect(fields.containsKey('valid_until'), isFalse,
        reason: 'партнёр дату не трогал — серверу о ней сказать нечего');
  });

  testWidgets('акция без срока, срок не задан — окончание не уходит',
      (tester) async {
    await openEdit(tester, _promotion());

    await save(tester);

    expect(patchedFields().containsKey('valid_until'), isFalse,
        reason: 'снимать нечего — пустое окончание не нужно');
  });
}
