import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/models/audit_log_entry.dart';
import 'package:restaurant_guide_admin_web/providers/audit_log_provider.dart';
import 'package:restaurant_guide_admin_web/services/audit_log_service.dart';
import 'package:restaurant_guide_admin_web/utils/error_text.dart';

// Журнал действий: что уходит в запрос и что провайдер считает «выборкой».
//
// Проверяются два обещания шапки экрана. Первое — подсвеченный период
// действительно применён: до этапа 5 сегмент-контрол показывал «30 дней», а
// запрос уходил без границ дат, и подпись «за 30 дней» врала о содержимом
// таблицы. Второе — «последняя запись» относится к ВЫБОРКЕ, а не к открытой
// странице: на третьей странице она не должна становиться трёхдневной.

/// Fake via `implements` — сеть здесь не нужна.
///
/// `noSuchMethod` закрывает остальной сервис: любой новый вызов упадёт с
/// именем метода вместо того, чтобы молча вернуть пустоту.
class _FakeAuditLogService implements AuditLogService {
  final List<Map<String, dynamic>> calls = <Map<String, dynamic>>[];

  /// Что отдавать на очередной запрос, по номеру страницы.
  Map<int, List<AuditLogEntry>> pages = <int, List<AuditLogEntry>>{};
  int total = 0;
  int pages_ = 1;

  /// Отказ на следующие запросы.
  Object? failWith;

