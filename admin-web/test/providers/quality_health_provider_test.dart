import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/models/quality_health_models.dart';
import 'package:restaurant_guide_admin_web/providers/quality_health_provider.dart';
import 'package:restaurant_guide_admin_web/services/quality_health_service.dart';

/// Гонки в `QualityHealthProvider`.
///
/// У провайдера ДВА вызывающих: экран «Здоровье данных» и панель «Требует
/// внимания» на дашборде. Отсюда счётчик поколений и пропуск обычной загрузки
/// при летящем запросе — логика, которая до этого набора не была проверена ни
/// одной веткой, хотя именно она стоит между поздним ответом и перезаписью
/// свежего снимка.
class _FakeHealthService implements QualityHealthService {
  final List<Completer<QualityHealthData>> pending =
      <Completer<QualityHealthData>>[];
  final List<bool> forced = <bool>[];

  @override
  Future<QualityHealthData> getHealth({bool force = false}) {
    forced.add(force);
    final completer = Completer<QualityHealthData>();
    pending.add(completer);
    return completer.future;
  }

  int get calls => forced.length;
}

QualityHealthData _data(int unreachable) => QualityHealthData(
      scope: 'active',
      generatedAt: '2026-08-27T09:41:00.000Z',
      unreachableCount: unreachable,
      categoryOffCanonCount: 0,
      cuisineOffCanonCount: 0,
      emptyMenusCount: 0,
      ocrFailedCount: 0,
      ocrStuckCount: 0,
      outOfBoundsCount: 0,
      hoursMalformedCount: 0,
      hoursAllClosedCount: 0,
      attributeKeys: const <AttributeKeyCount>[],
      nonObjectAttributesCount: 0,
      hangingFlagsCount: 0,
      hangingAgedOver7d: 0,
      hangingAgedOver30d: 0,
      priceDistributionStatus: 'deferred',
    );

void main() {
  late _FakeHealthService fake;
  late QualityHealthProvider provider;

  setUp(() {
    fake = _FakeHealthService();
    provider = QualityHealthProvider(service: fake);
  });

  test('обычная загрузка при летящем запросе не отправляется второй раз', () {
    provider.load();
    provider.load();

    // Ответ один и тот же; второй вызов лишь удвоил бы работу сервера, а
    // эндпоинт тяжёлый — восемь запросов, три из них по всему каталогу.
    expect(fake.calls, 1);
  });

  test('принудительная отправляется поверх летящей', () {
    provider.load();
    provider.refresh();

    // Иначе нажатие «Обновить» в момент фоновой загрузки осталось бы без
    // ответа, а кнопка без отклика читается как поломка.
    expect(fake.calls, 2);
    expect(fake.forced, <bool>[false, true]);
  });

  test('побеждает отправленный последним, а не ответивший последним', () async {
    provider.load(); // поколение 1
    provider.refresh(); // поколение 2

    // Второй ответил первым, первый — следом. Именно этот порядок и губит
    // наивную реализацию: поздний ответ старого запроса перетирает свежий.
    fake.pending[1].complete(_data(222));
    await Future<void>.delayed(Duration.zero);
    fake.pending[0].complete(_data(111));
    await Future<void>.delayed(Duration.zero);

    expect(provider.data!.unreachableCount, 222);
  });

  test('отставшее поколение не снимает полосу загрузки', () async {
    provider.load();
    provider.refresh();

    fake.pending[0].complete(_data(111)); // отставший ответил первым
    await Future<void>.delayed(Duration.zero);

    // Свежий запрос ещё летит — значит экран обязан продолжать показывать
    // загрузку. Снятие флага чужим поколением гасило бы полосу раньше времени.
    expect(provider.isLoading, isTrue);
    expect(provider.data, isNull);

    fake.pending[1].complete(_data(222));
    await Future<void>.delayed(Duration.zero);

    expect(provider.isLoading, isFalse);
    expect(provider.data!.unreachableCount, 222);
  });

  test('ошибка отставшего поколения не портит свежие данные', () async {
    provider.load();
    provider.refresh();

    fake.pending[1].complete(_data(222));
    await Future<void>.delayed(Duration.zero);
    fake.pending[0].completeError(Exception('Connection timeout'));
    await Future<void>.delayed(Duration.zero);

    expect(provider.data!.unreachableCount, 222);
    expect(provider.error, isNull);
  });

  test('сбой обновления оставляет прежний снимок на месте', () async {
    provider.load();
    fake.pending[0].complete(_data(111));
    await Future<void>.delayed(Duration.zero);

    provider.refresh();
    fake.pending[1].completeError(Exception('Connection timeout'));
    await Future<void>.delayed(Duration.zero);

    // Данные остаются: экран покажет их и сообщит о сбое тостом. Обнулять их
    // значило бы потерять уже прочитанное из-за неудачного повтора.
    expect(provider.data!.unreachableCount, 111);
    expect(provider.error, 'Превышено время ожидания');
  });

  test('после завершения обычная загрузка снова проходит', () async {
    provider.load();
    fake.pending[0].complete(_data(111));
    await Future<void>.delayed(Duration.zero);

    provider.load();

    // Защита от повторного входа держится ровно на время полёта, а не навсегда:
    // иначе возврат на экран перестал бы обновлять снимок вовсе.
    expect(fake.calls, 2);
  });
}
