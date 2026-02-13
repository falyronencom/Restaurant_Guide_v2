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
  final DateTime createdAt;
  final Map<String, dynamic>? oldData;
  final Map<String, dynamic>? newData;
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
    required this.createdAt,
    this.oldData,
    this.newData,
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
      createdAt: DateTime.parse(json['created_at'] as String),
      oldData: json['old_data'] as Map<String, dynamic>?,
      newData: json['new_data'] as Map<String, dynamic>?,
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
