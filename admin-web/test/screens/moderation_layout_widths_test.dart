import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/models/flagged_menu_item.dart';
import 'package:restaurant_guide_admin_web/providers/approved_provider.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/providers/menu_items_moderation_provider.dart';
import 'package:restaurant_guide_admin_web/providers/moderation_provider.dart';
import 'package:restaurant_guide_admin_web/providers/rejected_provider.dart';
import 'package:restaurant_guide_admin_web/providers/suspended_provider.dart';
import 'package:restaurant_guide_admin_web/screens/menu_items/menu_items_moderation_screen.dart';
import 'package:restaurant_guide_admin_web/screens/moderation/approved_screen.dart';
import 'package:restaurant_guide_admin_web/screens/moderation/pending_moderation_screen.dart';
import 'package:restaurant_guide_admin_web/screens/moderation/rejected_screen.dart';
import 'package:restaurant_guide_admin_web/screens/moderation/suspended_screen.dart';
import 'package:restaurant_guide_admin_web/services/admin_menu_item_service.dart';
import 'package:restaurant_guide_admin_web/services/moderation_service.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_screen_header.dart';

import '../helpers/stub_auth.dart';

// Вёрстка экранов модерации и «Позиций меню» на 1024 и 1150 px (П5+П6,
// проход по панели модератора, 20.10; решение А — минимум окна 1024; осмотр
// расширением Chrome — обрезки уже на 1150: Ч9, Ч16, Ч24, F-01, F-03, A1-14).
//
// Окно собирается как в каркасе: меню слева 260 px (`admin_sidebar.dart`) и
// экран справа. Шрифты в сьюте настоящие (`flutter_test_config.dart`), данные —
// в форме, худшей для ширины: длинное название, почта, «Осталось проверить
// 14 полей», три фильтра.
//
// Проверяется два признака поломки, которые на экране видел Координатор:
// - переполнение (`RenderFlex overflowed`) — исключение раскладки;
// - перенос по буквам: у многострочного текста самое длинное слово шире
//   отведённого места (`getMinIntrinsicWidth(∞) > ширина`) — так «Осталось
//   проверить 14 полей» шло по 2–5 букв в строке. Однострочные тексты с
//   многоточием — законная обрезка и из проверки исключены.

const double _rail = 260;
const String _id = 'a41f9c02-1234-5678-9abc-def012345678';
const String _longName = 'Старая кофейня на набережной';

EstablishmentDetail _detail(String status, {Map<String, dynamic>? notes}) =>
    EstablishmentDetail(
      id: _id,
      partnerId: 'p-1',
      name: _longName,
      status: status,
      city: 'Минск',
      address: 'пр. Победителей, 9',
      latitude: 53.9,
      longitude: 27.55,
      phone: '+375 29 611-24-80',
      email: 'kofeinya.minsk@example.by',
      description: 'Кофейня у воды: завтраки, десерты, кофе своей обжарки.',
      categories: const <String>['Кофейня'],
      cuisines: const <String>['Европейская'],
      priceRange: r'$$',
      workingHours: const <String, dynamic>{'monday': '08:00-22:00'},
      attributes: const <String, dynamic>{
        'wifi': true,
        'terrace': true,
        'accessible_environment': false,
      },
      legalName: 'ООО «Старая кофейня»',
      unp: '191482073',
      registrationDocUrl: 'https://res.cloudinary.com/t/raw/upload/reg.pdf',
      contactPerson: 'Иван Контактов',
      contactEmail: 'ivan.kontaktov@example.by',
      partnerName: 'Ольга Партнёрова',
      partnerEmail: 'olga.partnerova@example.by',
      moderationNotes: notes,
    );

class _Service implements ModerationService {
  _Service(this.status, {this.notes});

  final String status;
  final Map<String, dynamic>? notes;

  EstablishmentListItem get _item => EstablishmentListItem(
        id: _id,
        name: _longName,
        city: 'Минск',
        categories: const <String>['Кофейня'],
        updatedAt: DateTime.now().subtract(const Duration(days: 21)),
      );

