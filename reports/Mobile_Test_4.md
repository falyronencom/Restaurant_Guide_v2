# Mobile Test 4 - Отчёт о тестировании

**Дата:** 21 января 2026
**Тестировщик:** Всеволод + Claude
**Версия:** После Mobile_Test_3
**Статус:** РЕШЕНО

---

## Цель тестирования

Исправить проблему из Mobile_Test_3: после успешного создания заведения через мастер регистрации партнёра UI не обновлялся - пользователь возвращался в личный кабинет и видел кнопку "Разместить заведение" вместо Partner Dashboard с созданным заведением.

---

## Выявленные и решённые проблемы

### 1. AuthProvider не обновлял роль после смены user → partner

**Проблема:**
Backend обновлял роль в БД и возвращал новые JWT токены с `role: partner`, но AuthProvider._currentUser.role оставался `user`. ProfileScreen проверял stale роль и показывал неправильный UI.

**Решение:**
Добавлен метод `updateUserRole()` в AuthProvider для немедленного обновления роли без сетевого запроса:

```dart
/// Updates user role after backend role change (e.g., user → partner)
Future<void> updateUserRole(String newRole) async {
  if (_currentUser != null) {
    _currentUser = _currentUser!.copyWith(role: newRole);
    _status = AuthenticationStatus.authenticated;
    notifyListeners();
  }
}
```

**Файл:** `mobile/lib/providers/auth_provider.dart`

---

### 2. Неправильная оркестрация _handleSubmit()

**Проблема:**
После успешного создания заведения не выполнялась правильная последовательность действий для обновления UI.

**Решение:**
Переписан `_handleSubmit()` с правильной оркестрацией:

```dart
Future<void> _handleSubmit(PartnerRegistrationProvider provider) async {
  final authProvider = context.read<AuthProvider>();
  final partnerDashboardProvider = context.read<PartnerDashboardProvider>();

  final success = await provider.submit();

  if (success && mounted) {
    // Step 1: Update role in AuthProvider (no network call)
    await authProvider.updateUserRole('partner');

    // Step 2: Reset and reload partner dashboard
    partnerDashboardProvider.reset();
    await partnerDashboardProvider.loadEstablishments();

    // Step 3: Show success message
    scaffoldMessenger.showSnackBar(...);

    // Step 4: Navigate back
    navigator.pop();
  }
}
```

**Файл:** `mobile/lib/screens/partner/partner_registration_screen.dart`

---

### 3. PartnerEstablishment.fromJson() не соответствовал формату backend

**Проблема:**
При загрузке заведений возникала ошибка парсинга JSON:
```
type 'String' is not a subtype of type 'int' of 'index'
```

**Причина:**
Flutter модель ожидала один формат, backend возвращал другой:
- Flutter: `json['address']['city']` → Backend: `json['city']` (отдельное поле)
- Flutter: `json['category']` → Backend: `json['categories']`
- Flutter: `json['cuisine_type']` → Backend: `json['cuisines']`
- Flutter: `json['primary_image_url']` → Backend: `json['primary_photo']['url']`

**Решение:**
Полностью переписан `fromJson()` для соответствия формату backend:

```dart
factory PartnerEstablishment.fromJson(Map<String, dynamic> json) {
  // Extract primary image from nested structure
  String? primaryImage;
  if (json['primary_photo'] is Map) {
    primaryImage = json['primary_photo']['url'] as String?
        ?? json['primary_photo']['thumbnail_url'] as String?;
  } else {
    primaryImage = json['primary_image_url'] as String?;
  }

  return PartnerEstablishment(
    // Backend uses 'categories' (array), not 'category'
    categories: (json['categories'] as List<dynamic>?)
        ?.map((e) => e.toString()).toList() ?? [],
    // Backend uses 'cuisines' (array), not 'cuisine_type'
    cuisineTypes: (json['cuisines'] as List<dynamic>?)
        ?.map((e) => e.toString()).toList() ?? [],
    // Backend returns 'city' as separate field
    city: json['city'] as String?,
    street: json['address'] as String?,  // address is street string
    // ...
  );
}
```

**Файл:** `mobile/lib/models/partner_establishment.dart`

---

### 4. Числовые поля возвращались как строки

**Проблема:**
Вторая ошибка парсинга:
```
type 'String' is not a subtype of type 'num?' in type cast
```

