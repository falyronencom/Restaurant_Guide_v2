import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:geolocator/geolocator.dart';
import 'package:restaurant_guide_mobile/utils/geo.dart';
import 'package:shared_preferences/shared_preferences.dart';

// Слежение за позицией человека «на ходу» (прогулка, решение Координатора
// Р4, 17.10.2026). Не знает ни про избранное, ни про карту: хозяин заводит
// его, пока прогулку видно, и гасит вместе с собой.
//
// Почему не LocationService.getCurrentPosition(): тот отдаёт сначала
// последнюю сохранённую позицию, а она бывает старой на часы (Discovery,
// Q4). И почему не EstablishmentsProvider.fetchUserLocation(): тот заодно
// переключает сортировку поиска.

/// Позиция обновляется, когда человек отошёл примерно на столько метров.
const int kWalkDistanceFilterMeters = 50;

/// Сколько ждать свежую позицию при включении, прежде чем сказать «не
/// удалось».
const Duration kFreshPositionTimeLimit = Duration(seconds: 15);

/// Позиция старше этого — не «сейчас»: система отдаёт и сохранённые.
const Duration kMaxFixAge = Duration(seconds: 15);

/// Позиция грубее этого (метров) не годится: круг в 923 м вокруг точки,
/// известной с точностью до километров, — неправда. Столько дают
/// «приблизительная геолокация» Android 12+ и «Точно: выкл.» на iOS, а
/// внутри дома без Wi-Fi — вышки связи.
const double kMaxFixAccuracyMeters = 250;

/// Годится ли позиция для прогулки на момент [now]: не старше [kMaxFixAge]
/// (в обе стороны — часы телефона и спутников расходятся) и не грубее
/// [kMaxFixAccuracyMeters].
bool isUsableFix(Position position, DateTime now) =>
    now.difference(position.timestamp).abs() <= kMaxFixAge &&
    position.accuracy <= kMaxFixAccuracyMeters;

/// Свежей позиции нет: система отдаёт только старые или грубые.
class NoUsableFixException implements Exception {
  const NoUsableFixException();

  @override
  String toString() => 'NoUsableFixException: только старые или грубые позиции';
}

/// Можно ли узнать, где человек.
enum LocationAccess {
  /// Разрешение дано, геолокация включена.
  granted,

  /// Разрешение ещё не спрашивали (или отказали один раз, и система
  /// спросит снова) — спросить по нажатию.
  askable,

  /// Запрещено навсегда: система больше не спросит.
  denied,

  /// Геолокация на телефоне выключена.
  off,
}

/// Откуда берётся позиция. Подменяется в тестах.
abstract interface class PositionSource {
  /// Можно ли узнать позицию — без системного запроса.
  Future<LocationAccess> access();

  /// Спросить разрешение системным запросом.
  Future<LocationAccess> requestAccess();

  /// Свежая позиция — не последняя сохранённая.
  Future<GeoPoint> freshPosition();

  /// Позиция на ходу: новая — когда человек отошёл на
  /// [distanceFilterMeters]. Подписка держит геолокацию включённой, отписка
  /// выключает.
  Stream<GeoPoint> positions({required int distanceFilterMeters});
}

/// Позиция телефона через Geolocator.
///
/// Android не отличает «ещё не спрашивали» от «запрещено навсегда»: проверка
/// разрешения отвечает `denied` в обоих случаях (geolocator_android 4.6.2,
/// `PermissionManager.checkPermissionStatus`), а `deniedForever` приходит
/// только ответом на запрос. Этот ответ запоминается ([deniedForeverKey]) —
/// иначе чип «Пешком» стоял бы у того, кого система больше не спросит, и
/// нажатие на него ничего бы не делало. Разрешение дали — в приложении или
/// в настройках телефона — память стирается.
class DevicePositionSource implements PositionSource {
  const DevicePositionSource();

  static const String deniedForeverKey = 'walk_location_denied_forever';

  /// Сколько раз спрашивать свежую позицию, если приходит старая или грубая.
  static const int freshAttempts = 3;

  @override
  Future<LocationAccess> access() async {
    if (!await Geolocator.isLocationServiceEnabled()) return LocationAccess.off;
    final access = _accessOf(await Geolocator.checkPermission());
    if (access == LocationAccess.askable && await _rememberedDenied()) {
      return LocationAccess.denied;
    }
    if (access == LocationAccess.granted) await _remember(access);
    return access;
  }

  @override
  Future<LocationAccess> requestAccess() async {
    if (!await Geolocator.isLocationServiceEnabled()) return LocationAccess.off;
    final access = _accessOf(await Geolocator.requestPermission());
    await _remember(access);
    return access;
  }

