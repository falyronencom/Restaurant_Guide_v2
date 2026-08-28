import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/quality_signals.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/quality_health_models.dart';
import 'package:restaurant_guide_admin_web/providers/quality_health_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_screen_header.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/analytics_panel.dart';
import 'package:restaurant_guide_admin_web/widgets/quality/health_summary_bar.dart';
import 'package:restaurant_guide_admin_web/widgets/quality/quality_signal_card.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_error_card.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_error_toast.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_skeleton.dart';

/// «Здоровье данных» — AI-ops Brick-1 (Tier-0, только чтение).
///
/// Одиннадцать постоянных проверок каталога плюс перепись ключей атрибутов.
/// Состав и порядок карточек живут не здесь, а в `config/quality_signals.dart`:
/// по тому же порядку панель «Требует внимания» на дашборде считает красные
/// проверки и берёт первую себе в подпись.
class QualityHealthScreen extends StatefulWidget {
  const QualityHealthScreen({super.key});

  @override
  State<QualityHealthScreen> createState() => _QualityHealthScreenState();
}

class _QualityHealthScreenState extends State<QualityHealthScreen> {
  late final QualityHealthProvider _provider;
  String? _reportedError;
  VoidCallback? _dismissToast;

  @override
  void initState() {
    super.initState();
    _provider = context.read<QualityHealthProvider>();
    _provider.addListener(_onProviderChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      // Не force: тяжёлый пересчёт незачем — на сервере снимок живёт две минуты,
      // и заход сюда после дашборда почти всегда попадёт в него. Клиентского
      // кэша у провайдера НЕТ: запрос уходит при каждом заходе на экран.
      _provider.load();
    });
  }

  @override
  void dispose() {
    _provider.removeListener(_onProviderChanged);
    _dismissToast?.call();
    super.dispose();
  }

  /// Сбой обновления при живых данных сообщается тостом, а не подменой экрана.
  ///
  /// Карточка ошибки занимает всё тело и потому уместна, только когда
  /// показывать больше нечего. Если снимок на экране есть, а обновление не
  /// прошло, то без тоста видно лишь, что нажатие «ничего не сделало», — и это
  /// читается как сломанная кнопка. Ровно этот дефект чинили на этапе 6 в
  /// аналитике.
  void _onProviderChanged() {
    final message = _provider.error;

    if (message == null) {
      _reportedError = null;
      return;
    }
    if (_provider.data == null) return; // покажется карточка ошибки
    if (message == _reportedError) return;

    _reportedError = message;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _dismissToast?.call();
      _dismissToast = showAdminErrorToast(
        context,
        title: 'Снимок не обновился',
        message: '$message. На экране остался прежний снимок.',
        onRetry: () => _provider.refresh(),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<QualityHealthProvider>();
    final data = provider.data;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        AdminScreenHeader(
          title: 'Здоровье данных',
          subtitle: _subtitle(data),
          busy: provider.isLoading && data != null,
          actions: <Widget>[
            OutlinedButton.icon(
              onPressed: provider.isLoading ? null : () => provider.refresh(),
              style: AppTheme.canonHeaderAction(),
              icon: const Icon(
                Icons.refresh,
                size: 18,
                color: AppTheme.primaryOrangeDark,
              ),
              label: const Text('Обновить'),
            ),
          ],
        ),
        Expanded(child: _body(provider, data)),
      ],
    );
  }

  /// «Активные заведения, если на карточке не сказано иначе · только чтение ·
  /// снимок 14 июля, 09:41».
  ///
  /// Оговорка про карточки не педантизм: три сигнала из одиннадцати считаются
  /// шире активных заведений, и прежняя шапка обещала за них то, чего они не
  /// делают. Общее правило с названными исключениями честнее, чем общее
  /// правило, которое трижды неверно.
  String _subtitle(QualityHealthData? data) {
    const base = 'Активные заведения, если на карточке не сказано иначе · '
        'только чтение';
    final stamp = data?.generatedAt;
    if (stamp == null) return base;

    final taken = DateTime.tryParse(stamp);
    if (taken == null) return base;

    return '$base · снимок ${formatDayMonthLocal(taken)}, '
        '${formatTimeLocal(taken)}';
  }

  Widget _body(QualityHealthProvider provider, QualityHealthData? data) {
    if (data == null) {
      final message = provider.error;
      if (message != null) {
        return SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: AdminErrorCard(
            title: 'Снимок не загрузился',
            reason: message,
            message: 'Проверки читают каталог целиком, поэтому запрос дольше '
                'обычного. Если повтор не помогает — вероятно, недоступен сервер.',
            onRetry: () => provider.refresh(),
          ),
        );
      }
      return const _HealthSkeleton();
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          HealthSummaryBar(data: data),
          const SizedBox(height: 18),
          _SignalGrid(data: data),
          const SizedBox(height: 18),
          _CensusPanel(data: data),
        ],
      ),
    );
  }
}

