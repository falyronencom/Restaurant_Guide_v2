import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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

/// Плашка на пределе — формулировка Координатора (15.10.2026).
const _limitMessage =
    'Можно добавить не больше 30 фото. Удалите одно, чтобы добавить новое.';

/// Серый цвет надписи неактивной кнопки на шаге «Медиа».
const _inactiveGrey = Color(0xFF9D9D9D);

/// Канал галереи телефона (`image_picker`).
const _pickerChannel = MethodChannel('plugins.flutter.io/image_picker');

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
    // Галерея отвечает `null` — партнёр закрыл её, ничего не выбрав. Так
    // `_pickPhoto` заканчивается до загрузки, а тест видит сам факт открытия.
    late List<MethodCall> pickerCalls;
    setUp(() {
      pickerCalls = [];
      final messenger =
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
      messenger.setMockMethodCallHandler(_pickerChannel, (call) async {
        pickerCalls.add(call);
        return null;
      });
      addTearDown(() => messenger.setMockMethodCallHandler(_pickerChannel, null));
    });

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

    Future<void> tapAddPhoto(WidgetTester tester) async {
      final button = find.text('+ Добавить фото');
      await tester.ensureVisible(button);
      await tester.tap(button);
      await tester.pump();
      // Плашка выезжает анимацией.
      await tester.pump(const Duration(milliseconds: 750));
    }

    /// Цвет надписи кнопки: на пределе кнопка серая.
    Color? addPhotoColor(WidgetTester tester) =>
        tester.widget<Text>(find.text('+ Добавить фото')).style?.color;

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

    // После ответа сервера на загрузку `_pickPhoto` зовёт `addInteriorPhoto`
    // и показывает «Фото успешно загружено». Саму загрузку тест заменяет этим
    // вызовом — дефект жил между кнопкой и провайдером.
    testWidgets(
        'при 20 фото кнопка открывает галерею, и 21-е фото после загрузки '
        'появляется в карточке', (tester) async {
      final provider = _providerWith(20);
      await pumpMediaStep(tester, provider);

      await tapAddPhoto(tester);
      expect(pickerCalls.map((c) => c.method), ['pickImage']);
      expect(addPhotoColor(tester), isNot(_inactiveGrey));

      provider.addInteriorPhoto(_url(21));
      await tester.pump();

      expect(provider.data.interiorPhotos, _photos(21));
      expect(tileOf(_url(21)), findsOneWidget);
      expect(find.text(_limitMessage), findsNothing);
    });

    testWidgets(
        'при 29 фото кнопка открывает галерею; 30-е фото появляется в '
        'карточке, после него кнопка серая и галерею не открывает',
        (tester) async {
      final provider = _providerWith(29);
      await pumpMediaStep(tester, provider);

      await tapAddPhoto(tester);
      expect(pickerCalls, hasLength(1));

      provider.addInteriorPhoto(_url(30));
      await tester.pump();

      expect(provider.data.interiorPhotos, _photos(30));
      expect(tileOf(_url(30)), findsOneWidget);
      expect(addPhotoColor(tester), _inactiveGrey);

      await tapAddPhoto(tester);
      expect(pickerCalls, hasLength(1));
      expect(find.text(_limitMessage), findsOneWidget);
    });

    // Так открывается карточка, где уже 30 фото — например, набранных на
    // сайте: партнёр жмёт на серую кнопку и должен понять, почему она серая.
    testWidgets(
        'при 30 фото нажатие на серую кнопку показывает плашку о пределе '
        'и галерею не открывает', (tester) async {
      await pumpMediaStep(tester, _providerWith(30));

      expect(addPhotoColor(tester), _inactiveGrey);
      expect(find.text(_limitMessage), findsNothing);

      await tapAddPhoto(tester);

      expect(find.text(_limitMessage), findsOneWidget);
      expect(pickerCalls, isEmpty);
    });
  });
}
