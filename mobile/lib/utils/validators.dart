/// Проверки полей форм: почта, телефон, пароль, имя, код.
///
/// Все тексты — по-русски: их читает человек под полем формы. До 17.10.2026
/// здесь были английские фразы («Name must be at least 2 characters»), и на
/// одном экране соседствовали два языка (проход тестировщика 17.10, пп. 20,
/// 38). Сторож — `test/utils/validators_language_test.dart`.
library;

/// Email validation
/// Returns null if valid, error message if invalid
String? validateEmail(String? value) {
  if (value == null || value.isEmpty) {
    return 'Введите почту';
  }

  // RFC 5322 compliant regex (simplified)
  final emailRegex = RegExp(
    r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$',
  );

  if (!emailRegex.hasMatch(value)) {
    return 'Проверьте адрес почты: в нём нужны «@» и домен';
  }

  return null;
}

/// Belarus phone validation
/// Accepts formats: +375291234567 or +375 29 123 45 67
/// Returns null if valid, error message if invalid
String? validateBelarusPhone(String? value) {
  if (value == null || value.isEmpty) {
    return 'Введите номер телефона';
  }

  // Remove all non-digit characters for validation
  final digitsOnly = value.replaceAll(RegExp(r'\D'), '');

  // Belarus: +375 XX XXX XX XX (12 digits total with country code)
  if (!digitsOnly.startsWith('375') || digitsOnly.length != 12) {
    return 'Введите номер полностью: +375 и ещё 9 цифр';
  }

  // Check operator prefix (25, 29, 33, 44)
  final operatorPrefix = digitsOnly.substring(3, 5);
  if (!['25', '29', '33', '44'].contains(operatorPrefix)) {
    return 'Код оператора — 25, 29, 33 или 44';
  }

  return null;
}

/// Format Belarus phone number for display
/// Converts 375291234567 to +375 29 123 45 67
String formatBelarusPhone(String phone) {
  final digitsOnly = phone.replaceAll(RegExp(r'\D'), '');

  if (digitsOnly.length != 12 || !digitsOnly.startsWith('375')) {
    return phone; // Return as-is if invalid format
  }

  return '+${digitsOnly.substring(0, 3)} ${digitsOnly.substring(3, 5)} ${digitsOnly.substring(5, 8)} ${digitsOnly.substring(8, 10)} ${digitsOnly.substring(10, 12)}';
}

/// Format Belarus phone for storage (remove formatting)
/// Converts +375 29 123 45 67 to +375291234567
String unformatBelarusPhone(String phone) {
  final digitsOnly = phone.replaceAll(RegExp(r'\D'), '');
  return '+$digitsOnly';
}

/// Требование к паролю: что показать человеку и как проверить.
class PasswordRequirement {
  const PasswordRequirement(this.label, this._test);

  /// Строка списка под полем пароля.
  final String label;
  final bool Function(String password) _test;

  bool isMetBy(String password) => _test(password);
}

/// Требования к паролю — те же, что на сервере (`authValidation.js`,
/// `validateRegister`): от 8 символов, заглавная и строчная ЛАТИНСКИЕ буквы,
/// цифра. Сервер проверяет `[A-Z]` и `[a-z]`, поэтому «Пароль123» он не
/// примет — список говорит «латинская» прямо, иначе человек с русской
/// раскладкой не поймёт отказ. Один список питает и проверку поля
/// ([validatePassword]), и перечень под полем (`PasswordStrengthIndicator`),
/// чтобы они не разошлись.
final List<PasswordRequirement> passwordRequirements = [
  PasswordRequirement('Не меньше 8 символов', (p) => p.length >= 8),
  PasswordRequirement(
      'Заглавная латинская буква (A–Z)', (p) => RegExp(r'[A-Z]').hasMatch(p)),
  PasswordRequirement(
      'Строчная латинская буква (a–z)', (p) => RegExp(r'[a-z]').hasMatch(p)),
  PasswordRequirement('Цифра', (p) => RegExp(r'[0-9]').hasMatch(p)),
];

/// Password validation with complexity rules
/// Returns null if valid, error message if invalid
String? validatePassword(String? value) {
  if (value == null || value.isEmpty) {
    return 'Введите пароль';
  }

  for (final requirement in passwordRequirements) {
    if (!requirement.isMetBy(value)) {
      return 'Пароль не подходит: нужно — ${_lowerFirst(requirement.label)}';
    }
  }

  return null;
}

String _lowerFirst(String text) =>
    text.isEmpty ? text : text[0].toLowerCase() + text.substring(1);

