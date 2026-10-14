import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/panel_roles.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/providers/approved_provider.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/screens/moderation/approved_screen.dart';
import 'package:restaurant_guide_admin_web/services/moderation_service.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_detail_panel.dart';

import '../helpers/stub_auth.dart';

// Экран «Одобренные» на настоящем провайдере и подставном сервере, который
// отвечает, когда велит тест (пакет 2, пункт 4; Codex CL-4). Провайдерные
// проверки — в providers/late_detail_answer_test.dart; здесь — что видит и
// что подтверждает модератор:
//   - поздняя деталь другой карточки не меняет открытую панель;
//   - диалог подтверждения называет показанную карточку, и действие уходит
//     к ней же;
//   - после смены аккаунта поздний ответ прежней роли на экран не попадает.

class _GatedServer implements ModerationService {
  final Map<String, List<Completer<EstablishmentDetail>>> details =
      <String, List<Completer<EstablishmentDetail>>>{};
  final List<String> calls = <String>[];

  void answer(String id, EstablishmentDetail detail, {int index = 0}) =>
      details[id]![index].complete(detail);

  @override
  Future<ActiveListResponse> getActiveEstablishments({
    int page = 1,
    int perPage = 20,
    String? sort,
    String? city,
    String? search,
  }) async =>
      ActiveListResponse(
        establishments: <ActiveEstablishmentItem>[
          for (final id in <String>['a', 'b'])
            ActiveEstablishmentItem.fromJson(<String, dynamic>{
              'id': id,
              'name': 'Кафе $id',
              'city': 'Минск',
            }),
        ],
        total: 2,
        page: 1,
        pages: 1,
      );

  @override
  Future<EstablishmentDetail> getEstablishmentDetails(String id) {
    calls.add('detail:$id');
    final gate = Completer<EstablishmentDetail>();
    details.putIfAbsent(id, () => <Completer<EstablishmentDetail>>[]).add(gate);
    return gate.future;
  }

  @override
  Future<void> suspendEstablishment({
    required String id,
    required String reason,
  }) async {
    calls.add('suspend:$id');
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(
        'подставка не обслуживает ${invocation.memberName}',
      );
}

class _StubBadges extends BadgesProvider {
  @override
  Future<void> load() async {}
}

EstablishmentDetail _detail(String id, {bool forAdmin = true}) =>
    EstablishmentDetail(
      id: id,
      partnerId: 'p-1',
      name: 'Кафе $id',
      status: 'active',
      city: 'Минск',
      contactPerson: forAdmin ? 'Иван Контактов' : null,
      contactEmail: forAdmin ? 'ivan@partner.by' : null,
      partnerDataRedacted: !forAdmin,
    );

void main() {
  Future<(_GatedServer, ApprovedProvider)> pumpScreen(
    WidgetTester tester, {
    bool viewer = false,
  }) async {
    final server = _GatedServer();
    final provider = ApprovedProvider(service: server);
    addTearDown(provider.dispose);

    tester.view.physicalSize = const Size(1440, 820);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<ApprovedProvider>.value(value: provider),
          ChangeNotifierProvider<BadgesProvider>(create: (_) => _StubBadges()),
          ChangeNotifierProvider<AuthProvider>(
            create: (_) =>
                viewer ? StubAuthProvider.viewer() : StubAuthProvider.admin(),
          ),
        ],
        child: MaterialApp(
          theme: AppTheme.lightTheme,
          home: const Scaffold(body: ApprovedScreen()),
        ),
      ),
    );
    await tester.pump(); // первый кадр
    await tester.pump(); // список пришёл
    return (server, provider);
  }

  testWidgets(
      'поздняя деталь другой карточки не меняет открытую; «Приостановить» '
      'называет показанную карточку и уходит к ней', (tester) async {
    final (server, _) = await pumpScreen(tester);

    await tester.tap(find.text('Кафе a'));
    await tester.pump();
    await tester.tap(find.text('Кафе b'));
    await tester.pump();
    server.answer('b', _detail('b'));
    await tester.pump();
    server.answer('a', _detail('a')); // опоздавший ответ о прежнем выборе
    await tester.pump();

    // Панель — о «Кафе b»: её имя на экране дважды (список и панель), имени
    // «Кафе a» — один раз (только в списке).
    expect(find.text('Кафе b'), findsWidgets);
    expect(find.text('Кафе a'), findsOneWidget);

    // Кнопка в шапке — OutlinedButton.icon (закрытый подкласс), поэтому по
    // тексту: до открытия диалога «Приостановить» на экране одно.
    await tester.tap(find.text('Приостановить'));
    await tester.pumpAndSettle();
    expect(find.text('«Кафе b»'), findsOneWidget);
    expect(find.text('«Кафе a»'), findsNothing);

    await tester.enterText(
      find.descendant(
        of: find.byType(AlertDialog),
        matching: find.byType(TextField),
      ),
      'Жалобы посетителей',
    );
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Приостановить'));
    await tester.pumpAndSettle();

    expect(server.calls.where((c) => c.startsWith('suspend:')),
        <String>['suspend:b']);
  });

  testWidgets(
      'панель не показывает деталь другой карточки, чем выбрана '
      '(второй слой под провайдерами)', (tester) async {
    tester.view.physicalSize = const Size(1440, 820);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.lightTheme,
        home: Scaffold(
          body: ModerationDetailPanel(
            mode: DetailPanelMode.readonly,
            detail: _detail('a'),
            selectedId: 'b',
            isLoadingDetail: false,
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.text('Кафе a'), findsNothing);
    expect(find.text('ivan@partner.by'), findsNothing);
  });

  testWidgets(
      'после смены аккаунта поздний ответ администратору не показывается '
      'просмотрщику', (tester) async {
    final (server, provider) = await pumpScreen(tester, viewer: true);

    await tester.tap(find.text('Кафе a')); // запрос ещё администратора
    await tester.pump();
    provider.resetAccountScope(); // выход; вошёл просмотрщик
    provider.selectEstablishment('a'); // и открыл ту же карточку
    await tester.pump();

    server.answer('a', _detail('a', forAdmin: true), index: 0);
    await tester.pump();
    expect(find.text('ivan@partner.by'), findsNothing);

    server.answer('a', _detail('a', forAdmin: false), index: 1);
    await tester.pump();
    expect(find.text('ivan@partner.by'), findsNothing);
    expect(find.text(kRedactedForViewerLabel), findsWidgets);
  });
}
