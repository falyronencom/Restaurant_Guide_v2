import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/moderation_vocabulary.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/providers/menu_items_moderation_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_filter_dropdown.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_screen_header.dart';
import 'package:restaurant_guide_admin_web/widgets/menu_items/flagged_menu_items_list_panel.dart';
import 'package:restaurant_guide_admin_web/widgets/menu_items/menu_item_detail_panel.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_error_toast.dart';

/// Экран «Позиции меню» — очередь позиций с флагом проверки и разбор выбранной.
///
/// Шапка держит всё, что относится к экрану целиком: сколько позиций и какую
/// именно область показывает список, поиск и три фильтра. В панели остаётся
/// только то, что принадлежит ей одной.
class MenuItemsModerationScreen extends StatefulWidget {
  const MenuItemsModerationScreen({super.key});

  @override
  State<MenuItemsModerationScreen> createState() =>
      _MenuItemsModerationScreenState();
}

class _MenuItemsModerationScreenState extends State<MenuItemsModerationScreen> {
  late final MenuItemsModerationProvider _provider;
  VoidCallback? _dismissToast;
  String? _reportedError;

  @override
  void initState() {
    super.initState();
    _provider = context.read<MenuItemsModerationProvider>();
    _provider.addListener(_onProviderChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _provider.loadFlaggedItems();
    });
  }

  @override
  void dispose() {
    _provider.removeListener(_onProviderChanged);
    _dismissToast?.call();
    super.dispose();
  }

  /// Сбой обновления при живом списке — тост, а не карточка ошибки.
  ///
  /// Карточка занимает всё тело и потому уместна, только когда показывать
  /// больше нечего. Если очередь на экране есть, а перечитка не прошла, без
  /// тоста видно лишь, что нажатие «ничего не сделало».
  void _onProviderChanged() {
    // Неудача ДЕЙСТВИЯ показывается тем же тостом и тем же владельцем. Панель
    // разбора показывать его не может: она размонтируется вместе с выбранной
    // позицией — та уходит из выборки при первом же переключении области, — и
    // кнопка «Ещё раз» осталась бы висеть с мёртвым контекстом.
    final actionFailure = _provider.actionError;
    final loadFailure = _provider.hasLoaded ? _provider.error : null;
    final message = actionFailure ?? loadFailure;

    if (message == null) {
      _reportedError = null;
      return;
    }
    if (message == _reportedError) return;

    _reportedError = message;
    final isAction = actionFailure != null;

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _dismissToast?.call();
      _dismissToast = showAdminErrorToast(
        context,
        title: isAction ? message : 'Список не обновился',
        message: isAction
            // Повтора у действия нет намеренно: кнопка, которая его запускает,
            // стоит рядом и уже вернулась в рабочее состояние.
            ? 'Очередь не изменилась. Попробуйте ещё раз.'
            : '$message. Позиции на экране остались от прошлой загрузки.',
        onRetry: isAction ? null : () => _provider.refresh(),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<MenuItemsModerationProvider>();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        AdminScreenHeader(
          title: 'Позиции меню',
          subtitle: _subtitle(provider),
          busy: provider.isRefreshing,
          actions: <Widget>[
            const _QueueSearchField(),
            AdminFilterDropdown<String>(
              value: provider.cityFilter,
              emptyLabel: 'Все города',
              options: <AdminFilterOption<String>>[
                const AdminFilterOption<String>(value: null, label: 'Все города'),
                for (final city in _cityOptions(provider))
                  AdminFilterOption<String>(value: city, label: city),
              ],
              onChanged: provider.setCityFilter,
            ),
            AdminFilterDropdown<String>(
              value: provider.reasonFilter,
              emptyLabel: 'Все причины',
              options: <AdminFilterOption<String>>[
                const AdminFilterOption<String>(value: null, label: 'Все причины'),
                for (final reason in provider.availableReasons)
                  AdminFilterOption<String>(
                    value: reason,
                    // Незнакомый код показывается кодом: так расхождение между
                    // каноном бэкенда и словарём видно, а не спрятано.
                    label: sanityFlagLabel(reason),
                  ),
              ],
              onChanged: provider.setReasonFilter,
            ),
            _VisibilityFilter(provider: provider),
          ],
        ),
        const Expanded(
          child: Row(
            children: <Widget>[
              FlaggedMenuItemsListPanel(),
              Expanded(child: MenuItemDetailPanel()),
            ],
          ),
        ),
      ],
    );
  }

  /// Варианты города — из ответа, но с выбранным значением обязательно.
  ///
  /// Сервер держит выбранный город в списке сам, однако на неудачной загрузке
  /// список остаётся прежним, а фильтр уже выставлен. Пилюля тогда рисуется
  /// активной и подписывается «Все города» — значение, которого нет среди
  /// вариантов, интерфейсу нечем показать.
  List<String> _cityOptions(MenuItemsModerationProvider provider) {
    final city = provider.cityFilter;
    final cities = provider.availableCities;
    if (city == null || cities.contains(city)) return cities;
    return <String>[...cities, city]..sort();
  }

  /// Подпись описывает ЗАГРУЖЕННОЕ окно, а не выставленные фильтры.
  ///
  /// Если обновление не прошло, на экране остаётся прежняя выборка — и подпись
  /// обязана остаться её подписью, иначе число будет описывать список, которого
  /// никто не видит. О самом сбое говорит тост.
  ///
  /// Область называется вслух всегда. Раньше её приходилось угадывать: бейдж
  /// рейла считал нескрытые, а список показывал и скрытые, и разница ничем не
  /// объяснялась.
  String? _subtitle(MenuItemsModerationProvider provider) {
    if (!provider.hasLoaded) return null;

    final total = provider.loadedTotal;
    final hidden = provider.loadedHiddenCount;
    final visible = provider.loadedVisibleCount;

    if (total == 0) {
      if (provider.loadedNarrowed) return 'Под фильтром ничего не нашлось';
      return switch (provider.loadedVisibility) {
        MenuItemVisibility.visible => 'Неразобранных позиций нет',
        MenuItemVisibility.hidden => 'Скрытых позиций нет',
        MenuItemVisibility.all => 'Позиций с флагом нет',
      };
    }

    final count = countWithNoun(total, 'позиция', 'позиции', 'позиций');
    final head = provider.loadedNarrowed
        ? '$count с флагом под фильтром'
        : '$count с флагом';

    return switch (provider.loadedVisibility) {
      MenuItemVisibility.visible => hidden != null && hidden > 0
          ? '$head · показаны нескрытые, ещё ${formatCount(hidden)} скрыто'
          : '$head · показаны нескрытые',
      MenuItemVisibility.hidden => visible != null && visible > 0
          ? '$head · только скрытые, в очереди ещё ${formatCount(visible)}'
          : '$head · только скрытые',
      MenuItemVisibility.all => hidden != null && hidden > 0
          ? '$head · вместе со скрытыми, из них ${formatCount(hidden)} скрыто'
          : '$head · вместе со скрытыми',
    };
  }
}

