// Черновик отправляется на модерацию из экрана заведения — как отклонённая
// карточка. Черновик остаётся, когда мастер создал карточку, а отправка на
// модерацию не прошла (нет связи, сбой сервера) или ответ на создание
// потерялся. До 13.10.2026 у черновика здесь не было пути на модерацию:
// кнопка была только у отклонённой и приостановленной модератором карточки,
// и черновик можно было лишь удалить (решение Координатора 13.10.2026).

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_dashboard_provider.dart';
import 'package:restaurant_guide_mobile/screens/partner/edit_establishment_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';

import '../support/wire_stand.dart';

const _id = '11111111-2222-3333-4444-555555555555';

void main() {
  // Статус карточки так, как его отдаёт сервер.
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
      if (options.method == 'POST' && options.path.endsWith('/submit')) {
        status = 'pending';
        return jsonBody(<String, dynamic>{
          'success': true,
          'data': <String, dynamic>{
            'establishment': <String, dynamic>{'id': _id, 'status': 'pending'},
          },
        });
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

  /// Профиль с открытым поверх него экраном заведения: после отправки экран
  /// закрывается и возвращает в профиль.
  Future<void> openScreen(WidgetTester tester) async {
    final provider = PartnerDashboardProvider();
    addTearDown(provider.dispose);
    await tester.pumpWidget(ChangeNotifierProvider.value(
      value: provider,
      child: MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: TextButton(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) =>
                        const EditEstablishmentScreen(establishmentId: _id),
                  ),
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
  }

  Iterable<String> submits() => wire.requests
      .where((o) => o.method == 'POST' && o.path.endsWith('/submit'))
      .map((o) => o.path);

  testWidgets(
      'черновик: «Отправить на модерацию», подтверждение — и карточка '
      'уходит на модерацию', (tester) async {
    await openScreen(tester);

    await tester.tap(find.text('Отправить на модерацию'));
    await tester.pumpAndSettle();

    expect(find.text('Отправка на модерацию'), findsOneWidget);
    expect(find.text('Отправить заведение на модерацию?'), findsOneWidget);

    await tester.tap(find.text('Отправить'));
    await tester.pumpAndSettle();

    expect(submits(), ['/api/v1/partner/establishments/$_id/submit']);
    expect(find.text('Заведение отправлено на модерацию'), findsOneWidget);
    expect(find.byType(EditEstablishmentScreen), findsNothing);
  });

  testWidgets('черновик: «Отмена» в подтверждении ничего не отправляет',
      (tester) async {
    await openScreen(tester);

    await tester.tap(find.text('Отправить на модерацию'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Отмена'));
    await tester.pumpAndSettle();

    expect(submits(), isEmpty);
    expect(find.byType(EditEstablishmentScreen), findsOneWidget);
  });

  testWidgets('отклонённая: прежние надписи повторной отправки',
      (tester) async {
    status = 'rejected';
    await openScreen(tester);

    expect(find.text('Отправить на модерацию'), findsNothing);
    await tester.tap(find.text('Отправить повторно на модерацию'));
    await tester.pumpAndSettle();

    expect(find.text('Повторная модерация'), findsOneWidget);
    expect(
      find.text(
          'Вы уверены, что хотите отправить заведение повторно на модерацию?'),
      findsOneWidget,
    );
  });

  for (final s in ['pending', 'active']) {
    testWidgets('$s: кнопки отправки нет', (tester) async {
      status = s;
      await openScreen(tester);

      expect(find.text('Отправить на модерацию'), findsNothing);
      expect(find.text('Отправить повторно на модерацию'), findsNothing);
    });
  }
}