/// Сетка сигналов: три колонки, проблемные первыми.
class _SignalGrid extends StatelessWidget {
  final QualityHealthData data;

  const _SignalGrid({required this.data});

  static const double _gap = 14;

  /// Сколько колонок влезает в [width] — ширину ТЕЛА сетки, уже без отступов.
  ///
  /// Пороги подобраны от ширины карточки, а не круглыми числами. В кадре 04
  /// карточка выходит 368 пикселей (тело 1132 на трёх колонках), и держаться
  /// стоит около этого. Прежние 1100/720 применялись к ширине уже за вычетом
  /// внутренних отступов 24+24 — из-за чего на окне 1024 сетка схлопывалась в
  /// ОДНУ колонку, промахнувшись мимо порога на четыре пикселя: карточки по
  /// 692 пикселя с иконкой и числом у левого края и одиннадцать рядов вниз.
  /// Две колонки дали бы там 351 — практически проектную ширину.
  ///
  /// Метод статический и общий со скелетоном: числа, продублированные в двух
  /// местах, разводят сетку и её заглушку по числу колонок, а совпадение
  /// геометрии — единственное, что скелетон обещает.
  static int columnsFor(double width) {
    if (width >= 1000) return 3; // ≥ 324 на карточку
    if (width >= 660) return 2; // ≥ 323 на карточку
    return 1;
  }

  static double cardWidth(double width) {
    final columns = columnsFor(width);
    return (width - _gap * (columns - 1)) / columns;
  }

  @override
  Widget build(BuildContext context) {
    final signals = signalsProblemsFirst(data);

    return LayoutBuilder(
      builder: (context, constraints) {
        final width = cardWidth(constraints.maxWidth);

        return Wrap(
          spacing: _gap,
          runSpacing: _gap,
          children: <Widget>[
            for (final signal in signals)
              // Ключ стоит на ПРЯМОМ ребёнке `Wrap`, а не на карточке внутри.
              // Сверка детей идёт по верхнему уровню: безключевые `SizedBox`
              // матчатся позиционно, и несовпадение ключей уже внутри слота
              // уничтожает элемент вместо переноса. Раскрытый список закрывался
              // сам, стоило карточке сменить место в сетке — а место меняется от
              // любого нового красного сигнала выше по канону.
              SizedBox(
                key: ValueKey<String>(signal.id),
                width: width,
                child: QualitySignalCard(
                  signal: signal,
                  count: signal.countOf(data),
                  extraNote: _extraNote(signal),
                  samples: signal.samplesOf?.call(data) ??
                      const <QualitySample>[],
                  carriesSamples: signal.samplesOf != null,
                ),
              ),
          ],
        );
      },
    );
  }

  /// Возрастные корзины — только у флагов и только когда есть что сказать.
  ///
  /// Обе приходили с бэкенда и обе не показывались. Тридцатидневная отличает
  /// «не успели на этой неделе» от «забыли месяц назад»; при нуле она молчит,
  /// а не печатает «0 старше 30 дней».
  String? _extraNote(QualitySignal signal) {
    if (signal.id != 'hanging_flags') return null;
    final week = data.hangingAgedOver7d;
    final month = data.hangingAgedOver30d;
    if (week == 0) return null;
    // Через formatCount, как и число над ним: без него на одной карточке
    // оказывались «12 480» с неразрывным пробелом сверху и «3120» снизу.
    if (month == 0) return '${formatCount(week)} старше 7 дней';
    return '${formatCount(week)} старше 7 дней, ${formatCount(month)} старше 30';
  }
}

/// Перепись ключей атрибутов — наблюдение, а не проверка.
class _CensusPanel extends StatelessWidget {
  final QualityHealthData data;

