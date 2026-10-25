import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/category_icons.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/moderation_vocabulary.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/models/flagged_menu_item.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/providers/menu_items_moderation_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/media/media_viewer.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/status_dot.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_inline_spinner.dart';

/// Панель разбора выбранной позиции: факты, флаг и два действия.
class MenuItemDetailPanel extends StatelessWidget {
  const MenuItemDetailPanel({super.key});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<MenuItemsModerationProvider>();
    final selected = provider.selected;
    // Просмотрщику действий не показываем: сервер ответил бы 403, а кнопка,
    // обещающая то, что не выполнится, читается как поломка.
    final canModerate = context.watch<AuthProvider>().canModerate;

    if (selected == null) return const _NothingSelected();

    return SingleChildScrollView(
      // Ключ по позиции: панель живёт в постоянном слоте, и без него прокрутка,
      // домотанная до действий у длинного флага, переезжала бы на следующую
      // позицию — та открывалась бы уже прокрученной.
      key: ValueKey<String>('detail-${selected.id}'),
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          _Heading(item: selected),
          if (selected.menuFile != null) ...<Widget>[
            const SizedBox(height: 12),
            // Флаг сверяется с самим меню: ошибка распознавания или правда
            // такая цена (A1-08).
            OutlinedButton.icon(
              key: const ValueKey<String>('open-menu-file'),
              onPressed: () => showMediaViewer(
                context,
                items: <MediaItem>[selected.menuFile!],
                title: 'Меню',
              ),
              icon: Icon(
                selected.menuFile!.isPdf
                    ? Icons.picture_as_pdf_outlined
                    : Icons.image_outlined,
                size: 18,
              ),
              label: Text(
                selected.menuFile!.isPdf
                    ? 'Открыть файл меню (PDF)'
                    : 'Открыть фото меню',
              ),
              style: AppTheme.canonCtaOutlined(),
            ),
          ],
          const SizedBox(height: 20),
          _FactGrid(item: selected),
          const SizedBox(height: 20),
          _FlagPanel(item: selected),
          if (selected.isHiddenByAdmin) ...<Widget>[
            const SizedBox(height: 20),
            _HiddenNotice(item: selected),
          ],
          if (canModerate) ...<Widget>[
            const SizedBox(height: 24),
            _Actions(provider: provider, item: selected),
          ],
        ],
      ),
    );
  }
}

