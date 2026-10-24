/// Data models for audit log viewer
library;

/// Single audit log entry for the list
class AuditLogEntry {
  final String id;
  final String action;
  final String summary;
  final String entityType;
  final String? entityId;
  final String? adminName;
  final String? adminEmail;

  /// Роль исполнителя (`users.role`). Просмотрщику — единственное, что о нём
  /// известно: имя и e-mail сервер ему не отдаёт (пакет 2, пункт 2).
  final String? actorRole;

  /// Кто действовал, когда автора-человека нет: `operator_script` — скрипт
  /// оператора, `system` — сама система; `person` — человек (имя или роль
  /// рядом). Старый сервер поля не присылает — тогда `null`.
  final String? actorKind;
  final DateTime createdAt;
  final Map<String, dynamic>? oldData;
  final Map<String, dynamic>? newData;
  final Map<String, dynamic>? entityContext;
  final String? ipAddress;
  final String? userAgent;

  const AuditLogEntry({
    required this.id,
    required this.action,
    required this.summary,
    required this.entityType,
    this.entityId,
    this.adminName,
    this.adminEmail,
    this.actorRole,
    this.actorKind,
    required this.createdAt,
    this.oldData,
    this.newData,
    this.entityContext,
    this.ipAddress,
    this.userAgent,
  });

  factory AuditLogEntry.fromJson(Map<String, dynamic> json) {
    return AuditLogEntry(
      id: json['id'] as String,
      action: json['action'] as String? ?? '',
      summary: json['summary'] as String? ?? json['action'] as String? ?? '',
      entityType: json['entity_type'] as String? ?? '',
      entityId: json['entity_id'] as String?,
      adminName: json['admin_name'] as String?,
      adminEmail: json['admin_email'] as String?,
      actorRole: json['actor_role'] as String?,
      actorKind: json['actor_kind'] as String?,
      createdAt: DateTime.parse(json['created_at'] as String),
      oldData: json['old_data'] as Map<String, dynamic>?,
      newData: json['new_data'] as Map<String, dynamic>?,
      entityContext: json['entity_context'] as Map<String, dynamic>?,
      ipAddress: json['ip_address'] as String?,
      userAgent: json['user_agent'] as String?,
    );
  }
}

/// Paginated response wrapper
class AuditLogListResponse {
  final List<AuditLogEntry> entries;
  final int total;
  final int page;
  final int pages;

  const AuditLogListResponse({
    required this.entries,
    required this.total,
    required this.page,
    required this.pages,
  });
}
