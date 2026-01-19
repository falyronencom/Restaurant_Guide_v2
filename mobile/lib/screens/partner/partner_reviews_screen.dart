import 'package:flutter/material.dart';

/// Partner Reviews Screen - view and filter establishment reviews
/// Figma design: Profile/Admin (Отзывы) frame
/// Phase 5.2b - Partner Dashboard
class PartnerReviewsScreen extends StatefulWidget {
  final int establishmentId;

  const PartnerReviewsScreen({
    super.key,
    required this.establishmentId,
  });

  @override
  State<PartnerReviewsScreen> createState() => _PartnerReviewsScreenState();
}

class _PartnerReviewsScreenState extends State<PartnerReviewsScreen> {
  // Figma colors
  static const Color _backgroundColor = Color(0xFFF4F1EC);
  static const Color _primaryOrange = Color(0xFFDB4F13);
  static const Color _greyText = Color(0xFFABABAB);
  static const Color _greyStroke = Color(0xFFD2D2D2);
  static const Color _greenRating = Color(0xFF34C759);

  // Date filter
  DateTime _dateFrom = DateTime.now().subtract(const Duration(days: 30));
  DateTime _dateTo = DateTime.now();

  // Sort option
  String _sortOption = 'По дате (новые)';
  final List<String> _sortOptions = [
    'По дате (новые)',
    'По дате (старые)',
    'По рейтингу (высокий)',
    'По рейтингу (низкий)',
  ];