  const _CensusPanel({required this.data});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: AppTheme.canonCardDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            spacing: 10,
            children: <Widget>[
              Text(
                'Перепись ключей атрибутов',
                style: AppTheme.unbounded(
                  fontSize: 17,
                  color: AppTheme.textPrimary,
                ),
              ),
              const Flexible(
                child: Text(
                  'наблюдение, не проверка — вход для сверки канона атрибутов',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12,
                    color: AppTheme.textSecondary,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          // Витринные `AdminEmptyState`/`AdminColumnMessage` сюда не годятся —
          // это пустота ВНУТРИ карточки сетки, и для неё в проекте уже есть
          // `PanelEmpty`. Свой Text с теми же кеглем и цветом отличался бы от
          // соседних карточек отсутствием центрирования и отступа.
          if (data.attributeKeys.isEmpty)
            const PanelEmpty('Ни одного ключа не встретилось')
          else
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: <Widget>[
                for (final key in data.attributeKeys) _KeyChip(entry: key),
              ],
            ),
        ],
      ),
    );
  }
}

/// Чип переписи: ключ моноширинным, счётчик жирным.
///
/// Ключ остаётся латиницей намеренно — это буквально то, что лежит в базе, и
/// смысл переписи в сверке с каноном. Перевести его значило бы сверять перевод.
class _KeyChip extends StatelessWidget {
  final AttributeKeyCount entry;

  const _KeyChip({required this.entry});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
      decoration: BoxDecoration(
        color: AppTheme.backgroundWarm,
        borderRadius: BorderRadius.circular(AppTheme.radiusPill),
        border: Border.all(color: AppTheme.beigeDivider),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          // Ключ обязан ужиматься: длину его никто не ограничивает — ни SQL
          // переписи, ни путь записи атрибутов (канон ратифицирован, но в коде
          // не проверяется). Панель для того и есть, чтобы показывать чужие
          // ключи, и на длинном она рвала бы всю карточку переполнением.
          Flexible(
            child: Text(
              entry.key,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTheme.mono(fontSize: 12, color: AppTheme.textDark),
            ),
          ),
          const Text(
            ' · ',
            style: TextStyle(fontSize: 12, color: AppTheme.textDark),
          ),
          Text(
            formatCount(entry.count),
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: AppTheme.textDark,
            ),
          ),
        ],
      ),
    );
  }
}

/// Скелетон тела: сводка, сетка на одиннадцать карточек, панель переписи.
///
/// Высота ЗАГЛУШКИ СВОДКИ сверена замером и закреплена тестом: от неё зависит
/// вертикальное положение всей сетки, и расхождение даёт скачок содержимого ровно
/// в тот момент, когда читатель начал в него вглядываться. Тест сравнивает её с
/// НАСТОЯЩИМ блоком, а не с числом, — поэтому когда `price_distribution`
/// перестанет быть `deferred` и трёхстрочная сноска про цены исчезнет, он упадёт
/// и потребует пересчёта, а не промолчит.
///
/// Высота заглушки переписи — приблизительная, и это честно: настоящая панель
/// растёт от числа ключей. Обещание здесь — «ниже сетки будет ещё один блок», а
/// не «он будет ровно такой».
class _HealthSkeleton extends StatelessWidget {
  const _HealthSkeleton();

  static const double _summaryBarHeight = 90;
  static const double _censusPanelHeight = 120;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          // 90, а не 80: столько занимает настоящий HealthSummaryBar (18 + 44 +
          // 18 + рамка). На восьмидесяти всё содержимое ниже подпрыгивало на
          // десять пикселей в момент прихода данных.
          Container(
            height: _summaryBarHeight,
            decoration: AppTheme.canonPanelDecoration(),
          ),
          const SizedBox(height: 18),
          LayoutBuilder(
            builder: (context, constraints) {
              const gap = _SignalGrid._gap;
              final width = _SignalGrid.cardWidth(constraints.maxWidth);
              return Wrap(
                spacing: gap,
                runSpacing: gap,
                children: <Widget>[
                  for (var i = 0; i < kQualitySignals.length; i++)
                    SizedBox(
                      width: width,
                      child: const QualitySignalCardSkeleton(),
                    ),
                ],
              );
            },
          ),
          const SizedBox(height: 18),
          // Панель переписи в скелетоне была пропущена, и после прихода данных
          // снизу «вырастал» целый блок, которого заглушка не обещала.
          Container(
            height: _censusPanelHeight,
            decoration: AppTheme.canonCardDecoration(),
            padding: const EdgeInsets.all(18),
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                SkeletonBlock(width: 220, height: 17, radius: 6),
                SizedBox(height: 14),
                SkeletonBlock.line(
                  widthFactor: 0.8,
                  height: 26,
                  shade: SkeletonShade.weak,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
