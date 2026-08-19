import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';

/// Карточка ошибки загрузки — 400px, витринная, по центру области.
///
/// Применяется, когда не загрузилось содержимое экрана. Ошибка **действия**
/// выглядит иначе — это тост (`AdminErrorToast`), и он не сбрасывает работу.
/// Разница принципиальная: здесь показывать нечего, там всё на месте, просто
/// не сработала одна операция.
///
/// Устройство сообщения разделено на три слоя, и смешивать их нельзя:
/// [title] — что не получилось, человеческими словами;
/// [reason] — почему, коротко и тоже по-человечески;
/// [technical] — строка для отправки разработчику, моноширинная и мелкая.
/// Технику в заголовок не выносить: модератор не должен читать «502» вместо
/// «Список не загрузился».
class AdminErrorCard extends StatelessWidget {
  final String title;
  final String reason;

  /// Абзац: что с данными на самом деле и что делать дальше.
  final String message;

  /// Метод, эндпоинт, код, время. Копируется кнопкой «Скопировать код».
  final String? technical;

  final VoidCallback onRetry;
  final String retryLabel;

  /// По умолчанию кладёт [technical] в буфер обмена.
  final VoidCallback? onCopyCode;

  const AdminErrorCard({
    super.key,
    required this.title,
    required this.reason,
    required this.message,
    required this.onRetry,
    this.technical,
    this.retryLabel = 'Повторить',
    this.onCopyCode,
  });

  @override
  Widget build(BuildContext context) {
    final tech = technical;

    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Container(
          width: 400,
          padding: const EdgeInsets.all(24),
          decoration: AppTheme.canonPanelDecoration(),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                spacing: 12,
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: AppTheme.errorTint(0.10),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: const Icon(
                      Icons.cloud_off,
                      size: 23,
                      color: AppTheme.errorRed,
                    ),
                  ),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          title,
                          style: AppTheme.canonSheetTitle.copyWith(
                            fontSize: 18,
                            height: 1.15,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          reason,
                          style: const TextStyle(
                            fontSize: 12,
                            color: AppTheme.textSecondary,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              Text(
                message,
                style: const TextStyle(
                  fontSize: 14,
                  height: 1.5,
                  color: AppTheme.textDark,
                ),
              ),
              const SizedBox(height: 16),
              // Wrap, а не Row: в карточке 400px за вычетом паддингов остаётся
              // 352, и две кнопки с длинными русскими подписями в них едва
              // помещаются. При достатке места ряд выглядит как в макете,
              // в тесноте вторая кнопка переносится, а не обрезается.
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: [
                  ElevatedButton.icon(
                    onPressed: onRetry,
                    style: _filledCompact,
                    icon: const Icon(Icons.refresh, size: 17),
                    label: Text(retryLabel),
                  ),
                  if (tech != null || onCopyCode != null)
                    OutlinedButton(
                      onPressed: onCopyCode ??
                          (tech == null
                              ? null
                              : () => Clipboard.setData(
                                    ClipboardData(text: tech),
                                  )),
                      style: _outlinedCompact,
                      child: const Text('Скопировать код'),
                    ),
                ],
              ),
              if (tech != null) ...[
                const SizedBox(height: 12),
                Text(
                  tech,
                  style: AppTheme.mono(fontSize: 11, color: AppTheme.textGrey),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  /// Кнопки внутри карточки — 40px, а не канонические 48: карточка узкая,
  /// и полноразмерная CTA в ней перевешивает сам текст ошибки.
  static ButtonStyle get _filledCompact => ElevatedButton.styleFrom(
        backgroundColor: AppTheme.primaryOrange,
        foregroundColor: AppTheme.textOnPrimary,
        elevation: 0,
        minimumSize: const Size(0, 40),
        padding: const EdgeInsets.symmetric(horizontal: 16),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppTheme.radiusControl),
        ),
        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
      );

  static ButtonStyle get _outlinedCompact => OutlinedButton.styleFrom(
        foregroundColor: AppTheme.textDark,
        side: const BorderSide(color: AppTheme.strokeGrey),
        minimumSize: const Size(0, 40),
        padding: const EdgeInsets.symmetric(horizontal: 14),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppTheme.radiusControl),
        ),
        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
      );
}
