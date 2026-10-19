import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/account_deletion_provider.dart';
import 'package:restaurant_guide_mobile/providers/notification_provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_dashboard_provider.dart';
import 'package:restaurant_guide_mobile/services/account_service.dart';
import 'package:restaurant_guide_mobile/services/auth_service.dart';
import 'package:restaurant_guide_mobile/services/session_events.dart';
import 'package:url_launcher/url_launcher.dart';

/// «Удалить учётку» — предупреждение и подтверждение словом (бриф В1,
/// 18.10.2026; App Store 5.1.1(v), Google Play).
///
/// Сначала экран спрашивает сервер, можно ли удалить: владельцу карточек
/// заведений сервер отвечает «напишите в поддержку» (решение 3), и человек
/// узнаёт это до того, как наберёт слово. Можно — предупреждение простыми
/// словами: что исчезнет, что останется без имени (решения 1 и 2), что
/// вернуть нельзя; кнопка доступна, когда набрано УДАЛИТЬ (решение 4).
/// После удаления — главный экран гостем и «Учётка удалена».
class DeleteAccountScreen extends StatelessWidget {
  const DeleteAccountScreen({
    super.key,
    this.mentionDrafts = false,
    this.signOut,
  });

  /// Сказать, что неопубликованные черновики карточек удалятся, — партнёру.
  final bool mentionDrafts;

  /// Выход на телефоне после удаления. По умолчанию — как «Выйти из
  /// профиля», но без запроса к серверу: опрос уведомлений остановлен,
  /// кабинет партнёра сброшен, сеанс закончен. Тест подставляет свой.
  final Future<void> Function()? signOut;

  /// Адрес поддержки — тот же, что в отказах сервера.
  static const String supportEmail = 'support@nirivio.by';

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider<AccountDeletionProvider>(
      create: (context) {
        final onDeleted = signOut ?? _defaultSignOut(context);
        return AccountDeletionProvider(onDeleted: onDeleted)..check();
      },
      child: _DeleteAccountView(mentionDrafts: mentionDrafts),
    );
  }

  /// Сеанс на телефоне кончается тем же путём, что сеанс, который сервер
  /// больше не продлит: хранилище очищено, затем [SessionEvents.reportExpired]
  /// — провайдер входа переводит телефон в «гость» и сбрасывает кэши аккаунта
  /// (`AuthProvider._onSessionExpired`). К серверу не ходим: `logout()`
  /// отправил бы refresh-токен, которого больше нет, а адреса push сервер
  /// уже удалил сам.
  static Future<void> Function() _defaultSignOut(BuildContext context) {
    final notifications = context.read<NotificationProvider>();
    final partner = context.read<PartnerDashboardProvider>();
    return () async {
      notifications.stopPolling();
      partner.reset();
      await AuthService().clearAuthData();
      SessionEvents.reportExpired();
    };
  }
}

class _DeleteAccountView extends StatefulWidget {
  const _DeleteAccountView({required this.mentionDrafts});

  final bool mentionDrafts;

  @override
  State<_DeleteAccountView> createState() => _DeleteAccountViewState();
}

class _DeleteAccountViewState extends State<_DeleteAccountView> {
  final TextEditingController _word = TextEditingController();

  @override
  void dispose() {
    _word.dispose();
    super.dispose();
  }

