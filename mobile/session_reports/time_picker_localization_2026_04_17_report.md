# Time Picker Localization & Dial Fix — 2026-04-17

## Problem

Партнёр при заполнении карточки заведения на 5-м шаге («Время работы») сталкивался с тремя проблемами в нативном Material TimePicker:

- **(а)** В режиме ручного ввода (`TimePickerEntryMode.input`) клавиатура не меняла значения часов/минут.
- **(б)** При первом открытии в режиме циферблата цифры визуально перекрывались — две концентрические окружности (0-11 и 12-23) слишком близки.
- **(в)** Все подписи диалога на английском: "Select time", "Enter time", "Hour", "Minute", "Cancel", "OK".

## Root Causes

1. **Отсутствие русской Material-локализации.** В `MaterialApp` не были подключены `localizationsDelegates` и `supportedLocales`. Без `MaterialLocalizations` ru:
   - все подписи на английском (в)
   - форматер поля ввода в `TimePickerEntryMode.input` не принимает цифры с клавиатуры (а)

2. **Известный баг Flutter в 24-часовом циферблате** ([flutter/flutter#141501](https://github.com/flutter/flutter/issues/141501)): кольца 0-11 и 12-23 рисуются слишком близко друг к другу. Присутствует в stable 3.35.2. Локализация на это не влияет (б).

## Changes

### Локализация (закрывает а и в)
- `mobile/pubspec.yaml`: добавлен `flutter_localizations` (SDK), `intl` поднят `^0.18.1 → ^0.20.2` (требование SDK-пакета)
- `mobile/lib/main.dart`: в `MaterialApp` добавлены `locale: Locale('ru')`, `localizationsDelegates` (Global Material/Widgets/Cupertino), `supportedLocales: [ru, en]`

### Убран циферблат (закрывает б)
- `mobile/lib/screens/partner/working_hours_screen.dart`: `initialEntryMode: TimePickerEntryMode.input → TimePickerEntryMode.inputOnly`. Диалог открывается сразу в режиме клавиатурного ввода, кнопка переключения на циферблат скрыта. Для ввода рабочих часов заведения клавиатура объективно быстрее циферблата.

## Verification

- `flutter analyze` — No issues found (после обновления `intl`).
- Сборка `flutter build apk --debug` прошла.
- Установка на Samsung A72 (Android 14, R58R54TPJ7Z) через ADB, визуальная проверка пользователем:
  - ✅ Все надписи на русском
  - ✅ Клавиатурный ввод работает
  - ✅ Циферблата больше нет — проблема исчезла как класс

## Known UX Residual (out of scope)

При вводе с клавиатуры для замещения цифр нужно сначала нажать Backspace. Это дефолтное поведение Flutter TimePicker. Для полного решения (авто-замещение при фокусе) понадобится кастомный inline-picker — вынесено как потенциальная отдельная задача.

## Files Modified

- `mobile/pubspec.yaml`
- `mobile/pubspec.lock`
- `mobile/lib/main.dart`
- `mobile/lib/screens/partner/working_hours_screen.dart`

## Side Effects (positive)

Русская локаль теперь применяется ко всем Material-виджетам в приложении (DatePicker, Dismissible, контекстные меню и т.п.), а не только к TimePicker.