  // Mock reviews data
  late List<_MockReview> _reviews;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadReviews();
  }

  Future<void> _loadReviews() async {
    setState(() => _isLoading = true);

    // Simulate network delay
    await Future.delayed(const Duration(milliseconds: 500));

    // Mock data
    _reviews = [
      _MockReview(
        id: 1,
        userName: 'Oleg P.',
        userAvatarColor: Colors.red,
        rating: 4.5,
        text: 'Хорошая кухня, красивый интерьер.\nЗаказ был подан быстро.',
        createdAt: DateTime.now().subtract(const Duration(hours: 2)),
      ),
      _MockReview(
        id: 2,
        userName: 'Eda_POP',
        userAvatarColor: Colors.blue,
        rating: 4.0,
        text: 'Довольно миленько и вкусно\u{1F60A}\nНемного шумно',
        createdAt: DateTime.now().subtract(const Duration(hours: 5)),
      ),
      _MockReview(
        id: 3,
        userName: 'Elena1010',
        userAvatarColor: Colors.pink,
        rating: 4.8,
        text: 'Очень вкусно\u{1F60D}',
        createdAt: DateTime.now().subtract(const Duration(days: 1)),
      ),
      _MockReview(
        id: 4,
        userName: 'MaxFood',
        userAvatarColor: Colors.green,
        rating: 3.5,
        text: 'Нормально, но ожидал большего за такую цену. Обслуживание хорошее.',
        createdAt: DateTime.now().subtract(const Duration(days: 2)),
      ),
      _MockReview(
        id: 5,
        userName: 'Anna_K',
        userAvatarColor: Colors.purple,
        rating: 5.0,
        text: 'Идеальное место для романтического ужина! Рекомендую всем.',
        createdAt: DateTime.now().subtract(const Duration(days: 3)),
      ),
    ];

    setState(() => _isLoading = false);
  }

  void _sortReviews() {
    switch (_sortOption) {
      case 'По дате (новые)':
        _reviews.sort((a, b) => b.createdAt.compareTo(a.createdAt));
        break;
      case 'По дате (старые)':
        _reviews.sort((a, b) => a.createdAt.compareTo(b.createdAt));
        break;
      case 'По рейтингу (высокий)':
        _reviews.sort((a, b) => b.rating.compareTo(a.rating));
        break;
      case 'По рейтингу (низкий)':
        _reviews.sort((a, b) => a.rating.compareTo(b.rating));
        break;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _backgroundColor,
      body: SafeArea(
        child: Column(
          children: [
            // Header
            _buildHeader(context),

            // Date filter
            _buildDateFilter(),

            const SizedBox(height: 8),

            // Sort button
            _buildSortButton(),

            const SizedBox(height: 16),

            // Reviews list
            Expanded(
              child: _isLoading
                  ? const Center(
                      child: CircularProgressIndicator(color: _primaryOrange),
                    )
                  : _reviews.isEmpty
                      ? _buildEmptyState()
                      : _buildReviewsList(),
            ),
          ],
        ),
      ),
    );
  }

  /// Build header with back button and title
  Widget _buildHeader(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      child: Row(
        children: [
          GestureDetector(
            onTap: () => Navigator.of(context).pop(),
            child: const Icon(
              Icons.chevron_left,
              size: 28,
              color: Colors.black,
            ),
          ),
          const SizedBox(width: 8),
          const Text(
            'Отзывы',
            style: TextStyle(
              fontFamily: 'Unbounded',
              fontSize: 25,
              fontWeight: FontWeight.w400,
              color: _primaryOrange,
            ),
          ),
        ],
      ),
    );
  }

  /// Build date filter row
  Widget _buildDateFilter() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        children: [
          // From date
          const Text(
            'от',
            style: TextStyle(
              fontFamily: 'Avenir Next',
              fontSize: 15,
              color: Colors.black,
            ),
          ),
          const SizedBox(width: 8),
          _buildDateButton(_dateFrom, true),

          const SizedBox(width: 16),

          // To date
          const Text(
            'до',
            style: TextStyle(
              fontFamily: 'Avenir Next',
              fontSize: 15,
              color: Colors.black,
            ),
          ),
          const SizedBox(width: 8),
          _buildDateButton(_dateTo, false),
        ],
      ),
    );
  }

  /// Build date picker button
  Widget _buildDateButton(DateTime date, bool isFrom) {
    return GestureDetector(
      onTap: () => _showDatePicker(isFrom),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        decoration: BoxDecoration(
          border: Border.all(color: _greyStroke),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              _formatDate(date),
              style: const TextStyle(
                fontFamily: 'Avenir Next',
                fontSize: 15,
                color: Colors.black,
              ),
            ),
            const SizedBox(width: 8),
            const Icon(
              Icons.calendar_today_outlined,
              size: 20,
              color: Colors.black54,
            ),
          ],
        ),
      ),
    );
  }

  /// Show date picker
  Future<void> _showDatePicker(bool isFrom) async {
    final initialDate = isFrom ? _dateFrom : _dateTo;
    final firstDate = DateTime(2020);
    final lastDate = DateTime.now();

    final picked = await showDatePicker(
      context: context,
      initialDate: initialDate,
      firstDate: firstDate,
      lastDate: lastDate,
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            colorScheme: const ColorScheme.light(
              primary: _primaryOrange,
              onPrimary: _backgroundColor,
              surface: _backgroundColor,
            ),
          ),
          child: child!,
        );
      },
    );

    if (picked != null) {
      setState(() {
        if (isFrom) {
          _dateFrom = picked;
        } else {
          _dateTo = picked;
        }
      });
    }
  }

  /// Format date as DD.MM.YYYY
  String _formatDate(DateTime date) {
    return '${date.day.toString().padLeft(2, '0')}.${date.month.toString().padLeft(2, '0')}.${date.year}';
  }

  /// Build sort button
  Widget _buildSortButton() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Align(
        alignment: Alignment.centerRight,
        child: GestureDetector(
          onTap: _showSortOptions,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Transform.rotate(
                angle: 1.5708, // 90 degrees
                child: const Icon(
                  Icons.swap_horiz,
                  size: 22,
                  color: Colors.black,
                ),
              ),
              const SizedBox(width: 4),
              const Text(
                'Сортировка',
                style: TextStyle(
                  fontFamily: 'Avenir Next',
                  fontSize: 14,
                  color: Colors.black,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Show sort options bottom sheet
  void _showSortOptions() {
    showModalBottomSheet(
      context: context,
      backgroundColor: _backgroundColor,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 16),
            const Text(
              'Сортировка',
              style: TextStyle(
                fontFamily: 'Avenir Next',
                fontSize: 18,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(height: 16),
            ..._sortOptions.map((option) => ListTile(
              title: Text(
                option,
                style: TextStyle(
                  fontFamily: 'Avenir Next',
                  fontSize: 16,
                  color: option == _sortOption ? _primaryOrange : Colors.black,
                ),
              ),
              trailing: option == _sortOption
                  ? const Icon(Icons.check, color: _primaryOrange)
                  : null,
              onTap: () {
                setState(() {
                  _sortOption = option;
                  _sortReviews();
                });
                Navigator.pop(context);
              },
            )),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }

  /// Build empty state
  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.rate_review_outlined,
            size: 64,
            color: _greyText.withValues(alpha: 0.5),
          ),
          const SizedBox(height: 16),
          const Text(
            'Нет отзывов за выбранный период',
            style: TextStyle(
              fontFamily: 'Avenir Next',
              fontSize: 16,
              color: _greyText,
            ),
          ),
        ],
      ),
    );
  }

  /// Build reviews list
  Widget _buildReviewsList() {
    return RefreshIndicator(
      onRefresh: _loadReviews,
      color: _primaryOrange,
      child: ListView.builder(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: _reviews.length,
        itemBuilder: (context, index) {
          return Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: _buildReviewCard(_reviews[index]),
          );
        },
      ),
    );
  }

  /// Build review card
  Widget _buildReviewCard(_MockReview review) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: _greyStroke, width: 1.13),
        borderRadius: BorderRadius.circular(11),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header row with avatar, name, and rating
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Avatar
              CircleAvatar(
                radius: 30,
                backgroundColor: review.userAvatarColor,
                child: Text(
                  review.userName[0].toUpperCase(),
                  style: const TextStyle(
                    fontFamily: 'Avenir Next',
                    fontSize: 20,
                    fontWeight: FontWeight.w500,
                    color: Colors.white,
                  ),
                ),
              ),
              const SizedBox(width: 12),

              // Name
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const SizedBox(height: 8),
                    Text(
                      review.userName,
                      style: const TextStyle(
                        fontFamily: 'Avenir Next',
                        fontSize: 18,
                        fontWeight: FontWeight.w500,
                        color: Colors.black,
                      ),
                    ),
                  ],
                ),
              ),

              // Rating badge
              Container(
                width: 31,
                height: 31,
                decoration: BoxDecoration(
                  color: _greenRating,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Center(
                  child: Text(
                    review.rating.toStringAsFixed(1).replaceAll('.', ','),
                    style: const TextStyle(
                      fontFamily: 'Avenir Next',
                      fontSize: 16,
                      color: _backgroundColor,
                    ),
                  ),
                ),
              ),
            ],
          ),

          const SizedBox(height: 8),

          // Date
          Text(
            '– ${_formatRelativeDate(review.createdAt)}',
            style: const TextStyle(
              fontFamily: 'Avenir Next',
              fontSize: 13,
              color: Colors.black,
            ),
          ),

          const SizedBox(height: 8),

          // Review text
          Text(
            review.text,
            style: const TextStyle(
              fontFamily: 'Avenir Next',
              fontSize: 15,
              color: Colors.black,
              height: 1.5,
            ),
          ),
        ],
      ),
    );
  }

  /// Format date as relative time
  String _formatRelativeDate(DateTime date) {
    final now = DateTime.now();
    final difference = now.difference(date);

    final hours = date.hour.toString().padLeft(2, '0');
    final minutes = date.minute.toString().padLeft(2, '0');
    final time = '$hours:$minutes';

    if (difference.inDays < 1) {
      return '$time, сегодня';
    } else if (difference.inDays < 2) {
      return '$time, вчера';
    } else if (difference.inDays < 7) {
      return '$time, ${difference.inDays} дней назад';
    } else {
      return '$time, ${_formatDate(date)}';
    }
  }
}

/// Mock review model
class _MockReview {
  final int id;
  final String userName;
  final Color userAvatarColor;
  final double rating;
  final String text;
  final DateTime createdAt;

  const _MockReview({
    required this.id,
    required this.userName,
    required this.userAvatarColor,
    required this.rating,
    required this.text,
    required this.createdAt,
  });
}