**Причина:**
Backend возвращал числовые поля (view_count, latitude, longitude и т.д.) как строки, а Flutter пытался кастовать их напрямую к `num`.

**Решение:**
Добавлены safe-parsing хелперы, которые обрабатывают и String, и num:

```dart
/// Safely parse int from dynamic value (handles String and num)
int _parseIntSafe(dynamic value) {
  if (value == null) return 0;
  if (value is int) return value;
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value) ?? 0;
  return 0;
}

double? _parseDoubleSafe(dynamic value) {
  if (value == null) return null;
  if (value is double) return value;
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value);
  return null;
}
```

**Файл:** `mobile/lib/models/partner_establishment.dart`

---

### 5. Отсутствовал статус 'draft' в enum

**Проблема:**
Switch statement для `EstablishmentStatus` был не exhaustive после добавления `draft`.

**Решение:**
Добавлен `draft` статус в enum и во все switch statements:

```dart
enum EstablishmentStatus {
  draft,     // Черновик (только создано)
  pending,   // На модерации
  approved,  // Одобрено (активно)
  rejected,  // Отклонено
  suspended, // Приостановлено
}
```

**Файлы:**
- `mobile/lib/models/partner_establishment.dart`
- `mobile/lib/widgets/partner_establishment_card.dart`

---

## Изменённые файлы

### Mobile (Flutter):

| Файл | Изменения |
|------|-----------|
| `lib/providers/auth_provider.dart` | Добавлен метод `updateUserRole()` |
| `lib/providers/partner_dashboard_provider.dart` | Добавлено debug логирование |
| `lib/screens/partner/partner_registration_screen.dart` | Переписан `_handleSubmit()` с оркестрацией |
| `lib/models/partner_establishment.dart` | Переписан `fromJson()`, добавлены safe-parse хелперы, добавлен `draft` статус |
| `lib/widgets/partner_establishment_card.dart` | Добавлен case для `draft` статуса |

---

## Результаты тестирования

| Функция | Статус |
|---------|--------|
| Wizard шаги 1-7 | ✅ Работает |
| Отправка на бэкенд | ✅ 201 Created |
| Обновление роли user → partner | ✅ Работает |
| Показ SnackBar успеха | ✅ Работает |
| Навигация обратно в профиль | ✅ Работает |
| Отображение Partner Dashboard | ✅ Работает |
| Загрузка списка заведений | ✅ Работает (5 заведений) |
| Отображение карточек заведений | ✅ Работает |

---

## Логи успешного теста

```
SUBMIT: Starting submission...
SUBMIT: Creation result: true
AuthProvider: Updating role from user to partner
AuthProvider: User role updated to partner
SUBMIT: Role updated to partner
PartnerDashboard: Loading establishments...
PartnerDashboard: Loaded 5 establishments
SUBMIT: Partner dashboard reloaded
SUBMIT: Navigating back...
```

---

## Коммиты

### Коммит 1: 49aa830
```
fix: Handle JWT token refresh when user role changes to partner
```
Backend генерирует новые токены при смене роли, Flutter сохраняет их.

### Коммит 2: 50d72c0
```
fix: Mobile Test_4 - Partner role transition and JSON parsing fixes

- Add updateUserRole() method to AuthProvider for immediate role updates
- Update _handleSubmit() to orchestrate partner transition flow properly
- Fix PartnerEstablishment.fromJson() to match backend response format
- Add safe JSON parsing helpers for String/num type coercion
- Add 'draft' status to EstablishmentStatus enum
- Add debug logging to PartnerDashboardProvider
```

---

## Выводы

Проблема "UI не обновляется после создания заведения" из Mobile_Test_3 полностью решена.

**Корневые причины:**
1. AuthProvider не синхронизировал роль с JWT токеном
2. `fromJson()` модели не соответствовал формату ответа backend
3. Backend возвращал числа как строки, требовался safe parsing

**Ключевое решение:**
Добавление `updateUserRole()` метода + правильная оркестрация в `_handleSubmit()` + исправление парсинга JSON.

---

## Следующие шаги (для Test_5)

1. Тестирование редактирования заведения
2. Тестирование статистики партнера
3. Тестирование отзывов
4. Тестирование push-уведомлений
5. Тестирование модерации заведений
