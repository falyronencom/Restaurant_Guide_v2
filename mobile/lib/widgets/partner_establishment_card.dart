import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:restaurant_guide_mobile/models/partner_establishment.dart';

/// Partner Establishment Card widget
/// Displays establishment info with stats and status for partner dashboard
/// Based on Figma design: Profile/Log In - Partner card section
/// Phase 5.2 - Partner Dashboard
class PartnerEstablishmentCard extends StatelessWidget {
  final PartnerEstablishment establishment;
  final VoidCallback? onTap;
  final VoidCallback? onEditTap;
  final VoidCallback? onPromotionTap;

  const PartnerEstablishmentCard({
    super.key,
    required this.establishment,
    this.onTap,
    this.onEditTap,
    this.onPromotionTap,
  });

  // ============================================================================
  // Colors from Figma
  // ============================================================================

  static const Color _backgroundColor = Color(0xFFF4F1EC);
  static const Color _cardDarkBg = Color(0xFF000000);
  static const Color _primaryOrange = Color(0xFFF06B32);
  static const Color _greyText = Color(0xFFC7C3BC);
  static const Color _darkGreyText = Color(0xFF717171);

  // Status colors
  static const Color _statusPending = Color(0xFFFFA500);
  static const Color _statusApproved = Color(0xFF34C759);
  static const Color _statusRejected = Color(0xFFFF3B30);
  static const Color _statusSuspended = Color(0xFF8E8E93);

