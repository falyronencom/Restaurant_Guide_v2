import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/utils/validators.dart';

/// Проверки полей форм: язык текстов и правило имени.
///
/// **Язык.** До 17.10.2026 все тексты проверок были английскими («Name must
/// be at least 2 characters», «Please enter a valid email address»), а
/// подсказки рядом — русскими: на одном экране два языка (проход
/// тестировщика 17.10, пп. 20, 38). Сторож прогоняет каждую проверку по
/// набору плохих значений — новая проверка с английским текстом упадёт здесь
/// в тот же день.
///
/// **Имя.** Правило то же, что на сервере (решение Координатора 17.10,
/// В4): буквы любого алфавита, пробел, дефис и апостроф между буквами,
/// 2–50. Раньше правка профиля пропускала запятые и цифры, регистрация —
/// любые знаки, и отказ сервера до человека не доходил (пп. 32, 49).
void main() {
  /// Латинские слова в сообщении. «A–Z» и «a–z» — одиночные буквы, не слова.
  List<String> latinWords(String message) => RegExp(r'[A-Za-z]{2,}')
      .allMatches(message)
      .map((m) => m.group(0)!)
      .toList();

  group('Тексты проверок — по-русски', () {
    final cases = <String, String? Function(String?)>{
      'почта': validateEmail,
      'телефон': validateBelarusPhone,
      'пароль': validatePassword,
      'повтор пароля': (v) => validatePasswordMatch(v, 'Secret123'),
      'имя': validateName,
      'код': validateVerificationCode,
    };
    // У каждой проверки — каждая ветка отказа: имя длиннее 50 знаков ведёт в
    // свою, и без него её текст не проверял никто.
    final badInputs = <String?>[
      'А' * 51,
      null,
      '',
      ' ',
      'a',
      'abc',
      'abc@',
      '+375',
      '+375111234567',
      '+3752912345',
      'abcdefgh',
      'ABCDEFGH',
      'Abcdefgh',
      'abc12345',
      'Анна, К.',
      'Анна1',
      '-Анна',
      '12345',
      '12345a',
      'А',
    ];

    for (final entry in cases.entries) {
      test(entry.key, () {
        final messages = <String>{};
        for (final input in badInputs) {
          final message = entry.value(input);
          if (message != null) messages.add(message);
        }

        // Якорь: сторож без находок выглядит как «всё чисто», даже если
        // набор значений перестал задевать проверку.
        expect(messages.length, greaterThanOrEqualTo(2),
            reason: 'набор значений не задевает проверку «${entry.key}»');
        for (final message in messages) {
          expect(latinWords(message), isEmpty, reason: 'в тексте: $message');
        }
      });
    }
  });

  group('Правило имени — как на сервере', () {
    test('принимает буквы любого алфавита, пробел, дефис, апостроф', () {
      const accepted = [
        'Анна',
        'Ёжик',
        'Іван',
        'Алеся Ўладзіслаўна',
        'Анна-Мария',
        "O'Brien",
        'Jean Luc',
        'Ли',
        'Zoë',
        // «Любого алфавита» — не только кириллица и латиница.
        'Νίκος',
        'Գոհար',
        'ნინო',
        'علي',
        '李明',
      ];
      for (final name in accepted) {
        expect(validateName(name), isNull, reason: name);
      }
    });

    test('отказывает в запятой, точке, цифре — текстом правила', () {
      for (final name in ['Анна, К.', 'Анна.', 'Анна1', 'Анна!', 'Ann_a']) {
        expect(validateName(name), nameCharactersMessage, reason: name);
      }
    });

    test('пробел, дефис и апостроф — только между буквами', () {
      for (final name in ['-Анна', 'Анна-', "'Анна", 'Анна--Мария', "Анна-'Мария"]) {
        expect(validateName(name),
            'Пробел, дефис и апостроф — только между буквами',
            reason: name);
      }
    });

    test('длина 2–50: граница с обеих сторон', () {
      expect(validateName('А'), isNotNull);
      expect(validateName('Ан'), isNull);
      expect(validateName('А' * 50), isNull);
      expect(validateName('А' * 51), isNotNull);
      expect(validateName('А' * 501), isNotNull,
          reason: 'п. 32: имя из 500+ знаков');
    });

    test('пустое и из пробелов — «Введите имя»', () {
      expect(validateName(null), 'Введите имя');
      expect(validateName(''), 'Введите имя');
      expect(validateName('   '), 'Введите имя');
    });

    test('апостроф iPhone и белорусской раскладки становится прямым', () {
      // «Умная пунктуация» iPhone печатает ’ вместо ' — без замены сервер
      // отказал бы за знак, которого человек не видит.
      expect(normalizeName('O’Brien'), "O'Brien");
      expect(normalizeName('Марʼяна'), "Мар'яна");
      expect(validateName('O’Brien'), isNull);
      expect(normalizeName('  Анна   Мария '), 'Анна Мария');
      expect(validateName('  Анна   Мария '), isNull);
    });
  });

  group('Требования к паролю', () {
    test('совпадают с проверкой поля: прошёл все — проверка молчит', () {
      for (final password in ['Secret12', 'abcdefgh', 'ABCDEFG1', 'Ab1']) {
        final allMet =
            passwordRequirements.every((r) => r.isMetBy(password));
        expect(validatePassword(password) == null, allMet, reason: password);
      }
    });

    test('кириллица не засчитывается за заглавную и строчную — как на сервере',
        () {
      expect(validatePassword('Пароль123'), isNotNull);
      expect(validatePassword('Parol123'), isNull);
      // По одной стороне за раз: в «Пароль123» нет ни латинской заглавной, ни
      // строчной, и он не скажет, какая из двух проверок засчитала кириллицу.
      expect(validatePassword('Пarol123'),
          'Пароль не подходит: нужно — заглавная латинская буква (A–Z)',
          reason: 'кириллическая «П» — не заглавная латинская');
      expect(validatePassword('PAROLь12'),
          'Пароль не подходит: нужно — строчная латинская буква (a–z)',
          reason: 'кириллическая «ь» — не строчная латинская');
    });
  });
}
