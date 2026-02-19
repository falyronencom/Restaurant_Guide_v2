import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/models/review.dart';
import 'package:restaurant_guide_mobile/services/reviews_service.dart';

/// Reviews List Screen - displays all reviews for an establishment
/// Figma design: Dark background, review cards with reactions
class ReviewsListScreen extends StatefulWidget {
  final Establishment establishment;

  const ReviewsListScreen({
    super.key,
    required this.establishment,
  });

  @override
  State<ReviewsListScreen> createState() => _ReviewsListScreenState();
}

class _ReviewsListScreenState extends State<ReviewsListScreen> {
  // Services
  final ReviewsService _reviewsService = ReviewsService();

  // State
  List<Review> _reviews = [];
  bool _isLoading = true;
  bool _isLoadingMore = false;
  String? _error;
  int _currentPage = 1;
  int _totalPages = 1;

  // Local reactions state (UI only - no backend yet)
  final Map<String, int> _likes = {};  // Key is review UUID
  final Map<String, int> _dislikes = {};  // Key is review UUID
  final Map<String, String?> _userReactions = {}; // 'like', 'dislike', or null

  // Scroll controller for pagination
  final ScrollController _scrollController = ScrollController();

  // Sort options
  String _sortBy = 'newest'; // 'newest', 'oldest', 'highest', 'lowest'

  // Figma colors
  static const Color _backgroundColor = Color(0xFF000000);
  static const Color _primaryOrange = AppTheme.primaryOrangeDark;
  static const Color _secondaryOrange = AppTheme.primaryOrange;
  static const Color _creamColor = AppTheme.backgroundWarm;
  static const Color _navyBlue = AppTheme.accentNavy;
  static const Color _greyText = Color(0xFFAAAAAA);

  @override
  void initState() {
    super.initState();
    _loadReviews();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    super.dispose();
  }

  /// Handle scroll for pagination
  void _onScroll() {
    if (_scrollController.position.pixels >=
            _scrollController.position.maxScrollExtent - 200 &&
        !_isLoadingMore &&
        _currentPage < _totalPages) {
      _loadMoreReviews();
    }
  }

  /// Load initial reviews
  Future<void> _loadReviews() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final response = await _reviewsService.getReviewsForEstablishment(
        widget.establishment.id,
        page: 1,
        perPage: 10,
      );

