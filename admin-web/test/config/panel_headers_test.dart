import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/config/environment.dart';

// Сторож политики источников панели (`Caddyfile`, сверка меток панели 29.10,
// S2). Ошибка в политике — белый экран у модератора, а видна она только в
// браузере; здесь — то, что можно поймать до сборки: адрес API в политике
// тот же, что в коде панели, и политика не ослаблена молча.

/// Директивы политики из `Content-Security-Policy "…"` Caddyfile.
Map<String, List<String>> _policy() {
  final caddy = File('Caddyfile').readAsStringSync();
  final match =
      RegExp(r'Content-Security-Policy "([^"]+)"').firstMatch(caddy);
  expect(match, isNotNull, reason: 'в Caddyfile нет Content-Security-Policy');
  final directives = <String, List<String>>{};
  for (final part in match!.group(1)!.split(';')) {
    final words = part.trim().split(RegExp(r'\s+'));
    if (words.first.isEmpty) continue;
    directives[words.first] = words.skip(1).toList();
  }
  return directives;
}

/// Значение `{$ПЕРЕМЕННАЯ:по умолчанию}` — то, что Caddy подставит на Railway,
/// где переменная не задана.
String _resolved(String source) => source.replaceAllMapped(
    RegExp(r'\{\$[A-Z_]+:([^}]*)\}'), (m) => m.group(1)!);

void main() {
  test('адрес API в политике — тот же, что у панели в боевой сборке', () {
    // API переедет на свой домен — environment.dart поменяют, а Caddyfile
    // забудут: вход упадёт «нет сети», и только в консоли будет видно почему.
    final connect = _policy()['connect-src']!.map(_resolved).toList();
    final api = Uri.parse(Environment.apiBaseUrl);
    expect(Environment.isProduction, isTrue,
        reason: 'тест сверяет боевой адрес: ENV по умолчанию — production');
    expect(connect, contains(api.origin));
  });

  test('скрипты — только свои: без unsafe-inline, unsafe-eval и чужих хостов',
      () {
    final policy = _policy();
    expect(policy['script-src'], <String>["'self'", "'wasm-unsafe-eval'"]);
    expect(policy['default-src'], <String>["'self'"]);
    expect(policy['object-src'], <String>["'none'"]);
    expect(policy['base-uri'], <String>["'self'"]);
    expect(policy['frame-ancestors'], <String>["'none'"]);
  });

  test('Cloudinary — только наше облако, не весь общий хост', () {
    // res.cloudinary.com общий для всех клиентов Cloudinary: без пути
    // политика пускала бы запрос в чужое облако.
    final policy = _policy();
    for (final directive in <String>['connect-src', 'img-src']) {
      final cloudinary = policy[directive]!
          .where((source) => source.contains('cloudinary'))
          .toList();
      expect(cloudinary, <String>['https://res.cloudinary.com/davrzdre8/'],
          reason: directive);
    }
  });
}
