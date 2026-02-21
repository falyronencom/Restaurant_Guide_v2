import 'package:flutter/material.dart';

/// Reusable metric card for the Dashboard.
/// Shows title, large number, change percentage with colored indicator,
/// and optional subtitle.
class MetricCard extends StatelessWidget {
  final String title;
  final String value;
  final double? changePercent;
  final String? subtitle;
  final IconData icon;
  final Color iconColor;

  const MetricCard({
    super.key,
    required this.title,
    required this.value,
    this.changePercent,
    this.subtitle,
    required this.icon,
    this.iconColor = const Color(0xFFF06B32),
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
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
                  color: iconColor.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(icon, color: iconColor, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  title,
                  style: TextStyle(
                    fontSize: 13,
                    color: Colors.grey[600],
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            value,
            style: const TextStyle(
              fontSize: 28,
              fontWeight: FontWeight.w700,
              color: Color(0xFF1A1A1A),
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              _buildChangeIndicator(),
              if (subtitle != null)
                Text(
                  subtitle!,
                  style: TextStyle(
                    fontSize: 12,
                    color: Colors.grey[500],
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildChangeIndicator() {
    if (changePercent == null) {
      return Text(
        'Новый показатель',
        style: TextStyle(fontSize: 12, color: Colors.grey[500]),
      );
    }

    final isPositive = changePercent! > 0;
    final isZero = changePercent == 0;
    final color = isZero
        ? Colors.grey[500]!
        : isPositive
            ? const Color(0xFF3FD00D)
            : Colors.red[600]!;
    final arrow = isZero ? '' : (isPositive ? '\u2191 ' : '\u2193 ');
    final sign = isPositive ? '+' : '';

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          '$arrow$sign${changePercent!.toStringAsFixed(1)}%',
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: color,
          ),
        ),
        const SizedBox(width: 4),
        Text(
          'vs пред. период',
          style: TextStyle(fontSize: 11, color: Colors.grey[500]),
        ),
      ],
    );
  }
}
