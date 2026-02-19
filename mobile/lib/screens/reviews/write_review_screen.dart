import 'package:flutter/material.dart';
import 'package:dio/dio.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/services/reviews_service.dart';

/// Write Review Screen - allows authenticated users to submit reviews
/// Figma design: Light background, 5-star rating, text field, submit button
class WriteReviewScreen extends StatefulWidget {
  final Establishment establishment;

  const WriteReviewScreen({
    super.key,
    required this.establishment,
  });

  @override
  State<WriteReviewScreen> createState() => _WriteReviewScreenState();
}

class _WriteReviewScreenState extends State<WriteReviewScreen> {
  // Services
  final ReviewsService _reviewsService = ReviewsService();

  // Form state
  int _selectedRating = 0;
  final TextEditingController _textController = TextEditingController();
  final FocusNode _textFocusNode = FocusNode();

  // UI state
  bool _isSubmitting = false;
  String? _errorMessage;

  // Figma colors
  static const Color _backgroundColor = AppTheme.backgroundWarm;
  static const Color _primaryOrange = AppTheme.primaryOrangeDark;
  static const Color _secondaryOrange = AppTheme.primaryOrange;
  static const Color _greyText = AppTheme.textGrey;
  static const Color _greyBorder = AppTheme.strokeGrey;
  static const Color _starActiveColor = Color(0xFFFFB800); // Yellow for active stars
  static const Color _starInactiveColor = AppTheme.strokeGrey; // Grey for inactive

  // Validation constants (must match backend: min 20, max 1000)
  static const int _minTextLength = 20;
  static const int _maxTextLength = 1000;

  @override
  void initState() {
    super.initState();
    _textController.addListener(_onTextChanged);
  }

  @override
  void dispose() {
    _textController.removeListener(_onTextChanged);
    _textController.dispose();
    _textFocusNode.dispose();
    super.dispose();
  }

  void _onTextChanged() {
    setState(() {
      // Clear error when user starts typing
      if (_errorMessage != null) {
        _errorMessage = null;
      }
    });
  }

  /// Check if form is valid for submission
  bool get _isFormValid {
    return _selectedRating > 0 &&
        _textController.text.trim().length >= _minTextLength;
  }

  /// Handle star rating selection
  void _onStarTap(int rating) {
    setState(() {
      _selectedRating = rating;
      if (_errorMessage != null) {
        _errorMessage = null;
      }
    });
  }

