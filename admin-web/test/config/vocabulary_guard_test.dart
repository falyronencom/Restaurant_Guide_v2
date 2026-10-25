import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/config/analytics_vocabulary.dart';
import 'package:restaurant_guide_admin_web/config/establishment_vocabulary.dart';
import 'package:restaurant_guide_admin_web/config/moderation_vocabulary.dart';
import 'package:restaurant_guide_admin_web/config/panel_roles.dart';
import 'package:restaurant_guide_admin_web/providers/moderation_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/status_dot.dart';

import '../helpers/dart_source_scan.dart';

// Сторож единого словаря панели (волна 3, проход по панели модератора,
// 20.10, пакет П8): каждое значение статуса, действия, роли и поля — с
// подписью, одно значение — одно имя на всех экранах.
//
// Статусы и роли сверяются не с копией набора, а с самой схемой базы —
// `backend/migrations/production_schema.sql` (снимок состава прода): новый
// статус или роль там без подписи здесь роняют тест, а не доезжают до экрана
// машинным кодом. Действия журнала сторожит `moderation_vocabulary_test.dart`
// (общий список сервера `auditLogActions.json`), удобства —
// `establishment_vocabulary_test.dart`.

const String _schemaPath = '../backend/migrations/production_schema.sql';

/// Значения из `CHECK (… = ANY (ARRAY['a'::…, …]))` ограничения [name].
List<String> _checkValues(String schema, String name) {
  final start = schema.indexOf('CONSTRAINT $name CHECK');
  expect(start, isNonNegative, reason: 'в схеме нет ограничения $name');
  final end = schema.indexOf('\n', start);
  final values = RegExp(r"'([a-z_]+)'::")
      .allMatches(schema.substring(start, end))
      .map((m) => m.group(1)!)
      .toList();
  // Якорь: пустой разбор выглядел бы как «расхождений нет».
  expect(values, isNotEmpty, reason: '$name разобрался пустым');
  return values;
}

/// Подпись — словами по-русски: есть кириллица и нет кода через `_`.
void _expectWords(String? label, String key) {
  expect(label, isNotNull, reason: '$key: подписи нет');
  expect(label!.trim(), isNotEmpty, reason: '$key: подпись пустая');
  expect(RegExp('[а-яё]', caseSensitive: false).hasMatch(label), isTrue,
      reason: '$key: «$label» — не по-русски');
  expect(label.contains('_'), isFalse, reason: '$key: «$label» — код');
}

void main() {
  final schema = File(_schemaPath).readAsStringSync();

  group('статусы заведения', () {
    List<String> statuses() =>
        _checkValues(schema, 'establishments_status_check');

    test('у каждого статуса базы — подпись точки и доли аналитики', () {
      expect(kEstablishmentStatuses.keys.toSet(), statuses().toSet());
      expect(kStatusShares.keys.toSet(), statuses().toSet());
      for (final status in statuses()) {
        _expectWords(StatusDot.labelFor(status), status);
        _expectWords(statusShareLabel(status), status);
      }
    });

    test('одно слово на статус: «Отклонённые», «Приостановленные» (Г)', () {
      expect(StatusDot.labelFor('rejected'), 'отклонено');
      expect(statusShareLabel('rejected'), 'Отклонённые');
      expect(StatusDot.labelFor('suspended'), 'приостановлено');
      expect(statusShareLabel('suspended'), 'Приостановленные');
    });
  });

  group('роли', () {
    List<String> roles() => _checkValues(schema, 'users_role_check');

    test('у каждой роли базы — подпись в аналитике и в журнале', () {
      expect(kUserRoles.keys.toSet(), roles().toSet());
      for (final role in roles()) {
        _expectWords(userRoleLabel(role), role);
        _expectWords(actorRoleLabel(role), role);
      }
    });

    test('у каждой роли панели — подпись в меню слева', () {
      expect(kPanelRoles.difference(roles().toSet()), isEmpty,
          reason: 'роль панели, которой нет в базе');
      for (final role in kPanelRoles) {
        _expectWords(panelRoleLabel(role), role);
      }
    });

    test('роль просмотра называется одинаково везде (A3-26)', () {
      const name = 'Только просмотр';
      expect(panelRoleLabel(kViewerRole), name, reason: 'меню слева');
      expect(actorRoleLabel(kViewerRole), name, reason: 'журнал');
      expect(userRoleLabel(kViewerRole), name, reason: 'аналитика');
    });
  });

  test('у каждого действия журнала — подпись словами', () {
    for (final entry in kAuditActions.entries) {
      _expectWords(entry.value, entry.key);
    }
  });

  group('поля карточки', () {
    test('у каждого поля проверки — имя из словаря полей', () {
      for (final field in kModerationTabFields.expand((tab) => tab)) {
        expect(kEstablishmentFieldNames, contains(field),
            reason: 'поле проверки «$field» без имени');
        expect(kModerationFieldLabels[field], fieldLabel(field),
            reason: 'диалоги и заметки называют «$field» иначе, чем строка');
      }
    });

    test('одно поле — одно имя, и разные поля не делят имя (F-25)', () {
      final labels = kEstablishmentFieldNames.values.map((f) => f.label);
      expect(labels.toSet().length, labels.length,
          reason: 'два поля под одним именем');
      for (final entry in kEstablishmentFieldNames.entries) {
        // «E-mail» — общепринятое имя поля, латиницей пишется и у гостя.
        if (entry.value.label == 'E-mail') continue;
        _expectWords(entry.value.label, entry.key);
      }
    });

    test('пустое поле — «не указан/а/о/ы» по роду имени (F-21)', () {
      expect(fieldEmptyText('unp'), 'не указан');
      expect(fieldEmptyText('registration_doc'), 'не указана');
      expect(fieldEmptyText('legal_name'), 'не указано');
      expect(fieldEmptyText('working_hours'), 'не указаны');
      expect(fieldEmptyText('незнакомое'), 'не указано');
    });
  });

  // Старые синонимы в строках интерфейса. Комментарии не в счёт: там
  // прежние слова цитируются как история.
  test('в строках панели нет старых синонимов', () {
    const retired = <String>[
      'Отказанные',
      'отказанные',
      'отказано',
      'История отказов',
      'Приостановлены',
      'Наблюдатели',
      'Ценовой диапазон',
      'Время работы',
      'Атрибуты заведения',
      'Номер для связи',
      'Номер контактного лица',
      'Полное название',
      'Учётк',
      'учётк',
    ];
    final strings = RegExp(r"'([^'\n]*)'");
    final found = <String>[];
    var scanned = 0;
    for (final file in libSources()) {
      final source = file.readAsStringSync();
      final lines = source.split('\n');
      for (var i = 0; i < lines.length; i++) {
        final line = lines[i].trimLeft();
        if (line.startsWith('//')) continue;
        for (final match in strings.allMatches(line)) {
          scanned++;
          final text = match.group(1)!;
          for (final word in retired) {
            if (text.contains(word)) {
              found.add('${unixPath(file)}:${i + 1}: «$text»');
            }
          }
        }
      }
    }
    // Якорь: скан, не нашедший ни одной строки, выглядел бы как «чисто».
    expect(scanned, greaterThan(1000));
    expect(found, isEmpty);
  });
}