/// Позиция не выбрана.
///
/// Витринные `AdminEmptyState` сюда не подходят ни одним из двух режимов: это
/// не «раздел не запущен» и не «фильтр ничего не нашёл», а приглашение выбрать
/// строку слева. Поэтому сообщение своё, но собрано из канонических токенов.
class _NothingSelected extends StatelessWidget {
  const _NothingSelected();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Padding(
        padding: EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(Icons.restaurant_menu, size: 32, color: AppTheme.textGrey),
            SizedBox(height: 12),
            Text('Позиция не выбрана', style: AppTheme.canonSubsectionHeader),
            SizedBox(height: 6),
            Text(
              'Выберите позицию в очереди слева, чтобы разобрать флаг.',
              style: TextStyle(
                fontSize: 13,
                color: AppTheme.textSecondary,
                height: 1.4,
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

/// Заголовок: название блюда и строка происхождения.
class _Heading extends StatelessWidget {
  final FlaggedMenuItem item;

  const _Heading({required this.item});

  @override
  Widget build(BuildContext context) {
    final asset = iconAssetForEstablishment(
      categories: item.establishmentCategories,
      cuisines: item.establishmentCuisines,
    );
    final city = item.establishmentCity;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          item.itemName,
          style: AppTheme.canonSectionHeader,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        const SizedBox(height: 8),
        Row(
          children: <Widget>[
            if (asset != null)
              SvgPicture.asset(
                asset,
                width: 14,
                height: 14,
                colorFilter: const ColorFilter.mode(
                  AppTheme.textSecondary,
                  BlendMode.srcIn,
                ),
              )
            else
              const Icon(Icons.storefront_outlined,
                  size: 14, color: AppTheme.textSecondary),
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                item.establishmentName,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: AppTheme.textDark,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            if (city != null && city.isNotEmpty) ...<Widget>[
              const _MetaDot(),
              Flexible(
                child: Text(
                  city,
                  style: const TextStyle(fontSize: 14, color: AppTheme.textSecondary),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
            const _MetaDot(),
            // Дата тоже гибкая: строка целиком (название + город + отметка)
            // на узком окне не помещается, и жёсткий хвост её переполнял.
            Flexible(
              child: Text(
                // «14 июля, 09:41» — как в кадре. Месяц берётся из ручного списка
                // родительного падежа (`formatters.dart`): `DateFormat('MMMM')`
                // дал бы «14 июль» и падал бы в виджет-тесте без делегатов локали.
                // «распознано», не «распарсено» — жаргон разработчика
                // (A1-20, Ч25). Полная строка — подсказкой.
                'распознано ${formatDayMonthLocal(item.createdAt)}, '
                '${formatTimeLocal(item.createdAt)}',
                style: const TextStyle(fontSize: 14, color: AppTheme.textSecondary),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _MetaDot extends StatelessWidget {
  const _MetaDot();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(horizontal: 8),
      child: Text('·', style: TextStyle(color: AppTheme.textGrey)),
    );
  }
}

/// Факт-грид 2×2 — то, по чему принимается решение.
///
/// В кадре четвёртой ячейкой стоит «Медиана категории», но её не считает
/// никто: в `details` ценовых правил лежат цена и порог, а распределение цен
/// в здоровье данных — заглушка до боевых пятисот заведений. Вместо
/// выдуманного числа стоит настоящее — состояние заведения: оно отвечает на
/// вопрос, видит ли это блюдо хоть кто-нибудь, и меняет цену разбора.
class _FactGrid extends StatelessWidget {
  final FlaggedMenuItem item;

  const _FactGrid({required this.item});

  @override
  Widget build(BuildContext context) {
    final price = item.priceByn;
    final confidence = item.confidence;
    final status = item.establishmentStatus;

    final facts = <Widget>[
      _Fact(
        icon: Icons.payments_outlined,
        label: 'Цена в меню',
        value: price == null ? null : '${formatMoney(price)} BYN',
        emptyValue: 'не распозналась',
      ),
      _Fact(
        icon: Icons.category_outlined,
        // Раздел меню так, как он прочитался в файле: «OCR» — слово
        // разработчика (A1-20, Ч25).
        label: 'Раздел в меню',
        value: item.categoryRaw,
        emptyValue: 'не распознан',
      ),
      _Fact(
        icon: Icons.verified_outlined,
        label: 'Уверенность распознавания',
        value: confidence == null ? null : '${(confidence * 100).round()}%',
        emptyValue: 'не сообщена',
        // Цветом отмечается ровно то, из-за чего позиция в очереди.
        // Зелёного здесь нет: порог живёт на сервере, и красить
        // «хорошо» пришлось бы по выдуманной границе.
        valueColor: item.sanityReason == 'low_confidence'
            ? AppTheme.disclaimerText
            : null,
      ),
      _Fact(
        icon: Icons.storefront_outlined,
        label: 'Состояние заведения',
        value: status == null ? null : StatusDot.labelFor(status),
        emptyValue: 'неизвестно',
        valueColor: status == null ? null : StatusDot.colorFor(status),
      ),
    ];

    // На окне 1024 правой части остаётся ≈ 344 px: в две колонки подпись
    // «Уверенность распознавания» рвалась посреди слова (F-03, Ч-проход).
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: AppTheme.canonPanelDecoration(radius: AppTheme.radiusShowcase),
      child: LayoutBuilder(
        builder: (context, constraints) {
          if (constraints.maxWidth < twoColumnsMinWidth) {
            return Column(
              children: <Widget>[
                for (var i = 0; i < facts.length; i++) ...<Widget>[
                  if (i > 0) const SizedBox(height: 14),
                  facts[i],
                ],
              ],
            );
          }
          return Column(
            children: <Widget>[
              for (var row = 0; row < 2; row++) ...<Widget>[
                if (row > 0) const SizedBox(height: 16),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Expanded(child: facts[row * 2]),
                    const SizedBox(width: 16),
                    Expanded(child: facts[row * 2 + 1]),
                  ],
                ),
              ],
            ],
          );
        },
      ),
    );
  }

  /// Уже этой ширины факты стоят в одну колонку.
  static const double twoColumnsMinWidth = 460;
}

class _Fact extends StatelessWidget {
  final IconData icon;
  final String label;
  final String? value;
  final String emptyValue;
  final Color? valueColor;

  const _Fact({
    required this.icon,
    required this.label,
    required this.value,
    required this.emptyValue,
    this.valueColor,
  });

  @override
  Widget build(BuildContext context) {
    final text = value;

    return Row(
      children: <Widget>[
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: AppTheme.backgroundPrimary,
            borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
          ),
          alignment: Alignment.center,
          child: Icon(icon, size: 20, color: AppTheme.primaryOrange),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(label, style: AppTheme.canonFieldLabel),
              const SizedBox(height: 2),
              Text(
                text ?? emptyValue,
                // Канонический стиль значения-для-чтения; свой цвет ставится
                // только там, где он несёт смысл (причина флага, статус).
                style: text == null
                    ? AppTheme.canonFieldValueEmpty
                    : valueColor == null
                        ? AppTheme.canonFieldValue
                        : AppTheme.canonFieldValue.copyWith(color: valueColor),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// Панель флага: правило человеческим языком плюс исходная запись под спойлером.
class _FlagPanel extends StatelessWidget {
  final FlaggedMenuItem item;

  const _FlagPanel({required this.item});

  @override
  Widget build(BuildContext context) {
    final flag = item.sanityFlag;

    if (flag == null || flag.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(16),
        decoration: AppTheme.canonCardDecoration(),
        child: const Row(
          children: <Widget>[
            Icon(Icons.check_circle_outline,
                size: 18, color: AppTheme.statusGreen),
            SizedBox(width: 8),
            Text(
              'Флаг снят',
              style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w600,
                color: AppTheme.textPrimary,
              ),
            ),
            SizedBox(width: 8),
            // Прежде здесь стояло «остаётся в очереди до обновления списка»,
            // но список перечитывается сразу после действия (A1-23). Сюда
            // попадают, только если перечитка не прошла, — об этом и речь.
            Expanded(
              child: Text(
                'Список не обновился — позиция уйдёт из очереди при '
                'следующем обновлении.',
                style: TextStyle(fontSize: 13, color: AppTheme.textSecondary),
              ),
            ),
          ],
        ),
      );
    }

    final reason = item.sanityReason;

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: AppTheme.canonCardDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              const Icon(Icons.flag_outlined, size: 18, color: AppTheme.errorRed),
              const SizedBox(width: 8),
              const Text(
                'Флаг проверки',
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                  color: AppTheme.textPrimary,
                ),
              ),
              // В чипе — НАЗВАНИЕ правила, в теле — фраза с числами. Разделение
              // не косметическое: сначала оба места печатали одну и ту же фразу,
              // и панель дважды говорила одно и то же на разных кеглях.
              if (reason != null) ...<Widget>[
                const SizedBox(width: 10),
                Flexible(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: AppTheme.errorTint(0.10),
                      borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
                    ),
                    child: Text(
                      sanityFlagLabel(reason),
                      style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: AppTheme.errorRed,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: 12),
          // Ключ по идентификатору обязателен: панель живёт в постоянном слоте
          // экрана, и при переходе к другой позиции Flutter переиспользует то же
          // состояние. Без ключа раскрытая исходная запись оставалась бы
          // раскрытой на следующей позиции, а автораскрытие для незнакомого
          // правила — наоборот, не срабатывало бы.
          _FlagExplanation(
            key: ValueKey<String>(item.id),
            flag: flag,
          ),
        ],
      ),
    );
  }
}

/// Позиция скрыта — disclaimer-пара канона и причина.
class _HiddenNotice extends StatelessWidget {
  final FlaggedMenuItem item;

  const _HiddenNotice({required this.item});

  @override
  Widget build(BuildContext context) {
    final reason = item.hiddenReason;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.disclaimerBg,
        borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Row(
            children: <Widget>[
              Icon(Icons.visibility_off_outlined,
                  size: 18, color: AppTheme.disclaimerText),
              SizedBox(width: 8),
              Text(
                'Позиция скрыта из поиска',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: AppTheme.disclaimerText,
                ),
              ),
            ],
          ),
          if (reason != null && reason.isNotEmpty) ...<Widget>[
            const SizedBox(height: 6),
            Text(
              reason,
              style: const TextStyle(fontSize: 13, color: AppTheme.disclaimerText),
            ),
          ],
        ],
      ),
    );
  }
}

/// Действия: скрыть/показать и снять флаг.
class _Actions extends StatelessWidget {
  final MenuItemsModerationProvider provider;
  final FlaggedMenuItem item;

  const _Actions({required this.provider, required this.item});

  bool get _hasFlag => item.sanityFlag != null && item.sanityFlag!.isNotEmpty;

  @override
  Widget build(BuildContext context) {
    final busy = provider.isSubmittingAction;

    return Wrap(
      spacing: 10,
      runSpacing: 10,
      children: <Widget>[
        if (!item.isHiddenByAdmin)
          FilledButton.icon(
            onPressed: busy ? null : () => _hide(context),
            style: AppTheme.canonCtaL(backgroundColor: AppTheme.errorRed),
            icon: const Icon(Icons.visibility_off_outlined, size: 19),
            label: const Text('Скрыть позицию'),
          )
        else
          FilledButton.icon(
            onPressed: busy ? null : () => _unhide(context),
            style: AppTheme.canonCtaL(backgroundColor: AppTheme.statusGreen),
            icon: const Icon(Icons.visibility_outlined, size: 19),
            label: const Text('Показать снова'),
          ),
        if (_hasFlag)
          OutlinedButton.icon(
            onPressed: busy ? null : () => _dismiss(context),
            style: AppTheme.canonCtaOutlined(),
            icon: const Icon(Icons.flag_outlined, size: 19),
            label: const Text('Снять флаг'),
          ),
        // Заблокированная кнопка сама по себе читается как «нельзя», а не как
        // «идёт». Канон держит спиннер 16 ровно для этого случая — рядом с
        // действием, а не на всю область.
        if (busy)
          const SizedBox(
            height: 48,
            child: Center(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  AdminInlineSpinner.overContent(),
                  SizedBox(width: 8),
                  Text(
                    'выполняем',
                    style: TextStyle(fontSize: 13, color: AppTheme.textSecondary),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  // ==========================================================================
  // Диалоги и завершение действия
  // ==========================================================================

  Future<void> _hide(BuildContext context) async {
    final reason = await showDialog<String>(
      context: context,
      builder: (_) => _HideDialog(itemName: item.itemName),
    );
    if (reason == null || !context.mounted) return;

    await _run(context, action: () => provider.hideItem(item.id, reason));
  }

  Future<void> _unhide(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => _ConfirmDialog(
        title: 'Показать снова?',
        message: 'Позиция «${item.itemName}» вернётся в результаты поиска — '
            '$kCopiesClause, скрытыми с той же причиной.',
        confirmLabel: 'Показать',
        confirmColor: AppTheme.statusGreen,
      ),
    );
    if (confirmed != true || !context.mounted) return;

    await _run(context, action: () => provider.unhideItem(item.id));
  }

  Future<void> _dismiss(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => _ConfirmDialog(
        title: 'Снять флаг?',
        message: 'Флаг снимется с позиции «${item.itemName}» и с её повторов в других файлах '
            'меню того же заведения — гость видит их одной строкой. Позиции '
            'уйдут из очереди. Скрытие и его причина, если они есть, '
            'останутся без изменений.',
        confirmLabel: 'Снять флаг',
        confirmColor: AppTheme.primaryOrangeDark,
      ),
    );
    if (confirmed != true || !context.mounted) return;

    await _run(context, action: () => provider.dismissFlag(item.id));
  }

  /// Общий хвост действия: обновить бейдж рейла.
  ///
  /// Об успехе не сообщается: он виден сам — позиция уходит из очереди или
  /// меняет вид, а счётчики в шапке пересчитываются. Тост об удаче перекрыл бы
  /// собой ровно то, что подтверждает.
  ///
  /// О неудаче сообщает ЭКРАН, а не панель: панель размонтируется вместе с
  /// выбранной позицией — достаточно переключить область, — и кнопка «Ещё раз»
  /// осталась бы висеть с мёртвым контекстом. Экран же снимает свой тост в
  /// `dispose`.
  Future<void> _run(
    BuildContext context, {
    required Future<bool> Function() action,
  }) async {
    // Провайдер бейджей читается ДО ожидания: после него этого элемента может
    // уже не быть в дереве.
    final badges = context.read<BadgesProvider>();
    final ok = await action();

    // Скрытие и снятие флага меняют счётчик «Позиции меню» в рейле — серверный
    // кэш бейджей эти пути записи уже сбрасывают, осталось перечитать.
    if (ok) badges.load();
  }
}

/// Действия над позицией доходят до её повторов: одно меню, загруженное
/// фото и PDF, гость видит одной строкой (PR #107, правило копий). До
/// 21.10.2026 диалоги об этом молчали, и в очереди пропадало сразу
/// несколько строк (пункт A1-07).
const String kCopiesClause =
    'вместе с повторами этой строки в других файлах меню';

/// Подтверждение без ввода.
class _ConfirmDialog extends StatelessWidget {
  final String title;
  final String message;
  final String confirmLabel;
  final Color confirmColor;

  const _ConfirmDialog({
    required this.title,
    required this.message,
    required this.confirmLabel,
    required this.confirmColor,
  });

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(title, style: AppTheme.canonSheetTitle),
      content: SizedBox(
        width: 420,
        child: Text(
          message,
          style: const TextStyle(fontSize: 14, color: AppTheme.textDark),
        ),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Отмена'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(true),
          style: FilledButton.styleFrom(backgroundColor: confirmColor),
          child: Text(confirmLabel),
        ),
      ],
    );
  }
}

/// Скрытие позиции: причина обязательна, минимум 10 символов.
///
/// Диалог владеет своим контроллером — «создал, освободи» держится только
/// целиком, и `showDialog(...).whenComplete(dispose)` здесь не годится: future
/// завершается на попе маршрута, а тот ещё уезжает анимацией, и тронутое поле
/// перестраивается уже после `dispose`.
///
/// Кнопка следует за полем, а не выходит по `return` при короткой причине:
/// активная кнопка, молча не реагирующая на нажатие, читается как поломка.
/// Рядом написано, чего именно не хватает.
class _HideDialog extends StatefulWidget {
  final String itemName;

  const _HideDialog({required this.itemName});

  static const int minReasonLength = 10;

  @override
  State<_HideDialog> createState() => _HideDialogState();
}

class _HideDialogState extends State<_HideDialog> {
  final TextEditingController _reasonController = TextEditingController();

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Скрыть позицию?', style: AppTheme.canonSheetTitle),
      content: SizedBox(
        width: 480,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              'Позиция «${widget.itemName}» перестанет показываться в поиске — '
              '$kCopiesClause. Флаг проверки при этом останется.',
              style: const TextStyle(fontSize: 14, color: AppTheme.textDark),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _reasonController,
              autofocus: true,
              maxLines: 3,
              decoration: const InputDecoration(
                hintText: 'Причина скрытия — её увидит следующий модератор',
              ),
            ),
          ],
        ),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Отмена'),
        ),
        // Значение читается через сам контроллер: он и есть источник истины, а
        // `setState` на каждое нажатие клавиши перерисовывал бы диалог целиком
        // ради одной кнопки.
        ValueListenableBuilder<TextEditingValue>(
          valueListenable: _reasonController,
          builder: (context, value, _) {
            final reason = value.text.trim();
            final missing = _HideDialog.minReasonLength - reason.length;

            return Row(
              mainAxisSize: MainAxisSize.min,
              spacing: 10,
              children: <Widget>[
                if (missing > 0)
                  Text(
                    reason.isEmpty
                        ? 'Нужна причина'
                        : 'Ещё ${countWithNoun(missing, 'символ', 'символа', 'символов')}',
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppTheme.textSecondary,
                    ),
                  ),
                FilledButton(
                  onPressed:
                      missing > 0 ? null : () => Navigator.of(context).pop(reason),
                  style: FilledButton.styleFrom(
                    backgroundColor: AppTheme.errorRed,
                    disabledBackgroundColor: AppTheme.strokeGrey,
                    disabledForegroundColor: AppTheme.textSecondary,
                  ),
                  child: const Text('Скрыть'),
                ),
              ],
            );
          },
        ),
      ],
    );
  }
}

