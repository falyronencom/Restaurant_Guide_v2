import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/models/audit_log_entry.dart';
import 'package:restaurant_guide_admin_web/providers/audit_log_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/period_selector.dart';

/// Audit Log viewer — "Журнал действий"
/// Table-based view of all admin actions in reverse chronological order.
class AuditLogScreen extends StatefulWidget {
  const AuditLogScreen({super.key});

  @override
  State<AuditLogScreen> createState() => _AuditLogScreenState();
}

class _AuditLogScreenState extends State<AuditLogScreen> {
  String _period = '30d';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<AuditLogProvider>().loadEntries();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _buildHeader(),
        const Divider(height: 1),
        _buildFilterBar(),
        const Divider(height: 1),
        Expanded(child: _buildContent()),
      ],
    );
  }

  Widget _buildHeader() {
    return Consumer<AuditLogProvider>(
      builder: (context, provider, _) {
        return Padding(
          padding: const EdgeInsets.fromLTRB(24, 20, 24, 16),
          child: Row(
            children: [
              Text(
                'Журнал действий',
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
              ),
              const SizedBox(width: 12),
              if (!provider.isLoading)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.grey[200],
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    '${provider.totalCount}',
                    style: TextStyle(
                      color: Colors.grey[700],
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildFilterBar() {
    return Consumer<AuditLogProvider>(
      builder: (context, provider, _) {
        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
          child: Wrap(
            spacing: 16,
            runSpacing: 12,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              // Action type filter
              SizedBox(
                width: 220,
                child: InputDecorator(
                  decoration: InputDecoration(
                    labelText: 'Тип действия',
                    contentPadding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 6),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                    isDense: true,
                  ),
                  child: DropdownButtonHideUnderline(
                    child: DropdownButton<String>(
                      value: provider.actionFilter,
                      isExpanded: true,
                      isDense: true,
                      items: const [
                        DropdownMenuItem(
                            value: null, child: Text('Все действия')),
                        DropdownMenuItem(
                            value: 'moderate_approve',
                            child: Text('Одобрение')),
                        DropdownMenuItem(
                            value: 'moderate_reject',
                            child: Text('Отклонение')),
                        DropdownMenuItem(
                            value: 'suspend',
                            child: Text('Приостановка')),
                        DropdownMenuItem(
                            value: 'unsuspend',
                            child: Text('Возобновление')),
                        DropdownMenuItem(
                            value: 'review_hide',
                            child: Text('Скрытие отзыва')),
                        DropdownMenuItem(
                            value: 'review_show',
                            child: Text('Показ отзыва')),
                        DropdownMenuItem(
                            value: 'review_delete',
                            child: Text('Удаление отзыва')),
                      ],
                      onChanged: (value) => provider.setActionFilter(value),
                    ),
                  ),
                ),
              ),
              // Period selector (reused from analytics)
              PeriodSelector(
                currentPeriod: _period,
                onPeriodChanged: (selection) {
                  setState(() => _period = selection.period);
                  if (selection.period == 'custom') {
                    provider.setDateRange(selection.from, selection.to);
                  } else {
                    final now = DateTime.now();
                    final days = switch (selection.period) {
                      '7d' => 7,
                      '30d' => 30,
                      '90d' => 90,
                      _ => 30,
                    };
                    provider.setDateRange(
                      now.subtract(Duration(days: days)),
                      null,
                    );
                  }
                },
              ),
              // Clear filters
              if (provider.actionFilter != null ||
                  provider.dateFrom != null ||
                  provider.dateTo != null)
                TextButton.icon(
                  onPressed: () {
                    setState(() => _period = '30d');
                    provider.clearFilters();
                  },
                  icon: const Icon(Icons.clear, size: 16),
                  label: const Text('Сбросить'),
                  style: TextButton.styleFrom(
                    foregroundColor: Colors.grey[600],
                  ),
                ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildContent() {
    return Consumer<AuditLogProvider>(
      builder: (context, provider, _) {
        if (provider.isLoading && provider.entries.isEmpty) {
          return const Center(child: CircularProgressIndicator());
        }

        if (provider.error != null && provider.entries.isEmpty) {
          return Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.error_outline, size: 48, color: Colors.grey[400]),
                const SizedBox(height: 12),
                Text(provider.error!,
                    style: TextStyle(color: Colors.grey[600])),
                const SizedBox(height: 12),
                TextButton(
                  onPressed: () => provider.loadEntries(),
                  child: const Text('Повторить'),
                ),
              ],
            ),
          );
        }

        if (provider.entries.isEmpty) {
          return Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.history, size: 48, color: Colors.grey[400]),
                const SizedBox(height: 12),
                Text('Записи не найдены',
                    style: TextStyle(color: Colors.grey[600], fontSize: 16)),
              ],
            ),
          );
        }

        return Column(
          children: [
            Expanded(
              child: SingleChildScrollView(
                child: _buildTable(provider),
              ),
            ),
            if (provider.totalPages > 1)
              _buildPagination(provider),
          ],
        );
      },
    );
  }

  Widget _buildTable(AuditLogProvider provider) {
    final dateFormat = DateFormat('dd.MM.yyyy HH:mm', 'ru');

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: Table(
        columnWidths: const {
          0: FixedColumnWidth(150), // Дата/время
          1: FlexColumnWidth(2),   // Действие
          2: FlexColumnWidth(1.5), // Объект
          3: FlexColumnWidth(1.5), // Администратор
          4: FixedColumnWidth(40), // Expand icon
        },
        defaultVerticalAlignment: TableCellVerticalAlignment.middle,
        children: [
          // Header row
          TableRow(
            decoration: BoxDecoration(
              border: Border(bottom: BorderSide(color: Colors.grey[300]!)),
            ),
            children: [
              _headerCell('Дата/время'),
              _headerCell('Действие'),
              _headerCell('Объект'),
              _headerCell('Администратор'),
              const SizedBox(height: 44),
            ],
          ),
          // Data rows
          for (final entry in provider.entries) ...[
            TableRow(
              decoration: BoxDecoration(
                color: provider.expandedEntryId == entry.id
                    ? const Color(0xFFF06B32).withValues(alpha: 0.04)
                    : null,
                border: Border(
                    bottom: BorderSide(color: Colors.grey[200]!)),
              ),
              children: [
                _dataCell(dateFormat.format(entry.createdAt.toLocal())),
                _dataCell(entry.summary),
                _dataCell(
                  '${entry.entityType}${entry.entityId != null ? '\n${_truncateId(entry.entityId!)}' : ''}',
                ),
                _dataCell(entry.adminName ?? entry.adminEmail ?? '—'),
                InkWell(
                  onTap: () => provider.toggleExpanded(entry.id),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Icon(
                      provider.expandedEntryId == entry.id
                          ? Icons.expand_less
                          : Icons.expand_more,
                      size: 20,
                      color: Colors.grey[500],
                    ),
                  ),
                ),
              ],
            ),
            // Expanded detail row
            if (provider.expandedEntryId == entry.id)
              TableRow(
                decoration: BoxDecoration(
                  color: Colors.grey[50],
                  border: Border(
                      bottom: BorderSide(color: Colors.grey[200]!)),
                ),
                children: [
                  const SizedBox(),
                  _buildDetailCell(entry),
                  const SizedBox(),
                  const SizedBox(),
                  const SizedBox(),
                ],
              ),
          ],
        ],
      ),
    );
  }

  Widget _headerCell(String text) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
      child: Text(
        text,
        style: TextStyle(
          fontWeight: FontWeight.w600,
          fontSize: 13,
          color: Colors.grey[600],
        ),
      ),
    );
  }

  Widget _dataCell(String text) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
      child: Text(
        text,
        style: const TextStyle(fontSize: 14),
      ),
    );
  }

  Widget _buildDetailCell(AuditLogEntry entry) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 8, 8, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (entry.oldData != null) ...[
            Text('Данные до:',
                style: TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 12,
                    color: Colors.grey[600])),
            const SizedBox(height: 4),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(4),
                border: Border.all(color: Colors.grey[300]!),
              ),
              child: Text(
                _formatJson(entry.oldData!),
                style: const TextStyle(fontSize: 12, fontFamily: 'monospace'),
              ),
            ),
            const SizedBox(height: 8),
          ],
          if (entry.newData != null) ...[
            Text('Данные после:',
                style: TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 12,
                    color: Colors.grey[600])),
            const SizedBox(height: 4),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(4),
                border: Border.all(color: Colors.grey[300]!),
              ),
              child: Text(
                _formatJson(entry.newData!),
                style: const TextStyle(fontSize: 12, fontFamily: 'monospace'),
              ),
            ),
          ],
          if (entry.oldData == null && entry.newData == null)
            Text(
              'Нет данных',
              style: TextStyle(
                  fontSize: 13,
                  color: Colors.grey[500],
                  fontStyle: FontStyle.italic),
            ),
        ],
      ),
    );
  }

  Widget _buildPagination(AuditLogProvider provider) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 24),
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: Colors.grey[200]!)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          IconButton(
            icon: const Icon(Icons.chevron_left),
            onPressed: provider.currentPage > 1
                ? () => provider.loadEntries(page: provider.currentPage - 1)
                : null,
          ),
          for (int i = 1; i <= provider.totalPages && i <= 7; i++)
            _pageButton(i, provider),
          if (provider.totalPages > 7)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: Text('...', style: TextStyle(color: Colors.grey[500])),
            ),
          IconButton(
            icon: const Icon(Icons.chevron_right),
            onPressed: provider.currentPage < provider.totalPages
                ? () => provider.loadEntries(page: provider.currentPage + 1)
                : null,
          ),
        ],
      ),
    );
  }

  Widget _pageButton(int page, AuditLogProvider provider) {
    final isActive = page == provider.currentPage;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 2),
      child: Material(
        color: isActive ? const Color(0xFFF06B32) : Colors.transparent,
        borderRadius: BorderRadius.circular(6),
        child: InkWell(
          onTap: isActive ? null : () => provider.loadEntries(page: page),
          borderRadius: BorderRadius.circular(6),
          child: Container(
            constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
            alignment: Alignment.center,
            child: Text(
              '$page',
              style: TextStyle(
                color: isActive ? Colors.white : Colors.grey[700],
                fontWeight: isActive ? FontWeight.w600 : FontWeight.w400,
                fontSize: 14,
              ),
            ),
          ),
        ),
      ),
    );
  }

  String _truncateId(String id) {
    if (id.length <= 8) return id;
    return '${id.substring(0, 8)}...';
  }

  String _formatJson(Map<String, dynamic> data) {
    const encoder = JsonEncoder.withIndent('  ');
    return encoder.convert(data);
  }
}
