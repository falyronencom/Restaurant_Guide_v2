import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/menu_recognition.dart';
import 'package:restaurant_guide_mobile/models/partner_menu_item.dart';
import 'package:restaurant_guide_mobile/providers/partner_menu_provider.dart';
import 'package:restaurant_guide_mobile/screens/profile/delete_account_screen.dart';
import 'package:restaurant_guide_mobile/widgets/canon_app_bar.dart';

/// Partner view of parsed menu items for a single establishment.
/// Component 8, Segment C, Block 1.
///
/// Mounted via EditEstablishmentScreen → "Меню" row.
class PartnerMenuScreen extends StatefulWidget {
  final String establishmentId;

  const PartnerMenuScreen({super.key, required this.establishmentId});

  @override
  State<PartnerMenuScreen> createState() => _PartnerMenuScreenState();
}

class _PartnerMenuScreenState extends State<PartnerMenuScreen> {
  static const Color _bg = AppTheme.backgroundWarm;
  static const Color _primary = AppTheme.primaryOrangeDark;

  /// Ссылка берётся заранее: в dispose экран уже отцеплен от дерева, и
  /// `context.read` там — поиск предка у неактивного элемента (в отладке —
  /// исключение при каждом уходе с экрана).
  late final PartnerMenuProvider _menu;

  /// Экран записался в провайдер — значит, при уходе выписывается.
  bool _attached = false;