  @override
  Future<PendingListResponse> getPendingEstablishments({
    int page = 1,
    int perPage = 20,
  }) async =>
      PendingListResponse(
        establishments: <EstablishmentListItem>[_item],
        total: 25,
        page: 1,
        pages: 2,
      );

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
          ActiveEstablishmentItem(
            id: _id,
            name: _longName,
            city: 'Минск',
            categories: const <String>['Кофейня'],
            publishedAt: DateTime(2026, 10, 1),
            averageRating: 4.6,
            reviewCount: 12,
            viewCount: 1240,
            favoriteCount: 85,
          ),
        ],
        total: 46,
        page: 1,
        pages: 3,
      );

  @override
  Future<SuspendedListResponse> getSuspendedEstablishments({
    int page = 1,
    int perPage = 20,
  }) async =>
      SuspendedListResponse(
        establishments: <SuspendedEstablishmentItem>[
          SuspendedEstablishmentItem(
            id: _id,
            name: _longName,
            city: 'Минск',
            categories: const <String>['Кофейня'],
            suspendReason: 'Жалобы посетителей на санитарию',
            suspendedAt: DateTime(2026, 10, 7),
          ),
        ],
        total: 1,
        page: 1,
        pages: 1,
      );

  @override
  Future<RejectedListResponse> getRejectedEstablishments({
    int page = 1,
    int perPage = 20,
  }) async =>
      RejectedListResponse(
        rejections: <RejectedEstablishmentItem>[_rejection],
        total: 1,
        page: 1,
        pages: 1,
      );

  @override
  Future<EstablishmentDetail> getEstablishmentDetails(String id) async =>
      _detail(status, notes: notes);

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(
        'фейк не обслуживает ${invocation.memberName}',
      );
}

final RejectedEstablishmentItem _rejection = RejectedEstablishmentItem(
  auditId: 'audit-1',
  establishmentId: _id,
  name: _longName,
  city: 'Минск',
  categories: const <String>['Кофейня'],
  rejectionDate: DateTime(2026, 8, 19),
  rejectionNotes: const <String, dynamic>{
    'unp': 'УНП не совпадает с реестром',
    'photos': 'Фото интерьера размыты, загрузите резкие',
  },
  currentStatus: 'rejected',
);

class _MenuService implements AdminMenuItemService {
  @override
  Future<FlaggedMenuItemsResponse> getFlaggedItems({
    int page = 1,
    int perPage = 20,
    String? reason,
    String? visibility,
    String? city,
    String? search,
  }) async =>
      FlaggedMenuItemsResponse(
        items: <FlaggedMenuItem>[
          FlaggedMenuItem(
            id: 'mi-1',
            establishmentId: _id,
            mediaId: 'm-1',
            itemName: 'Стейк рибай из мраморной говядины',
            priceByn: 13,
            categoryRaw: 'Горячие блюда',
            confidence: 0.62,
            sanityFlag: const <String, dynamic>{
              'reason': 'price_delta_anomaly',
              'details': <String, dynamic>{
                'previousPrice': 185,
                'currentPrice': 13,
                'ratio': 14.23,
                'threshold': 3,
              },
            },
            isHiddenByAdmin: false,
            hiddenReason: null,
            createdAt: DateTime(2026, 10, 1, 9, 41),
            establishmentName: _longName,
            establishmentCity: 'Минск',
            establishmentStatus: 'active',
          ),
        ],
        total: 2,
        page: 1,
        pages: 1,
        perPage: 20,
        visibleCount: 2,
        hiddenCount: 1,
        cities: const <String>['Минск', 'Гродно'],
        reasons: const <String>[
          'price_below_threshold',
          'price_above_threshold',
          'low_confidence',
          'price_delta_anomaly',
        ],
      );

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(
        'фейк не обслуживает ${invocation.memberName}',
      );
}

class _StubBadges extends BadgesProvider {
  @override
  Future<void> load() async {}
}

