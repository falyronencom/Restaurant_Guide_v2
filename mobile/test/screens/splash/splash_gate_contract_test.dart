import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/screens/splash/splash_screen.dart';

import 'splash_stand.dart';

/// Контракт гейта заставки (побайтно прежний при смене визуала на кокарду).
///
/// Интро — минимальное время на экране (2800 мс). Если к его концу сессия
/// прочитана — сразу outro (460 мс) и переход; если нет — петля ожидания до
/// готовности или таймаута 10 с, затем outro и переход. Маршрут выбирается по
/// `isAuthenticated`. Переход один.
///
/// Хронометраж проверяется `pump`-ами по фазам, не секундомером. Три факта о
/// кадрах, от которых зависят шаги ниже (измерены с шагом 1 мс):
/// 1. `AnimationController` завершается на первом тике СТРОГО ПОСЛЕ своей
///    длительности: на 2800 мс интро ещё на последнем кадре, на 2801 —
///    завершено; на устройстве это следующий кадр, +16 мс;
/// 2. outro, запущенный из завершения интро, отсчитывает время от того же
///    кадра (2801), завершается на 3262 и там же просит переход;
/// 3. маршрут, вставленный навигатором, появляется в дереве на СЛЕДУЮЩЕМ
///    кадре после запроса (3263);
/// 4. `pump()` без длительности гоняет микрозадачи ДО кадра только когда
///    кадр уже запланирован (что-то анимируется); в неподвижной петле
///    Reduce Motion это не так — поэтому после `release()` всегда `pump(1 мс)`.
void main() {
  setUp(resetSplashStand);

  const intro = Duration(milliseconds: 2800);
  const outro = Duration(milliseconds: 460);
  const oneMs = Duration(milliseconds: 1);

  testWidgets('сессия готова до конца интро → outro сразу после 2800 мс',
      (tester) async {
    await pumpSplash(tester, held: false);
    await tester.pump(); // первый кадр: post-frame вешает слушатель сессии

    await tester.pump(intro); // 2800: последний кадр интро
    expect(find.byKey(guestStubKey), findsNothing,
        reason: 'интро — минимальное время на экране, уходить раньше нельзя');

    await tester.pump(oneMs); // 2801: интро завершено, outro стартует
    await tester.pump(outro); // 3261: последний кадр outro
    expect(find.byKey(guestStubKey), findsNothing,
        reason: 'outro длится 460 мс');

    await tester.pump(oneMs); // 3262: outro завершён, переход запрошен
    await tester.pump(oneMs); // 3263: маршрут построен
    expect(find.byKey(guestStubKey), findsOneWidget);
    expect(find.byKey(homeStubKey), findsNothing);
  });

  testWidgets('сессия не готова к концу интро → петля; готовность → outro',
      (tester) async {
    final stand = await pumpSplash(tester);
    await tester.pump();

    await tester.pump(intro + oneMs);
    await tester.pump(const Duration(seconds: 3));
    expect(find.byKey(guestStubKey), findsNothing,
        reason: 'сессия ещё грузится — заставка обязана ждать');
    expect(find.byType(SplashScreen), findsOneWidget);
    expect(cockadeOf(tester).loopPhase, isNotNull,
        reason: 'в петле ожидания знак окружён волнами');
    expect(cockadeOf(tester).landed, isTrue);

    stand.release();
    await tester.pump(oneMs); // провайдер выходит из загрузки → outro стартует
    await tester.pump(outro); // последний кадр outro
    expect(find.byKey(guestStubKey), findsNothing);

    await tester.pump(oneMs); // outro завершён, переход запрошен
    await tester.pump(oneMs); // маршрут построен
    expect(find.byKey(guestStubKey), findsOneWidget);
  });

  testWidgets('таймаут 10 с без готовности → outro и переход', (tester) async {
    await pumpSplash(tester); // хранилище не ответит никогда
    await tester.pump();

    await tester.pump(const Duration(milliseconds: 9999));
    expect(find.byKey(guestStubKey), findsNothing);

    await tester.pump(oneMs); // 10 000: таймер → outro стартует
    await tester.pump(outro); // последний кадр outro
    expect(find.byKey(guestStubKey), findsNothing);

    await tester.pump(oneMs);
    await tester.pump(oneMs);
    expect(find.byKey(guestStubKey), findsOneWidget);
  });

  testWidgets('готовая живая сессия ведёт на /home', (tester) async {
    await pumpSplash(tester, held: false, authenticated: true);
    await tester.pump();
    await tester.pump(intro + oneMs);
    await tester.pump(outro + oneMs);
    await tester.pump(oneMs);

    expect(find.byKey(homeStubKey), findsOneWidget);
    expect(find.byKey(guestStubKey), findsNothing);
  });

  testWidgets('переход один: после ухода таймаут и петля молчат',
      (tester) async {
    final stand = await pumpSplash(tester, held: false);
    await tester.pump();
    await tester.pump(intro + oneMs);
    await tester.pump(outro + oneMs);
    await tester.pump(oneMs);
    expect(find.byKey(guestStubKey), findsOneWidget);

    await tester.pump(const Duration(seconds: 11)); // таймаут уже отменён
    expect(tester.takeException(), isNull);
    expect(find.byKey(guestStubKey), findsOneWidget);
    expect(find.byType(SplashScreen), findsNothing);
    // Считаем переходы, а не стубы: второй pushAndRemoveUntil оставил бы
    // ровно один стуб и тоже прошёл бы проверку выше.
    expect(stand.navigation.pushes, ['/', '/auth/method-selection']);
  });

  group('Reduce Motion', () {
    const reducedIntro = Duration(milliseconds: 1000);

    testWidgets('минимум на экране 1000 мс, затем тот же outro', (tester) async {
      await pumpSplash(tester, held: false, reduceMotion: true);
      await tester.pump();

      await tester.pump(reducedIntro); // последний кадр интро
      expect(find.byKey(guestStubKey), findsNothing);

      await tester.pump(oneMs); // интро завершено, outro стартует
      await tester.pump(outro); // последний кадр outro
      expect(find.byKey(guestStubKey), findsNothing);

      await tester.pump(oneMs);
      await tester.pump(oneMs);
      expect(find.byKey(guestStubKey), findsOneWidget);
    });

    testWidgets('гейт ждёт сессию так же: петля до готовности', (tester) async {
      final stand = await pumpSplash(tester, reduceMotion: true);
      await tester.pump();
      await tester.pump(reducedIntro + oneMs);
      await tester.pump(const Duration(seconds: 2));
      expect(find.byKey(guestStubKey), findsNothing);
      expect(cockadeOf(tester).landed, isTrue,
          reason: 'без полёта знак стоит собранным');
      expect(cockadeOf(tester).loopPhase, isNull,
          reason: 'Reduce Motion: петля держит знак неподвижно');

      stand.release();
      await tester.pump(oneMs); // outro стартует (кадр не был запланирован)
      await tester.pump(outro + oneMs);
      await tester.pump(oneMs);
      expect(find.byKey(guestStubKey), findsOneWidget);
    });
  });
}
