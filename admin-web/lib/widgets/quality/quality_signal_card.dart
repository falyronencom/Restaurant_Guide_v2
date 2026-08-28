import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/quality_signals.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/quality_health_models.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_skeleton.dart';

/// Карточка одного сигнала здоровья данных.
///
/// Красная и чистая карточки различаются не только цветом числа. У чистой
/// приглушён заголовок и снята подпись: объяснять нечего, а одиннадцать
/// карточек в сетке 3×4 с одинаковым весом читались бы как одиннадцать
/// требований внимания. Ровно так это нарисовано в кадре 04.
///
/// Порог нулевой, а не процентный: проверки детерминированные — «нет
/// канонического адреса», «координаты вне Беларуси». Допустимого фона у них
/// не бывает.
class QualitySignalCard extends StatefulWidget {
  final QualitySignal signal;
  final int count;

  /// Дополнительная строка под подписью — возрастные корзины у флагов.
  final String? extraNote;

  /// Заведения под сигналом. Пусто — раскрывать нечего, и кнопки не будет.
  final List<QualitySample> samples;

  /// Собирает ли бэкенд примеры для этого сигнала вообще.
  ///
  /// Отличает «примеров у сигнала не бывает» (шесть сигналов из одиннадцати —
  /// молчим) от «бывают, но в этот срез не попали» (говорим вслух).
  final bool carriesSamples;

  const QualitySignalCard({
    super.key,
    required this.signal,
    required this.count,
    this.extraNote,
    this.samples = const <QualitySample>[],
    this.carriesSamples = false,
  });

  @override
  State<QualitySignalCard> createState() => _QualitySignalCardState();
}

class _QualitySignalCardState extends State<QualitySignalCard> {
  bool _expanded = false;

  @override
  void didUpdateWidget(QualitySignalCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Сигнал стал чистым — блок раскрытия просто перестаёт рисоваться, но флаг
    // остаётся поднятым. Вернись счётчик через снимок-другой, карточка пришла
    // бы уже раскрытой, хотя её никто не открывал.
    if (widget.count == 0 && _expanded) {
      _expanded = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final signal = widget.signal;
    final count = widget.count;
    final extraNote = widget.extraNote;
    final samples = widget.samples;
    final carriesSamples = widget.carriesSamples;
    final isProblem = count > 0;
    final accent = isProblem ? AppTheme.errorRed : AppTheme.statusGreen;
    final scope = signal.scopeNote;
    final extra = extraNote;
    // Раскрытие только у красных: у чистой раскрывать нечего по определению.
    final canExpand = isProblem && samples.isNotEmpty;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: AppTheme.canonCardDecoration(
        // Красная рамка @35% — карточка должна вычитываться из сетки боковым
        // зрением, но не спорить с числом внутри себя.
        borderColor: isProblem ? AppTheme.errorTint(0.35) : AppTheme.strokeGrey,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            spacing: 10,
            children: [
              Padding(
                padding: const EdgeInsets.only(top: 1),
                child: Icon(signal.icon, size: 18, color: accent),
              ),
              Expanded(
                child: Text(
                  signal.title,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    height: 1.35,
                    color: isProblem
                        ? AppTheme.textPrimary
                        : AppTheme.textSecondary,
                  ),
                ),
              ),
              Text(
                formatCount(count),
                // Число не переносится и не сжимается: пятизначный счётчик
                // рвал карточку на этапе 6, и лечится это одной строкой здесь.
                maxLines: 1,
                style: AppTheme.unbounded(
                  fontSize: 22,
                  color: accent,
                  height: 1,
                ),
              ),
            ],
          ),
          if (isProblem) ...[
            const SizedBox(height: 9),
            Text(
              scope == null ? signal.subtitle : '${signal.subtitle} · $scope',
              style: const TextStyle(
                fontSize: 12,
                height: 1.45,
                color: AppTheme.gray500,
              ),
            ),
            if (extra != null) ...[
              const SizedBox(height: 6),
              Text(
                extra,
                style: const TextStyle(
                  fontSize: 12,
                  height: 1.45,
                  fontWeight: FontWeight.w600,
                  color: AppTheme.disclaimerText,
                ),
              ),
            ],
            // Счётчик есть, а примеров нет — это не редкость и не сбой. Лимит в
            // 25 строк у часов ОБЩИЙ на два сигнала: если все двадцать пять
            // заняты битым форматом, у «всё закрыто» примеров не останется
            // вовсе. Молчащая карточка выглядела бы так, будто показывать
            // нечего, — а показывать есть что, просто не сюда доехало.
            if (isProblem && carriesSamples && samples.isEmpty) ...[
              const SizedBox(height: 8),
              const Text(
                'Примеров в этом срезе нет',
                style: TextStyle(fontSize: 11, color: AppTheme.textTertiary),
              ),
            ],
            if (canExpand) ...[
              const SizedBox(height: 10),
              _ExpandToggle(
                expanded: _expanded,
                onTap: () => setState(() => _expanded = !_expanded),
              ),
              if (_expanded) ...[
                const SizedBox(height: 8),
                // Высота ограничена, а не отдана содержимому: двадцать пять
                // строк растягивали карточку до 1485 пикселей рядом с соседями
                // по 56, роняли всё нижележащее на полтора экрана и оставляли
                // две пустые колонки. Кадр 04 задуман плотной сеткой, и один
                // клик не должен переставать её быть. Все строки при этом
                // доступны — у списка свой скролл.
                ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: 320),
                  child: SingleChildScrollView(
                    child: _SampleList(samples: samples, total: count),
                  ),
                ),
              ],
            ],
          ],
        ],
      ),
    );
  }
}


