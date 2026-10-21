/// Человек платформы на экране «Пользователи» — зеркало ответа
/// `GET /api/v1/admin/users` и `/users/:id` (`backend/src/models/adminUserModel.js`).
///
/// Проход тестировщика 17.10, п. 8: модератор находит человека по почте,
/// телефону или имени и блокирует его, не открывая базу.
library;

import 'package:restaurant_guide_admin_web/config/panel_roles.dart';

/// Последняя блокировка или разблокировка из журнала.
class AdminUserBlockAction {
  /// `user_block` или `user_unblock`.
  final String action;
  final String? reason;
  final DateTime? createdAt;

  /// Кто действовал. Просмотрщику сервер имя не отдаёт.
  final String? adminName;

  /// Запись скрипта оператора (`scripts/set-user-active.js`), а не панели.
  final bool byOperator;

  /// Сколько отзывов скрыла блокировка / вернула разблокировка. `null` —
  /// запись числа не несёт (прежний ответ, последняя запись `last_block_action`).
  final int? hiddenReviews;
  final int? restoredReviews;

  const AdminUserBlockAction({
    required this.action,
    this.reason,
    this.createdAt,
    this.adminName,
    this.byOperator = false,
    this.hiddenReviews,
    this.restoredReviews,
  });

  bool get isBlock => action == 'user_block';

  factory AdminUserBlockAction.fromJson(Map<String, dynamic> json) {
    final created = json['created_at'];
    return AdminUserBlockAction(
      action: json['action'] as String? ?? '',
      reason: json['reason'] as String?,
      createdAt: created is String ? DateTime.tryParse(created) : null,
      adminName: json['admin_name'] as String?,
      byOperator: json['by_operator'] == true,
      hiddenReviews: json['hidden_reviews'] as int?,
      restoredReviews: json['restored_reviews'] as int?,
    );
  }
}

/// Карточка заведения партнёра — в его карточке на экране «Пользователи»
/// (осмотр панели 20.10, п. 35: «у партнёра не видно, чьё заведение»).
class AdminUserEstablishment {
  final String id;
  final String name;
  final String? city;
  final String status;

  const AdminUserEstablishment({
    required this.id,
    required this.name,
    this.city,
    required this.status,
  });

  factory AdminUserEstablishment.fromJson(Map<String, dynamic> json) =>
      AdminUserEstablishment(
        id: json['id'] as String,
        name: json['name'] as String? ?? '',
        city: json['city'] as String?,
        status: json['status'] as String? ?? '',
      );
}

/// Почему кнопка «Заблокировать» человеку не служит. Сервер откажет и сам
/// (409 с текстом), но кнопка, обещающая невыполнимое, читается как поломка.
enum AdminUserProtection {
  /// Учётка панели — её включает и отключает оператор скриптом.
  panelAccount,

  /// Служебная учётка платформы, владелец карточек каталога.
  serviceAccount,

  /// Партнёр с карточкой в каталоге или на модерации: его блокировка решает
  /// судьбу карточек. Черновик не защищает — его заводит любой пользователь.
  partnerWithEstablishments,
}

class AdminUser {
  final String id;
  final String? name;
  final String? email;
  final String? phone;
  final String role;
  final bool isActive;

  /// Учётку удалил её владелец (или поддержка по его заявке). Она тоже
  /// выключена, но это не блокировка: кнопки блокировки и имени ей не служат
  /// (проход по панели 20.10, A2-05).
  final bool isDeleted;
  final bool isServiceAccount;
  final DateTime? createdAt;

  /// Неудалённые отзывы. Просмотрщику — только видимые.
  final int reviewCount;

  /// Из них скрытые. Просмотрщику не приходит (`null`).
  final int? hiddenReviewCount;

  /// Все карточки партнёра, в любом статусе.
  final int establishmentCount;

  /// Карточки в каталоге или на модерации (`active`, `pending`, `suspended`) —
  /// они, а не черновики, закрывают кнопку блокировки (`adminUserService`).
  final int liveEstablishmentCount;

  /// Только у ответа `/users/:id`.
  final AdminUserBlockAction? lastBlockAction;

  /// Блокировки и разблокировки, новые сверху — только у `/users/:id`.
  /// Пустой список при выключенной учётке — блокировку ставили без записи.
  final List<AdminUserBlockAction> blockHistory;

  /// Карточки партнёра — только у `/users/:id`, и не у просмотрщика (`null`).
  final List<AdminUserEstablishment>? establishments;

  /// Пустые имя и контакты означают «скрыто от просмотрщика», а не «их нет».
  final bool viewerRedacted;

  const AdminUser({
    required this.id,
    this.name,
    this.email,
    this.phone,
    required this.role,
    this.isActive = true,
    this.isDeleted = false,
    this.isServiceAccount = false,
    this.createdAt,
    this.reviewCount = 0,
    this.hiddenReviewCount,
    this.establishmentCount = 0,
    this.liveEstablishmentCount = 0,
    this.lastBlockAction,
    this.blockHistory = const <AdminUserBlockAction>[],
    this.establishments,
    this.viewerRedacted = false,
  });

