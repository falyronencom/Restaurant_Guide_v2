import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/moderation_vocabulary.dart';
import 'package:restaurant_guide_admin_web/config/panel_roles.dart';

/// Раскрытая запись журнала — словами, а не кодом.
///
/// Раньше блок «Изменение» печатал `old_data` и `new_data` как JSON: модератор
/// читал `{"sanity_flag": {"reason": "price_delta_anomaly", "ratio": …}}` и
/// `hidden_review_ids` из uuid (замечание Координатора К-3, A3-04, A2-13).
/// Здесь каждый ключ, который пишут писатели журнала, получает русское имя, а
/// значение — человеческую форму: статус словом, флаг фразой с числами,
/// список отзывов — числом. Исходник остаётся доступен под «Исходная запись».
///
/// Набор ключей — общий список сервера (`backend/src/constants/
/// auditLogActions.json`, поле `fields`), сверяет тест. Незнакомый ключ НЕ
/// пропадает: он показывается строкой «поле «…»» с сырым значением — дрейф
/// видно, а не прячется (тот же принцип, что у словаря действий).

/// Одна строка раскрытой записи: что изменилось и как.
class AuditChangeLine {
  /// Что — словами: «Статус», «Причина».
  final String label;

  /// Значение до действия. `null` — у записи его нет (ключ только в «после»).
  final String? before;

  /// Значение после действия. `null` — ключ был только в «до».
  final String? after;

  /// Ключ незнаком панели — показан как есть.
  final bool unknown;

  const AuditChangeLine({
    required this.label,
    this.before,
    this.after,
    this.unknown = false,
  });

  @override
  String toString() => before != null && after != null
      ? '$label: $before → $after'
      : '$label: ${after ?? before}';
}

/// Ключи-контекст: они называют объект, а не изменение, и показываются в
/// колонке «Объект» и в «Контексте записи» (снимок названия позиции меню,
/// название и город удалённой карточки).
const Set<String> kAuditContextFields = <String>{
  'item_name',
  'establishment_name',
  'establishment_city',
  'name',
  'city',
};

/// Ключи, которые на экран не выводятся вовсе: служебный идентификатор пачки
/// скрытых разом отзывов (П7) нужен разработчику, а не модератору, — он в
/// «Исходной записи» и в «Скопировать код».
const Set<String> kAuditHiddenFields = <String>{'batch_id'};

/// Русские имена ключей записи. Набор вместе с [kAuditHiddenFields] обязан
/// покрывать `fields` общего списка сервера — проверяет тест.
const Map<String, String> kAuditFieldLabels = <String, String>{
  'status': 'Статус',
  'reason': 'Причина',
  'moderation_notes': 'Замечания модератора',
  'latitude': 'Широта',
  'longitude': 'Долгота',
  'slug': 'Адрес страницы',
  'partner_id': 'Партнёр',
  'role': 'Роль',
  'is_hidden_by_admin': 'Скрыта модератором',
  'copy_of': 'Та же позиция в другом файле меню',
  'sanity_flag': 'Флаг проверки',
  'is_visible': 'Виден в приложении',
  'is_deleted': 'Удалён',
  'establishment_id': 'Заведение',
  'is_active': 'Учётная запись',
  'hidden_review_ids': 'Скрыто отзывов',
  'restored_review_ids': 'Снова видно отзывов',
  'restore_reviews': 'Вернуть скрытые отзывы',
  'user_name': 'Имя',
  'account_takeover': 'Вход в чужую учётную запись через',
  'actor': 'Кто действовал',
  'auth_method': 'Способ входа',
  'reviews_kept': 'Отзывов осталось',
  'bookings_cancelled': 'Броней отменено',
  'favorites_removed': 'Удалено из избранного',
  'drafts_deleted': 'Черновиков удалено',
  'access_tokens_revoked': 'Сеансы завершены',
  'user_email': 'E-mail',
  'provider_linked': 'Вход через Google или Яндекс',
  'had_password': 'Был пароль',
  'password_cleared': 'Пароль сброшен',
  'sessions_ended': 'Завершено сеансов',
  'devices_switched_off': 'Отключено устройств',
  'reset_links_spent': 'Погашено ссылок сброса пароля',
  'email_codes_spent': 'Погашено кодов из письма',
  'is_service_account': 'Служебная учётная запись',
  'name': 'Название',
  'city': 'Город',
  'item_name': 'Позиция',
  'establishment_name': 'Заведение',
  'establishment_city': 'Город',
  // Пакетное скрытие отзывов одного автора (П7): по записи на отзыв.
  'batch_size': 'В пачке',
};

/// Статус карточки — в единственном числе, как о ней говорят в записи.
const Map<String, String> _statusWords = <String, String>{
  'draft': 'черновик',
  'pending': 'на модерации',
  'active': 'в каталоге',
  'rejected': 'отклонена',
  'suspended': 'приостановлена',
  'archived': 'в архиве',
};