/// Переключатель раскрытия: «Показать заведения» / «Скрыть».
class _ExpandToggle extends StatelessWidget {
  final bool expanded;
  final VoidCallback onTap;

  const _ExpandToggle({required this.expanded, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          spacing: 4,
          children: <Widget>[
            Text(
              expanded ? 'Скрыть' : 'Показать заведения',
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppTheme.primaryOrangeDark,
              ),
            ),
            Icon(
              expanded ? Icons.expand_less : Icons.expand_more,
              size: 16,
              color: AppTheme.primaryOrangeDark,
            ),
          ],
        ),
      ),
    );
  }
}

/// Список заведений под сигналом: имя, город, диагноз.
///
/// Ссылками имена не сделаны намеренно: маршрута на отдельное заведение в
/// админке не существует, карточка живёт панелью внутри списков очередей.
/// Имя плюс город — рабочий адрес для поиска на «Одобренных» (он ищет по всем
/// статусам). Диплинк в список с подставленным поиском — отдельная работа.
class _SampleList extends StatelessWidget {
  final List<QualitySample> samples;

  /// Сколько заведений под сигналом ВСЕГО. Бэкенд отдаёт не больше двадцати
  /// пяти примеров, и умолчать об обрезке значило бы соврать длиной списка.
  final int total;

  const _SampleList({required this.samples, required this.total});

  @override
  Widget build(BuildContext context) {
    // Не `>`, а `!=`. Из нынешнего бэкенда список длиннее счётчика недостижим
    // (обе величины считаются одним проходом), но инвариант ничем не закреплён,
    // и при расхождении вниз молчаливая приписка скрыла бы его от глаз.
    final truncated = total != samples.length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        for (final sample in samples) _SampleRow(sample: sample),
        if (truncated) ...<Widget>[
          const SizedBox(height: 6),
          Text(
            'Показаны ${formatCount(samples.length)} из ${formatCount(total)}',
            style: const TextStyle(
              fontSize: 11,
              color: AppTheme.textTertiary,
            ),
          ),
        ],
      ],
    );
  }
}

class _SampleRow extends StatelessWidget {
  final QualitySample sample;

  const _SampleRow({required this.sample});

  @override
  Widget build(BuildContext context) {
    final city = sample.city;
    final detail = sample.detail;

    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          // Имя и город — РАЗНЫЕ Text. Одной строкой обрезался хвост, то есть
          // ровно город, а вместе они и делают строку рабочим адресом для
          // поиска: без города одноимённых заведений не различить.
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: <Widget>[
              Flexible(
                child: Text(
                  sample.name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    height: 1.35,
                    color: AppTheme.textDark,
                  ),
                ),
              ),
              if (city != null && city.isNotEmpty)
                Text(
                  ' · $city',
                  maxLines: 1,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    height: 1.35,
                    color: AppTheme.textDark,
                  ),
                ),
            ],
          ),
          if (detail != null)
            Text(
              detail,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 11,
                height: 1.35,
                color: AppTheme.textTertiary,
              ),
            ),
        ],
      ),
    );
  }
}
/// Скелетон карточки сигнала — та же коробка, та же геометрия.
///
/// Обещает именно ту раскладку, которая придёт: иконка, заголовок, число.
/// Скелетон, обещающий не ту геометрию, даёт скачок при появлении данных.
class QualitySignalCardSkeleton extends StatelessWidget {
  const QualitySignalCardSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: AppTheme.canonCardDecoration(),
      child: const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            spacing: 10,
            children: <Widget>[
              SkeletonBlock(width: 18, height: 18, radius: 4),
              Expanded(
                child: SkeletonBlock.line(widthFactor: 0.7, height: 13),
              ),
              SkeletonBlock(width: 24, height: 22, radius: 4),
            ],
          ),
          SizedBox(height: 9),
          SkeletonBlock.line(
            widthFactor: 1,
            height: 12,
            shade: SkeletonShade.weak,
          ),
          SizedBox(height: 5),
          SkeletonBlock.line(
            widthFactor: 0.55,
            height: 12,
            shade: SkeletonShade.weak,
          ),
        ],
      ),
    );
  }
}
