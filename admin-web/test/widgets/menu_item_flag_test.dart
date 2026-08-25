import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/flagged_menu_item.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/providers/menu_items_moderation_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/menu_items/menu_item_detail_panel.dart';

// Блок флага проверки: человеческая фраза вместо сырого JSON, а сама запись —
// под спойлером.
//
// Отдельно проверяется переключение позиций. Панель живёт в постоянном слоте
// экрана, поэтому Flutter переиспользует состояние виджета при смене позиции —
// и без ключа раскрытый спойлер «переезжал» на следующую позицию, а
// автораскрытие для незнакомого правила не срабатывало вовсе.

class _StubProvider extends MenuItemsModerationProvider {
  FlaggedMenuItem? _selected;

  _StubProvider(this._selected);

  @override
  FlaggedMenuItem? get selected => _selected;

  void choose(FlaggedMenuItem item) {
    _selected = item;
    notifyListeners();
  }
}

class _StubBadges extends BadgesProvider {
  @override
  Future<void> load() async {}
}

FlaggedMenuItem _item({
  required String id,
  required Map<String, dynamic> flag,
}) {
  return FlaggedMenuItem(
    id: id,
    establishmentId: 'e-1',
    mediaId: 'm-1',
    itemName: 'Драники',
    priceByn: 1200,
    categoryRaw: 'Горячее',
    confidence: 0.62,
    sanityFlag: flag,
    isHiddenByAdmin: false,
    hiddenReason: null,
    createdAt: DateTime(2026, 8, 9),
    establishmentName: 'Кухмістр',
    establishmentCity: 'Минск',
    establishmentStatus: 'active',
  );
}

/// Полное правило: фраза строится, спойлер по умолчанию закрыт.
final _known = _item(
  id: 'known',
  flag: <String, dynamic>{
    'reason': 'price_above_threshold',
    'details': <String, dynamic>{'price': 1200, 'threshold': 1000},
  },
);

/// Незнакомое правило: фразы нет, спойлер обязан раскрыться сам.
final _unknown = _item(
  id: 'unknown',
  flag: <String, dynamic>{'reason': 'quarantine'},
);

Future<_StubProvider> _pump(WidgetTester tester, FlaggedMenuItem first) async {
  tester.view.physicalSize = const Size(1440, 820);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  final provider = _StubProvider(first);
  await tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<MenuItemsModerationProvider>.value(
          value: provider,
        ),
        ChangeNotifierProvider<BadgesProvider>(create: (_) => _StubBadges()),
      ],
      child: MaterialApp(
        theme: AppTheme.lightTheme,
        home: const Scaffold(body: MenuItemDetailPanel()),
      ),
    ),
  );
  await tester.pump();
  return provider;
}

void main() {
  // Панель печатает дату русской локалью. В приложении данные локали грузит
  // main(), в тестах их надо поднять руками — иначе виджет падает
  // LocaleDataException ещё до первой проверки.
  setUpAll(() => initializeDateFormatting('ru'));

  testWidgets('фраза вместо кода и JSON', (tester) async {
    await _pump(tester, _known);

    expect(find.text('Цена выше порога'), findsOneWidget);
    expect(find.textContaining('при пороге'), findsOneWidget);
    // Сырая запись есть, но убрана: JSON на экране модератора честно
    // показывает всё и ровно поэтому не сообщает ничего.
    expect(find.text('Исходная запись'), findsOneWidget);
    expect(find.textContaining('"reason"'), findsNothing);
  });

  testWidgets('незнакомое правило раскрывает запись само', (tester) async {
    await _pump(tester, _unknown);

    // Фразы нет — значит показать нечего, кроме исходной записи.
    expect(find.text('Скрыть исходную запись'), findsOneWidget);
    expect(find.textContaining('quarantine'), findsWidgets);
  });

  testWidgets('раскрытая запись не переезжает на следующую позицию',
      (tester) async {
    final provider = await _pump(tester, _known);

    await tester.tap(find.text('Исходная запись'));
    await tester.pump();
    expect(find.text('Скрыть исходную запись'), findsOneWidget);

    provider.choose(_unknown);
    await tester.pump();

    // Здесь спойлер раскрыт по своей причине — правило незнакомое.
    expect(find.text('Скрыть исходную запись'), findsOneWidget);

    provider.choose(_known);
    await tester.pump();

    // А вот теперь он обязан быть закрыт: у этой позиции есть фраза, и
    // состояние прошлой позиции переезжать не должно.
    expect(find.text('Исходная запись'), findsOneWidget);
    expect(find.text('Скрыть исходную запись'), findsNothing);
  });

  testWidgets('автораскрытие срабатывает и при переходе к незнакомому правилу',
      (tester) async {
    final provider = await _pump(tester, _known);
    expect(find.text('Исходная запись'), findsOneWidget);

    provider.choose(_unknown);
    await tester.pump();

    // Без ключа состояние осталось бы от прошлой позиции, и модератор увидел
    // бы код `quarantine` без фразы и без записи — то есть ничего.
    expect(find.text('Скрыть исходную запись'), findsOneWidget);
  });
}