/// Окно: меню слева 260 и экран справа.
Future<void> _pumpWindow(
  WidgetTester tester, {
  required double width,
  required List<ChangeNotifierProvider<ChangeNotifier>> providers,
  required Widget screen,
}) async {
  tester.view.physicalSize = Size(width, 800);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(MultiProvider(
    providers: <ChangeNotifierProvider<ChangeNotifier>>[
      ...providers,
      ChangeNotifierProvider<BadgesProvider>(create: (_) => _StubBadges()),
      ChangeNotifierProvider<AuthProvider>(
        create: (_) => StubAuthProvider.admin(),
      ),
    ],
    child: MaterialApp(
      theme: AppTheme.lightTheme,
      debugShowCheckedModeBanner: false,
      home: Scaffold(
        body: Row(
          children: <Widget>[
            const SizedBox(width: _rail),
            Expanded(child: screen),
          ],
        ),
      ),
    ),
  ));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 300));
}

/// Тексты, у которых самое длинное слово шире их места, — перенос по буквам.
List<String> _brokenByLetters(WidgetTester tester) {
  final broken = <String>[];
  for (final object in tester.allRenderObjects) {
    if (object is! RenderParagraph || !object.hasSize) continue;
    if (object.maxLines == 1) continue;
    final width = object.size.width;
    if (width <= 0) continue;
    final widestWord = object.getMinIntrinsicWidth(double.infinity);
    if (widestWord > width + 0.5) {
      broken.add('«${object.text.toPlainText()}»: слово '
          '${widestWord.toStringAsFixed(1)} в ${width.toStringAsFixed(1)} px');
    }
  }
  return broken;
}

/// Заголовок шапки не обрезан многоточием.
void _expectTitleWhole(WidgetTester tester, String title) {
  final paragraph = tester.renderObject<RenderParagraph>(
    find.descendant(
      of: find.byType(AdminScreenHeader),
      matching: find.text(title),
    ),
  );
  expect(paragraph.didExceedMaxLines, isFalse,
      reason: 'заголовок «$title» обрезан многоточием');
}

void _expectClean(WidgetTester tester, String where) {
  expect(tester.takeException(), isNull, reason: '$where: ошибка раскладки');
  expect(_brokenByLetters(tester), isEmpty, reason: '$where: по буквам');
}

