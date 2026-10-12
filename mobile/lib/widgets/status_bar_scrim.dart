import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Полоса под системной строкой для экранов без шапки, у которых фото героя
/// уходит под часы (карточка заведения).
///
/// Пока экран не прокручен, полосы нет — фото во весь рост, как в макете.
/// С прокруткой она за [fadeDistance] проявляется до цвета [color] и
/// закрывает системную строку: текст страницы больше не едет под часы и
/// значки (на карточке «6,9 км от вас» ложилось поверх часов, 10.10.2026).
/// Значки строки — светлые над фото, тёмные над полосой.
///
/// Полоса нарисована поверх [child] и касаний не принимает.
class StatusBarScrim extends StatelessWidget {
  const StatusBarScrim({
    super.key,
    required this.controller,
    required this.color,
    required this.child,
    this.fadeDistance = 24,
  });

  /// Контроллер прокрутки экрана, по которому проявляется полоса.
  final ScrollController controller;

  /// Цвет полосы — фон экрана.
  final Color color;

  final Widget child;

  /// За сколько dp прокрутки полоса становится непрозрачной. Кнопка «назад»
  /// стоит на 36 dp ниже строки — к её приходу полоса уже сплошная.
  final double fadeDistance;

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.paddingOf(context).top;
    return ListenableBuilder(
      listenable: controller,
      // [child] передаётся как есть: тот же экземпляр виджета не
      // перестраивается, на кадр прокрутки перерисовывается только полоса.
      child: child,
      builder: (context, child) {
        final offset = controller.hasClients ? controller.offset : 0.0;
        final shown = (offset / fadeDistance).clamp(0.0, 1.0);
        final overBand = shown >= 0.5;
        return AnnotatedRegion<SystemUiOverlayStyle>(
          // Только поля строки состояния: готовые .light/.dark заодно красят
          // нижнюю панель Android, и стиль оставался бы после ухода с экрана.
          value: SystemUiOverlayStyle(
            statusBarColor: Colors.transparent,
            // Android — цвет значков; iOS — яркость фона под ними.
            statusBarIconBrightness:
                overBand ? Brightness.dark : Brightness.light,
            statusBarBrightness: overBand ? Brightness.light : Brightness.dark,
          ),
          child: Stack(
            children: [
              child!,
              Positioned(
                top: 0,
                left: 0,
                right: 0,
                height: top,
                child: IgnorePointer(
                  child: ColoredBox(
                    key: const ValueKey('status-bar-scrim'),
                    color: color.withValues(alpha: color.a * shown),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
