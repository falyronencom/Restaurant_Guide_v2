import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/models/review.dart';
import 'package:restaurant_guide_mobile/services/reviews_service.dart';

/// Reviews List Screen - displays all reviews for an establishment
/// Figma design: Dark background, review cards
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
  /// Следующая страница не загрузилась: листание стоит, пока человек не
  /// нажмёт «Повторить» внизу списка. Иначе каждая прокрутка у конца слала бы
  /// новый запрос в сбой.
  bool _loadMoreFailed = false;
  String? _error;
  /// Последняя загруженная страница сервера. При «сначала старые» страницы
  /// идут от последней к первой, и номер убывает.
  int _currentPage = 1;
  int _totalPages = 1;
  /// Номер загрузки с первой страницы: растёт при смене сортировки и
  /// «Повторить». Ответ, пришедший на прежний номер, опоздал — его не
  /// показывать, иначе страницы разных порядков смешаются.
  int _generation = 0;

  static const int _perPage = 10;

  // Scroll controller for pagination
  final ScrollController _scrollController = ScrollController();

  // Sort options
  String _sortBy = 'newest'; // 'newest', 'oldest', 'highest', 'lowest'

  /// Порядок задаёт сервер: страницы по 10, и переставить уже загруженное
  /// значило бы показать «лучшие из первых десяти», а не из всех (проход
  /// тестировщика 17.10, Х31). Сервер знает `newest`, `highest`, `lowest`.
  /// «Сначала старые» он не знает, поэтому страницы порядка «сначала новые»
  /// берутся с последней к первой и каждая разворачивается — так это порядок
  /// всех отзывов, а не загруженных.
  bool get _oldestFirst => _sortBy == 'oldest';
  String get _serverSort => _oldestFirst ? 'newest' : _sortBy;
  bool get _hasMore =>
      _oldestFirst ? _currentPage > 1 : _currentPage < _totalPages;
  int get _nextPage => _oldestFirst ? _currentPage - 1 : _currentPage + 1;

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
        !_loadMoreFailed &&
        _hasMore) {
      _loadMoreReviews();
    }
  }

  /// Список короче экрана не прокрутить, и подгрузка по прокрутке не
  /// сработает. При «сначала старые» первой идёт последняя страница сервера,
  /// в ней бывает один отзыв — после отрисовки проверить и догрузить.
  void _loadMoreIfShort() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _scrollController.hasClients) _onScroll();
    });
  }

  Future<PaginatedReviews> _fetchPage(int page) =>
      _reviewsService.getReviewsForEstablishment(
        widget.establishment.id,
        page: page,
        perPage: _perPage,
        sort: _serverSort,
      );

  /// Страница в порядке показа, без отзывов, которые уже в списке: если
  /// между запросами отзывов стало больше или меньше, страницы по смещению
  /// сдвигаются, и отзыв с края прежней страницы приходит снова.
  List<Review> _shown(List<Review> page, {List<Review> after = const []}) {
    final seen = {for (final review in after) review.id};
    final ordered = _oldestFirst ? page.reversed : page;
    return [for (final review in ordered) if (seen.add(review.id)) review];
  }

  /// Load initial reviews
  Future<void> _loadReviews() async {
    final generation = ++_generation;
    setState(() {
      _isLoading = true;
      _error = null;
      // Подгрузка прежней сортировки, если шла, уже не в счёт.
      _isLoadingMore = false;
      _loadMoreFailed = false;
    });

    try {
      var page = 1;
      var response = await _fetchPage(page);
      // «Сначала старые»: первая страница сказала, сколько их; самые старые
      // отзывы — на последней.
      if (_oldestFirst &&
          generation == _generation &&
          response.meta.totalPages > 1) {
        page = response.meta.totalPages;
        response = await _fetchPage(page);
      }
      if (!mounted || generation != _generation) return;

      setState(() {
        _reviews = _shown(response.data);
        _totalPages = response.meta.totalPages;
        _currentPage = page;
        _isLoading = false;
      });
      _loadMoreIfShort();
    } catch (e) {
      if (!mounted || generation != _generation) return;
      setState(() {
        _error = 'Не удалось загрузить отзывы';
        _isLoading = false;
      });
    }
  }

  /// Load more reviews for pagination
  Future<void> _loadMoreReviews() async {
    if (_isLoadingMore || !_hasMore) return;

    final generation = _generation;
    final page = _nextPage;
    setState(() {
      _isLoadingMore = true;
      _loadMoreFailed = false;
    });

    try {
      final response = await _fetchPage(page);
      if (!mounted || generation != _generation) return;

      setState(() {
        _reviews.addAll(_shown(response.data, after: _reviews));
        _currentPage = page;
        _isLoadingMore = false;
      });
      _loadMoreIfShort();
    } catch (e) {
      if (!mounted || generation != _generation) return;
      setState(() {
        _isLoadingMore = false;
        _loadMoreFailed = true;
      });
    }
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
          const Text(
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
      itemCount: _reviews.length + (_isLoadingMore || _loadMoreFailed ? 1 : 0),
      itemBuilder: (context, index) {
        if (index == _reviews.length && _loadMoreFailed) {
          return _buildLoadMoreFailed();
        }
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

  /// Низ списка, когда следующая страница не загрузилась.
  Widget _buildLoadMoreFailed() {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Column(
        children: [
          const Text(
            'Не удалось загрузить ещё отзывы',
            style: TextStyle(color: _creamColor),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          TextButton(
            onPressed: _loadMoreReviews,
            style: TextButton.styleFrom(foregroundColor: _secondaryOrange),
            child: const Text('Повторить'),
          ),
        ],
      ),
    );
  }

  /// Build review card (Figma style). Реакций «палец вверх / вниз» здесь нет:
  /// на сервере такой функции нет, а числа при кнопках когда-то брались из
  /// хэша id — выдуманные (проход тестировщика 17.10, п. 28; решение
  /// Координатора В1: убрать, пока функции нет).
  Widget _buildReviewCard(Review review) {
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
              if (review.fullAvatarUrl != null)
                CircleAvatar(
                  radius: 21,
                  backgroundImage: NetworkImage(review.fullAvatarUrl!),
                  onBackgroundImageError: (_, __) {},
                  backgroundColor: _navyBlue,
                )
              else
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
                      style: const TextStyle(
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
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 16,
                    color: _creamColor,
                  ),
                ),
              ),
              const SizedBox(width: 8),
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
          const Text(
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
        Navigator.pop(context);
        if (_sortBy == value) return;
        _sortBy = value;
        if (_scrollController.hasClients) _scrollController.jumpTo(0);
        _loadReviews();
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
}