/// Флаг проверки человеческими строками; исходная запись — под «Скопировать
/// код» (Ч26, проход 20.10; приём `AdminErrorCard`).
///
/// До 21.10.2026 под спойлером «Исходная запись» лежал `JsonEncoder` — сырой
/// JSON на экране модератора (`price_below_threshold`, `threshold`). Он честно
/// показывает всё и ровно поэтому не сообщает ничего. Теперь на экране —
/// фраза с числами и строка о пороге, а запись целиком уходит в буфер обмена
/// кнопкой: разработчику она нужна, модератору — нет.
///
/// Правило, которого панель не знает, кодом на экран тоже не выходит: строка
/// говорит, что причина незнакома, и называет её — расхождение словаря с
/// каноном видно, а JSON по-прежнему только в буфере.
class _FlagExplanation extends StatefulWidget {
  final Map<String, dynamic> flag;

  const _FlagExplanation({super.key, required this.flag});

  @override
  State<_FlagExplanation> createState() => _FlagExplanationState();
}

class _FlagExplanationState extends State<_FlagExplanation> {
  bool _copied = false;

  Future<void> _copy() async {
    await Clipboard.setData(
      ClipboardData(text: const JsonEncoder.withIndent('  ').convert(widget.flag)),
    );
    if (mounted) setState(() => _copied = true);
  }

