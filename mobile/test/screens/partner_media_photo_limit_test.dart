import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';
import 'package:restaurant_guide_mobile/providers/partner_registration_provider.dart';
import 'package:restaurant_guide_mobile/screens/partner/steps/media_step.dart';

import '../support/wire_stand.dart';

/// Предел фото заведения в мастере карточки: экран и провайдер — одно число.
///
/// Дефект (13.10.2026): экран шага «Медиа» пускал до 30 фото, а провайдер
/// принимал только 20 и 21-е молча выбрасывал. Партнёр видел «Фото успешно
/// загружено», файл уходил в облако, а в карточке фото не появлялось; кнопка
/// «+ Добавить фото» при этом оставалась активной — счётчик застревал на 20.
///
/// Ожидаемое число — литерал, а не константа из `lib/`: оно взято у сервера
/// (`MEDIA_LIMITS.interior` в backend/src/services/mediaService.js) и из
/// подсказки на экране. Тест, читающий предел из провайдера, согласился бы
/// с провайдером и при старых 20.
const _serverLimit = 30;

String _url(int i) =>
    'https://res.cloudinary.com/demo/image/upload/partner/interior_$i.jpg';

List<String> _photos(int count) => [for (var i = 1; i <= count; i++) _url(i)];

PartnerRegistrationProvider _providerWith(int count) =>
    PartnerRegistrationProvider(
      initialData: PartnerRegistration(
        interiorPhotos: _photos(count),
        primaryPhotoUrl: count > 0 ? _url(1) : null,
      ),
    );

void main() {
  // Провайдер держит сервис заведений, а тот — общий `ApiClient`. Добавление
  // фото в сеть не ходит; стенд стоит, чтобы случайный запрос не ушёл в
  // настоящий транспорт и не уронил чужой тест после конца этого.
  setUp(() {
    installWireStand((options) => jsonBody({}, status: 500));
  });

  group('провайдер мастера карточки', () {
    test('принимает фото с 1-го по 30-е — столько пускают сервер и экран', () {
      final provider = PartnerRegistrationProvider();

      for (final url in _photos(_serverLimit)) {
        provider.addInteriorPhoto(url);
      }

      expect(provider.data.interiorPhotos, _photos(_serverLimit));
    });

    test('31-е фото не принимает', () {
      final provider = _providerWith(_serverLimit);

      provider.addInteriorPhoto(_url(31));

      expect(provider.data.interiorPhotos, _photos(_serverLimit));
    });
  });

  group('шаг «Медиа»', () {
    Future<void> pumpMediaStep(
      WidgetTester tester,
      PartnerRegistrationProvider provider,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ChangeNotifierProvider<PartnerRegistrationProvider>.value(
              value: provider,
              child: const MediaStep(),
            ),
          ),
        ),
      );
    }

    /// Активна ли кнопка: неактивной экран передаёт `onTap: null`.
    bool addPhotoEnabled(WidgetTester tester) {
      final button = find
          .ancestor(
            of: find.text('+ Добавить фото'),
            matching: find.byType(GestureDetector),
          )
          .first;
      return tester.widget<GestureDetector>(button).onTap != null;
    }

    /// Плитка фото в сетке карточки — то, что видит партнёр.
    Finder tileOf(String url) => find.byWidgetPredicate(
          (w) =>
              w is Image && w.image is NetworkImage &&
              (w.image as NetworkImage).url == url,
        );

    testWidgets('подсказка называет предел сервера: до 30 фото',
        (tester) async {
      await pumpMediaStep(tester, _providerWith(0));

      expect(
        find.text('До 30 фото формата PNG/JPG, до 150 мб'),
        findsOneWidget,
      );
    });

    // Что делает `_pickPhoto` после ответа сервера на загрузку: зовёт
    // `addInteriorPhoto` и показывает «Фото успешно загружено». Выбор файла
    // и сама загрузка здесь не нужны — дефект жил между кнопкой и провайдером.
    for (final (seeded, enabledAfter) in [(20, true), (29, false)]) {
      final added = seeded + 1;
      testWidgets(
          'при $seeded фото кнопка активна, и $added-е фото после загрузки '
          'появляется в карточке', (tester) async {
        final provider = _providerWith(seeded);
        await pumpMediaStep(tester, provider);

        expect(addPhotoEnabled(tester), isTrue);

        provider.addInteriorPhoto(_url(added));
        await tester.pump();

        expect(provider.data.interiorPhotos, _photos(added));
        expect(tileOf(_url(added)), findsOneWidget);
        expect(addPhotoEnabled(tester), enabledAfter);
      });
    }
  });
}