  /// Submit the review
  Future<void> _submitReview() async {
    if (!_isFormValid || _isSubmitting) return;

    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });

    try {
      final review = await _reviewsService.createReview(
        establishmentId: widget.establishment.id,
        rating: _selectedRating,
        text: _textController.text.trim(),
      );

      if (review != null && mounted) {
        // Success - navigate back with result
        Navigator.of(context).pop(true);

        // Show success snackbar on parent screen
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Отзыв успешно опубликован!'),
            backgroundColor: AppTheme.statusGreen,
          ),
        );
      } else {
        setState(() {
          _errorMessage = 'Не удалось отправить отзыв. Попробуйте ещё раз.';
          _isSubmitting = false;
        });
      }
    } on DioException catch (e) {
      setState(() {
        _isSubmitting = false;
        _errorMessage = _getErrorMessage(e);
      });
    } catch (e) {
      setState(() {
        _isSubmitting = false;
        _errorMessage = 'Произошла ошибка. Попробуйте ещё раз.';
      });
    }
  }

  /// Get user-friendly error message from DioException
  String _getErrorMessage(DioException e) {
    final statusCode = e.response?.statusCode;
    final responseData = e.response?.data;

    // Helper to safely get error code from response
    String? getErrorCode() {
      if (responseData is Map) {
        final error = responseData['error'];
        if (error is Map) {
          return error['code'] as String?;
        }
      }
      return null;
    }

    // Check for specific error codes
    if (statusCode == 409) {
      // Duplicate review
      final errorCode = getErrorCode();
      if (errorCode == 'DUPLICATE_REVIEW') {
        return 'Вы уже оставили отзыв для этого заведения';
      }
      return 'Отзыв уже существует';
    }

    if (statusCode == 429) {
      // Rate limit / daily quota
      final errorCode = getErrorCode();
      if (errorCode == 'DAILY_QUOTA_EXCEEDED') {
        return 'Достигнут дневной лимит отзывов. Попробуйте завтра';
      }
      return 'Слишком много запросов. Попробуйте позже';
    }

    if (statusCode == 401) {
      return 'Необходимо войти в аккаунт';
    }

    if (statusCode == 422) {
      // Validation error
      return 'Проверьте правильность заполнения формы';
    }

    // Network error
    if (e.type == DioExceptionType.connectionError ||
        e.type == DioExceptionType.connectionTimeout) {
      return 'Нет подключения к интернету';
    }

    return 'Не удалось отправить отзыв. Попробуйте ещё раз';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _backgroundColor,
      body: SafeArea(
        child: Column(
          children: [
            // Header with back button and title
            _buildHeader(),

            // Main content
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const SizedBox(height: 24),

                    // Star rating section
                    _buildStarRatingSection(),

                    const SizedBox(height: 8),

                    // Character counter
                    _buildCharacterCounter(),

                    const SizedBox(height: 8),

                    // Text input field
                    _buildTextInputField(),

                    // Error message
                    if (_errorMessage != null) ...[
                      const SizedBox(height: 16),
                      _buildErrorMessage(),
                    ],

                    const SizedBox(height: 32),
                  ],
                ),
              ),
            ),

            // Submit button at bottom
            _buildSubmitButton(),
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
              color: AppTheme.textDark,
            ),
          ),
          const SizedBox(width: 8),
          // Title
          Text(
            'Написать отзыв',
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

  /// Build star rating section
  Widget _buildStarRatingSection() {
    return Center(
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: List.generate(5, (index) {
          final starNumber = index + 1;
          final isActive = starNumber <= _selectedRating;

          return GestureDetector(
            onTap: () => _onStarTap(starNumber),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: Icon(
                Icons.star,
                size: 47,
                color: isActive ? _starActiveColor : _starInactiveColor,
              ),
            ),
          );
        }),
      ),
    );
  }

  /// Build character counter
  Widget _buildCharacterCounter() {
    final currentLength = _textController.text.length;
    return Center(
      child: Text(
        '$currentLength/$_maxTextLength символов',
        style: const TextStyle(
          fontSize: 13,
          color: _greyText,
        ),
      ),
    );
  }

  /// Build text input field
  Widget _buildTextInputField() {
    final hasText = _textController.text.isNotEmpty;
    final isTextTooShort = hasText && _textController.text.trim().length < _minTextLength;

    return Container(
      height: 240,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
        border: Border.all(
          color: isTextTooShort ? Colors.red : _greyBorder,
          width: 1.13,
        ),
      ),
      child: TextField(
        controller: _textController,
        focusNode: _textFocusNode,
        maxLines: null,
        expands: true,
        maxLength: _maxTextLength,
        enabled: !_isSubmitting,
        textAlignVertical: TextAlignVertical.top,
        style: const TextStyle(
          fontSize: 15,
          color: Colors.black,
        ),
        decoration: const InputDecoration(
          hintText: 'Начните писать...',
          hintStyle: TextStyle(
            fontSize: 15,
            color: _greyBorder,
          ),
          contentPadding: EdgeInsets.all(16),
          border: InputBorder.none,
          counterText: '', // Hide default counter
        ),
      ),
    );
  }

  /// Build error message
  Widget _buildErrorMessage() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.red.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_outline, color: Colors.red, size: 20),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              _errorMessage!,
              style: const TextStyle(
                color: Colors.red,
                fontSize: 14,
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Build submit button
  Widget _buildSubmitButton() {
    final canSubmit = _isFormValid && !_isSubmitting;

    return Container(
      padding: const EdgeInsets.all(16),
      child: SizedBox(
        width: double.infinity,
        height: 44,
        child: ElevatedButton(
          onPressed: canSubmit ? _submitReview : null,
          style: ElevatedButton.styleFrom(
            backgroundColor: canSubmit ? _secondaryOrange : _greyBorder,
            foregroundColor: _backgroundColor,
            disabledBackgroundColor: _greyBorder,
            disabledForegroundColor: _greyText,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
            ),
            elevation: 0,
          ),
          child: _isSubmitting
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Colors.white,
                  ),
                )
              : const Text(
                  'Написать отзыв',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w500,
                  ),
                ),
        ),
      ),
    );
  }
}
