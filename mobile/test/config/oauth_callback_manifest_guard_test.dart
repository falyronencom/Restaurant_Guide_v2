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
  // Без комментариев: закомментированный экран Android не объявляет, и
  // разбор не должен его видеть.
  final manifest = File('android/app/src/main/AndroidManifest.xml')
      .readAsStringSync()
      .replaceAll(RegExp(r'<!--[\s\S]*?-->'), '');

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

    // «Принимает» — значит, браузер может его открыть: экран виден другим
    // приложениям, фильтр — переход по ссылке. Без любого из этих признаков
    // схема объявлена, а ответ не приходит никуда — сборка зелёная, вход
    // ломается только на телефоне.
    final handler = activities
        .singleWhere((block) => nameOf(block) == '.OAuthCallbackActivity');
    for (final mark in const [
      'android:exported="true"',
      '<action android:name="android.intent.action.VIEW"',
      '<category android:name="android.intent.category.DEFAULT"',
      '<category android:name="android.intent.category.BROWSABLE"',
    ]) {
      expect(handler, contains(mark),
          reason: 'без «$mark» браузер не отдаст ответ экрану');
    }
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
      // Манифест называет экран относительно namespace сборки. Имя и пакет —
      // целым словом: «OAuthCallbackActivityLegacy» или пакет
      // «com.nirivio.app.auth» содержат искомое, но манифест на них не указывает.
      final namespace = RegExp(r'namespace\s*=\s*"([^"]+)"')
          .firstMatch(
              File('android/app/build.gradle.kts').readAsStringSync())!
          .group(1)!;
      expect(source,
          matches(RegExp('^package ${RegExp.escape(namespace)}\\s*\$',
              multiLine: true)));
      expect(source,
          matches(RegExp(r'^class OAuthCallbackActivity\b', multiLine: true)));
    });

    test('ответ отдаётся до того, как окно приложения выходит наверх', () {
      // Порядок обязателен: на возврате приложения на экран плагин отменяет
      // незавершённые входы, и ответ, отданный позже, потерялся бы. «Отдаётся»
      // — это `success(…)`: одно `remove` снимает ожидание, не отдав ответа.
      final delivered = source
          .indexOf(RegExp(r'callbacks\.remove\([^)]*\)\?\.success\('));
      final raised = source.indexOf('startActivity(');
      expect(delivered, greaterThan(0), reason: 'ответ плагину не отдаётся');
      expect(raised, greaterThan(0), reason: 'окно приложения не поднимается');
      expect(delivered, lessThan(raised));
    });
  });
}