/// Фильтр области. Называется «Видимость», а не «Статус».
///
/// «Активные» здесь — не скрытые модератором, тогда как «активное» у
/// заведения означает статус в каталоге. Одно слово на две оси уже путало:
/// в очереди при отборе «Активные» законно стоят позиции заведений на
/// модерации и приостановленных.
class _VisibilityFilter extends StatelessWidget {
  final MenuItemsModerationProvider provider;

  const _VisibilityFilter({required this.provider});

  @override
  Widget build(BuildContext context) {
    return AdminFilterDropdown<MenuItemVisibility>(
      label: 'Видимость',
      // «Все» — тоже осознанный выбор области, а не снятый фильтр, поэтому
      // значение непустое всегда, и пилюля всегда выглядит активной.
      value: provider.visibility,
      emptyLabel: 'Все',
      options: const <AdminFilterOption<MenuItemVisibility>>[
        AdminFilterOption<MenuItemVisibility>(
          value: MenuItemVisibility.visible,
          label: 'Активные',
        ),
        AdminFilterOption<MenuItemVisibility>(
          value: MenuItemVisibility.hidden,
          label: 'Скрытые',
        ),
        AdminFilterOption<MenuItemVisibility>(
          value: MenuItemVisibility.all,
          label: 'Все',
        ),
      ],
      onChanged: (value) =>
          provider.setVisibility(value ?? MenuItemVisibility.all),
    );
  }
}

