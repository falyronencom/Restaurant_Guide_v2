import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/models/partner_establishment.dart';

/// Строка кухонь на карточке кабинета партнёра и в его статистике.
///
/// Кухни выводились в фигурных скобках: «{итальянская, европейская}» — как
/// «{Авторская}» в списке гостя (находка 18.10.2026 на телефоне Координатора).
/// Карточка кабинета печатает эту строку как есть, поэтому проверяется сама
/// строка: несколько кухонь — через запятую, без скобок.
PartnerEstablishment _card(List<String> cuisineTypes) => PartnerEstablishment(
      id: 'p-1',
      name: 'Zalkind Kitchen',
      status: EstablishmentStatus.approved,
      categories: const ['restaurant'],
      cuisineTypes: cuisineTypes,
      createdAt: DateTime(2026, 1, 1),
      updatedAt: DateTime(2026, 1, 1),
    );

void main() {
  test('одна кухня — без скобок', () {
    expect(_card(const ['author']).cuisineDisplayName, 'авторская');
  });

  test('несколько кухонь — через запятую, без скобок', () {
    expect(_card(const ['vegetarian', 'italian']).cuisineDisplayName,
        'вегетарианская, итальянская');
  });

  test('кухонь нет — пустая строка', () {
    expect(_card(const []).cuisineDisplayName, '');
  });
}
