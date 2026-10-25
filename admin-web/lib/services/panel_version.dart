import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

/// Номер сборки, с которой открыта вкладка. Вшивается при сборке
/// (`--dart-define=PANEL_BUILD=…` в `Dockerfile`); тот же номер сборка кладёт
/// рядом с бандлом в [PanelVersionWatcher.buildFileName].
///
/// Пусто — сборка без номера (локальный запуск, тесты): сверять не с чем,
/// плашки не бывает.
const String kPanelBuild = String.fromEnvironment('PANEL_BUILD');

/// Новее ли опубликованная сборка той, что открыта во вкладке.
///
/// Номера не упорядочиваются — это метка сборки, а не версия: «новее» значит
/// «другая». Пустой или отсутствующий номер с любой стороны — не повод звать
/// обновляться: сервер ответил чем-то не тем, и лучше промолчать, чем
/// гонять модератора по кругу перезагрузок.
bool isNewerPanelBuild({required String running, String? published}) {
  final current = running.trim();
  final next = published?.trim() ?? '';
  if (current.isEmpty || next.isEmpty) return false;
  return current != next;
}

/// Сверяет номер сборки панели с опубликованным и говорит, когда вышла новая.
///
/// Зачем (проход по панели модератора, 20.10, К-7): панель — одна страница,
/// и вкладка, не перезагруженная с 18.10, жила со старой сборкой без раздела
/// «Пользователи», который у других уже был. Service worker'а нет
/// (`--pwa-strategy=none`) — значит, сама она про новую сборку не узнает.
///
/// Сверка — раз в [checkEvery] и при возврате на вкладку (это делает каркас).
/// Новая сборка найдена — [updateAvailable] остаётся true до перезагрузки:
/// откат на прежнюю сборку плашку не снимает, вкладке всё равно стоит
/// перечитаться.
class PanelVersionWatcher with ChangeNotifier {
  /// Файл с номером сборки рядом с `index.html`: `{"build": "…"}`.
  static const String buildFileName = 'build.json';

  /// Как часто сверяться, пока вкладка открыта.
  static const Duration checkEvery = Duration(minutes: 5);

  final String runningBuild;
  final Future<String?> Function() _fetchPublished;

  Timer? _timer;
  bool _checking = false;
  bool _updateAvailable = false;
  bool _disposed = false;

  PanelVersionWatcher({
    this.runningBuild = kPanelBuild,
    Future<String?> Function()? fetchPublished,
  }) : _fetchPublished = fetchPublished ?? _fetchFromServer;

  /// Есть ли с чем сверять: у сборки без номера сверка выключена целиком.
  bool get enabled => runningBuild.trim().isNotEmpty;

  bool get updateAvailable => _updateAvailable;

  /// Запустить сверку по таймеру (каркас, на всё время сеанса).
  void start({Duration every = checkEvery}) {
    if (!enabled) return;
    _timer?.cancel();
    _timer = Timer.periodic(every, (_) => check());
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
  }

  /// Одна сверка. Сбой сети — молча: плашка — подсказка, не тревога; через
  /// [checkEvery] будет следующая попытка.
  Future<void> check() async {
    if (!enabled || _updateAvailable || _checking) return;
    _checking = true;
    try {
      final published = await _fetchPublished();
      if (_disposed) return;
      if (isNewerPanelBuild(running: runningBuild, published: published)) {
        _updateAvailable = true;
        notifyListeners();
      }
    } catch (_) {
      // Не дозвались — сверимся в следующий раз.
    } finally {
      _checking = false;
    }
  }

  @override
  void dispose() {
    _disposed = true;
    stop();
    super.dispose();
  }

  /// Номер опубликованной сборки с того же адреса, откуда открыта панель.
  /// Метка времени в запросе — мимо любого кэша на пути (Caddy и так
  /// отдаёт всё с `no-cache`, но прокси по дороге мог бы решить иначе).
  static Future<String?> _fetchFromServer() async {
    final url = Uri.base.removeFragment().resolve(buildFileName).replace(
      queryParameters: <String, String>{
        't': DateTime.now().millisecondsSinceEpoch.toString(),
      },
    );
    final response = await Dio(BaseOptions(
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 10),
      responseType: ResponseType.json,
    )).getUri<dynamic>(url);
    return parseBuildFile(response.data);
  }

  /// Номер из содержимого [buildFileName]. Что-то не то — null.
  @visibleForTesting
  static String? parseBuildFile(Object? data) {
    // Сервер мог отдать файл текстом, без типа JSON, — Dio тогда не разберёт.
    if (data is String) {
      try {
        data = jsonDecode(data);
      } on FormatException {
        return null;
      }
    }
    if (data is Map && data['build'] is String) return data['build'] as String;
    return null;
  }
}
