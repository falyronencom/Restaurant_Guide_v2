import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/public_menu_item.dart';
import 'package:restaurant_guide_mobile/providers/establishment_menu_provider.dart';
import 'package:restaurant_guide_mobile/widgets/canon_app_bar.dart';
import 'package:restaurant_guide_mobile/widgets/menu/menu_text.dart';

/// Всё меню заведения отдельным экраном: разделы чипами сверху, под ними
/// меню текстом с ценами, ниже — оригинал (фото и PDF меню).
///
/// Отдельный экран, а не прокрутка в карточке — по рекомендации брифа В3
/// (18.10.2026, §4): длинное меню удобнее читать без героя и отзывов вокруг,
/// а разделы держатся на виду. Шапка и чипы стоят на месте и меню не
/// накрывают (у Resty свернувшаяся шапка накрывает кнопки — не повторяем).
///
/// Данные — у [EstablishmentMenuProvider] карточки: если она уже загрузила
/// меню, второй раз экран за ним не ходит. Загрузку запускает тот, кто
/// открывает экран (кнопка «Меню» карточки), — здесь только показ.
class MenuScreen extends StatefulWidget {
  const MenuScreen({
    super.key,
    required this.establishmentName,
    this.originalsBuilder,
  });

  final String establishmentName;

  /// Фото и PDF меню — те же плитки, что в карточке. `null` — их нет.
  final WidgetBuilder? originalsBuilder;

  static const String originalsTitle = 'Оригинал меню';
  static const String emptyText = 'Меню пока не загружено.';

  @override
  State<MenuScreen> createState() => _MenuScreenState();
}

class _MenuScreenState extends State<MenuScreen> {
  final ScrollController _scroll = ScrollController();
  final GlobalKey _originalsKey = GlobalKey();
  List<GlobalKey> _sectionKeys = const [];
  List<GlobalKey> _chipKeys = const [];

  /// Раздел, чей чип подсвечен.
  int _active = 0;

