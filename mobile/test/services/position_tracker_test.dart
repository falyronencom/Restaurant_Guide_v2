// Геолокация прогулки (этап 4, решение Р4): свежая позиция при включении,
// поток «на ходу» с порогом ~50 м, отписка при остановке и уходе в фон.
//
// Две половины. DevicePositionSource — против подставной платформы
// Geolocator: что именно спрошено у системы (свежая, не последняя
// сохранённая; порог потока), какие позиции не годятся (старые, грубые) и
// как Android-запрет «навсегда» запоминается. PositionTracker — против
// подставного источника: когда подписан, когда нет.

import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:restaurant_guide_mobile/services/position_tracker.dart';
import 'package:restaurant_guide_mobile/utils/geo.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/fake_position_source.dart';

/// Позиция [age] назад с точностью [accuracy] м; по умолчанию — только что
/// и точная.
Position _position(
  double lat,
  double lng, {
  Duration age = Duration.zero,
  double accuracy = 5,
}) =>
    Position(
      latitude: lat,
      longitude: lng,
      timestamp: DateTime.now().subtract(age),
      accuracy: accuracy,
      altitude: 0,
      altitudeAccuracy: 0,
      heading: 0,
      headingAccuracy: 0,
      speed: 0,
      speedAccuracy: 0,
    );

/// Подставная платформа Geolocator: записывает, что у неё спросили.
/// Наследует GeolocatorPlatform — токен платформы у неё настоящий.
class _FakeGeolocator extends GeolocatorPlatform {
  bool serviceEnabled = true;
  LocationPermission permission = LocationPermission.whileInUse;
  LocationPermission afterRequest = LocationPermission.whileInUse;
  final List<String> calls = [];
  LocationSettings? currentSettings;
  LocationSettings? streamSettings;

  /// Ответы на запросы свежей позиции по очереди; кончились — последний.
  List<Position> current = [_position(53.9, 27.56)];

  /// Что идёт потоком.
  List<Position> stream = [_position(53.91, 27.57)];

  @override
  Future<bool> isLocationServiceEnabled() async {
    calls.add('service');
    return serviceEnabled;
  }

  @override
  Future<LocationPermission> checkPermission() async {
    calls.add('check');
    return permission;
  }

  @override
  Future<LocationPermission> requestPermission() async {
    calls.add('request');
    return afterRequest;
  }

  @override
  Future<Position?> getLastKnownPosition(
      {bool forceLocationManager = false}) async {
    calls.add('last');
    return _position(1, 1);
  }

  @override
  Future<Position> getCurrentPosition(
      {LocationSettings? locationSettings}) async {
    calls.add('current');
    currentSettings = locationSettings;
    return current.length > 1 ? current.removeAt(0) : current.single;
  }

  @override
  Stream<Position> getPositionStream({LocationSettings? locationSettings}) {
    calls.add('stream');
    streamSettings = locationSettings;
    return Stream.fromIterable(stream);
  }
}