void main() {
  for (final width in <double>[1024, 1150]) {
    group('окно $width px', () {
      testWidgets('«Ожидают просмотра»: подвал заявки и вкладки',
          (tester) async {
        final provider = ModerationProvider(service: _Service('pending'));
        addTearDown(provider.dispose);
        await _pumpWindow(
          tester,
          width: width,
          providers: <ChangeNotifierProvider<ChangeNotifier>>[
            ChangeNotifierProvider<ModerationProvider>.value(value: provider),
          ],
          screen: const PendingModerationScreen(),
        );
        await provider.selectEstablishment(_id);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));

        expect(find.textContaining('Осталось проверить'), findsOneWidget,
            reason: 'предпосылка: подсказка подвала на экране');
        _expectClean(tester, 'Данные');
        _expectTitleWhole(tester, 'Ожидают просмотра');

        // Кнопки подвала целиком в правой части окна.
        final approve = tester.getRect(
            find.byKey(const ValueKey<String>('approve-application')));
        final reject = tester.getRect(
            find.byKey(const ValueKey<String>('reject-application')));
        expect(approve.right, lessThanOrEqualTo(width));
        expect(reject.right, lessThanOrEqualTo(width));
        expect(approve.overlaps(reject), isFalse);

        for (final tab in <String>['О заведении', 'Медиа', 'Адрес']) {
          await tester.tap(find.textContaining(tab).first);
          await tester.pumpAndSettle();
          _expectClean(tester, tab);
        }
      });

      testWidgets('«Одобренные»: шапка с действиями и поиском, карточка',
          (tester) async {
        final provider = ApprovedProvider(service: _Service('active'));
        addTearDown(provider.dispose);
        await _pumpWindow(
          tester,
          width: width,
          providers: <ChangeNotifierProvider<ChangeNotifier>>[
            ChangeNotifierProvider<ApprovedProvider>.value(value: provider),
          ],
          screen: const ApprovedScreen(),
        );
        await provider.selectEstablishment(_id);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));

        expect(find.byTooltip('Приостановить'), findsOneWidget,
            reason: 'на узком окне действия шапки — значками');
        _expectClean(tester, 'Данные');
        _expectTitleWhole(tester, 'Одобренные');

        for (final tab in <String>['О заведении', 'Медиа', 'Адрес']) {
          await tester.tap(find.text(tab).first);
          await tester.pumpAndSettle();
          _expectClean(tester, tab);
        }
      });

      testWidgets('«Приостановленные»: причина и карточка', (tester) async {
        final provider = SuspendedProvider(
          service: _Service('suspended', notes: const <String, dynamic>{
            'suspend_reason': 'Жалобы посетителей на санитарию',
            'suspended_at': '2026-10-07T11:40:00.000Z',
          }),
        );
        addTearDown(provider.dispose);
        await _pumpWindow(
          tester,
          width: width,
          providers: <ChangeNotifierProvider<ChangeNotifier>>[
            ChangeNotifierProvider<SuspendedProvider>.value(value: provider),
          ],
          screen: const SuspendedScreen(),
        );
        await provider.selectEstablishment(_id);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));

        _expectClean(tester, 'карточка');
        _expectTitleWhole(tester, 'Приостановленные');
      });

      testWidgets('«Отказанные»: причины отказа и карточка', (tester) async {
        final provider = RejectedProvider(service: _Service('rejected'));
        addTearDown(provider.dispose);
        await _pumpWindow(
          tester,
          width: width,
          providers: <ChangeNotifierProvider<ChangeNotifier>>[
            ChangeNotifierProvider<RejectedProvider>.value(value: provider),
          ],
          screen: const RejectedScreen(),
        );
        await provider.selectEstablishment(_rejection);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));

        expect(find.text('Причины отказа'), findsOneWidget,
            reason: 'предпосылка: блок причин на экране');
        _expectClean(tester, 'карточка');
        _expectTitleWhole(tester, 'Отказанные');
      });

      testWidgets('«Позиции меню»: заголовок, фильтры, разбор позиции',
          (tester) async {
        final provider = MenuItemsModerationProvider(service: _MenuService());
        addTearDown(provider.dispose);
        await _pumpWindow(
          tester,
          width: width,
          providers: <ChangeNotifierProvider<ChangeNotifier>>[
            ChangeNotifierProvider<MenuItemsModerationProvider>.value(
              value: provider,
            ),
          ],
          screen: const MenuItemsModerationScreen(),
        );
        provider.selectItem('mi-1');
        await tester.pump();

        expect(find.byKey(const ValueKey<String>('menu-filters-row')),
            findsOneWidget,
            reason: 'на узком окне фильтры — строкой под шапкой (Ч24)');
        _expectClean(tester, 'разбор позиции');
        _expectTitleWhole(tester, 'Позиции меню');
        final subtitle = tester.renderObject<RenderParagraph>(
            find.textContaining('с флагом'));
        expect(subtitle.didExceedMaxLines, isFalse,
            reason: 'подпись «2 позиции с флагом · …» обрезана (Ч24)');
      });
    });
  }

  testWidgets('широкое окно: фильтры «Позиций меню» — в шапке', (tester) async {
    final provider = MenuItemsModerationProvider(service: _MenuService());
    addTearDown(provider.dispose);
    await _pumpWindow(
      tester,
      width: 1600,
      providers: <ChangeNotifierProvider<ChangeNotifier>>[
        ChangeNotifierProvider<MenuItemsModerationProvider>.value(
          value: provider,
        ),
      ],
      screen: const MenuItemsModerationScreen(),
    );
    expect(find.byKey(const ValueKey<String>('menu-filters-row')), findsNothing);
    _expectClean(tester, 'шапка 1600');
    _expectTitleWhole(tester, 'Позиции меню');
  });
}