  /// Пока прокрутка идёт по тапу на чип, подсветку ведёт тап, а не позиция.
  bool _jumping = false;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_syncActiveChip);
  }

  @override
  void dispose() {
    _scroll.removeListener(_syncActiveChip);
    _scroll.dispose();
    super.dispose();
  }

  void _ensureKeys(int count) {
    if (_sectionKeys.length == count) return;
    _sectionKeys = List.generate(count, (_) => GlobalKey());
    _chipKeys = List.generate(count, (_) => GlobalKey());
    if (_active >= count) _active = 0;
  }

  /// Подсвечен последний раздел, чей заголовок уже ушёл к верху списка.
  void _syncActiveChip() {
    if (_jumping || _sectionKeys.isEmpty) return;
    final viewport = _scroll.position.context.storageContext.findRenderObject()
        as RenderBox?;
    if (viewport == null) return;
    final top = viewport.localToGlobal(Offset.zero).dy;
    var active = 0;
    for (var i = 0; i < _sectionKeys.length; i++) {
      final box =
          _sectionKeys[i].currentContext?.findRenderObject() as RenderBox?;
      if (box == null) continue;
      if (box.localToGlobal(Offset.zero).dy <= top + 24) active = i;
    }
    if (active != _active) {
      setState(() => _active = active);
      _revealChip(active);
    }
  }

  void _revealChip(int index) {
    final chip = _chipKeys[index].currentContext;
    if (chip == null) return;
    Scrollable.ensureVisible(
      chip,
      alignment: 0.5,
      duration: const Duration(milliseconds: 200),
    );
  }

  Future<void> _jumpTo(GlobalKey key, {int? chip}) async {
    final target = key.currentContext;
    if (target == null) return;
    if (chip != null) {
      setState(() => _active = chip);
      _revealChip(chip);
    }
    _jumping = true;
    try {
      await Scrollable.ensureVisible(
        target,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeInOut,
      );
    } finally {
      _jumping = false;
    }
    // Переход не по чипу («Оригинал») — подсветка по тому, где оказались.
    if (chip == null && mounted) _syncActiveChip();
  }

  @override
  Widget build(BuildContext context) {
    final menu = context.watch<EstablishmentMenuProvider>();
    final sections = menu.status == MenuLoadStatus.loaded
        ? menu.sections
        : const <MenuSection>[];
    _ensureKeys(sections.length);
    final hasOriginals = widget.originalsBuilder != null;
    // Один раздел — переходить некуда, чипы не нужны.
    final showChips = sections.length > 1;

    return Scaffold(
      backgroundColor: AppTheme.backgroundWarm,
      appBar: CanonAppBar(
        title: 'Меню',
        actions: [
          if (hasOriginals)
            TextButton(
              onPressed: () => _jumpTo(_originalsKey),
              style: TextButton.styleFrom(
                foregroundColor: AppTheme.primaryOrange,
              ),
              child: const Text(
                'Оригинал',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
              ),
            ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (showChips)
            SizedBox(
              height: 52,
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Row(
                  children: [
                    for (var i = 0; i < sections.length; i++)
                      Padding(
                        key: _chipKeys[i],
                        padding: const EdgeInsets.only(right: 8),
                        child: _SectionChip(
                          label: sections[i].title ?? 'Без раздела',
                          selected: i == _active,
                          onTap: () => _jumpTo(_sectionKeys[i], chip: i),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          Expanded(
            // Не ListView.builder: к разделу прокручиваем по его ключу, а
            // ключ есть только у построенного виджета. Позиций в меню —
            // десятки, редко сотни строк текста.
            child: SingleChildScrollView(
              controller: _scroll,
              padding: EdgeInsets.fromLTRB(
                16,
                showChips ? 4 : 12,
                16,
                24 + MediaQuery.paddingOf(context).bottom,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    widget.establishmentName,
                    style: const TextStyle(
                      fontSize: 15,
                      color: AppTheme.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 12),
                  ..._buildText(menu, sections, hasOriginals),
                  if (hasOriginals) ...[
                    const SizedBox(height: 28),
                    Text(
                      MenuScreen.originalsTitle,
                      key: _originalsKey,
                      style: const TextStyle(
                        fontFamily: AppTheme.fontDisplayFamily,
                        fontSize: 20,
                        fontWeight: FontWeight.w400,
                        color: AppTheme.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 14),
                    widget.originalsBuilder!(context),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _buildText(
    EstablishmentMenuProvider menu,
    List<MenuSection> sections,
    bool hasOriginals,
  ) {
    switch (menu.status) {
      case MenuLoadStatus.idle:
      case MenuLoadStatus.loading:
        return const [MenuLoadingBox()];
      case MenuLoadStatus.failed:
        return [MenuLoadFailedBox(onRetry: menu.ensureLoaded)];
      case MenuLoadStatus.loaded:
        if (sections.isEmpty) {
          // Распознанного меню нет — как раньше: только фото и PDF.
          return hasOriginals
              ? const []
              : const [
                  Text(
                    MenuScreen.emptyText,
                    style:
                        TextStyle(fontSize: 15, color: AppTheme.textSecondary),
                  ),
                ];
        }
        return [
          const Align(
            alignment: Alignment.centerLeft,
            child: MenuAutoExtractedNote(),
          ),
          for (var i = 0; i < sections.length; i++) ...[
            const SizedBox(height: 20),
            KeyedSubtree(
              key: _sectionKeys[i],
              child: MenuSectionView(section: sections[i]),
            ),
          ],
        ];
    }
  }
}

class _SectionChip extends StatelessWidget {
  const _SectionChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Container(
          constraints: const BoxConstraints(minHeight: 40),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
          decoration: BoxDecoration(
            color: selected ? AppTheme.textDark : AppTheme.backgroundPrimary,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: selected ? AppTheme.textDark : AppTheme.strokeWarm,
            ),
          ),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w500,
              color:
                  selected ? AppTheme.backgroundPrimary : AppTheme.textPrimary,
            ),
          ),
        ),
      ),
    );
  }
}
