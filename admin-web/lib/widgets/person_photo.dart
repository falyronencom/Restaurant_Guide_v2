import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';

/// Где стоит фото человека — как его отдаёт сервер (`avatarStateSql`,
/// миграция 041).
enum PersonPhotoState {
  /// Фото нет.
  none,

  /// Фото есть, другие люди его не видят, пока модератор не одобрит.
  pending,

  /// Одобрено: другие видят его рядом с отзывами.
  approved;

  static PersonPhotoState fromWire(Object? value) => switch (value) {
        'pending' => PersonPhotoState.pending,
        'approved' => PersonPhotoState.approved,
        _ => PersonPhotoState.none,
      };
}

/// Подпись состояния фото — одна на экраны «Пользователи» и «Отзывы».
String personPhotoStateLabel(PersonPhotoState state) => switch (state) {
      PersonPhotoState.none => 'Фото нет',
      PersonPhotoState.pending => 'Фото на проверке — другие видят букву',
      PersonPhotoState.approved => 'Фото одобрено — другие его видят',
    };

/// Откуда панель грузит фото человека — те же места, что сайт
/// (`web/src/lib/avatar-source.ts`): наше облако и фото входа через Google и
/// Яндекс. Ссылку с другого хоста (значение до шлюза 02.10.2026) браузер
/// модератора не открывает: чужой сервер увидел бы его адрес — вместо фото
/// буква, снять такое фото можно (ревью по линзе PR 1а, находка 4).
const List<({String host, String pathPrefix})> kPersonPhotoSources =
    <({String host, String pathPrefix})>[
  (host: 'res.cloudinary.com', pathPrefix: '/'),
  (host: 'lh3.googleusercontent.com', pathPrefix: '/'),
  (host: 'avatars.yandex.net', pathPrefix: '/get-yapic/'),
];

/// Ссылка, которую панель вправе загрузить, или `null`.
String? personPhotoSource(String? url) {
  final link = url?.trim();
  if (link == null || link.isEmpty) return null;
  final uri = Uri.tryParse(link);
  if (uri == null || uri.scheme != 'https' || uri.hasPort || uri.userInfo.isNotEmpty) {
    return null;
  }
  final allowed = kPersonPhotoSources.any(
      (s) => uri.host == s.host && uri.path.startsWith(s.pathPrefix));
  return allowed ? link : null;
}

/// Фото человека в круге — так модератор видит, что человек поставил
/// (решение Координатора 09.11.2026: фото профиля другим — только после
/// одобрения). Без фото и при сбое загрузки — буква, как в приложении и на
/// сайте.
///
/// Ссылка — та, что лежит у человека, без своих преобразований: в облаке
/// включён строгий режим, новый вид ссылки он не отдаёт (память проекта
/// `project_outsider_costs_thread`). Фото из входа через Google и Яндекс
/// лежит у них: если их сервер не разрешает чтение картинки странице панели,
/// Flutter показывает её обычным элементом `<img>`
/// ([WebHtmlElementStrategy.fallback]).
class PersonPhoto extends StatelessWidget {
  /// Ссылка на фото или `null`.
  final String? url;

  /// Из чего взять букву: имя, иначе почта.
  final String? label;
  final double size;

  /// Серый круг буквы — у человека без имени.
  final bool muted;

  const PersonPhoto({
    super.key,
    required this.url,
    required this.label,
    this.size = 22,
    this.muted = false,
  });

  /// Ключ картинки — по нему тест отличает фото от буквы.
  static const Key imageKey = ValueKey<String>('person-photo-image');

  @override
  Widget build(BuildContext context) {
    final link = personPhotoSource(url);
    final letter = _Letter(label: label, size: size, muted: muted);
    if (link == null) return letter;

    return ClipOval(
      child: SizedBox(
        width: size,
        height: size,
        child: Image.network(
          link,
          key: imageKey,
          fit: BoxFit.cover,
          webHtmlElementStrategy: WebHtmlElementStrategy.fallback,
          errorBuilder: (_, __, ___) => letter,
        ),
      ),
    );
  }
}

class _Letter extends StatelessWidget {
  final String? label;
  final double size;
  final bool muted;

  const _Letter({required this.label, required this.size, required this.muted});

  @override
  Widget build(BuildContext context) {
    final trimmed = label?.trim() ?? '';
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: muted ? AppTheme.textGrey : AppTheme.primaryOrangeDark,
        shape: BoxShape.circle,
      ),
      child: Text(
        trimmed.isEmpty ? '?' : trimmed.characters.first.toUpperCase(),
        style: TextStyle(
          fontSize: size * 0.45,
          fontWeight: FontWeight.w700,
          color: AppTheme.textOnPrimary,
        ),
      ),
    );
  }
}