  Future<void> _delete(AccountDeletionProvider deletion) async {
    FocusScope.of(context).unfocus();
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context, rootNavigator: true);
    final deleted = await deletion.delete(_word.text);
    if (!deleted || !mounted) return;
    navigator.pushNamedAndRemoveUntil('/home', (route) => false);
    messenger.showSnackBar(
      SnackBar(
        // «Удалена» — только когда это сказал сервер; иначе сеанс кончился по
        // дороге (AccountDeletionProvider.deletionConfirmed).
        content: Text(deletion.deletionConfirmed ? 'Учётка удалена' : 'Сеанс завершён'),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  Future<void> _writeToSupport() async {
    final uri = Uri(
      scheme: 'mailto',
      path: DeleteAccountScreen.supportEmail,
      query: 'subject=${Uri.encodeComponent('Удаление учётки')}',
    );
    final messenger = ScaffoldMessenger.of(context);
    var opened = false;
    try {
      opened = await launchUrl(uri);
    } catch (_) {
      opened = false;
    }
    if (!opened) {
      messenger.showSnackBar(
        const SnackBar(
          content: Text('Почта не открылась. Адрес поддержки: '
              '${DeleteAccountScreen.supportEmail}'),
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final deletion = context.watch<AccountDeletionProvider>();
    final busy = deletion.stage == AccountDeletionStage.deleting;

    return PopScope(
      // Пока запрос в пути, назад не уйти: иначе человек не узнает, удалена
      // ли учётка.
      canPop: !busy,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Удалить учётку'),
          backgroundColor: Colors.white,
          foregroundColor: AppTheme.textPrimary,
          // Тема задаёт заголовку белый цвет — здесь он тёмный, со своим
          // семейством (стиль заголовка заменяет унаследованный).
          titleTextStyle: const TextStyle(
            fontFamily: AppTheme.fontBodyFamily,
            fontSize: 20,
            fontWeight: FontWeight.w600,
            color: AppTheme.textPrimary,
          ),
          elevation: 0,
        ),
        backgroundColor: Colors.white,
        body: SafeArea(child: _body(deletion, busy)),
      ),
    );
  }

  Widget _body(AccountDeletionProvider deletion, bool busy) {
    switch (deletion.stage) {
      case AccountDeletionStage.checking:
      case AccountDeletionStage.deleted:
        return const Center(child: CircularProgressIndicator());
      case AccountDeletionStage.checkFailed:
        return _CheckFailed(onRetry: deletion.check);
      case AccountDeletionStage.refused:
        return _Refused(
          message: deletion.refusalMessage ?? AccountDeletionProvider.fallbackRefusal,
          onWrite: _writeToSupport,
        );
      case AccountDeletionStage.ready:
      case AccountDeletionStage.deleting:
        return _warning(deletion, busy);
    }
  }

  Widget _warning(AccountDeletionProvider deletion, bool busy) {
    final confirmed = AccountDeletionProvider.isConfirmation(_word.text);
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
      children: [
        const _SectionTitle('Что удалится'),
        const _Point('Имя, почта, телефон и фото профиля'),
        const _Point('Избранное, уведомления и их настройки'),
        const _Point('Вход: в эту учётку больше не войти ни паролем, '
            'ни через Google или Яндекс'),
        if (widget.mentionDrafts)
          const _Point('Черновики карточек заведений, которые не публиковались'),
        const SizedBox(height: 16),
        const _SectionTitle('Что останется без вашего имени'),
        const _Point('Ваши отзывы и оценки — автором будет «Гость», без фото'),
        const _Point('Брони — у заведения останутся дата, время и число гостей. '
            'Предстоящие брони отменятся, заведение получит уведомление'),
        const SizedBox(height: 16),
        const Text(
          'Вернуть учётку будет нельзя. Новую можно завести на ту же почту '
          'или телефон.',
          style: TextStyle(fontSize: 15, color: AppTheme.textPrimary, height: 1.35),
        ),
        const SizedBox(height: 24),
        const Text(
          'Чтобы подтвердить, введите слово ${AccountService.confirmationWord}',
          style: TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w600,
            color: AppTheme.textPrimary,
          ),
        ),
        const SizedBox(height: 8),
        TextField(
          key: const Key('delete-account-word'),
          controller: _word,
          enabled: !busy,
          textCapitalization: TextCapitalization.characters,
          autocorrect: false,
          enableSuggestions: false,
          decoration: InputDecoration(
            hintText: AccountService.confirmationWord,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
            ),
          ),
          onChanged: (_) => setState(() {}),
        ),
        if (deletion.deleteError != null) ...[
          const SizedBox(height: 12),
          Text(
            deletion.deleteError!,
            key: const Key('delete-account-error'),
            style: const TextStyle(fontSize: 14, color: AppTheme.errorRedDark),
          ),
        ],
        const SizedBox(height: 20),
        SizedBox(
          height: 48,
          child: ElevatedButton(
            key: const Key('delete-account-button'),
            onPressed: confirmed && !busy ? () => _delete(deletion) : null,
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.errorRed,
              foregroundColor: Colors.white,
              disabledBackgroundColor: AppTheme.gray300,
              disabledForegroundColor: AppTheme.textSecondary,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
              ),
              textStyle: const TextStyle(
                fontFamily: AppTheme.fontBodyFamily,
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
            child: busy
                ? const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(
                      strokeWidth: 2.5,
                      color: Colors.white,
                    ),
                  )
                : const Text('Удалить учётку'),
          ),
        ),
      ],
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        text,
        style: const TextStyle(
          fontSize: 17,
          fontWeight: FontWeight.w600,
          color: AppTheme.textPrimary,
        ),
      ),
    );
  }
}

class _Point extends StatelessWidget {
  const _Point(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('•  ', style: TextStyle(fontSize: 15, color: AppTheme.textPrimary)),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(fontSize: 15, color: AppTheme.textPrimary, height: 1.35),
            ),
          ),
        ],
      ),
    );
  }
}

class _Refused extends StatelessWidget {
  const _Refused({required this.message, required this.onWrite});

  final String message;
  final VoidCallback onWrite;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        const Text(
          'Сейчас учётку удалить нельзя',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w600,
            color: AppTheme.textPrimary,
          ),
        ),
        const SizedBox(height: 12),
        Text(
          message,
          key: const Key('delete-account-refusal'),
          style: const TextStyle(fontSize: 15, color: AppTheme.textPrimary, height: 1.35),
        ),
        const SizedBox(height: 24),
        SizedBox(
          height: 48,
          child: OutlinedButton(
            onPressed: onWrite,
            style: OutlinedButton.styleFrom(
              foregroundColor: AppTheme.primaryOrangeDark,
              side: const BorderSide(color: AppTheme.primaryOrangeDark),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
              ),
              textStyle: const TextStyle(
                fontFamily: AppTheme.fontBodyFamily,
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
            child: const Text('Написать в поддержку'),
          ),
        ),
      ],
    );
  }
}

class _CheckFailed extends StatelessWidget {
  const _CheckFailed({required this.onRetry});

  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'Не удалось проверить учётку. Проверьте интернет.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 15, color: AppTheme.textSecondary),
            ),
            const SizedBox(height: 16),
            TextButton(
              onPressed: onRetry,
              child: const Text(
                'Повторить',
                style: TextStyle(color: AppTheme.primaryOrangeDark),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
