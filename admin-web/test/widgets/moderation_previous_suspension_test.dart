import 'dart:convert' show jsonDecode, jsonEncode;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/providers/moderation_provider.dart';
import 'package:restaurant_guide_admin_web/services/moderation_service.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_detail_panel.dart';

// «Раньше приостановлена» в очереди модератора (решение Координатора
// 01.11.2026, «А+В»). Карточку приостановили, партнёр исправил и отправил
// снова — в очереди она выглядела обычной заявкой: панель не знала, что её
// снимали с показа, за что и кто. Сервер теперь отдаёт `previous_suspension`
// у карточки в очереди; панель показывает пометку с причиной, кем и когда.
//
// Деталь собирается из JSON — те же типы, что приходят с сервера, а не
// литералы теста; панель монтируется в режиме модерации, как в очереди.

const _id = 'a41f9c02-1234-5678-9abc-def012345678';
const _at = '2026-10-20T08:40:00.000Z';

class _DetailService implements ModerationService {
  _DetailService(this.detail);

  final EstablishmentDetail detail;

  @override
  Future<EstablishmentDetail> getEstablishmentDetails(String id) async =>
      detail;

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(
        'фейк не обслуживает ${invocation.memberName}',
      );
}

class _StubBadges extends BadgesProvider {
  @override
  Future<void> load() async {}
}

EstablishmentDetail _detail({
  String status = 'pending',
  Map<String, Object?>? previous,
  Map<String, Object?>? notes,
}) =>
    EstablishmentDetail.fromJson(
      jsonDecode(jsonEncode(<String, Object?>{
        'id': _id,
        'partner_id': 'p-1',
        'name': 'Кухмістр',
        'status': status,
        'moderation_notes': notes,
        'previous_suspension': previous,
      })) as Map<String, dynamic>,
    );

Future<void> _pumpQueue(WidgetTester tester, EstablishmentDetail detail) async {
  tester.view.physicalSize = const Size(1440, 1200);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  final provider = ModerationProvider(service: _DetailService(detail));
  addTearDown(provider.dispose);
  await provider.selectEstablishment(detail.id);
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
}

/// Дата и время пометки — местные, как во всей панели. На машине в UTC (CI)
/// проверка совпадает с переводом сама собой; смысл она имеет на UTC+3.
void _expectStamp() {
  final local = DateTime.parse(_at).toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  expect(
    find.text('${two(local.day)}.${two(local.month)}.${local.year}, '
        '${two(local.hour)}:${two(local.minute)}'),
    findsOneWidget,
  );
}

void main() {
  testWidgets('приостанавливал модератор: причина, имя и время', (tester) async {
    await _pumpQueue(
      tester,
      _detail(
        previous: <String, Object?>{
          'by': 'moderator',
          'name': 'Сергей Админов',
          'reason': 'Фото не того заведения',
          'at': _at,
        },
        // Метки приостановки, оставшиеся до решения, — не заметки к полям:
        // блок «Заметки прошлой проверки» их не показывает, пометка — да.
        notes: <String, Object?>{
          'suspend_reason': 'Фото не того заведения',
          'suspended_at': _at,
          'suspended_from': 'active',
        },
      ),
    );

    expect(find.text('Раньше приостановлена'), findsOneWidget);
    expect(find.text('Фото не того заведения'), findsOneWidget);
    expect(find.text('Кто: модератор Сергей Админов'), findsOneWidget);
    _expectStamp();
  });

  testWidgets('имени журнал не знает — «модератор» без выдуманного имени',
      (tester) async {
    await _pumpQueue(
      tester,
      _detail(previous: <String, Object?>{
        'by': 'moderator',
        'name': null,
        'reason': 'Жалобы гостей',
        'at': _at,
      }),
    );

    expect(find.text('Кто: модератор'), findsOneWidget);
  });

  testWidgets('приостанавливала система при переходе учётной записи',
      (tester) async {
    const reason =
        'Учётная запись перешла к владельцу адреса e-mail после входа через '
        'Google или Яндекс. Карточка приостановлена до решения модератора: '
        'кому она принадлежит.';
    await _pumpQueue(
      tester,
      _detail(previous: <String, Object?>{
        'by': 'system',
        'name': null,
        'reason': reason,
        'at': _at,
      }),
    );

    expect(find.text('Раньше приостановлена'), findsOneWidget);
    expect(find.text(reason), findsOneWidget);
    expect(find.text('Кто: система, при переходе учётной записи'),
        findsOneWidget);
    _expectStamp();
  });

  testWidgets('своя пауза партнёра: без причины, кто и когда', (tester) async {
    await _pumpQueue(
      tester,
      _detail(previous: <String, Object?>{
        'by': 'partner',
        'name': null,
        'reason': null,
        'at': _at,
      }),
    );

    expect(find.text('Раньше приостановлена'), findsOneWidget);
    expect(find.text('Кто: партнёр, своя пауза'), findsOneWidget);
    _expectStamp();
  });

  testWidgets('без истории пометки нет', (tester) async {
    await _pumpQueue(tester, _detail());

    expect(find.text('Раньше приостановлена'), findsNothing);
    expect(find.textContaining('Кто:'), findsNothing);
  });

  testWidgets('незнакомый «кто» (ответ новее панели) — пометки нет',
      (tester) async {
    await _pumpQueue(
      tester,
      _detail(previous: <String, Object?>{
        'by': 'robot',
        'reason': 'Что-то новое',
        'at': _at,
      }),
    );

    expect(find.text('Раньше приостановлена'), findsNothing);
  });

  testWidgets('вне очереди пометки нет, даже если история пришла',
      (tester) async {
    // Режим чтения («Одобренные»): решать там нечего, и сервер историю для
    // такой карточки не отдаёт — панель не полагается на одно это.
    tester.view.physicalSize = const Size(1440, 1200);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    final detail = _detail(
      status: 'active',
      previous: <String, Object?>{
        'by': 'moderator',
        'name': 'Сергей Админов',
        'reason': 'Фото не того заведения',
        'at': _at,
      },
    );
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.lightTheme,
        home: Scaffold(
          body: ModerationDetailPanel(
            mode: DetailPanelMode.readonly,
            detail: detail,
            selectedId: detail.id,
            isLoadingDetail: false,
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.text('Раньше приостановлена'), findsNothing);
  });
}
