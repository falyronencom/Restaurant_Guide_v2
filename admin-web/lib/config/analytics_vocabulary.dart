import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';

/// Машинные коды аналитики по-русски: статусы заведений и роли пользователей.
///
/// Отдельно от `moderation_vocabulary.dart` намеренно: там подписи разбора
/// (действия журнала, причины флагов), здесь — подписи распределений, где
/// величина всегда счётная и форма поэтому множественная.

// ============================================================================
// Статусы заведений
// ============================================================================

/// Что цвет значит на кадре 08.
///
/// Он кодирует ПРИСУТСТВИЕ В КАТАЛОГЕ, а не оценку заведения:
///   * [visible]     — видно посетителям прямо сейчас;
///   * [awaiting]    — ждёт нашей работы;
///   * [withdrawn]   — из каталога убрано решением модератора;
///   * [neverPublic] — публичным не было.
///
/// Отсюда расхождение со `StatusDot`, где `suspended` получает disclaimer-пару
/// с доводом «не ошибка и не успех». Расхождение не дрейф: там цвет отвечает на
/// вопрос «каков вердикт по этой карточке», здесь — «сколько каталога видно».
/// Приостановка по первому вопросу нейтральна, а по второму она ограничение,
/// такое же по направлению, как отказ. То же правило направления, по которому
/// красятся точки действий в журнале.
enum CatalogPresence { visible, awaiting, withdrawn, neverPublic }

Color catalogPresenceColor(CatalogPresence presence) => switch (presence) {
      CatalogPresence.visible => AppTheme.statusGreen,
      CatalogPresence.awaiting => AppTheme.primaryOrange,
      CatalogPresence.withdrawn => AppTheme.errorRed,
      CatalogPresence.neverPublic => AppTheme.textGrey,
    };

class StatusShare {
  /// Подпись во множественном числе: величина здесь — количество заведений.
  final String label;
  final CatalogPresence presence;

  const StatusShare(this.label, this.presence);
}

/// Статусы в порядке кадра 08 — от видимого к никогда не публиковавшемуся.
///
/// Порядок здесь канонический, а не тот, в котором пришёл ответ: бэкенд
/// сортирует распределение по убыванию количества, и от этого полоса
/// перекладывалась бы при каждом изменении данных. Смысловая шкала не должна
/// зависеть от того, чего сегодня больше.
///
/// Набор ключей повторяет CHECK-ограничение `establishments.status`. Полнота
/// сверяется с `kEstablishmentStatuses` тестом: новый статус без подписи
/// показал бы модератору машинный код.
const Map<String, StatusShare> kStatusShares = <String, StatusShare>{
  'active': StatusShare('Активные', CatalogPresence.visible),
  'pending': StatusShare('На модерации', CatalogPresence.awaiting),
  'rejected': StatusShare('Отклонённые', CatalogPresence.withdrawn),
  'suspended': StatusShare('Приостановленные', CatalogPresence.withdrawn),
  'draft': StatusShare('Черновики', CatalogPresence.neverPublic),
  'archived': StatusShare('Архив', CatalogPresence.neverPublic),
};

/// Подпись статуса. Незнакомый код возвращается как есть — дефект виден и на
/// экране, и в тесте, вместо того чтобы прятаться за вежливым «прочее».
String statusShareLabel(String status) =>
    kStatusShares[status]?.label ?? status;

/// Цвет статуса. Незнакомый код получает нейтральный серый: угадывать
/// направление за неизвестное правило нельзя.
Color statusShareColor(String status) => catalogPresenceColor(
      kStatusShares[status]?.presence ?? CatalogPresence.neverPublic,
    );

// ============================================================================
// Роли пользователей
// ============================================================================

/// Роли в порядке кадра 10 — от самой массовой к самой узкой.
///
/// Ключи — то, что лежит в `users.role`. Кадр про это говорит прямо: «Роли
/// приходят из БД ключами user · partner · admin — перевод на стороне клиента».
const Map<String, String> kUserRoles = <String, String>{
  'user': 'Пользователи',
  'partner': 'Партнёры',
  'admin': 'Администраторы',
};

/// Цвет роли. Партнёр — брендовый: это единственная роль, которую платформа
/// растит. Администраторы — зелёный доступа, остальные — нейтральный серый:
/// рядовой пользователь не «хуже» партнёра, он просто фон.
const Map<String, Color> kUserRoleColors = <String, Color>{
  'user': AppTheme.textGrey,
  'partner': AppTheme.primaryOrange,
  'admin': AppTheme.statusGreen,
};

String userRoleLabel(String role) => kUserRoles[role] ?? role;

Color userRoleColor(String role) => kUserRoleColors[role] ?? AppTheme.textGrey;
