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

  const AdminUserBlockAction({
    required this.action,
    this.reason,
    this.createdAt,
    this.adminName,
  });

  bool get isBlock => action == 'user_block';

  factory AdminUserBlockAction.fromJson(Map<String, dynamic> json) {
    final created = json['created_at'];
    return AdminUserBlockAction(
      action: json['action'] as String? ?? '',
      reason: json['reason'] as String?,
      createdAt: created is String ? DateTime.tryParse(created) : null,
      adminName: json['admin_name'] as String?,
    );
  }
}

/// Почему кнопка «Заблокировать» человеку не служит. Сервер откажет и сам
/// (409 с текстом), но кнопка, обещающая невыполнимое, читается как поломка.
enum AdminUserProtection {
  /// Учётка панели — её включает и отключает оператор скриптом.
  panelAccount,

  /// Служебная учётка платформы, владелец карточек каталога.
  serviceAccount,

  /// Партнёр с карточками: его блокировка решает судьбу карточек.
  partnerWithEstablishments,
}

class AdminUser {
  final String id;
  final String? name;
  final String? email;
  final String? phone;
  final String role;
  final bool isActive;
  final bool isServiceAccount;
  final DateTime? createdAt;

  /// Неудалённые отзывы. Просмотрщику — только видимые.
  final int reviewCount;

  /// Из них скрытые. Просмотрщику не приходит (`null`).
  final int? hiddenReviewCount;
  final int establishmentCount;

  /// Только у ответа `/users/:id`.
  final AdminUserBlockAction? lastBlockAction;

  /// Пустые имя и контакты означают «скрыто от просмотрщика», а не «их нет».
  final bool viewerRedacted;

  const AdminUser({
    required this.id,
    this.name,
    this.email,
    this.phone,
    required this.role,
    this.isActive = true,
    this.isServiceAccount = false,
    this.createdAt,
    this.reviewCount = 0,
    this.hiddenReviewCount,
    this.establishmentCount = 0,
    this.lastBlockAction,
    this.viewerRedacted = false,
  });

  factory AdminUser.fromJson(Map<String, dynamic> json) {
    final created = json['created_at'];
    final last = json['last_block_action'];
    return AdminUser(
      id: json['id'] as String,
      name: json['name'] as String?,
      email: json['email'] as String?,
      phone: json['phone'] as String?,
      role: json['role'] as String? ?? 'user',
      isActive: json['is_active'] as bool? ?? true,
      isServiceAccount: json['is_service_account'] as bool? ?? false,
      createdAt: created is String ? DateTime.tryParse(created) : null,
      reviewCount: json['review_count'] as int? ?? 0,
      hiddenReviewCount: json['hidden_review_count'] as int?,
      establishmentCount: json['establishment_count'] as int? ?? 0,
      lastBlockAction: last is Map<String, dynamic>
          ? AdminUserBlockAction.fromJson(last)
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

  /// Тот же порядок, что у сервера (`adminUserService.lockTarget`).
  AdminUserProtection? get protection {
    if (isPanelRole(role)) return AdminUserProtection.panelAccount;
    if (isServiceAccount) return AdminUserProtection.serviceAccount;
    if (establishmentCount > 0) {
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