const Map<String, String> _authMethods = <String, String>{
  'email': 'e-mail и пароль',
  'phone': 'телефон',
  'google': 'Google',
  'yandex': 'Яндекс',
};

/// Поля карточки в замечаниях модератора — те же имена, что в панели разбора
/// заявки (`moderation_detail_panel.dart`).
const Map<String, String> _noteFields = <String, String>{
  'legal_name': 'Полное название',
  'unp': 'УНП',
  'registration_doc': 'Регистрация',
  'contact_person': 'Контактное лицо',
  'contact_email': 'E-mail',
  'description': 'Описание',
  'name': 'Название',
  'customer_phone': 'Номер для связи',
  'website': 'Сайт',
  'working_hours': 'Время работы',
  'price_range': 'Средний чек',
  'photos': 'Фото',
  'menu': 'Меню',
  'address': 'Адрес',
  'suspend_reason': 'Причина приостановки',
};

/// Кто действовал по полю `actor`: «operator_script:change-account-email» →
/// «скрипт оператора (change-account-email)».
String describeActor(Object? actor) {
  final text = actor?.toString() ?? '';
  const prefix = 'operator_script:';
  if (text.startsWith(prefix)) {
    return 'скрипт оператора (${text.substring(prefix.length)})';
  }
  return text;
}

/// Значение ключа человеческим языком.
String describeAuditValue(String key, Object? value) {
  if (value == null) {
    return switch (key) {
      'sanity_flag' => 'нет',
      'partner_id' => 'не назначен',
      _ => 'нет',
    };
  }

  switch (key) {
    case 'status':
      return _statusWords[value] ?? value.toString();
    case 'role':
      return actorRoleLabel(value.toString()) ?? value.toString();
    case 'auth_method':
      return _authMethods[value] ?? value.toString();
    case 'account_takeover':
      return _authMethods[value] ?? value.toString();
    case 'actor':
      return describeActor(value);
    case 'is_active':
      return value == true ? 'включена' : 'отключена';
    case 'sanity_flag':
      if (value is Map<String, dynamic>) {
        final reason = value['reason'];
        return describeSanityFlag(value) ??
            (reason is String ? sanityFlagLabel(reason) : 'есть');
      }
      return 'есть';
    case 'batch_size':
      return value is num
          ? countWithNoun(value.round(), 'отзыв', 'отзыва', 'отзывов')
          : value.toString();
    case 'hidden_review_ids':
    case 'restored_review_ids':
      return value is List ? formatCount(value.length) : value.toString();
    case 'partner_id':
    case 'establishment_id':
    case 'copy_of':
      // Идентификатор понижен в правах, а не спрятан: восемь знаков, как в
      // колонке «Объект».
      final id = value.toString();
      return 'id ${id.length <= 8 ? id : id.substring(0, 8)}';
    case 'latitude':
    case 'longitude':
      return value is num
          ? formatDecimal(value.toDouble(), digits: 6)
          : value.toString();
    case 'moderation_notes':
      if (value is Map) {
        final notes = <String>[
          for (final entry in value.entries)
            if (entry.value != null && entry.value.toString().trim().isNotEmpty)
              '${_noteFields[entry.key] ?? 'замечание'} — ${entry.value}',
        ];
        return notes.isEmpty ? 'нет' : notes.join('; ');
      }
      return value.toString();
  }

  if (value is bool) return value ? 'да' : 'нет';
  if (value is num) return formatCount(value.round());
  if (value is List) return value.isEmpty ? 'нет' : formatCount(value.length);
  return value.toString();
}

/// Строки раскрытой записи: ключи «до» и «после» парами, в порядке записи.
///
/// Ключ в обоих состояниях даёт строку «было → стало»; только в одном — его
/// значение. Ключи-контекст ([kAuditContextFields]) не повторяются здесь.
List<AuditChangeLine> describeAuditChange(
  Map<String, dynamic>? oldData,
  Map<String, dynamic>? newData,
) {
  final before = oldData ?? const <String, dynamic>{};
  final after = newData ?? const <String, dynamic>{};
  final keys = <String>[
    ...before.keys,
    for (final key in after.keys)
      if (!before.containsKey(key)) key,
  ].where((key) =>
      !kAuditContextFields.contains(key) && !kAuditHiddenFields.contains(key));

  return <AuditChangeLine>[
    for (final key in keys)
      AuditChangeLine(
        label: kAuditFieldLabels[key] ?? 'поле «$key»',
        unknown: !kAuditFieldLabels.containsKey(key),
        before: before.containsKey(key)
            ? (kAuditFieldLabels.containsKey(key)
                ? describeAuditValue(key, before[key])
                : '${before[key]}')
            : null,
        after: after.containsKey(key)
            ? (kAuditFieldLabels.containsKey(key)
                ? describeAuditValue(key, after[key])
                : '${after[key]}')
            : null,
      ),
  ];
}