      setState(() {
        _reviews = response.data;
        _totalPages = response.meta.totalPages;
        _currentPage = 1;
        _isLoading = false;

        // Initialize reactions with mock data (using hashCode for mock values)
        for (final review in _reviews) {
          _likes[review.id] = (review.id.hashCode.abs() % 10) + 1; // Mock likes
          _dislikes[review.id] = review.id.hashCode.abs() % 3; // Mock dislikes
        }
      });
    } catch (e) {
      setState(() {
        _error = 'Не удалось загрузить отзывы';
        _isLoading = false;
      });
    }
  }

  /// Load more reviews for pagination
  Future<void> _loadMoreReviews() async {
    if (_isLoadingMore) return;

    setState(() {
      _isLoadingMore = true;
    });

    try {
      final response = await _reviewsService.getReviewsForEstablishment(
        widget.establishment.id,
        page: _currentPage + 1,
        perPage: 10,
      );

      setState(() {
        _reviews.addAll(response.data);
        _currentPage++;
        _isLoadingMore = false;

        // Initialize reactions for new reviews (using hashCode for mock values)
        for (final review in response.data) {
          _likes[review.id] = (review.id.hashCode.abs() % 10) + 1;
          _dislikes[review.id] = review.id.hashCode.abs() % 3;
        }
      });
    } catch (e) {
      setState(() {
        _isLoadingMore = false;
      });
    }
  }

  /// Handle like tap
  void _onLikeTap(String reviewId) {
    setState(() {
      final currentReaction = _userReactions[reviewId];

      if (currentReaction == 'like') {
        // Remove like
        _userReactions[reviewId] = null;
        _likes[reviewId] = (_likes[reviewId] ?? 1) - 1;
      } else {
        // Add like
        if (currentReaction == 'dislike') {
          _dislikes[reviewId] = (_dislikes[reviewId] ?? 1) - 1;
        }
        _userReactions[reviewId] = 'like';
        _likes[reviewId] = (_likes[reviewId] ?? 0) + 1;
      }
    });
  }

  /// Handle dislike tap
  void _onDislikeTap(String reviewId) {
    setState(() {
      final currentReaction = _userReactions[reviewId];

      if (currentReaction == 'dislike') {
        // Remove dislike
        _userReactions[reviewId] = null;
        _dislikes[reviewId] = (_dislikes[reviewId] ?? 1) - 1;
      } else {
        // Add dislike
        if (currentReaction == 'like') {
          _likes[reviewId] = (_likes[reviewId] ?? 1) - 1;
        }
        _userReactions[reviewId] = 'dislike';
        _dislikes[reviewId] = (_dislikes[reviewId] ?? 0) + 1;
      }
    });
  }

  /// Show sort options
  void _showSortOptions() {
    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF1C1C1E),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => _buildSortSheet(),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _backgroundColor,
      body: SafeArea(
        child: Column(
          children: [
            // Header
            _buildHeader(),

            // Sort button
            _buildSortButton(),

            // Reviews list
            Expanded(
              child: _buildContent(),
            ),
          ],
        ),
      ),
    );
  }

  /// Build header with back button and title
  Widget _buildHeader() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      child: Row(
        children: [
          // Back button
          GestureDetector(
            onTap: () => Navigator.of(context).pop(),
            child: const Icon(
              Icons.chevron_left,
              size: 28,
              color: _creamColor,
            ),
          ),
          const SizedBox(width: 8),
          // Title
          Text(
            'Все отзывы',
            style: TextStyle(
              fontFamily: AppTheme.fontDisplayFamily,
              fontSize: 25,
              fontWeight: FontWeight.w400,
              color: _primaryOrange,
            ),
          ),
        ],
      ),
    );
  }

  /// Build sort button
  Widget _buildSortButton() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Align(
        alignment: Alignment.centerLeft,
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
                  color: _creamColor,
                ),
              ),
              const SizedBox(width: 10),
              const Text(
                'Сортировка',
                style: TextStyle(
                  fontSize: 14,
                  color: _creamColor,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Build main content
  Widget _buildContent() {
    if (_isLoading) {
      return const Center(
        child: CircularProgressIndicator(color: _primaryOrange),
      );
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, size: 48, color: _greyText),
            const SizedBox(height: 16),
            Text(
              _error!,
              style: const TextStyle(color: _creamColor),
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _loadReviews,
              style: ElevatedButton.styleFrom(
                backgroundColor: _secondaryOrange,
              ),
              child: const Text('Повторить'),
            ),
          ],
        ),
      );
    }

    if (_reviews.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                Icons.rate_review_outlined,
                size: 64,
                color: _greyText,
              ),
              SizedBox(height: 16),
              Text(
                'Пока нет отзывов',
                style: TextStyle(
                  color: _creamColor,
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                ),
                textAlign: TextAlign.center,
              ),
              SizedBox(height: 8),
              Text(
                'Станьте первым, кто поделится\nвпечатлениями об этом заведении',
                style: TextStyle(
                  color: _greyText,
                  fontSize: 14,
                ),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      );
    }

    return ListView.builder(
      controller: _scrollController,
      padding: const EdgeInsets.all(16),
      itemCount: _reviews.length + (_isLoadingMore ? 1 : 0),
      itemBuilder: (context, index) {
        if (index == _reviews.length) {
          return const Center(
            child: Padding(
              padding: EdgeInsets.all(16),
              child: CircularProgressIndicator(color: _primaryOrange),
            ),
          );
        }
        return Padding(
          padding: const EdgeInsets.only(bottom: 20),
          child: _buildReviewCard(_reviews[index]),
        );
      },
    );
  }

  /// Build review card (Figma style with reactions)
  Widget _buildReviewCard(Review review) {
    final likes = _likes[review.id] ?? 0;
    final dislikes = _dislikes[review.id] ?? 0;
    final userReaction = _userReactions[review.id];

    return Container(
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        border: Border.all(color: _creamColor),
        borderRadius: BorderRadius.circular(15),
        boxShadow: [
          BoxShadow(
            color: AppTheme.primaryOrangeShadow.withValues(alpha: 0.04),
            blurRadius: 15,
            spreadRadius: 2,
            offset: const Offset(4, 4),
          ),
          BoxShadow(
            color: AppTheme.primaryOrangeShadow.withValues(alpha: 0.04),
            blurRadius: 15,
            spreadRadius: 2,
            offset: const Offset(-4, -4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header row
          Row(
            children: [
              // Avatar
              Container(
                width: 42,
                height: 42,
                decoration: const BoxDecoration(
                  color: _navyBlue,
                  shape: BoxShape.circle,
                ),
                child: Center(
                  child: Text(
                    review.userName.isNotEmpty
                        ? review.userName[0].toUpperCase()
                        : 'A',
                    style: TextStyle(
fontFamily: AppTheme.fontDisplayFamily,
                      fontSize: 25,
                      color: _creamColor,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              // Name
              Expanded(
                child: Text(
                  review.userName,
                  style: const TextStyle(
                    fontSize: 16,
                    color: _creamColor,
                  ),
                ),
              ),
              // Stars and date
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  _buildStarRating(review.rating),
                  const SizedBox(height: 4),
                  Text(
                    _formatDate(review.createdAt),
                    style: const TextStyle(
                      fontSize: 12,
                      color: _greyText,
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 11),

          // Review text
          Text(
            review.text ?? '',
            style: const TextStyle(
              fontSize: 12,
              color: _creamColor,
              height: 1.67,
            ),
          ),

          // Partner response section
          if (review.partnerResponse != null && review.partnerResponse!.isNotEmpty) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: _primaryOrange.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
                border: Border.all(color: _primaryOrange.withValues(alpha: 0.3)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(
                        Icons.reply,
                        size: 14,
                        color: _secondaryOrange,
                      ),
                      const SizedBox(width: 6),
                      const Text(
                        'Ответ заведения',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: _secondaryOrange,
                        ),
                      ),
                      const Spacer(),
                      if (review.partnerResponseAt != null)
                        Text(
                          _formatDate(review.partnerResponseAt!),
                          style: const TextStyle(
                            fontSize: 10,
                            color: _greyText,
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    review.partnerResponse!,
                    style: const TextStyle(
                      fontSize: 11,
                      color: _creamColor,
                      height: 1.4,
                    ),
                  ),
                ],
              ),
            ),
          ],

          const SizedBox(height: 12),

          // Reactions row (likes/dislikes)
          Row(
            children: [
              // Like button
              GestureDetector(
                onTap: () => _onLikeTap(review.id),
                child: Row(
                  children: [
                    Icon(
                      userReaction == 'like'
                          ? Icons.thumb_up
                          : Icons.thumb_up_outlined,
                      size: 18,
                      color: userReaction == 'like'
                          ? _secondaryOrange
                          : _greyText,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      likes.toString(),
                      style: TextStyle(
                        fontSize: 12,
                        color: userReaction == 'like'
                            ? _secondaryOrange
                            : _greyText,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 16),
              // Dislike button
              GestureDetector(
                onTap: () => _onDislikeTap(review.id),
                child: Row(
                  children: [
                    Icon(
                      userReaction == 'dislike'
                          ? Icons.thumb_down
                          : Icons.thumb_down_outlined,
                      size: 18,
                      color: userReaction == 'dislike'
                          ? _secondaryOrange
                          : _greyText,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      dislikes.toString(),
                      style: TextStyle(
                        fontSize: 12,
                        color: userReaction == 'dislike'
                            ? _secondaryOrange
                            : _greyText,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  /// Build star rating display
  Widget _buildStarRating(int rating) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(5, (index) {
        return Icon(
          index < rating ? Icons.star : Icons.star_border,
          color: index < rating ? _secondaryOrange : _greyText,
          size: 15,
        );
      }),
    );
  }

  /// Format date for display
  String _formatDate(DateTime date) {
    final months = [
      'января',
      'февраля',
      'марта',
      'апреля',
      'мая',
      'июня',
      'июля',
      'августа',
      'сентября',
      'октября',
      'ноября',
      'декабря'
    ];
    return '${date.day} ${months[date.month - 1]}';
  }

  /// Build sort options sheet
  Widget _buildSortSheet() {
    return Container(
      padding: const EdgeInsets.all(16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Сортировка',
            style: TextStyle(
              fontFamily: AppTheme.fontDisplayFamily,
              fontSize: 20,
              color: _creamColor,
            ),
          ),
          const SizedBox(height: 16),
          _buildSortOption('Сначала новые', 'newest'),
          _buildSortOption('Сначала старые', 'oldest'),
          _buildSortOption('Высокий рейтинг', 'highest'),
          _buildSortOption('Низкий рейтинг', 'lowest'),
          const SizedBox(height: 16),
        ],
      ),
    );
  }

  /// Build sort option item
  Widget _buildSortOption(String title, String value) {
    final isSelected = _sortBy == value;

    return ListTile(
      onTap: () {
        setState(() {
          _sortBy = value;
        });
        Navigator.pop(context);
        _sortReviews();
      },
      leading: Icon(
        isSelected ? Icons.radio_button_checked : Icons.radio_button_off,
        color: isSelected ? _secondaryOrange : _greyText,
      ),
      title: Text(
        title,
        style: TextStyle(
          color: isSelected ? _creamColor : _greyText,
        ),
      ),
    );
  }

  /// Sort reviews based on selected option
  void _sortReviews() {
    setState(() {
      switch (_sortBy) {
        case 'newest':
          _reviews.sort((a, b) => b.createdAt.compareTo(a.createdAt));
          break;
        case 'oldest':
          _reviews.sort((a, b) => a.createdAt.compareTo(b.createdAt));
          break;
        case 'highest':
          _reviews.sort((a, b) => b.rating.compareTo(a.rating));
          break;
        case 'lowest':
          _reviews.sort((a, b) => a.rating.compareTo(b.rating));
          break;
      }
    });
  }
}