  /// `getCurrentPosition`, а не `getLastKnownPosition`: на Android плагин
  /// заводит обновления и отдаёт первое пришедшее (geolocator_android 4.6.2,
  /// `MethodCallHandlerImpl.onGetCurrentPosition`). Но на iOS запрос свежей
  /// позиции получает и то, что пришло потоку, без проверки возраста — то
  /// есть и сохранённую (geolocator_apple 2.3.13, `GeolocationHandler`,
  /// `didUpdateLocations`). Поэтому старая или грубая позиция — ещё попытка,
  /// после [freshAttempts] — отказ.
  @override
  Future<GeoPoint> freshPosition() async {
    for (var attempt = 0; attempt < freshAttempts; attempt++) {
      final position = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
        timeLimit: kFreshPositionTimeLimit,
      );
      if (isUsableFix(position, DateTime.now())) return _point(position);
    }
    throw const NoUsableFixException();
  }

  /// Старые и грубые позиции поток пропускает молча: следующая придёт
  /// через ~50 м.
  @override
  Stream<GeoPoint> positions({required int distanceFilterMeters}) {
    return Geolocator.getPositionStream(
      locationSettings: walkLocationSettings(
        distanceFilterMeters,
        defaultTargetPlatform,
      ),
    ).where((p) => isUsableFix(p, DateTime.now())).map(_point);
  }

  static GeoPoint _point(Position p) =>
      (latitude: p.latitude, longitude: p.longitude);

  static Future<bool> _rememberedDenied() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return prefs.getBool(deniedForeverKey) ?? false;
    } catch (e) {
      debugPrint('DevicePositionSource: память отказа не прочитать: $e');
      return false;
    }
  }

  /// Запомнить «навсегда» или стереть память, когда разрешение дано.
  static Future<void> _remember(LocationAccess access) async {
    if (access != LocationAccess.denied && access != LocationAccess.granted) {
      return;
    }
    try {
      final prefs = await SharedPreferences.getInstance();
      if (access == LocationAccess.denied) {
        await prefs.setBool(deniedForeverKey, true);
      } else if (prefs.containsKey(deniedForeverKey)) {
        await prefs.remove(deniedForeverKey);
      }
    } catch (e) {
      debugPrint('DevicePositionSource: память отказа не записать: $e');
    }
  }

  static LocationAccess _accessOf(LocationPermission permission) =>
      switch (permission) {
        LocationPermission.always ||
        LocationPermission.whileInUse =>
          LocationAccess.granted,
        LocationPermission.denied ||
        LocationPermission.unableToDetermine =>
          LocationAccess.askable,
        LocationPermission.deniedForever => LocationAccess.denied,
      };
}

/// Настройки потока позиции на ходу: высокая точность (порог в 50 м грубой
/// точности не по силам) и порог расстояния [distanceFilterMeters]. Android
/// не чаще раза в 5 секунд; iOS — шаги пешехода, без фоновой работы.
@visibleForTesting
LocationSettings walkLocationSettings(
  int distanceFilterMeters,
  TargetPlatform platform,
) {
  return switch (platform) {
    TargetPlatform.android => AndroidSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: distanceFilterMeters,
        intervalDuration: const Duration(seconds: 5),
      ),
    TargetPlatform.iOS || TargetPlatform.macOS => AppleSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: distanceFilterMeters,
        activityType: ActivityType.fitness,
        allowBackgroundLocationUpdates: false,
      ),
    _ => LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: distanceFilterMeters,
      ),
  };
}

/// Следит за позицией, пока его не остановят: при [start] — свежая позиция
/// и поток «на ходу»; при [stop] — отписка, геолокация выключена.
///
/// Приложение ушло в фон (Яндекс.Карты по «Маршруту», погас экран) — поток
/// снимается и сам заводится снова при возвращении, со свежей позицией:
/// пока человека нет в приложении, держать геолокацию незачем.
///
/// Ответы прошлого запуска (свежая позиция, пришедшая после [stop])
/// отбрасываются.
class PositionTracker {
  PositionTracker({
    required this.source,
    required this.onPosition,
    required this.onFailure,
    this.distanceFilterMeters = kWalkDistanceFilterMeters,
  });

  final PositionSource source;

  /// Новая позиция.
  final ValueChanged<GeoPoint> onPosition;

  /// Позицию узнать не удалось: свежая не пришла, а поток ничего не дал или
  /// оборвался (геолокацию выключили, отозвали разрешение).
  final VoidCallback onFailure;

  final int distanceFilterMeters;

  StreamSubscription<GeoPoint>? _subscription;
  AppLifecycleListener? _lifecycle;

  /// Номер запуска подписки: ответ прежнего запуска не доходит.
  int _run = 0;
  bool _running = false;
  bool _hidden = false;

  /// В этом запуске позиция уже пришла — поздний отказ свежей позиции
  /// ничего не меняет.
  bool _delivered = false;

  /// Слежение заведено ([start] без [stop]).
  bool get isRunning => _running;

  /// Геолокация сейчас включена этим слежением.
  bool get isListening => _subscription != null;

  void start() {
    if (_running) return;
    _running = true;
    _lifecycle ??= AppLifecycleListener(onHide: _onHide, onShow: _onShow);
    if (!_hidden) _listen();
  }

  /// Снова: после отказа — свежая позиция и поток заново.
  void retry() {
    if (!_running || _hidden) return;
    _unlisten();
    _listen();
  }

  void stop() {
    _running = false;
    _unlisten();
    _lifecycle?.dispose();
    _lifecycle = null;
    _hidden = false;
  }

  void dispose() => stop();

  void _listen() {
    final run = ++_run;
    _delivered = false;
    _subscription =
        source.positions(distanceFilterMeters: distanceFilterMeters).listen(
      (position) {
        if (run == _run) _deliver(position);
      },
      onError: (Object error) {
        if (run != _run) return;
        debugPrint('PositionTracker: поток позиции оборвался: $error');
        _unlisten();
        onFailure();
      },
    );
    source.freshPosition().then(
      (position) {
        if (run == _run) _deliver(position);
      },
      onError: (Object error) {
        debugPrint('PositionTracker: свежей позиции нет: $error');
        if (run == _run && !_delivered) onFailure();
      },
    );
  }

  void _deliver(GeoPoint position) {
    _delivered = true;
    onPosition(position);
  }

  void _unlisten() {
    _run++;
    _subscription?.cancel();
    _subscription = null;
  }

  void _onHide() {
    _hidden = true;
    _unlisten();
  }

  /// Слушатель жизненного цикла живёт только между [start] и [stop] —
  /// значит, слежение здесь всегда заведено.
  void _onShow() {
    _hidden = false;
    if (_subscription == null) _listen();
  }
}
