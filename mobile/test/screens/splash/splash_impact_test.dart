import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'splash_stand.dart';

/// Тактильный удар заставки — первое применение хаптики в `mobile/lib`.
///
/// Ровно один `HapticFeedback.mediumImpact()` за жизнь экрана, в точке
/// посадки знака: 1130 мс от старта интро, на Android — на 30 мс раньше
/// (мотор отстаёт от кадра). Ни в петле, ни в outro, ни при повторной сборке
/// виджета удара нет; при Reduce Motion удара нет вовсе.
///
/// Хаптика уходит по каналу `flutter/platform` методом `HapticFeedback.vibrate`
/// — перехватываем его и считаем вызовы. Платформа задаётся через `variant`:
/// `debugDefaultTargetPlatformOverride`, выставленный руками, проверяется
/// инвариантами теста РАНЬШЕ, чем сработает `addTearDown`.
void main() {
  setUp(resetSplashStand);

  const android = TargetPlatformVariant(<TargetPlatform>{TargetPlatform.android});
  const ios = TargetPlatformVariant(<TargetPlatform>{TargetPlatform.iOS});

  late List<MethodCall> hapticCalls;

  /// Перехват канала платформы: всё, что заставка шлёт системе.
  void interceptHaptics(WidgetTester tester) {
    hapticCalls = <MethodCall>[];
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (MethodCall call) async {
        if (call.method == 'HapticFeedback.vibrate') hapticCalls.add(call);
        return null;
      },
    );
    addTearDown(() {
      tester.binding.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, null);
    });
  }

  const oneMs = Duration(milliseconds: 1);

  testWidgets('Android: один mediumImpact на 1100 мс, дальше тишина',
      (tester) async {
    interceptHaptics(tester);
    final stand = await pumpSplash(tester); // сессия грузится → будет петля
    await tester.pump();

    await tester.pump(const Duration(milliseconds: 1099));
    expect(hapticCalls, isEmpty, reason: 'до посадки удара нет');

    await tester.pump(oneMs); // 1100
    expect(hapticCalls, hasLength(1));
    expect(hapticCalls.single.arguments, 'HapticFeedbackType.mediumImpact');

    // Остаток интро и четыре секунды петли — второго удара нет.
    for (var i = 0; i < 23; i++) {
      await tester.pump(const Duration(milliseconds: 250));
    }
    expect(hapticCalls, hasLength(1), reason: 'в петле ожидания удара нет');

    // Outro и переход — тоже без удара (outro завершается строго после
    // 460 мс, маршрут строится кадром позже — см. splash_gate_contract_test).
    stand.release();
    await tester.pump(oneMs);
    await tester.pump(const Duration(milliseconds: 461));
    await tester.pump(oneMs);
    expect(find.byKey(guestStubKey), findsOneWidget);
    expect(hapticCalls, hasLength(1), reason: 'в outro удара нет');
  }, variant: android);

  testWidgets('iOS: удар на 1130 мс — в самой точке посадки', (tester) async {
    interceptHaptics(tester);
    await pumpSplash(tester);
    await tester.pump();

    await tester.pump(const Duration(milliseconds: 1129));
    expect(hapticCalls, isEmpty);

    await tester.pump(oneMs); // 1130
    expect(hapticCalls, hasLength(1));
    expect(hapticCalls.single.arguments, 'HapticFeedbackType.mediumImpact');
  }, variant: ios);

  testWidgets(
      'смена зависимостей после посадки: интро не перезапускается, удар один',
      (tester) async {
    interceptHaptics(tester);
    final stand = await pumpSplash(tester);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 1100));
    expect(hapticCalls, hasLength(1));

    // Единственная зависимость экрана от MediaQuery — аспект
    // disableAnimations; его смена — настоящий didChangeDependencies
    // (смена размера окна его НЕ вызывает). Переключение посреди интро не
    // честится: хореография идёт по прежнему расписанию, волны петли —
    // как в обычном режиме, удар не повторяется.
    stand.reduceMotion.value = true;
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 1701)); // 2801: конец интро
    await tester.pump(const Duration(milliseconds: 300));
    expect(hapticCalls, hasLength(1),
        reason: 'интро не перезапускается, удар не повторяется');
    expect(cockadeOf(tester).loopPhase, isNotNull,
        reason: 'хореография осталась обычной: в петле идут волны');
  }, variant: android);

  testWidgets('Reduce Motion: хаптики нет', (tester) async {
    interceptHaptics(tester);
    await pumpSplash(tester, held: false, reduceMotion: true);
    await tester.pump();

    for (var i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 250)); // интро + outro
    }
    expect(find.byKey(guestStubKey), findsOneWidget,
        reason: 'гейт с Reduce Motion ведёт себя как обычно');
    expect(hapticCalls, isEmpty);
  }, variant: android);
}