/// Поиск по названию позиции или заведения.
///
/// Запрос уходит на сервер, поэтому не на каждую букву: пауза 350 мс после
/// последнего нажатия. Без неё «драники» — это восемь запросов, из которых
/// семь устарели ещё до ответа.
class _QueueSearchField extends StatefulWidget {
  const _QueueSearchField();

  static const double width = 280;

  @override
  State<_QueueSearchField> createState() => _QueueSearchFieldState();
}

OutlineInputBorder _searchBorder(Color color, {double width = 1}) =>
    OutlineInputBorder(
      borderRadius: BorderRadius.circular(AppTheme.radiusControl),
      borderSide: BorderSide(color: color, width: width),
    );

class _QueueSearchFieldState extends State<_QueueSearchField> {
  final TextEditingController _controller = TextEditingController();
  late final MenuItemsModerationProvider _provider;
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _provider = context.read<MenuItemsModerationProvider>();
    _controller.text = _provider.searchFilter;
    _provider.addListener(_syncFromProvider);
  }

  /// Поле следует за провайдером, а не только ведёт его.
  ///
  /// Сбросить отбор можно и мимо этого поля — кнопкой «Сбросить фильтры» в
  /// пустой очереди. Без синхронизации список после сброса наполнялся, а в
  /// шапке оставалось слово с крестиком: поле утверждало отбор, которого уже
  /// нет. Тот же дефект чинили на кадре 07, там сброс чистит обе половины.
  ///
  /// Пока идёт задержка ввода, поле не трогается: провайдер ещё не знает про
  /// последние буквы, и подстановка увела бы курсор в конец на каждом слове.
  void _syncFromProvider() {
    if (_debounce?.isActive ?? false) return;
    final value = _provider.searchFilter;
    if (value == _controller.text.trim()) return;
    _controller.text = value;
    setState(() {});
  }

  @override
  void dispose() {
    _provider.removeListener(_syncFromProvider);
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _onChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      if (!mounted) return;
      _provider.setSearchFilter(value.trim());
    });
  }

  void _clear() {
    _debounce?.cancel();
    _controller.clear();
    _provider.setSearchFilter('');
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: _QueueSearchField.width,
      height: 40,
      child: TextField(
        controller: _controller,
        onChanged: (value) {
          _onChanged(value);
          setState(() {}); // крестик очистки появляется и исчезает
        },
        style: const TextStyle(fontSize: 14, color: AppTheme.textDark),
        decoration: InputDecoration(
          hintText: 'Позиция или заведение',
          hintStyle: const TextStyle(fontSize: 14, color: AppTheme.textGrey),
          isDense: true,
          contentPadding: const EdgeInsets.symmetric(vertical: 10),
          // Радиус задан явно всем состояниям: глобальная тема полей держит
          // r12, а поле стоит в одном ряду с пилюлями фильтров на r10, и
          // разница в два пикселя рядом читается как небрежность. Точечно
          // перекрыть только `border` нельзя — остальные состояния наследуют
          // тему и разъезжаются при фокусе.
          border: _searchBorder(AppTheme.strokeGrey),
          enabledBorder: _searchBorder(AppTheme.strokeGrey),
          focusedBorder: _searchBorder(AppTheme.primaryOrange, width: 1.5),
          disabledBorder: _searchBorder(AppTheme.strokeGrey),
          prefixIcon: const Icon(Icons.search, size: 17, color: AppTheme.gray500),
          prefixIconConstraints: const BoxConstraints(minWidth: 38),
          suffixIcon: _controller.text.isEmpty
              ? null
              : IconButton(
                  icon: const Icon(Icons.close, size: 16),
                  color: AppTheme.textSecondary,
                  onPressed: _clear,
                  tooltip: 'Очистить поиск',
                ),
        ),
      ),
    );
  }
}
