import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';
import 'package:restaurant_guide_mobile/providers/partner_registration_provider.dart';

import '../support/wire_stand.dart';

/// Какой телефон пускает дальше шаг «О заведении» мастера карточки.
///
/// До 13.10.2026 шаг пропускал любой номер от 5 символов, а сервер принимал
/// только мобильные коды. Ресторан с городским номером проходил все семь
/// шагов и получал отказ на «Отправить» — с подсказкой формата, которой его
/// номер соответствовал. Решение Координатора 13.10.2026: городские номера
/// принимаются, а неверный номер шаг ловит сам, по тому же правилу, что и
/// сервер (`backend/src/constants/belarusPhone.js`).
///
/// Ожидаемые значения — литералы: номера из решения, подписи — дословно.
/// Шаг «О заведении» — третий, индекс 2.
PartnerRegistrationProvider _onBasicInfoStep(String phone) =>
    PartnerRegistrationProvider(
      initialStep: 2,
      initialData: PartnerRegistration(
        name: 'Кофейня у моста',
        priceRange: r'$$',
        phone: phone,
      ),
    );

const _lengthMessage = 'После +375 должно быть 9 цифр: код и номер.';
const _prefixMessage = 'Номер должен начинаться с +375.';
const _codeMessage = 'Неверный код после +375. Мобильный: 25, 29, 33 или 44; '
    'городской: код города — 17 Минск, 152 Гродно, 232 Гомель… '
    'Номер вида 8 017… вводите как +375 17…';

void main() {
  late StubAdapter stand;

  // Проверка поля в сеть не ходит; стенд стоит, чтобы случайный запрос
  // провайдера не ушёл в чужой транспорт, а был виден в `requests`.
  setUp(() {
    stand = installWireStand((_) => jsonBody({'success': false}, status: 500));
  });

  const accepted = {
    'городской, Минск': '+375171234567',
    'городской, Гродно (код из трёх цифр)': '+375152123456',
    'городской, Гомель': '+375232123456',
    'мобильный': '+375291234567',
    'без номера — поле необязательное': '',
  };
  for (final entry in accepted.entries) {
    test('пускает дальше: ${entry.key}', () {
      final provider = _onBasicInfoStep(entry.value);

      expect(provider.phoneError, isNull);
      expect(provider.canProceed(), isTrue);
      expect(stand.requests, isEmpty);
    });
  }

  test('номер с пробелами читается так же, как его отправит приложение', () {
    // toJson() убирает пробелы перед отправкой; проверка обязана смотреть
    // на тот же номер, иначе пропустит или задержит не то, что уйдёт.
    final provider = _onBasicInfoStep('+375 17 123 45 67');

    expect(provider.phoneError, isNull);
    expect(provider.canProceed(), isTrue);
  });

  test('не пускает неполный номер и говорит, сколько цифр нужно', () {
    final provider = _onBasicInfoStep('+3751712345');

    expect(provider.phoneError, _lengthMessage);
    expect(provider.canProceed(), isFalse);
    expect(provider.nextStep(), isFalse);
    expect(provider.currentStep, 2);
  });

  test('не пускает номер, набранный через 8, и говорит, как его ввести', () {
    // «8 029 123 45 67»: поле дописывает 375 к вводу, который не начинается
    // с 3, и получается несуществующий +375 80 291 23 45.
    final provider = _onBasicInfoStep('+375802912345');

    expect(provider.phoneError, _codeMessage);
    expect(provider.canProceed(), isFalse);
    expect(provider.nextStep(), isFalse);
    expect(provider.currentStep, 2);
    expect(stand.requests, isEmpty);
  });

  // Поле дописывает 375 только к вводу, который не начинается с 3:
  // «33 123 45 67» остаётся «+331 23 456 7», чужой код страны — как есть.
  // Подпись о цифрах «после +375» такому номеру не подходит.
  const notBelarus = {
    'мобильный без кода страны («33 123 45 67»)': '+331234567',
    'код другой страны, 12 цифр': '+380291234567',
  };
  for (final entry in notBelarus.entries) {
    test('не пускает номер не с +375 и говорит об этом: ${entry.key}', () {
      final provider = _onBasicInfoStep(entry.value);

      expect(provider.phoneError, _prefixMessage);
      expect(provider.canProceed(), isFalse);
    });
  }

  test('пока набирается код страны («+37»), подпись говорит о цифрах', () {
    final provider = _onBasicInfoStep('+37');

    expect(provider.phoneError, _lengthMessage);
  });
}