  @override
  Widget build(BuildContext context) {
    final isPremium = establishment.isPremium;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        // Main card
        GestureDetector(
          onTap: onTap,
          child: Container(
            width: double.infinity,
            height: 277,
            decoration: BoxDecoration(
              color: isPremium ? _cardDarkBg : _backgroundColor,
              borderRadius: BorderRadius.circular(10),
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFFD35620).withValues(alpha: 0.08),
                  blurRadius: 15,
                  spreadRadius: 2,
                  offset: const Offset(4, 4),
                ),
                BoxShadow(
                  color: const Color(0xFFD35620).withValues(alpha: 0.08),
                  blurRadius: 15,
                  spreadRadius: 2,
                  offset: const Offset(-4, -4),
                ),
              ],
            ),
            child: Stack(
              children: [
                // Image section (top portion with mask)
                Positioned(
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 120,
                  child: ClipRRect(
                    borderRadius: const BorderRadius.only(
                      topLeft: Radius.circular(10),
                      topRight: Radius.circular(10),
                      bottomLeft: Radius.circular(60),
                      bottomRight: Radius.circular(60),
                    ),
                    child: _buildImage(),
                  ),
                ),

                // Content section
                Positioned(
                  left: 18,
                  top: 125,
                  child: _buildEstablishmentInfo(isPremium),
                ),

                // Stats section (top right)
                Positioned(
                  top: 128,
                  right: 10,
                  child: _buildStats(isPremium),
                ),

                // Address (bottom left)
                Positioned(
                  left: 18,
                  bottom: 45,
                  child: Text(
                    establishment.shortAddress,
                    style: TextStyle(
                      fontFamily: 'Avenir Next',
                      fontSize: 14,
                      color: isPremium ? _backgroundColor : Colors.black,
                    ),
                  ),
                ),

                // Promotion button (bottom right)
                Positioned(
                  right: 10,
                  bottom: 18,
                  child: _buildPromotionButton(),
                ),
              ],
            ),
          ),
        ),

        const SizedBox(height: 8),

        // Edit link
        GestureDetector(
          onTap: onEditTap,
          child: const Padding(
            padding: EdgeInsets.symmetric(horizontal: 8),
            child: Text(
              'Редактировать',
              style: TextStyle(
                fontFamily: 'Avenir Next',
                fontSize: 14,
                color: Colors.black,
                decoration: TextDecoration.underline,
              ),
            ),
          ),
        ),

        const SizedBox(height: 8),

        // Status badge
        _buildStatusBadge(),
      ],
    );
  }

  /// Build establishment image
  Widget _buildImage() {
    if (establishment.primaryImageUrl != null &&
        establishment.primaryImageUrl!.isNotEmpty) {
      return CachedNetworkImage(
        imageUrl: establishment.primaryImageUrl!,
        fit: BoxFit.cover,
        placeholder: (context, url) => Container(
          color: _greyText.withValues(alpha: 0.3),
          child: const Center(
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: _primaryOrange,
            ),
          ),
        ),
        errorWidget: (context, url, error) => Container(
          color: _greyText.withValues(alpha: 0.3),
          child: const Icon(Icons.restaurant, size: 40, color: Colors.grey),
        ),
      );
    }

    return Container(
      color: _greyText.withValues(alpha: 0.3),
      child: const Center(
        child: Icon(Icons.restaurant, size: 40, color: Colors.grey),
      ),
    );
  }

  /// Build establishment info (name, type, cuisine)
  Widget _buildEstablishmentInfo(bool isPremium) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Name
        Text(
          establishment.name,
          style: TextStyle(
            fontFamily: 'Unbounded',
            fontSize: 22,
            fontWeight: FontWeight.w400,
            color: isPremium ? _backgroundColor : Colors.black,
          ),
        ),
        // Type
        Text(
          establishment.categoryDisplayName,
          style: TextStyle(
            fontFamily: 'Avenir Next',
            fontSize: 15,
            color: isPremium ? _backgroundColor : Colors.black,
          ),
        ),
        // Cuisine
        Text(
          establishment.cuisineDisplayName,
          style: TextStyle(
            fontFamily: 'Avenir Next',
            fontSize: 13,
            color: isPremium ? _darkGreyText : _greyText,
          ),
        ),
      ],
    );
  }

  /// Build stats row (views, shares, favorites)
  Widget _buildStats(bool isPremium) {
    final stats = establishment.stats;
    final statColor = isPremium ? _backgroundColor : _greyText;

    return Row(
      children: [
        _buildStatItem(
          icon: Icons.visibility_outlined,
          value: stats.views,
          color: statColor,
        ),
        const SizedBox(width: 12),
        _buildStatItem(
          icon: Icons.ios_share_outlined,
          value: stats.shares,
          color: statColor,
        ),
        const SizedBox(width: 12),
        _buildStatItem(
          icon: Icons.favorite_border,
          value: stats.favorites,
          color: statColor,
        ),
      ],
    );
  }

  /// Build single stat item
  Widget _buildStatItem({
    required IconData icon,
    required int value,
    required Color color,
  }) {
    return Row(
      children: [
        Icon(icon, size: 20, color: color),
        const SizedBox(width: 4),
        Text(
          '$value',
          style: TextStyle(
            fontFamily: 'Avenir Next',
            fontSize: 14,
            fontWeight: FontWeight.w500,
            color: color,
          ),
        ),
      ],
    );
  }

  /// Build promotion button
  Widget _buildPromotionButton() {
    final isPremium = establishment.isPremium;

    return GestureDetector(
      onTap: onPromotionTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: BoxDecoration(
          color: isPremium ? _primaryOrange : _cardDarkBg,
          borderRadius: BorderRadius.circular(11),
        ),
        child: const Text(
          'Продвижение',
          style: TextStyle(
            fontFamily: 'Avenir Next',
            fontSize: 15,
            fontWeight: FontWeight.w500,
            color: _backgroundColor,
          ),
        ),
      ),
    );
  }

  /// Build status badge below the card
  Widget _buildStatusBadge() {
    Color statusColor;
    String statusText;

    switch (establishment.status) {
      case EstablishmentStatus.draft:
        statusColor = _statusPending;
        statusText = 'Черновик';
        break;
      case EstablishmentStatus.pending:
        statusColor = _statusPending;
        statusText = 'На модерации';
        break;
      case EstablishmentStatus.approved:
        statusColor = _statusApproved;
        statusText = 'Одобрено';
        break;
      case EstablishmentStatus.rejected:
        statusColor = _statusRejected;
        statusText = 'Отклонено';
        break;
      case EstablishmentStatus.suspended:
        statusColor = _statusSuspended;
        statusText = 'Приостановлено';
        break;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Text(
        statusText,
        style: TextStyle(
          fontFamily: 'Avenir Next',
          fontSize: 14,
          fontWeight: FontWeight.w500,
          color: statusColor,
        ),
      ),
    );
  }
}