  @override
  Future<AuditLogListResponse> getAuditLog({
    int page = 1,
    int perPage = 20,
    String? action,
    String? entityType,
    DateTime? from,
    DateTime? to,
  }) async {
    final failure = failWith;
    if (failure != null) {
      calls.add(<String, dynamic>{'page': page, 'action': action, 'failed': true});
      throw failure;
    }
    calls.add(<String, dynamic>{
      'page': page,
      'perPage': perPage,
      'action': action,
      'entityType': entityType,
      'from': from,
      'to': to,
    });

    return AuditLogListResponse(
      entries: pages[page] ?? const <AuditLogEntry>[],
      total: total,
      page: page,
      pages: pages_,
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

AuditLogEntry _entry(String id, DateTime createdAt) => AuditLogEntry(
      id: id,
      action: 'moderate_approve',
      summary: 'Одобрено заведение',
      entityType: 'establishment',
      createdAt: createdAt,
    );

void main() {
  late _FakeAuditLogService fake;
  late AuditLogProvider provider;

  setUp(() {
    fake = _FakeAuditLogService();
    provider = AuditLogProvider(service: fake);
  });

  group('Период', () {
    test('первая загрузка применяет окно 30 дней, а не «за всё время»', () async {
      await provider.loadEntries();

      final from = fake.calls.single['from'] as DateTime?;
      expect(from, isNotNull, reason: 'сегмент-контрол подсвечивает «30 дней»');

      final days = DateTime.now().difference(from!).inDays;
      expect(days, 30);
      // Верхней границы у периода по умолчанию нет: «последние 30 дней»
      // кончаются сейчас, а не в момент выбора.
      expect(fake.calls.single['to'], isNull);
    });

    test('7 и 90 дней дают своё окно', () async {
      await provider.loadEntries();
      provider.setPeriod('7d');
      await Future<void>.delayed(Duration.zero);

      final from = fake.calls.last['from'] as DateTime;
      expect(DateTime.now().difference(from).inDays, 7);

      provider.setPeriod('90d');
      await Future<void>.delayed(Duration.zero);
      expect(
        DateTime.now().difference(fake.calls.last['from'] as DateTime).inDays,
        90,
      );
    });

    test('произвольный период включает последний выбранный день целиком',
        () async {
      // `showDateRangePicker` отдаёт последний день полуночью, а бэкенд
      // сравнивает `created_at <= to`. Без доведения до конца суток выбравший
      // «01.05 — 31.05» не увидел бы ничего за 31 мая — и пустая выборка
      // выглядела бы правдоподобно, то есть дефект не самообнаруживался.
      provider.setPeriod(
        'custom',
        from: DateTime(2026, 5, 1),
        to: DateTime(2026, 5, 31),
      );
      await Future<void>.delayed(Duration.zero);

      expect(fake.calls.last['from'], DateTime(2026, 5, 1));
      expect(fake.calls.last['to'], DateTime(2026, 5, 31, 23, 59, 59, 999));
    });

    test('уход с произвольного периода снимает обе границы', () async {
      provider.setPeriod(
        'custom',
        from: DateTime(2026, 5, 1),
        to: DateTime(2026, 5, 31),
      );
      provider.setPeriod('7d');
      await Future<void>.delayed(Duration.zero);

      expect(fake.calls.last['to'], isNull);
      expect(provider.customFrom, isNull);
    });
  });

  group('Последняя запись выборки', () {
    setUp(() {
      fake.total = 45;
      fake.pages_ = 3;
      fake.pages = <int, List<AuditLogEntry>>{
        1: <AuditLogEntry>[
          _entry('a', DateTime.utc(2026, 8, 25, 9, 0)),
          _entry('b', DateTime.utc(2026, 8, 25, 8, 0)),
        ],
        3: <AuditLogEntry>[_entry('z', DateTime.utc(2026, 7, 1, 8, 0))],
      };
    });

    test('берётся с верха первой страницы', () async {
      await provider.loadEntries();
      expect(provider.latestAt, DateTime.utc(2026, 8, 25, 9, 0));
    });

    test('переживает перелистывание', () async {
      await provider.loadEntries();
      await provider.loadEntries(page: 3);

      // Свойство выборки, а не открытой страницы: иначе на третьей странице
      // шапка сообщала бы «последняя месяц назад».
      expect(provider.latestAt, DateTime.utc(2026, 8, 25, 9, 0));
      expect(provider.entries.single.id, 'z');
    });

    test('меняется вместе с данными, а не раньше них', () async {
      await provider.loadEntries();
      expect(provider.latestAt, DateTime.utc(2026, 8, 25, 9, 0));

      fake.pages = <int, List<AuditLogEntry>>{
        1: <AuditLogEntry>[_entry('n', DateTime.utc(2026, 8, 20, 7, 0))],
      };
      provider.setActionFilter('review_hide');

      // Ответ ещё летит, на экране прежние строки — и подпись шапки описывает
      // именно их. Обнулив метку заранее, мы показали бы прежний счётчик уже
      // без хвоста «последняя …».
      expect(provider.latestAt, DateTime.utc(2026, 8, 25, 9, 0));

      await Future<void>.delayed(Duration.zero);
      expect(provider.latestAt, DateTime.utc(2026, 8, 20, 7, 0));
    });

    test('пустая выборка не оставляет метку от предыдущей', () async {
      await provider.loadEntries();
      fake.pages = <int, List<AuditLogEntry>>{};
      await provider.loadEntries();

      expect(provider.latestAt, isNull);
    });
  });

  group('Фильтры', () {
    test('тип объекта уходит в запрос', () async {
      provider.setEntityTypeFilter('review');
      await Future<void>.delayed(Duration.zero);

      expect(fake.calls.last['entityType'], 'review');
    });

    test('период по умолчанию за фильтр не считается', () async {
      expect(provider.hasActiveFilters, isFalse);

      provider.setPeriod('7d');
      expect(provider.hasActiveFilters, isTrue);

      provider.setPeriod(AuditLogProvider.defaultPeriod);
      expect(provider.hasActiveFilters, isFalse);

      provider.setActionFilter('suspend');
      expect(provider.hasActiveFilters, isTrue);
    });

    test('сброс возвращает всё, включая период', () async {
      provider.setActionFilter('suspend');
      provider.setEntityTypeFilter('review');
      provider.setPeriod('90d');
      await Future<void>.delayed(Duration.zero);

      provider.clearFilters();
      await Future<void>.delayed(Duration.zero);

      final last = fake.calls.last;
      expect(last['action'], isNull);
      expect(last['entityType'], isNull);
      expect(provider.period, AuditLogProvider.defaultPeriod);
      expect(DateTime.now().difference(last['from'] as DateTime).inDays, 30);
    });

    test('смена фильтра закрывает раскрытую строку', () async {
      fake.pages = <int, List<AuditLogEntry>>{
        1: <AuditLogEntry>[_entry('a', DateTime.utc(2026, 8, 25, 9, 0))],
      };
      await provider.loadEntries();

      provider.toggleExpanded('a');
      expect(provider.expandedEntryId, 'a');

      provider.setActionFilter('suspend');
      // Раскрытая строка принадлежала прежней выборке.
      expect(provider.expandedEntryId, isNull);
    });
  });

  group('Сбой загрузки', () {
    // До 20.10 сбой смены фильтра оставлял в таблице строки прежней выборки
    // под новым фильтром, а тост говорил «от прошлой страницы» (пункт A3-23).
    final failure = DioException(
      requestOptions: RequestOptions(path: '/api/v1/admin/audit-log'),
      type: DioExceptionType.connectionError,
    );

    setUp(() {
      fake
        ..pages = <int, List<AuditLogEntry>>{
          1: <AuditLogEntry>[_entry('e1', DateTime.utc(2026, 10, 1))],
          2: <AuditLogEntry>[_entry('e2', DateTime.utc(2026, 9, 1))],
        }
        ..total = 21
        ..pages_ = 2;
    });

    test('смены фильтра: таблица пуста, причина — для карточки с «Повторить»',
        () async {
      await provider.loadEntries();
      expect(provider.entries, isNotEmpty, reason: 'предпосылка');

      fake.failWith = failure;
      provider.setActionFilter('user_block');
      await pumpEventQueue();

      expect(provider.entries, isEmpty,
          reason: 'прежняя выборка под новым фильтром выдавала бы себя за новую');
      expect(provider.totalCount, 0);
      expect(provider.error, kNoConnectionPhrase);
      expect(provider.actionFilter, 'user_block',
          reason: 'фильтр остаётся выбранным — «Повторить» просит его же');

      fake.failWith = null;
      await provider.loadEntries();
      expect(fake.calls.last['action'], 'user_block');
    });

    test('смены периода — так же', () async {
      await provider.loadEntries();
      fake.failWith = failure;
      provider.setPeriod('7d');
      await pumpEventQueue();

      expect(provider.entries, isEmpty);
      expect(provider.latestAt, isNull);
    });

    test('перелистывания: строки остаются — они той же выборки', () async {
      await provider.loadEntries();
      fake.failWith = failure;
      await provider.loadEntries(page: 2);

      expect(provider.entries.single.id, 'e1');
      expect(provider.error, kNoConnectionPhrase);
    });
  });
}
