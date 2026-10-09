import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/config/environment.dart';

/// Сторож возврата из браузера после входа через Яндекс (Android).
///
/// Возврат принимает свой экран `.OAuthCallbackActivity`, а не
/// `CallbackActivity` из flutter_web_auth_2. Экран плагина при
/// `taskAffinity=""` у главного окна оставлял поверх приложения вкладку
/// браузера с «Войти как …», хотя вход уже прошёл (A72, 08.10.2026).
/// Инструкция плагина велит объявить именно его экран — и правка «по
/// инструкции» вернёт дефект молча: сборка зелёная, ломается только на
/// телефоне. Два обработчика одной схемы хуже: Android спросит человека,
/// чем открыть ссылку. Схема в настройках обязана совпадать со схемой,
/// которую ждёт код, иначе браузер не вернёт ответ вовсе.
///
/// Разбор текстом, а не XML-библиотекой: ей пришлось бы стать прямой
/// зависимостью ради одного сторожа.
void main() {
  final manifest =
      File('android/app/src/main/AndroidManifest.xml').readAsStringSync();

  /// Блоки `<activity …>…</activity>` и имя каждого.
  final activities = RegExp(r'<activity\b[\s\S]*?</activity>')
      .allMatches(manifest)
      .map((m) => m.group(0)!)
      .toList();
  String nameOf(String block) =>
      RegExp(r'android:name="([^"]+)"').firstMatch(block)!.group(1)!;

  const scheme = Environment.yandexRedirectScheme;
  final handlers = activities
      .where((block) => block.contains('android:scheme="$scheme"'))
      .map(nameOf)
      .toList();

  test('якорь: разбор видит окна приложения', () {
    // Промах разбора беззвучен: ноль окон выглядел бы как «обработчиков
    // нет», и проверки ниже упали бы не по делу — или, хуже, прошли.
    expect(activities.map(nameOf), contains('.MainActivity'));
  });

  test('ответ Яндекса принимает ровно один экран — свой', () {
    expect(handlers, ['.OAuthCallbackActivity'],
        reason: 'схему «$scheme» обязан обрабатывать ровно один экран, '
            '.OAuthCallbackActivity; экран плагина оставляет вкладку браузера '
            'поверх приложения, а два обработчика — вопрос «чем открыть»');
  });

  test('экран плагина не объявлен ни под какой схемой', () {
    expect(manifest, isNot(contains('flutter_web_auth_2.CallbackActivity')));
  });

  group('экран возврата в коде', () {
    // Манифест называет класс, но не проверяет его: класс переименуют или
    // перенесут — сборка останется зелёной, а возврат из Яндекса упадёт
    // ClassNotFoundException уже на телефоне.
    final source = File(
      'android/app/src/main/kotlin/com/nirivio/app/OAuthCallbackActivity.kt',
    ).readAsStringSync();

    test('класс объявлен там, куда указывает манифест', () {
      expect(source, contains('package com.nirivio.app'));
      expect(source, contains('class OAuthCallbackActivity'));
    });

    test('ответ отдаётся до того, как окно приложения выходит наверх', () {
      // Порядок обязателен: на возврате приложения на экран плагин отменяет
      // незавершённые входы, и ответ, отданный позже, потерялся бы.
      final delivered = source.indexOf('callbacks.remove(');
      final raised = source.indexOf('startActivity(');
      expect(delivered, greaterThan(0), reason: 'ответ плагину не отдаётся');
      expect(raised, greaterThan(0), reason: 'окно приложения не поднимается');
      expect(delivered, lessThan(raised));
    });
  });
}
