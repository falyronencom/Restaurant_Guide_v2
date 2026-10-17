import 'dart:async';

import 'package:restaurant_guide_mobile/services/position_tracker.dart';
import 'package:restaurant_guide_mobile/utils/geo.dart';

/// Подставной источник позиции для прогулки: тест решает, что ответит
/// система, когда придёт свежая позиция и что пойдёт потоком, — и видит,
/// что у него спросили и подписан ли кто-то на поток.
class FakePositionSource implements PositionSource {
  FakePositionSource({
    this.accessValue = LocationAccess.granted,
    this.afterRequest = LocationAccess.granted,
  });

  /// Что ответит проверка без запроса; `null` — проверка не отвечает.
  LocationAccess? accessValue;

  /// Что ответит системный запрос.
  LocationAccess afterRequest;

  int accessCalls = 0;
  int requestCalls = 0;
  int freshCalls = 0;

  /// Пороги расстояния, с которыми подписывались на поток, по порядку.
  final List<int> streamFilters = [];

  /// Сколько раз от потока отписались.
  int cancels = 0;

  StreamController<GeoPoint>? _stream;
  Completer<GeoPoint>? _fresh;

  /// Кто-то подписан на поток — геолокация «включена».
  bool get listening => _stream?.hasListener ?? false;

  @override
  Future<LocationAccess> access() {
    accessCalls++;
    final value = accessValue;
    return value == null
        ? Completer<LocationAccess>().future
        : Future.value(value);
  }

  @override
  Future<LocationAccess> requestAccess() async {
    requestCalls++;
    return afterRequest;
  }

  @override
  Future<GeoPoint> freshPosition() {
    freshCalls++;
    _fresh = Completer<GeoPoint>();
    return _fresh!.future;
  }

  @override
  Stream<GeoPoint> positions({required int distanceFilterMeters}) {
    streamFilters.add(distanceFilterMeters);
    final controller = StreamController<GeoPoint>(onCancel: () => cancels++);
    _stream = controller;
    return controller.stream;
  }

  /// Пришла свежая позиция.
  void completeFresh(GeoPoint position) => _fresh!.complete(position);

  /// Свежую позицию узнать не удалось.
  void failFresh() => _fresh!.completeError(TimeoutException('нет позиции'));

  /// Человек отошёл — позиция в поток.
  void move(GeoPoint position) => _stream!.add(position);

  /// Поток оборвался (геолокацию выключили).
  void breakStream() => _stream!.addError(StateError('геолокация выключена'));
}
