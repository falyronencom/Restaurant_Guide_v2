import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/models/flagged_menu_item.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/providers/menu_items_moderation_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/menu_items/menu_item_detail_panel.dart';

import '../helpers/stub_auth.dart';

// Блок флага проверки: человеческая фраза вместо сырого JSON, а сама запись —
// под спойлером.
//
// Отдельно проверяется переключение позиций. Панель живёт в постоянном слоте
// экрана, поэтому Flutter переиспользует состояние виджета при смене позиции —
// и без ключа раскрытый спойлер «переезжал» на следующую позицию, а
// автораскрытие для незнакомого правила не срабатывало вовсе.

class _StubProvider extends MenuItemsModerationProvider {
  FlaggedMenuItem? _selected;

  /// Причины, с которыми звали скрытие. Настоящий провайдер пошёл бы в сеть.
  final List<String> hideReasons = <String>[];

  _StubProvider(this._selected);

  @override
  FlaggedMenuItem? get selected => _selected;

  @override
  Future<bool> hideItem(String menuItemId, String reason) async {
    hideReasons.add(reason);
    return true;
  }

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
  double? price = 1200,
  bool hidden = false,
  MediaItem? menuFile,
}) {
  return FlaggedMenuItem(
    id: id,
    establishmentId: 'e-1',
    mediaId: 'm-1',
    itemName: 'Драники',
    priceByn: price,
    categoryRaw: 'Горячее',
    confidence: 0.62,
    sanityFlag: flag,
    isHiddenByAdmin: hidden,
    hiddenReason: hidden ? 'проверено вручную' : null,
    createdAt: DateTime(2026, 8, 9),
    establishmentName: 'Кухмістр',
    establishmentCity: 'Минск',
    establishmentStatus: 'active',
    establishmentCategories: const <String>['Ресторан'],
    establishmentCuisines: const <String>['Народная'],
    menuFile: menuFile,
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
  addTearDown(provider.dispose);
  await tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<MenuItemsModerationProvider>.value(
          value: provider,
        ),
        ChangeNotifierProvider<BadgesProvider>(create: (_) => _StubBadges()),
        // Панель читает роль вошедшего: действия рисуются администратору.
        ChangeNotifierProvider<AuthProvider>(
          create: (_) => StubAuthProvider.admin(),
        ),
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

  testWidgets('фраза вместо кода; JSON на экране нет, есть «Скопировать код»',
      (tester) async {
    await _pump(tester, _known);

    expect(find.text('Цена выше порога'), findsOneWidget);
    expect(find.textContaining('при пороге'), findsOneWidget);
    // Сырая запись на экран не выходит ни раскрытой, ни под спойлером (Ч26):
    // она уходит в буфер кнопкой, как в `AdminErrorCard`.
    expect(find.text('Исходная запись'), findsNothing);
    expect(find.textContaining('"reason"'), findsNothing);
    expect(find.textContaining('threshold'), findsNothing);
    expect(find.text('Скопировать код'), findsOneWidget);
  });

  // Сторож на незнакомую причину (`feedback_machine_codes_leak_to_moderator`):
  // правило, которого нет в словаре, не выводит JSON и не молчит — строка
  // признаёт незнакомую причину и называет её код.
  testWidgets('незнакомое правило: строка его называет, JSON на экране нет',
      (tester) async {
    await _pump(
      tester,
      _item(
        id: 'unknown-with-details',
        flag: <String, dynamic>{
          'reason': 'quarantine',
          'details': <String, dynamic>{'threshold': 7},
        },
      ),
    );

    expect(
      find.text('Причина флага «quarantine» панели незнакома — подробности '
          'в коде записи.'),
      findsOneWidget,
    );
    expect(find.textContaining('{'), findsNothing);
    expect(find.textContaining('threshold'), findsNothing);
    expect(find.text('Скопировать код'), findsOneWidget);
  });

  testWidgets('«Скопировать код» кладёт исходную запись в буфер',
      (tester) async {
    String? copied;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'Clipboard.setData') {
          copied = (call.arguments as Map)['text'] as String?;
        }
        return null;
      },
    );
    addTearDown(() => tester.binding.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null));

    await _pump(tester, _known);
    await tester.tap(find.text('Скопировать код'));
    await tester.pump();

    expect(copied, contains('"reason": "price_above_threshold"'));
    expect(copied, contains('"threshold": 1000'));
    expect(find.text('Код скопирован'), findsOneWidget);
  });

  testWidgets('отметка «скопировано» не переезжает на следующую позицию',
      (tester) async {
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async => null,
    );
    addTearDown(() => tester.binding.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null));
    final provider = await _pump(tester, _known);

    await tester.tap(find.text('Скопировать код'));
    await tester.pump();
    expect(find.text('Код скопирован'), findsOneWidget);

    provider.choose(_unknown);
    await tester.pump();
    expect(find.text('Скопировать код'), findsOneWidget);
  });

  testWidgets('резкое изменение цены: прежняя цена и порог — словами', (tester) async {
    await _pump(
      tester,
      _item(
        id: 'delta',
        price: 13,
        flag: <String, dynamic>{
          'reason': 'price_delta_anomaly',
          'details': <String, dynamic>{
            'previousPrice': 185,
            'currentPrice': 13,
            'ratio': 14.23,
            'threshold': 3,
          },
        },
      ),
    );

    expect(find.textContaining('с 185'), findsOneWidget);
    expect(
      find.text('Флаг ставится, когда цена меняется больше чем в 3 раза.'),
      findsOneWidget,
    );
    expect(find.textContaining('ratio'), findsNothing);
  });

  // ==========================================================================
  // Факт-грид: четыре ячейки, все настоящие
  // ==========================================================================

  testWidgets('грид показывает цену, категорию, уверенность и состояние',
      (tester) async {
    await _pump(tester, _known);

    // Четвёртой ячейкой в кадре стоит «Медиана категории», но её не считает
    // никто. Вместо выдуманного числа — состояние заведения: оно отвечает,
    // видит ли это блюдо хоть кто-то.
    expect(find.text('Цена в меню'), findsOneWidget);
    // Разряды разделяет НЕРАЗРЫВНЫЙ пробел — так их ставит `NumberFormat` для
    // русской локали, и обычный пробел в ожидании тест бы не нашёл.
    expect(find.text('1${String.fromCharCode(0xA0)}200 BYN'), findsOneWidget);
    // «Раздел в меню», не «Категория из OCR» — слово разработчика (A1-20).
    expect(find.text('Раздел в меню'), findsOneWidget);
    expect(find.textContaining('OCR'), findsNothing);
    expect(find.text('Горячее'), findsOneWidget);
    expect(find.text('Уверенность распознавания'), findsOneWidget);
    expect(find.text('62%'), findsOneWidget);
    expect(find.text('Состояние заведения'), findsOneWidget);
    expect(find.text('опубликовано'), findsOneWidget);
    expect(find.text('Медиана категории'), findsNothing);
  });

  // A1-08: флаг сверяется с самим меню — файл, из которого прочитана строка.
  testWidgets('«Открыть файл меню» — когда сервер назвал файл', (tester) async {
    await _pump(
      tester,
      _item(
        id: 'with-file',
        flag: <String, dynamic>{'reason': 'low_confidence'},
        menuFile: const MediaItem(
          id: 'm-1',
          url: 'https://res.cloudinary.com/t/image/upload/v1/menu/a.pdf',
          fileType: 'pdf',
        ),
      ),
    );
    expect(find.text('Открыть файл меню (PDF)'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey<String>('open-menu-file')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.textContaining('PDF · стр. 1'), findsOneWidget);
  });

  // A1-07: действия доходят до повторов строки в других файлах меню — и
  // диалоги говорят об этом (правило копий, PR #107).
  testWidgets('«Скрыть» и «Снять флаг» говорят о повторах строки',
      (tester) async {
    await _pump(tester, _known);

    await tester.tap(find.text('Скрыть позицию'));
    await tester.pumpAndSettle();
    expect(find.textContaining('вместе с повторами этой строки'), findsOneWidget);
    await tester.tap(find.text('Отмена'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Снять флаг'));
    await tester.pumpAndSettle();
    expect(find.textContaining('с её повторов в других файлах меню'),
        findsOneWidget);
    expect(find.textContaining('«Драники»'), findsOneWidget);
  });

  testWidgets('без файла кнопки нет', (tester) async {
    await _pump(tester, _known);
    expect(find.byKey(const ValueKey<String>('open-menu-file')), findsNothing);
  });

  testWidgets('нераспознанная цена названа словом, а не нулём', (tester) async {
    await _pump(
      tester,
      _item(id: 'no-price', flag: <String, dynamic>{'reason': 'low_confidence'}, price: null),
    );

    // «0,00 BYN» читалось бы как настоящая цена — и это ровно тот случай,
    // когда модератор пошёл бы искать несуществующую ошибку в меню.
    expect(find.text('не распозналась'), findsOneWidget);
  });

  // ==========================================================================
  // Диалог скрытия
  // ==========================================================================

  testWidgets('кнопка скрытия ждёт причину и говорит, чего не хватает',
      (tester) async {
    final provider = await _pump(tester, _known);

    await tester.tap(find.text('Скрыть позицию'));
    await tester.pumpAndSettle();

    // Пустое поле: кнопка заблокирована, причина блокировки написана рядом —
    // активная кнопка, молча не реагирующая на нажатие, читается как поломка.
    expect(find.text('Нужна причина'), findsOneWidget);
    expect(
      tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Скрыть')).onPressed,
      isNull,
    );

    await tester.enterText(find.byType(TextField), 'цена');
    await tester.pump();
    expect(find.text('Ещё 6 символов'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'цена подтверждена по фото меню');
    await tester.pump();
    expect(
      tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Скрыть')).onPressed,
      isNotNull,
    );

    await tester.tap(find.widgetWithText(FilledButton, 'Скрыть'));
    await tester.pumpAndSettle();

    expect(provider.hideReasons, <String>['цена подтверждена по фото меню']);
  });

  testWidgets('у скрытой позиции другое действие и видна причина скрытия',
      (tester) async {
    await _pump(
      tester,
      _item(
        id: 'hidden',
        flag: <String, dynamic>{'reason': 'low_confidence'},
        hidden: true,
      ),
    );

    expect(find.text('Показать снова'), findsOneWidget);
    expect(find.text('Скрыть позицию'), findsNothing);
    expect(find.text('Позиция скрыта из поиска'), findsOneWidget);
    expect(find.text('проверено вручную'), findsOneWidget);
  });
}
