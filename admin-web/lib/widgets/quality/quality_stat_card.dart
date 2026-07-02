import 'package:flutter/material.dart';

/// Compact health stat tile for the Quality Health panel.
///
/// Mirrors the MetricCard container, but colors by THRESHOLD rather than
/// period-over-period: a non-zero problem count reads red, zero reads green.
/// Informational signals (problemWhenNonZero=false, e.g. a census count) render
/// neutrally.
class QualityStatCard extends StatelessWidget {
  final String title;
  final int count;
  final String subtitle;
  final IconData icon;

  /// When true, count>0 is a problem (red); count==0 is clean (green).
  /// When false, the count is purely informational (neutral grey).
  final bool problemWhenNonZero;

  const QualityStatCard({
    super.key,
    required this.title,
    required this.count,
    required this.subtitle,
    required this.icon,
    this.problemWhenNonZero = true,
  });

  @override
  Widget build(BuildContext context) {
    final bool isProblem = problemWhenNonZero && count > 0;

    final Color accent = !problemWhenNonZero
        ? const Color(0xFF6B7280) // neutral grey — informational
        : (isProblem ? const Color(0xFFDC2626) : const Color(0xFF3FD00D));

    final String statusLabel = !problemWhenNonZero
        ? 'инфо'
        : (isProblem ? 'внимание' : 'чисто');

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: isProblem
              ? accent.withValues(alpha: 0.35)
              : const Color(0x11000000),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 10,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(icon, color: accent, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  title,
                  style: TextStyle(
                    fontSize: 13,
                    color: Colors.grey[700],
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                '$count',
                style: const TextStyle(
                  fontSize: 28,
                  fontWeight: FontWeight.w700,
                  color: Color(0xFF1A1A1A),
                ),
              ),
              const SizedBox(width: 10),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  statusLabel,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: accent,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            subtitle,
            style: TextStyle(fontSize: 12, color: Colors.grey[500]),
          ),
        ],
      ),
    );
  }
}
