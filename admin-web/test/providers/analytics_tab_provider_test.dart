import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/models/analytics_models.dart';
import 'package:restaurant_guide_admin_web/providers/establishments_analytics_provider.dart';
import 'package:restaurant_guide_admin_web/services/analytics_service.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/period_selector.dart';

// Что уходит в запрос и чей ответ доезжает до экрана.
//
// Первое обещание — подсвеченный период действительно применён. До этапа 6
// провайдер хранил границы диапазона отдельным полем и затирал его только
// непустым значением, а и сервис, и бэкенд предпочитают `from`/`to` коду
// периода: выбрать «Период», затем «7 дней» — и данные оставались за
// произвольный диапазон при подсвеченных «7 днях».
//
// Второе — устаревший ответ не перетирает свежий. Тот же класс дефекта в
// этом проекте ловили в модерации и в отзывах.

class _FakeAnalyticsService implements AnalyticsService {
  final List<Map<String, String?>> calls = <Map<String, String?>>[];

  /// Чем отвечать на n-й вызов. Незаполненное — мгновенный ответ.
  final Map<int, Completer<EstablishmentsAnalyticsData>> gates =
      <int, Completer<EstablishmentsAnalyticsData>>{};

  int total = 0;

  @override
  Future<EstablishmentsAnalyticsData> getEstablishmentsAnalytics({
    String period = '30d',
    String? from,
    String? to,
  }) {
    final index = calls.length;
    calls.add(<String, String?>{'period': period, 'from': from, 'to': to});

    final gate = gates[index];
    if (gate != null) return gate.future;
    return Future<EstablishmentsAnalyticsData>.value(_data(total));
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

EstablishmentsAnalyticsData _data(int total) => EstablishmentsAnalyticsData(
      creationTimeline: const <TimelinePoint>[],
      statusDistribution: const <DistributionItem>[],
      cityDistribution: const <DistributionItem>[],
      categoryDistribution: const <DistributionItem>[],
      total: total,
      active: 0,
      pending: 0,
      newInPeriod: 0,
      aggregation: 'day',
    );

void main() {
  late _FakeAnalyticsService service;
  late EstablishmentsAnalyticsProvider provider;

  setUp(() {
    service = _FakeAnalyticsService();
    provider = EstablishmentsAnalyticsProvider(service: service);
  });

  final custom = PeriodSelection(
    period: 'custom',
    from: DateTime(2026, 8, 1),
    to: DateTime(2026, 8, 25),
  );

  group('Значение периода', () {
    // Прежний дефект — залипший произвольный диапазон — здесь невыразим: код
    // периода и его границы стали одним значением, и провайдеру больше нечего
    // хранить между загрузками. Прогнать тест «против старого кода» поэтому
    // нельзя: у старого была другая форма вызова. Сторожить остаётся правило,
    // которое эту невыразимость и держит, — границы имеют силу только у
    // произвольного периода.
    test('границы при коде пресета игнорируются', () {
      final strayBounds = PeriodSelection(
        period: '7d',
        from: DateTime(2026, 8, 1),
        to: DateTime(2026, 8, 25),
      );

      expect(strayBounds.isCustom, isFalse);
      expect(strayBounds.fromParam, isNull);
      expect(strayBounds.toParam, isNull);
      expect(strayBounds.key, '7d');
    });

    test('незаполненный произвольный период не считается произвольным', () {
      const halfPicked = PeriodSelection(period: 'custom');

      expect(halfPicked.isCustom, isFalse);
      expect(halfPicked.fromParam, isNull);
    });

    test('ключ различает окна, а не только коды', () {
      final august = PeriodSelection(
        period: 'custom',
        from: DateTime(2026, 8, 1),
        to: DateTime(2026, 8, 25),
      );
      final july = PeriodSelection(
        period: 'custom',
        from: DateTime(2026, 7, 1),
        to: DateTime(2026, 7, 25),
      );

      // Иначе смена одного произвольного окна на другое не считалась бы
      // сменой периода, и вкладки остались бы на прежних числах.
      expect(august.key, isNot(july.key));
    });

    test('база сравнения названа словами периода', () {
      expect(
        const PeriodSelection(period: '7d').comparisonLabel,
        'сравнение с предыдущими 7 днями',
      );
      expect(
        const PeriodSelection(period: 'custom').comparisonLabel,
        'сравнение с предыдущим периодом',
      );
    });
  });

  group('Период на проводе', () {
    test('пресет уходит кодом, без границ', () async {
      await provider.load(const PeriodSelection(period: '7d'));

      expect(service.calls.single, <String, String?>{
        'period': '7d',
        'from': null,
        'to': null,
      });
    });

    test('произвольный период уходит датами без времени', () async {
      await provider.load(custom);

      expect(service.calls.single, <String, String?>{
        'period': 'custom',
        'from': '2026-08-01',
        'to': '2026-08-25',
      });
    });

    test('возврат к пресету стирает произвольный диапазон', () async {
      await provider.load(custom);
      await provider.load(const PeriodSelection(period: '7d'));

      // Именно здесь ломалось: границы переживали смену периода, бэкенд
      // предпочитал их коду, и таблица оставалась августовской.
      expect(service.calls.last['from'], isNull);
      expect(service.calls.last['to'], isNull);
      expect(service.calls.last['period'], '7d');
    });
  });

  group('Догрузка отставшей вкладки', () {
    test('свежая вкладка не перечитывается', () async {
      await provider.load();
      await provider.loadIfStale();

      expect(service.calls, hasLength(1));
    });

    test('после смены периода вкладка считается отставшей', () async {
      await provider.load();
      provider.setPeriod(const PeriodSelection(period: '7d'));

      expect(provider.isStale, isTrue);

      await provider.loadIfStale();
      expect(service.calls, hasLength(2));
      expect(service.calls.last['period'], '7d');
    });

    test('setPeriod сам за данными не ходит', () {
      provider.setPeriod(const PeriodSelection(period: '90d'));

      expect(service.calls, isEmpty);
    });

    test('повторный выбор того же периода ничего не меняет', () async {
      await provider.load();
      provider.setPeriod(const PeriodSelection(period: '30d'));

      expect(provider.isStale, isFalse);
      await provider.loadIfStale();
      expect(service.calls, hasLength(1));
    });
  });

  group('Гонка ответов', () {
    test('ответ на отменённый запрос выбрасывается', () async {
      final slow = Completer<EstablishmentsAnalyticsData>();
      service.gates[0] = slow;

      // Первый запрос завис, второй ушёл следом и ответил сразу.
      final first = provider.load(const PeriodSelection(period: '90d'));
      service.total = 2;
      await provider.load(const PeriodSelection(period: '7d'));

      expect(provider.data?.total, 2);

      // Первый отвечает последним — и не должен ничего изменить.
      slow.complete(_data(1));
      await first;

      expect(provider.data?.total, 2);
      expect(provider.period, '7d');
    });

    test('ошибка отменённого запроса не показывается', () async {
      final slow = Completer<EstablishmentsAnalyticsData>();
      service.gates[0] = slow;

      final first = provider.load(const PeriodSelection(period: '90d'));
      service.total = 5;
      await provider.load(const PeriodSelection(period: '7d'));

      slow.completeError(Exception('403'));
      await first;

      expect(provider.error, isNull);
      expect(provider.data?.total, 5);
      expect(provider.isLoading, isFalse);
    });
  });

  group('Смена периода на лету', () {
    test('ответ на старый период оставляет вкладку отставшей', () async {
      final slow = Completer<EstablishmentsAnalyticsData>();
      service.gates[0] = slow;

      final first = provider.load();
      // Период сменился, пока ответ ещё летит. Запроса за новым не было —
      // вкладка невидима, за неё ходят только при открытии.
      provider.setPeriod(const PeriodSelection(period: '7d'));

      slow.complete(_data(3));
      await first;

      // Данные доехали и показываются, но посчитаны за прежнее окно.
      expect(provider.data?.total, 3);
      expect(provider.isStale, isTrue);

      await provider.loadIfStale();
      expect(service.calls.last['period'], '7d');
    });

    test('отметка о летящем запросе снимается после сбоя', () async {
      service.gates[0] = Completer<EstablishmentsAnalyticsData>()
        ..completeError(Exception('No internet'));
      await provider.load();

      // Иначе отметка залипла бы, и вкладка перестала бы грузиться совсем.
      await provider.loadIfStale();
      expect(service.calls, hasLength(2));
    });

    test('пока летит нужный период, второго запроса не будет', () async {
      final slow = Completer<EstablishmentsAnalyticsData>();
      service.gates[0] = slow;

      final first = provider.load();
      await provider.loadIfStale();
      expect(service.calls, hasLength(1));

      slow.complete(_data(1));
      await first;
    });
  });

  group('Ошибка', () {
    test('сбой не стирает уже показанные данные', () async {
      service.total = 7;
      await provider.load();

      service.gates[1] = Completer<EstablishmentsAnalyticsData>()
        ..completeError(Exception('No internet'));
      await provider.load(const PeriodSelection(period: '7d'));

      expect(provider.error, 'Нет подключения к серверу');
      expect(provider.data?.total, 7);
    });

    test('после сбоя вкладка остаётся отставшей и догрузится', () async {
      service.gates[0] = Completer<EstablishmentsAnalyticsData>()
        ..completeError(Exception('No internet'));
      await provider.load();

      expect(provider.error, isNotNull);

      await provider.loadIfStale();
      expect(service.calls, hasLength(2));
    });
  });
}