/// Password match validation
/// Returns null if passwords match, error message if not
String? validatePasswordMatch(String? value, String? password) {
  if (value == null || value.isEmpty) {
    return 'Повторите пароль';
  }

  if (value != password) {
    return 'Пароли не совпадают';
  }

  return null;
}

/// Наименьшая и наибольшая длина имени — как на сервере.
const int nameMinLength = 2;
const int nameMaxLength = 50;

/// Отказ имени с недопустимыми знаками — та же фраза, что у сервера.
const String nameCharactersMessage =
    'Имя может содержать только буквы, пробел, дефис и апостроф';

/// Апострофы, которые ставит клавиатура вместо прямого `'`: iPhone с
/// «умной пунктуацией» (включена по умолчанию) печатает `’` (U+2019),
/// белорусская и украинская раскладки — `ʼ` (U+02BC).
final RegExp _typographicApostrophes = RegExp('[’ʼ]');

/// Имя в том виде, в каком оно уходит на сервер: без пробелов по краям,
/// пробелы внутри — по одному, апостроф — прямой `'`.
///
/// Сервер принимает только прямой апостроф; без замены «O’Brien», набранное
/// на iPhone, получило бы отказ за знак, которого человек не видит.
String normalizeName(String value) => value
    .trim()
    .replaceAll(RegExp(r'\s+'), ' ')
    .replaceAll(_typographicApostrophes, "'");

/// Буквы любого алфавита; пробел, дефис и апостроф — только между буквами.
final RegExp _namePattern = RegExp(r"^\p{L}+(?:[ '\-]\p{L}+)*$", unicode: true);

/// Только разрешённые знаки — без требования к их порядку.
final RegExp _nameAllowedChars = RegExp(r"^[\p{L} '\-]+$", unicode: true);

/// Проверка имени — одно правило для регистрации и правки профиля, то же,
/// что на сервере (решение Координатора 17.10.2026, В4): буквы любого
/// алфавита (кириллица с «ё», «і», «ў», латиница), пробел, дефис и апостроф
/// между буквами, длина 2–50. Главный судья — сервер; здесь проверка для
/// удобства, отказ сервера экран показывает своим текстом.
String? validateName(String? value) {
  final name = normalizeName(value ?? '');
  if (name.isEmpty) {
    return 'Введите имя';
  }

  if (!_nameAllowedChars.hasMatch(name)) {
    return nameCharactersMessage;
  }

  if (!_namePattern.hasMatch(name)) {
    return 'Пробел, дефис и апостроф — только между буквами';
  }

  if (name.length < nameMinLength) {
    return 'Имя — не короче $nameMinLength букв';
  }

  if (name.length > nameMaxLength) {
    return 'Имя — не длиннее $nameMaxLength символов';
  }

  return null;
}

/// Password strength enum
enum PasswordStrength {
  /// Weak password (score 0-2)
  weak,

  /// Medium password (score 3)
  medium,

  /// Strong password (score 4+)
  strong,
}

/// Get password strength
/// Returns PasswordStrength enum based on password complexity
PasswordStrength getPasswordStrength(String password) {
  if (password.length < 8) return PasswordStrength.weak;

  int score = 0;

  // Has uppercase
  if (RegExp(r'[A-Z]').hasMatch(password)) score++;

  // Has lowercase
  if (RegExp(r'[a-z]').hasMatch(password)) score++;

  // Has digit
  if (RegExp(r'[0-9]').hasMatch(password)) score++;

  // Has special character
  if (RegExp(r'[!@#\$%\^&\*]').hasMatch(password)) score++;

  // Is long enough (12+ chars)
  if (password.length >= 12) score++;

  if (score <= 2) return PasswordStrength.weak;
  if (score <= 3) return PasswordStrength.medium;
  return PasswordStrength.strong;
}

/// Get password strength percentage (0.0 to 1.0)
double getPasswordStrengthProgress(String password) {
  final strength = getPasswordStrength(password);
  switch (strength) {
    case PasswordStrength.weak:
      return 0.33;
    case PasswordStrength.medium:
      return 0.66;
    case PasswordStrength.strong:
      return 1.0;
  }
}

/// Verification code validation (6 digits)
/// Returns null if valid, error message if invalid
String? validateVerificationCode(String? value) {
  if (value == null || value.isEmpty) {
    return 'Введите код';
  }

  if (value.length != 6) {
    return 'Код — 6 цифр';
  }

  if (!RegExp(r'^[0-9]{6}$').hasMatch(value)) {
    return 'Код состоит только из цифр';
  }

  return null;
}