  factory AdminUser.fromJson(Map<String, dynamic> json) {
    final created = json['created_at'];
    final last = json['last_block_action'];
    final history = json['block_history'];
    final cards = json['establishments'];
    return AdminUser(
      id: json['id'] as String,
      name: json['name'] as String?,
      email: json['email'] as String?,
      phone: json['phone'] as String?,
      role: json['role'] as String? ?? 'user',
      isActive: json['is_active'] as bool? ?? true,
      isDeleted: json['is_deleted'] == true,
      isServiceAccount: json['is_service_account'] as bool? ?? false,
      createdAt: created is String ? DateTime.tryParse(created) : null,
      reviewCount: json['review_count'] as int? ?? 0,
      hiddenReviewCount: json['hidden_review_count'] as int?,
      establishmentCount: json['establishment_count'] as int? ?? 0,
      // Без поля — осторожно: считаем живыми все карточки, кнопки не будет,
      // а сервер всё равно решает сам.
      liveEstablishmentCount: json['live_establishment_count'] as int? ??
          json['establishment_count'] as int? ??
          0,
      lastBlockAction: last is Map<String, dynamic>
          ? AdminUserBlockAction.fromJson(last)
          : null,
      // Прежний сервер истории не знал — тогда [blockEntries] возьмёт
      // последнюю запись.
      blockHistory: history is List
          ? history
              .whereType<Map<String, dynamic>>()
              .map(AdminUserBlockAction.fromJson)
              .toList()
          : const <AdminUserBlockAction>[],
      establishments: cards is List
          ? cards
              .whereType<Map<String, dynamic>>()
              .map(AdminUserEstablishment.fromJson)
              .toList()
          : null,
      viewerRedacted: json['viewer_redacted'] == true,
    );
  }

  /// Почта или телефон — чем человек входит.
  String? get contact {
    final mail = email?.trim();
    if (mail != null && mail.isNotEmpty) return mail;
    final tel = phone?.trim();
    return tel != null && tel.isNotEmpty ? tel : null;
  }

  /// История для карточки: полная — когда сервер её прислал, иначе — из
  /// одной последней записи.
  List<AdminUserBlockAction> get blockEntries => blockHistory.isNotEmpty
      ? blockHistory
      : <AdminUserBlockAction>[if (lastBlockAction != null) lastBlockAction!];

  /// Заблокирован модератором или оператором — выключен и не удалён.
  bool get isBlocked => !isActive && !isDeleted;

  /// Тот же порядок, что у сервера (`adminUserService.lockTarget`).
  /// Удалённая учётка — отдельный случай ([isDeleted]): её не трогают никак.
  AdminUserProtection? get protection {
    if (isPanelRole(role)) return AdminUserProtection.panelAccount;
    if (isServiceAccount) return AdminUserProtection.serviceAccount;
    if (liveEstablishmentCount > 0) {
      return AdminUserProtection.partnerWithEstablishments;
    }
    return null;
  }

  /// Можно ли сбросить имя: партнёру с карточками — да, имя его, а не карточек.
  bool get canResetName =>
      protection == null ||
      protection == AdminUserProtection.partnerWithEstablishments;
}

/// Страница списка.
/// Что вернула блокировка: сколько видимых отзывов скрыто.
class AdminUserBlockResult {
  final bool changed;

  /// `null` — сервер не сказал (прежний ответ).
  final int? hiddenReviews;

  const AdminUserBlockResult({required this.changed, this.hiddenReviews});
}

/// Что вернула разблокировка: сколько отзывов вернулось из скольких,
/// скрытых блокировкой (проход по панели 20.10, A2-06).
class AdminUserUnblockResult {
  final bool changed;
  final int restoredReviews;

  /// Сколько отзывов скрыла блокировка, которую сняли. `null` — сервер не
  /// сказал (прежний ответ).
  final int? blockHiddenReviews;

  /// Блокировку ставил скрипт оператора — список скрытых не записан.
  final bool blockByOperator;

  /// Запись о блокировке в журнале была.
  final bool blockFound;

  const AdminUserUnblockResult({
    required this.changed,
    this.restoredReviews = 0,
    this.blockHiddenReviews,
    this.blockByOperator = false,
    this.blockFound = true,
  });

  factory AdminUserUnblockResult.fromJson(Map<String, dynamic> json) =>
      AdminUserUnblockResult(
        changed: json['changed'] != false,
        restoredReviews: json['restored_reviews'] as int? ?? 0,
        blockHiddenReviews: json['block_hidden_reviews'] as int?,
        blockByOperator: json['block_by_operator'] == true,
        blockFound: json['block_found'] as bool? ?? true,
      );
}

class AdminUserListResponse {
  final List<AdminUser> users;
  final int total;
  final int page;
  final int pages;

  const AdminUserListResponse({
    required this.users,
    required this.total,
    required this.page,
    required this.pages,
  });
}
