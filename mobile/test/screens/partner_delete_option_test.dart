// Удалить карточку партнёр может, только пока она черновик или отклонена —
// как на сайте (внешний обзор 23.09.2026, #4a). Остальные статусы сервер
// удалить не даёт (403 ESTABLISHMENT_NOT_DELETABLE): опубликованная карточка
// несёт отзывы, избранное и брони пользователей. Вместо пункта удаления экран
// говорит, почему его нет, — тем же текстом, что и сервер.
//
// Установленные сборки пункт показывают всегда; для них — проверка
// провайдера: отказ сервера доходит до экрана ошибкой, а не «Заведение
// удалено».

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_dashboard_provider.dart';
import 'package:restaurant_guide_mobile/screens/partner/edit_establishment_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';

import '../support/wire_stand.dart';

const _id = '11111111-2222-3333-4444-555555555555';

/// Текст отказа — литерал решения Координатора 30.09.2026.
const _refusal = 'Удалить можно только черновик или отклонённую карточку. '
    'Чтобы убрать эту карточку, напишите в поддержку.';

void main() {
  // Статус карточки так, как его отдаёт сервер (у опубликованной — 'active').
  late String status;
  late StubAdapter wire;

  setUp(() {
    AccountScope.debugReset();
    status = 'draft';
    wire = installWireStand((RequestOptions options) {
      final card = <String, dynamic>{
        'id': _id,
        'name': 'Кофейня у моста',
        'status': status,
      };
      if (options.method == 'DELETE') {
        return jsonBody(<String, dynamic>{
          'success': false,
          'message': _refusal,
          'error': <String, dynamic>{'code': 'ESTABLISHMENT_NOT_DELETABLE'},
        }, status: 403);
      }
      if (options.uri.path.endsWith('/partner/establishments')) {
        return jsonBody(<String, dynamic>{
          'success': true,
          'data': <String, dynamic>{
            'establishments': <Map<String, dynamic>>[card],
          },
        });
      }
      return jsonBody(<String, dynamic>{
        'success': true,
        'data': <String, dynamic>{'establishment': card},
      });
    });
  });

  Future<void> openStatusSheet(WidgetTester tester) async {
    final provider = PartnerDashboardProvider();
    addTearDown(provider.dispose);
    await tester.pumpWidget(ChangeNotifierProvider.value(
      value: provider,
      child: const MaterialApp(
        home: EditEstablishmentScreen(establishmentId: _id),
      ),
    ));
    await tester.pumpAndSettle();
    // Раздел статуса — внизу прокручиваемого экрана, ниже края поверхности теста.
    final statusMenu = find.text('Приостановить или удалить');
    await tester.ensureVisible(statusMenu);
    await tester.pumpAndSettle();
    await tester.tap(statusMenu);
    await tester.pumpAndSettle();
  }

  group('Лист «Статус заведения»', () {
    for (final s in ['draft', 'rejected']) {
      testWidgets('$s: пункт «Удалить заведение» есть', (tester) async {
        status = s;
        await openStatusSheet(tester);

        expect(find.text('Удалить заведение'), findsOneWidget);
        expect(find.text(_refusal), findsNothing);
      });
    }

    for (final s in ['pending', 'active', 'suspended']) {
      testWidgets('$s: пункта удаления нет, вместо него — почему',
          (tester) async {
        status = s;
        await openStatusSheet(tester);

        expect(find.text('Удалить заведение'), findsNothing);
        expect(find.text(_refusal), findsOneWidget);
      });
    }
  });

  test(
      'отказ сервера 403: провайдер отвечает неудачей с текстом сервера, '
      'карточка остаётся в списке', () async {
    status = 'active';
    final provider = PartnerDashboardProvider();
    addTearDown(provider.dispose);
    await provider.loadEstablishments();
    expect(provider.establishments.map((e) => e.id), [_id]);

    final deleted = await provider.deleteEstablishment(_id);

    expect(deleted, isFalse,
        reason: 'экран показал бы «Заведение удалено» и ушёл назад');
    expect(provider.error, contains(_refusal));
    expect(provider.establishments.map((e) => e.id), [_id]);
    expect(wire.requests.where((r) => r.method == 'DELETE'), hasLength(1));
  });
}