const GeoPoint _a = (latitude: 53.90, longitude: 27.56);
const GeoPoint _b = (latitude: 53.91, longitude: 27.57);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('DevicePositionSource — что спрошено у системы', () {
    late _FakeGeolocator platform;

    setUp(() {
      final previous = GeolocatorPlatform.instance;
      platform = _FakeGeolocator();
      GeolocatorPlatform.instance = platform;
      addTearDown(() => GeolocatorPlatform.instance = previous);
      SharedPreferences.setMockInitialValues({});
    });

    const source = DevicePositionSource();

    test('свежая позиция — getCurrentPosition, не последняя сохранённая',
        () async {
      final position = await source.freshPosition();

      expect(platform.calls, ['current'],
          reason: 'последняя сохранённая бывает старой на часы');
      expect(position, (latitude: 53.9, longitude: 27.56));
      final settings = platform.currentSettings!;
      expect(settings.accuracy, LocationAccuracy.high);
      expect(settings.timeLimit, const Duration(seconds: 15));
    });

    test('поток — с порогом 50 м и высокой точностью', () async {
      final positions =
          await source.positions(distanceFilterMeters: 50).toList();

      expect(platform.calls, ['stream']);
      expect(positions, [(latitude: 53.91, longitude: 27.57)]);
      final settings = platform.streamSettings!;
      expect(settings, isA<AndroidSettings>(),
          reason: 'в тестах платформа — Android');
      expect(settings.distanceFilter, 50);
      expect(settings.accuracy, LocationAccuracy.high);
      expect((settings as AndroidSettings).intervalDuration,
          const Duration(seconds: 5));
    });

    test(
        'свежая: сохранённая позиция часовой давности — ещё попытка, '
        'берётся свежая', () async {
      platform.current = [
        _position(1, 1, age: const Duration(hours: 1)),
        _position(53.9, 27.56),
      ];
      expect(await source.freshPosition(), (latitude: 53.9, longitude: 27.56));
      expect(platform.calls, ['current', 'current']);
    });

    test('свежая: три раза старая или грубая — отказ, а не старая позиция',
        () async {
      platform.current = [
        _position(1, 1, age: const Duration(hours: 1)),
        _position(2, 2, accuracy: 2000),
        _position(3, 3, age: const Duration(minutes: 5)),
      ];
      await expectLater(
          source.freshPosition(), throwsA(isA<NoUsableFixException>()));
      expect(platform.calls, ['current', 'current', 'current']);
    });

    test('поток: старые и грубые позиции не проходят', () async {
      platform.stream = [
        _position(1, 1, age: const Duration(hours: 1)),
        _position(53.91, 27.57),
        _position(2, 2, accuracy: 1500),
        _position(53.92, 27.58, accuracy: 30),
      ];
      expect(await source.positions(distanceFilterMeters: 50).toList(), [
        (latitude: 53.91, longitude: 27.57),
        (latitude: 53.92, longitude: 27.58),
      ]);
    });

    // (возраст, точность) → годится. Граница — 15 с и 250 м, по обе стороны.
    final now = DateTime(2026, 10, 17, 12, 0, 0);
    final fixes = <(Duration, double, bool)>[
      (Duration.zero, 5, true),
      (const Duration(seconds: 15), 5, true),
      (const Duration(seconds: 16), 5, false),
      (const Duration(seconds: -15), 5, true), // часы спутника впереди
      (const Duration(seconds: -16), 5, false),
      (Duration.zero, 250, true),
      (Duration.zero, 251, false),
    ];
    for (final (age, accuracy, usable) in fixes) {
      test(
          'позиция ${age.inSeconds} с назад, точность $accuracy м — '
          '${usable ? 'годится' : 'нет'}', () {
        final fix = Position(
          latitude: 53.9,
          longitude: 27.56,
          timestamp: now.subtract(age),
          accuracy: accuracy,
          altitude: 0,
          altitudeAccuracy: 0,
          heading: 0,
          headingAccuracy: 0,
          speed: 0,
          speedAccuracy: 0,
        );
        expect(isUsableFix(fix, now), usable);
      });
    }

    test('iOS — шаги пешехода, без фоновой работы', () {
      final settings = walkLocationSettings(50, TargetPlatform.iOS);
      expect(settings, isA<AppleSettings>());
      settings as AppleSettings;
      expect(settings.distanceFilter, 50);
      expect(settings.accuracy, LocationAccuracy.high);
      expect(settings.allowBackgroundLocationUpdates, isFalse);
      expect(settings.activityType, ActivityType.fitness);
    });

    // (служба включена, разрешение) → доступ.
    final table = <(bool, LocationPermission, LocationAccess)>[
      (true, LocationPermission.whileInUse, LocationAccess.granted),
      (true, LocationPermission.always, LocationAccess.granted),
      (true, LocationPermission.denied, LocationAccess.askable),
      (true, LocationPermission.deniedForever, LocationAccess.denied),
      (false, LocationPermission.whileInUse, LocationAccess.off),
    ];
    for (final (enabled, permission, expected) in table) {
      test(
          'служба ${enabled ? 'вкл' : 'выкл'}, ${permission.name} — '
          '${expected.name}, без системного запроса', () async {
        platform
          ..serviceEnabled = enabled
          ..permission = permission;
        expect(await source.access(), expected);
        expect(platform.calls, isNot(contains('request')));
      });
    }

    test('запрос — системный, его ответ и есть доступ', () async {
      platform
        ..permission = LocationPermission.denied
        ..afterRequest = LocationPermission.whileInUse;
      expect(await source.requestAccess(), LocationAccess.granted);
      expect(platform.calls, contains('request'));

      platform.afterRequest = LocationPermission.deniedForever;
      expect(await source.requestAccess(), LocationAccess.denied);
    });

    test(
        'Android: «навсегда» запоминается — проверка, которая отвечает '
        '«denied» и ещё не спрошенному, дальше даёт «запрещено»', () async {
      // Android отвечает на проверку «denied» и до запроса, и после отказа
      // навсегда; «deniedForever» приходит только ответом на запрос.
      platform
        ..permission = LocationPermission.denied
        ..afterRequest = LocationPermission.deniedForever;
      expect(await source.access(), LocationAccess.askable,
          reason: 'ещё не спрашивали');
      expect(await source.requestAccess(), LocationAccess.denied);
      expect(await source.access(), LocationAccess.denied);
    });

    test('разрешение дали в настройках — память отказа стёрта', () async {
      platform
        ..permission = LocationPermission.denied
        ..afterRequest = LocationPermission.deniedForever;
      await source.requestAccess();
      expect(await source.access(), LocationAccess.denied);

      platform.permission = LocationPermission.whileInUse;
      expect(await source.access(), LocationAccess.granted);
      // Позже разрешение снова сброшено до «спросить» — чип снова есть.
      platform.permission = LocationPermission.denied;
      expect(await source.access(), LocationAccess.askable);
    });

    test('отказ один раз (система спросит снова) — не запоминается', () async {
      platform
        ..permission = LocationPermission.denied
        ..afterRequest = LocationPermission.denied;
      expect(await source.requestAccess(), LocationAccess.askable);
      expect(await source.access(), LocationAccess.askable);
    });
  });

  group('PositionTracker', () {
    late FakePositionSource source;
    late List<GeoPoint> got;
    late int failures;
    late PositionTracker tracker;

    setUp(() {
      source = FakePositionSource();
      got = [];
      failures = 0;
      tracker = PositionTracker(
        source: source,
        onPosition: got.add,
        onFailure: () => failures++,
      );
      addTearDown(tracker.dispose);
    });

    Future<void> flush() => Future<void>.delayed(Duration.zero);

    test('старт — свежая позиция и поток с порогом 50 м', () async {
      tracker.start();
      expect(source.freshCalls, 1);
      expect(source.streamFilters, [50]);
      expect(source.listening, isTrue);

      source.completeFresh(_a);
      await flush();
      source.move(_b);
      await flush();
      expect(got, [_a, _b]);
    });

    test('стоп — отписка; поздняя свежая позиция не доходит', () async {
      tracker.start();
      tracker.stop();
      expect(source.listening, isFalse);
      expect(source.cancels, 1);
      expect(tracker.isListening, isFalse);

      source.completeFresh(_a);
      await flush();
      expect(got, isEmpty);
    });

    test('свежей нет, поток молчит — отказ', () async {
      tracker.start();
      source.failFresh();
      await flush();
      expect(failures, 1);
      expect(source.listening, isTrue, reason: 'поток ещё может ответить');

      source.move(_b);
      await flush();
      expect(got, [_b]);
    });

    test('поток успел раньше — поздний отказ свежей ничего не меняет',
        () async {
      tracker.start();
      source.move(_a);
      await flush();
      source.failFresh();
      await flush();
      expect(failures, 0);
      expect(got, [_a]);
    });

    test('поток оборвался — отказ и отписка; «Повторить» — всё заново',
        () async {
      tracker.start();
      source.breakStream();
      await flush();
      expect(failures, 1);
      expect(source.listening, isFalse);
      expect(tracker.isListening, isFalse);

      tracker.retry();
      expect(source.freshCalls, 2);
      expect(source.streamFilters, [50, 50]);
      expect(source.listening, isTrue);
    });

    testWidgets(
        'приложение ушло в фон — геолокация выключена; вернулось — свежая '
        'позиция и поток заново', (tester) async {
      final binding = tester.binding;
      tracker.start();
      expect(source.listening, isTrue);

      binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      expect(source.listening, isTrue,
          reason: 'системный запрос поверх приложения — не уход');
      binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      expect(source.listening, isFalse);
      expect(tracker.isRunning, isTrue);

      binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      expect(source.listening, isTrue);
      expect(source.freshCalls, 2, reason: 'за время в фоне человек ушёл');
      expect(source.streamFilters, [50, 50]);
    });

    testWidgets('остановлен в фоне — при возвращении ничего не заводится',
        (tester) async {
      final binding = tester.binding;
      tracker.start();
      binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tracker.stop();
      binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      expect(source.listening, isFalse);
      expect(source.freshCalls, 1);
    });
  });
}