  @override
  void initState() {
    super.initState();
    _menu = context.read<PartnerMenuProvider>();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _menu.attachScreen(widget.establishmentId);
      _attached = true;
    });
  }

  @override
  void dispose() {
    // Провайдер общий: последний экран останавливает опрос, верхний над
    // другим — возвращает провайдер к карточке нижнего (detachScreen).
    if (_attached) _menu.detachScreen(widget.establishmentId);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _bg,
      // Каноническая шапка, как у «Акций» и «Бронирований». Своя шапка с
      // заголовком без цвета брала белый из темы (appBarTheme.titleTextStyle
      // перекрывает foregroundColor) — «Меню» белым по светлому фону.
      appBar: const CanonAppBar(title: 'Меню'),
      body: Consumer<PartnerMenuProvider>(
        builder: (context, provider, _) {
          // Колонка — всегда: строка «мог устареть» появляется и уходит, не
          // пересоздавая список под ней (прокрутка и раскрытые карточки
          // остаются). Над экраном ошибки она не нужна — тот говорит сам.
          final showsError = provider.error != null && provider.items.isEmpty;
          return Column(
            children: [
              if (provider.isStale && !showsError) _buildStaleNote(provider),
              Expanded(
                key: const ValueKey('menu-content'),
                child: _buildContent(provider),
              ),
            ],
          );
        },
      ),
      bottomNavigationBar: _buildRetryBar(),
    );
  }

  Widget _buildContent(PartnerMenuProvider provider) {
    if (provider.isLoading && provider.items.isEmpty) {
      return const Center(
        child: CircularProgressIndicator(color: _primary),
      );
    }

    if (provider.error != null && provider.items.isEmpty) {
      return _buildErrorState(provider);
    }

    if (provider.items.isEmpty) {
      // Случаи одного пустого списка — по состоянию распознавания с сервера
      // (находка 3 инцидента Railway, 24.10.2026; Н38 и Н39, 25.10.2026;
      // КО-1 и КО-5, 29.10.2026). Нет поля (сервер до правки) или статус
      // незнаком — прежний пустой экран.
      final recognition = provider.recognition;
      switch (recognition?.status) {
        case MenuRecognitionStatus.processing:
          return _buildProcessingState();
        case MenuRecognitionStatus.failed:
          return _buildFailedState(recognition!);
        case MenuRecognitionStatus.notStarted:
          return _buildNotStartedState();
        case MenuRecognitionStatus.done:
          return _showsHiddenState(provider)
              ? _buildHiddenState()
              : _buildNothingFoundState();
        case MenuRecognitionStatus.none:
          return _buildNoFilesState();
        case null:
          return _buildEmptyState();
      }
    }

    return _buildList(provider);
  }

  // ============================================================================
  // States
  // ============================================================================

  /// Фоновое обновление не удалось несколько раз подряд: на экране может
  /// быть не последнее состояние. Тихая строка над экраном, не красная
  /// плашка; уходит сама с первым удачным ответом.
  Widget _buildStaleNote(PartnerMenuProvider provider) {
    return Material(
      color: AppTheme.textGrey.withValues(alpha: 0.08),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 4, 4),
        child: Row(
          children: [
            const Icon(Icons.cloud_off_outlined,
                size: 18, color: AppTheme.textGrey),
            const SizedBox(width: 8),
            const Expanded(
              child: Text(
                _staleText,
                style: TextStyle(fontSize: 13, color: AppTheme.textGrey),
              ),
            ),
            TextButton(
              onPressed: () => provider.fetchMenuItems(silent: true),
              style: TextButton.styleFrom(foregroundColor: _primary),
              child: const Text('Обновить'),
            ),
          ],
        ),
      ),
    );
  }

  static const String _staleText =
      'Не удалось обновить — на экране может быть не последнее состояние.';

  Widget _buildErrorState(PartnerMenuProvider provider) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.error_outline,
                size: 64, color: AppTheme.textGrey.withValues(alpha: 0.5)),
            const SizedBox(height: 16),
            Text(
              provider.error ?? 'Ошибка загрузки',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 15, color: AppTheme.textPrimary),
            ),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: () => provider.fetchMenuItems(),
              style: ElevatedButton.styleFrom(
                backgroundColor: _primary,
                foregroundColor: AppTheme.textOnPrimary,
              ),
              child: const Text('Повторить'),
            ),
          ],
        ),
      ),
    );
  }

  /// У заведения нет ни одного файла меню — сервер знает это точно (статус
  /// «none» с 26.10.2026: добавленный файл даёт другой статус). Текст —
  /// решение Координатора 29.10.2026 (КО-5): прежний «если вы добавили…»
  /// говорил о файле тому, кто его не добавлял.
  Widget _buildNoFilesState() {
    return _buildMessageState(
      icon: Icons.menu_book_outlined,
      title: 'Меню ещё не загружено',
      hint: 'Добавьте фото страниц меню или PDF в разделе «Медиа» — позиции '
          'появятся здесь сами через несколько минут.',
    );
  }

  /// Запасной пустой экран: сервер не прислал состояние (сервер до
  /// 24.10.2026, состояние не прочиталось при первой загрузке) или прислал
  /// незнакомое — тогда неизвестно, добавлен ли файл.
  Widget _buildEmptyState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.menu_book_outlined,
                size: 72, color: AppTheme.textGrey.withValues(alpha: 0.5)),
            const SizedBox(height: 16),
            // Без программистского «распарсенных» (решение Координатора
            // 15.10.2026).
            const Text(
              'Распознанных позиций меню пока нет',
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w500,
                color: AppTheme.textPrimary,
              ),
            ),
            const SizedBox(height: 12),
            // Распознаются и фото меню, не только PDF (решение
            // Координатора 15.10.2026).
            const Text(
              'Если вы добавили фото меню или PDF в разделе «Медиа», '
              'распознавание выполняется автоматически в течение '
              'нескольких минут. Если ещё не добавили — добавьте их '
              'в разделе «Медиа».',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 14, color: AppTheme.textGrey),
            ),
          ],
        ),
      ),
    );
  }

  /// Файлы приняты, распознавание идёт. Опрос провайдера (каждые 30 с)
  /// сменит экран сам, когда оно закончится.
  Widget _buildProcessingState() {
    return const Center(
      child: Padding(
        padding: EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            SizedBox(
              width: 48,
              height: 48,
              child: CircularProgressIndicator(color: _primary, strokeWidth: 3),
            ),
            SizedBox(height: 24),
            Text(
              'Распознаём меню…',
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w500,
                color: AppTheme.textPrimary,
              ),
            ),
            SizedBox(height: 12),
            Text(
              'Обычно это занимает несколько минут. Позиции появятся '
              'здесь сами.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 14, color: AppTheme.textGrey),
            ),
          ],
        ),
      ),
    );
  }

  /// Файл загружен, а распознавание не начиналось: суточный предел отказал
  /// при загрузке или постановка упала — само оно не начнётся. Выход —
  /// кнопка внизу экрана; если предел исчерпан, её отказ скажет, когда можно.
  Widget _buildNotStartedState() {
    return _buildMessageState(
      icon: Icons.hourglass_disabled_outlined,
      title: _notStartedTitle,
      hint: _notStartedHint,
    );
  }

  /// Файл прочитан, а блюд и цен в нём не нашлось (задание распознавания
  /// закончилось, позиций ноль). Уведомление партнёру об этом же говорит
  /// «Меню «…» распознано — позиций не найдено» (notificationService).
  Widget _buildNothingFoundState() {
    return _buildMessageState(
      icon: Icons.search_off_outlined,
      title: 'Позиций не нашлось',
      hint: 'Файл прочитан, но блюд и цен в нём не нашлось. Загрузите более '
          'чёткое фото или другой файл в разделе «Медиа».',
    );
  }

  /// Файл прочитан, а список пуст потому, что позиции скрыты модератором
  /// (`hasHiddenItems`, находка КО-1): совет «более чёткое фото» здесь только
  /// тратил суточные попытки. Текст — решения Координатора 29.10.2026
  /// (вариант Б; «По рекомендации», 21:18Z): модератор не назван, о новом
  /// фото и перезапуске — ни слова (скрытие держится за название блюда в том
  /// же файле, и обещание тут было бы неверным); адрес поддержки — тот же,
  /// что в отказах сервера.
  Widget _buildHiddenState() {
    return _buildMessageState(
      icon: Icons.visibility_off_outlined,
      title: 'Позиции не показываются',
      hint: 'Файл прочитан, но позиции из него сейчас не показываются гостям. '
          'Если это ошибка — напишите в поддержку: '
          '${DeleteAccountScreen.supportEmail}',
    );
  }

  /// На экране — «Позиции не показываются» (те же условия, что выбирает
  /// [_buildContent]). По нему же прячется кнопка перезапуска: перечитанный
  /// файл даст те же скрытые позиции, а нажатие тратит суточную попытку
  /// (решение Координатора 29.10.2026).
  bool _showsHiddenState(PartnerMenuProvider provider) =>
      provider.items.isEmpty &&
      !provider.isLoading &&
      provider.error == null &&
      provider.recognition?.status == MenuRecognitionStatus.done &&
      provider.hasHiddenItems;

  static const String _notStartedTitle = 'Распознавание не запущено';
  static const String _notStartedHint = 'Файл загружен, но распознавание не '
      'началось. Нажмите «Перезапустить распознавание».';

  Widget _buildMessageState({
    required IconData icon,
    required String title,
    required String hint,
  }) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 72, color: AppTheme.textGrey.withValues(alpha: 0.5)),
            const SizedBox(height: 16),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w500,
                color: AppTheme.textPrimary,
              ),
            ),
            const SizedBox(height: 12),
            Text(
              hint,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 14, color: AppTheme.textGrey),
            ),
          ],
        ),
      ),
    );
  }

  /// Распознавание упало окончательно: причина — фраза сервера для партнёра,
  /// выход — существующая кнопка внизу экрана или другой файл.
  Widget _buildFailedState(MenuRecognition recognition) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.error_outline,
                size: 72, color: AppTheme.textGrey.withValues(alpha: 0.5)),
            const SizedBox(height: 16),
            const Text(
              'Не удалось распознать меню',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w500,
                color: AppTheme.textPrimary,
              ),
            ),
            if (recognition.reason != null) ...[
              const SizedBox(height: 12),
              Text(
                recognition.reason!,
                textAlign: TextAlign.center,
                style: const TextStyle(
                    fontSize: 15, color: AppTheme.textPrimary),
              ),
            ],
            const SizedBox(height: 12),
            Text(
              _failedHint(recognition),
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 14, color: AppTheme.textGrey),
            ),
          ],
        ),
      ),
    );
  }

  /// Совет — по причине отказа: перезапуск помогает при сбое сервиса (и когда
  /// причина неизвестна — старый сервер, незнакомый код); пустой файл или
  /// файл за пределом он прочтёт так же — нужен другой файл.
  static String _failedHint(MenuRecognition recognition) =>
      recognition.fileCannotBeRead
          ? 'Загрузите другой файл в разделе «Медиа» — например, фото '
              'страниц меню.'
          : 'Нажмите «Перезапустить распознавание» внизу экрана или '
              'загрузите другой файл в разделе «Медиа».';

  /// Позиции есть, но файл меню не распознан — один из нескольких: список
  /// его не покажет, поэтому о нём говорит плашка над списком.
  Widget _buildFailedBanner(MenuRecognition recognition) {
    return _buildBanner(
      color: Colors.red,
      icon: Icons.error_outline,
      title: 'Часть меню не распознана',
      reason: recognition.reason,
      hint: _failedHint(recognition),
    );
  }

  /// Позиции есть, а у одного из файлов распознавание не начиналось — тоже
  /// плашкой над списком: сам файл в списке не виден.
  Widget _buildNotStartedBanner() {
    return _buildBanner(
      color: Colors.orange,
      icon: Icons.hourglass_disabled_outlined,
      title: _notStartedTitle,
      hint: _notStartedHint,
    );
  }

  Widget _buildBanner({
    required MaterialColor color,
    required IconData icon,
    required String title,
    String? reason,
    required String hint,
  }) {
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: color.shade700),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppTheme.textPrimary,
                  ),
                ),
                if (reason != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    reason,
                    style: const TextStyle(
                        fontSize: 13, color: AppTheme.textPrimary),
                  ),
                ],
                const SizedBox(height: 4),
                Text(
                  hint,
                  style: const TextStyle(fontSize: 13, color: AppTheme.textGrey),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildList(PartnerMenuProvider provider) {
    final groups = provider.itemsByCategory;
    final categoryKeys = groups.keys.toList();
    final recognition = provider.recognition;
    final Widget? bannerWidget = switch (recognition?.status) {
      MenuRecognitionStatus.failed => _buildFailedBanner(recognition!),
      MenuRecognitionStatus.notStarted => _buildNotStartedBanner(),
      _ => null,
    };
    final banner = bannerWidget == null ? 0 : 1;

    return RefreshIndicator(
      color: _primary,
      onRefresh: () => provider.fetchMenuItems(),
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
        itemCount: banner + categoryKeys.length,
        itemBuilder: (context, index) {
          if (index < banner) return bannerWidget!;
          final idx = index - banner;
          final key = categoryKeys[idx];
          final categoryLabel = key.isEmpty ? 'Без категории' : key;
          final items = groups[key]!;

          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 16, 4, 8),
                child: Text(
                  categoryLabel,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                    color: AppTheme.textPrimary,
                  ),
                ),
              ),
              ...items.map((item) => _MenuItemCard(
                    item: item,
                    onTap: () => _openEditor(item),
                  )),
            ],
          );
        },
      ),
    );
  }

  // ============================================================================
  // Edit flow
  // ============================================================================

  Future<void> _openEditor(PartnerMenuItem item) async {
    final result = await showModalBottomSheet<_EditResult>(
      context: context,
      isScrollControlled: true,
      backgroundColor: _bg,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => _EditItemSheet(item: item),
    );

    if (result == null || !mounted) return;

    final provider = context.read<PartnerMenuProvider>();
    final messenger = ScaffoldMessenger.of(context);

    final ok = await provider.updateItem(
      item.id,
      itemName: result.itemName,
      priceByn: result.priceByn,
      categoryRaw: result.categoryRaw,
    );

    if (!mounted) return;

    if (!ok) {
      messenger.showSnackBar(
        SnackBar(
          content: Text(provider.error ?? 'Не удалось сохранить изменения'),
          backgroundColor: Colors.red,
          behavior: SnackBarBehavior.floating,
        ),
      );
      provider.clearError();
    } else {
      messenger.showSnackBar(
        const SnackBar(
          content: Text('Изменения сохранены'),
          backgroundColor: AppTheme.statusGreen,
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  // ============================================================================
  // Retry OCR
  // ============================================================================

  Widget _buildRetryBar() {
    return Consumer<PartnerMenuProvider>(
      builder: (context, provider, _) {
        if (_showsHiddenState(provider)) return const SizedBox.shrink();
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            child: SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: () => _handleRetry(provider),
                icon: const Icon(Icons.refresh, size: 20),
                label: const Text('Перезапустить распознавание'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: _primary,
                  side: BorderSide(color: _primary.withValues(alpha: 0.4)),
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }

  Future<void> _handleRetry(PartnerMenuProvider provider) async {
    final messenger = ScaffoldMessenger.of(context);

    final result = await provider.retryOcr();
    if (!mounted) return;

    if (result.success) {
      // Успех — всегда хотя бы один поставленный файл: «ни одного» сервис
      // отдаёт отказом (retryOcrNotQueuedCode), он идёт в последнюю ветку.
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            'Распознавание запущено (${result.enqueuedJobs} из ${result.totalPdfs})',
          ),
          backgroundColor: AppTheme.statusGreen,
          behavior: SnackBarBehavior.floating,
        ),
      );
      // Refresh items shortly — OCR results may appear before next poll tick.
      Future.delayed(const Duration(seconds: 5), () {
        if (!mounted) return;
        context.read<PartnerMenuProvider>().fetchMenuItems(silent: true);
      });
    } else if (result.errorCode == 'RATE_LIMITED') {
      final waitText = _formatRetryAfter(result.retryAfterSeconds ?? 0);
      messenger.showSnackBar(
        SnackBar(
          content: Text('${result.errorMessage}. Повторите $waitText.'),
          backgroundColor: Colors.red.shade700,
          behavior: SnackBarBehavior.floating,
          duration: const Duration(seconds: 5),
        ),
      );
    } else if (result.errorCode == 'NO_PDF_MENUS') {
      messenger.showSnackBar(
        const SnackBar(
          // Распознаются и фото меню, не только PDF (решение
          // Координатора 15.10.2026).
          content: Text(
              'Сначала добавьте фото меню или PDF в разделе «Медиа»'),
          backgroundColor: Colors.red,
          behavior: SnackBarBehavior.floating,
        ),
      );
    } else {
      messenger.showSnackBar(
        SnackBar(
          content: Text(result.errorMessage ?? 'Не удалось запустить распознавание'),
          backgroundColor: Colors.red,
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  static String _formatRetryAfter(int seconds) {
    if (seconds <= 0) return 'через некоторое время';
    if (seconds < 60) return 'через $seconds сек';
    final minutes = (seconds / 60).ceil();
    if (minutes < 60) return 'через $minutes мин';
    final hours = (minutes / 60).ceil();
    return 'через $hours ч';
  }
}

// ============================================================================
// Card widget
// ============================================================================

class _MenuItemCard extends StatefulWidget {
  final PartnerMenuItem item;
  final VoidCallback onTap;

  const _MenuItemCard({required this.item, required this.onTap});

  @override
  State<_MenuItemCard> createState() => _MenuItemCardState();
}

class _MenuItemCardState extends State<_MenuItemCard> {
  bool _flagExpanded = false;

  static const Color _warnYellow = Color(0xFFFFB800);

  @override
  Widget build(BuildContext context) {
    final item = widget.item;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
        border: Border.all(color: AppTheme.strokeGrey.withValues(alpha: 0.5)),
      ),
      child: Column(
        children: [
          InkWell(
            onTap: widget.onTap,
            borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          item.itemName,
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w500,
                            color: AppTheme.textPrimary,
                          ),
                        ),
                        if (item.priceByn != null) ...[
                          const SizedBox(height: 4),
                          Text(
                            '${item.priceByn!.toStringAsFixed(2)} BYN',
                            style: const TextStyle(
                              fontSize: 14,
                              color: AppTheme.textGrey,
                            ),
                          ),
                        ],
                        if (item.hasSanityFlag) ...[
                          const SizedBox(height: 8),
                          GestureDetector(
                            onTap: () =>
                                setState(() => _flagExpanded = !_flagExpanded),
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: _warnYellow.withValues(alpha: 0.15),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(
                                    color: _warnYellow.withValues(alpha: 0.5)),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  const Icon(Icons.warning_amber_rounded,
                                      size: 14, color: _warnYellow),
                                  const SizedBox(width: 4),
                                  const Text(
                                    'Требует внимания',
                                    style: TextStyle(
                                      fontSize: 12,
                                      color: _warnYellow,
                                      fontWeight: FontWeight.w500,
                                    ),
                                  ),
                                  const SizedBox(width: 2),
                                  Icon(
                                    _flagExpanded
                                        ? Icons.expand_less
                                        : Icons.expand_more,
                                    size: 16,
                                    color: _warnYellow,
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  const Icon(Icons.edit_outlined,
                      size: 20, color: AppTheme.textGrey),
                ],
              ),
            ),
          ),
          if (_flagExpanded && item.hasSanityFlag)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: _warnYellow.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  _formatSanityFlag(item.sanityFlag!),
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppTheme.textPrimary,
                    height: 1.4,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  static String _formatSanityFlag(Map<String, dynamic> flag) {
    // Show key:value pairs; human-readable labels for known keys.
    const labels = {
      'price_below_threshold': 'Цена ниже порога',
      'price_above_threshold': 'Цена выше порога',
      'suspicious_name': 'Подозрительное название',
      'low_confidence': 'Низкая уверенность распознавания',
    };
    return flag.entries
        .map((e) => '• ${labels[e.key] ?? e.key}: ${e.value}')
        .join('\n');
  }
}

// ============================================================================
// Edit sheet
// ============================================================================

class _EditResult {
  final String? itemName;
  final double? priceByn;
  final String? categoryRaw;
  _EditResult({this.itemName, this.priceByn, this.categoryRaw});
}

class _EditItemSheet extends StatefulWidget {
  final PartnerMenuItem item;

  const _EditItemSheet({required this.item});

  @override
  State<_EditItemSheet> createState() => _EditItemSheetState();
}

class _EditItemSheetState extends State<_EditItemSheet> {
  late final TextEditingController _nameCtrl;
  late final TextEditingController _priceCtrl;
  late final TextEditingController _categoryCtrl;
  final _formKey = GlobalKey<FormState>();

  @override
  void initState() {
    super.initState();
    _nameCtrl = TextEditingController(text: widget.item.itemName);
    _priceCtrl = TextEditingController(
      text: widget.item.priceByn != null
          ? widget.item.priceByn!.toStringAsFixed(2)
          : '',
    );
    _categoryCtrl = TextEditingController(text: widget.item.categoryRaw ?? '');
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _priceCtrl.dispose();
    _categoryCtrl.dispose();
    super.dispose();
  }

  void _submit() {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    final name = _nameCtrl.text.trim();
    final priceText = _priceCtrl.text.trim().replaceAll(',', '.');
    final category = _categoryCtrl.text.trim();

    // Only send fields that changed
    final originalName = widget.item.itemName;
    final originalPrice = widget.item.priceByn;
    final originalCategory = widget.item.categoryRaw ?? '';

    final parsedPrice = priceText.isEmpty ? null : double.tryParse(priceText);

    final result = _EditResult(
      itemName: name != originalName ? name : null,
      priceByn: (parsedPrice != originalPrice) ? parsedPrice : null,
      categoryRaw: category != originalCategory ? category : null,
    );

    if (result.itemName == null &&
        result.priceByn == null &&
        result.categoryRaw == null) {
      Navigator.pop(context);
      return;
    }

    Navigator.pop(context, result);
  }

  @override
  Widget build(BuildContext context) {
    final viewInsets = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 16, 20, viewInsets + 16),
      child: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Редактировать позицию',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w600,
                color: AppTheme.textPrimary,
              ),
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _nameCtrl,
              decoration: const InputDecoration(
                labelText: 'Название',
                border: OutlineInputBorder(),
              ),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Укажите название' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _priceCtrl,
              decoration: const InputDecoration(
                labelText: 'Цена (BYN)',
                border: OutlineInputBorder(),
                hintText: 'например 6.50',
              ),
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
              ],
              validator: (v) {
                if (v == null || v.trim().isEmpty) return null;
                final parsed = double.tryParse(v.trim().replaceAll(',', '.'));
                if (parsed == null || parsed < 0) {
                  return 'Введите корректную цену';
                }
                return null;
              },
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _categoryCtrl,
              decoration: const InputDecoration(
                labelText: 'Категория',
                border: OutlineInputBorder(),
                hintText: 'например Кофе, Десерты',
              ),
            ),
            const SizedBox(height: 20),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Отмена'),
                ),
                const SizedBox(width: 8),
                ElevatedButton(
                  onPressed: _submit,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.primaryOrangeDark,
                    foregroundColor: AppTheme.textOnPrimary,
                  ),
                  child: const Text('Сохранить'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