  @override
  Widget build(BuildContext context) {
    final lines = flagExplanationLines(widget.flag);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        for (var i = 0; i < lines.length; i++)
          Padding(
            padding: EdgeInsets.only(top: i == 0 ? 0 : 4),
            child: Text(
              lines[i],
              style: TextStyle(
                fontSize: i == 0 ? 14 : 13,
                color: i == 0 ? AppTheme.textDark : AppTheme.textSecondary,
              ),
            ),
          ),
        const SizedBox(height: 8),
        OutlinedButton(
          key: const ValueKey<String>('flag-copy-code'),
          onPressed: _copy,
          style: OutlinedButton.styleFrom(
            foregroundColor: AppTheme.textDark,
            side: const BorderSide(color: AppTheme.strokeGrey),
            minimumSize: const Size(0, 32),
            padding: const EdgeInsets.symmetric(horizontal: 12),
            textStyle: const TextStyle(
              fontFamily: AppTheme.fontBodyFamily,
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
          ),
          child: Text(_copied ? 'Код скопирован' : 'Скопировать код'),
        ),
      ],
    );
  }
}

/// Строки флага для модератора: фраза с числами и, где есть, строка о пороге.
///
/// Незнакомое правило — одна строка, которая это признаёт и называет код:
/// пустота была бы хуже, а JSON — нечитаем (`feedback_machine_codes_leak_to_moderator`).
List<String> flagExplanationLines(Map<String, dynamic> flag) {
  final phrase = describeSanityFlag(flag);
  final reason = flag['reason'];
  if (phrase == null) {
    final code = reason is String && reason.isNotEmpty ? ' «$reason»' : '';
    return <String>[
      'Причина флага$code панели незнакома — подробности в коде записи.',
    ];
  }
  final details = flag['details'];
  final threshold = details is Map ? details['threshold'] : null;
  if (reason == 'price_delta_anomaly' && threshold is num) {
    final times = threshold == threshold.roundToDouble()
        ? formatCount(threshold.round())
        : formatDecimal(threshold.toDouble(), digits: 1);
    return <String>[
      phrase,
      'Флаг ставится, когда цена меняется больше чем в $times '
          '${threshold == threshold.roundToDouble() ? plural(threshold.round(), 'раз', 'раза', 'раз') : 'раза'}.',
    ];
  }
  return <String>[phrase];
}
