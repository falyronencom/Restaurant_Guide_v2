import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';

/// Фраза поиска, выдачу которой сейчас показывает карта, или null — карта
/// показывает все заведения видимой области.
///
/// Решение Координатора 29.09.2026 (вариант 2Б): пока в строке поиска есть
/// фраза, карта показывает ровно выдачу списка и плашку «Поиск: … ✕». До него
/// карта молча применяла фразу своим, прежним движком: после поиска
/// «underdog» соседние заведения пропадали без объяснения, а на «завтрак»
/// список находил 14 заведений, карта — ни одного (прод, 29.09).
///
/// Поиска на карте нет, когда она открыта ради одного заведения ([focused] —
/// карта из карточки заведения): фраза, набранная раньше, могла бы спрятать
/// само это заведение. И когда фразу сняли с карты крестиком
/// ([dismissedPhrase]) — пока в строке она же.
String? activeMapPhrase({
  required String? searchQuery,
  required String? dismissedPhrase,
  required bool focused,
}) {
  if (focused) return null;
  final phrase = searchQuery?.trim() ?? '';
  if (phrase.isEmpty || phrase == dismissedPhrase) return null;
  return phrase;
}

/// Когда карте загружать пины заново.
///
/// Ключ — что карта показала бы сейчас: режим, фраза и фильтры, которые
/// уходят в запрос. Один и тот же ключ второй раз не грузится: у умного поиска
/// лимит 30 запросов в минуту на адрес.
///
/// - Остановка камеры: без фразы пины зависят от видимой области — грузить
///   всегда, как раньше; с фразой — только если ключ сменился (выдача фразы
///   от области не зависит).
/// - Смена фразы или фильтров, пока карту НЕ видно (вкладка скрыта или карта
///   под другим экраном), её не перезагружает. Ревью 29.09.2026: вкладка карты
///   живёт в стопке вкладок, и семь касаний чипов на экране фильтров стоили
///   семи скрытых запросов — список ловил отказ по лимиту. Загрузка — когда
///   карту снова видно, и только если ключ за это время сменился.
/// - Ошибка ключ не сбрасывает: иначе каждое следующее уведомление провайдера
///   повторяло бы неудачный запрос, а отказ по лимиту продлевал бы сам себя.
///   Заново загружает только «Повторить» — мимо привратника.
class MapFetchGate {
  String? _lastKey;
  bool _visible = true;

  /// Видна ли карта (по последнему [onVisibilityChanged])
  bool get visible => _visible;

  /// Уведомление провайдера: грузить ли сейчас.
  bool onProviderChanged(String key) => _visible && key != _lastKey;

  /// Карту стало видно или не видно: грузить ли сейчас.
  bool onVisibilityChanged(bool visible, String key) {
    _visible = visible;
    return visible && key != _lastKey;
  }

  /// Камера остановилась: грузить ли сейчас.
  bool onCameraStopped(String key, {required bool phraseMode}) =>
      !phraseMode || key != _lastKey;

  /// Проверка перед загрузкой, отложенной до конца кадра: несколько
  /// отложенных вызовов на одну смену дают одну загрузку.
  bool isStale(String key) => key != _lastKey;

  /// Загрузка с этим ключом началась.
  void started(String key) => _lastKey = key;
}

/// Плашка над картой: «Поиск: «underdog»» и крестик, снимающий поиск с карты.
/// Если найдено больше, чем поместилось на карту, — «· 100 из 132».
class MapSearchPlaque extends StatelessWidget {
  const MapSearchPlaque({
    super.key,
    required this.phrase,
    required this.shown,
    required this.total,
    required this.onClear,
  });

  final String phrase;

  /// Сколько заведений по фразе на карте
  final int shown;

  /// Сколько найдено всего
  final int total;

  final VoidCallback onClear;

  /// Текст плашки без крестика
  String get label {
    final base = 'Поиск: «$phrase»';
    return total > shown ? '$base · $shown из $total' : base;
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.only(left: 14),
      decoration: BoxDecoration(
        color: AppTheme.backgroundPrimary,
        borderRadius: BorderRadius.circular(22),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.12),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.search, size: 18, color: AppTheme.primaryOrange),
          const SizedBox(width: 8),
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 14, color: Colors.black87),
            ),
          ),
          IconButton(
            tooltip: 'Показать все заведения',
            onPressed: onClear,
            icon: const Icon(Icons.close, size: 18, color: AppTheme.textGrey),
          ),
        ],
      ),
    );
  }
}
