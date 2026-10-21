import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/config/establishment_vocabulary.dart';

// Словарь карточки заведения против канона сервера (проход по панели
// модератора, 20.10, пункты A1-10, F-23, К-4, Ч12, A1-19).
//
// Сторож читает сам файл канона бэкенда, а не копию списка в тесте: копия
// ловит правку карты без правки теста, но не новое удобство на сервере.
// CI вынимает репозиторий целиком, и `../backend` рядом есть всегда.

const String _canonPath = '../backend/src/constants/establishmentVocab.js';
const String _validatorPath =
    '../backend/src/validators/establishmentValidation.js';

/// Строковые элементы массива `const NAME = …[ … ]` из исходника JS.
List<String> _jsArray(String source, String name) {
  final start = source.indexOf('const $name');
  expect(start, isNonNegative, reason: 'в каноне нет $name');
  final open = source.indexOf('[', start);
  final close = source.indexOf(']', open);
  final items = RegExp(r"'([^']*)'")
      .allMatches(source.substring(open, close))
      .map((m) => m.group(1)!)
      .toList();
  // Якорь: пустой разбор выглядел бы как «расхождений нет».
  expect(items, isNotEmpty, reason: '$name разобрался пустым');
  return items;
}

void main() {
  final canon = File(_canonPath).readAsStringSync();

  test('у каждого удобства канона есть русская подпись, лишних нет', () {
    final keys = _jsArray(canon, 'ATTRIBUTE_CANON');
    expect(kAttributeLabels.keys.toSet(), keys.toSet());
    for (final label in kAttributeLabels.values) {
      expect(label, matches(RegExp('^[А-ЯЁ]|^Wi-Fi')), reason: label);
    }
  });

  test('незнакомый ключ удобства — без подписи, экран покажет его как есть', () {
    expect(attributeLabel('hookah_lounge'), isNull);
    expect(attributeLabel('live_music'), 'Живая музыка');
  });

  test('категории без кухни — те же, что на сервере', () {
    expect(
      kCuisineOptionalCategories.toSet(),
      _jsArray(canon, 'CUISINE_OPTIONAL_CATEGORIES').toSet(),
    );
  });

  test('кухня нужна, если хоть одна категория её требует', () {
    expect(isCuisineRequired(const <String>['Бар']), isFalse);
    expect(isCuisineRequired(const <String>['Бар', 'Караоке']), isFalse);
    expect(isCuisineRequired(const <String>['Бар', 'Ресторан']), isTrue);
    expect(isCuisineRequired(const <String>[]), isTrue);
  });

  test('средний чек: каждое значение сервера — суммой, значок рядом', () {
    final values =
        _jsArray(File(_validatorPath).readAsStringSync(), 'VALID_PRICE_RANGES');
    expect(kPriceRangeLabels.keys.toSet(), values.toSet());
    expect(priceRangeLabel(r'$$'), r'до 50 руб · $$');
    expect(priceRangeLabel(' '), isNull);
    expect(priceRangeLabel(null), isNull);
    expect(priceRangeLabel('дорого'), 'дорого');
  });
}
