import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/config/establishment_attributes.dart';
import 'package:restaurant_guide_mobile/models/filter_options.dart';

/// Опечатка «Терасса» в подписи удобства (сверка находок тестировщика с
/// сайтом, 18.10, Ш9). Подпись — «Терраса» в карточке и в фильтре; файл
/// значка назван «Терасса.svg», и ключ `svg` — его имя: оно остаётся.
void main() {
  test('карточка: подпись «Терраса», значок — прежний файл', () {
    final terrace = EstablishmentAttributes.active({'terrace': true}).single;
    expect(terrace['name'], 'Терраса');
    expect(terrace['svg'], 'Терасса');
  });

  test('фильтр: подпись «Терраса»', () {
    expect(FilterConstants.amenities['terrace'], 'Терраса');
  });
}
