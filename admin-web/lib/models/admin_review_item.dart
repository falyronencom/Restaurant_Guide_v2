/// Data models for admin review management
library;

/// Single review in admin list view
class AdminReviewItem {
  final String id;
  final int rating;
  final String? content;
  final String? authorName;
  final String? authorEmail;
  final String? establishmentName;
  final String? establishmentCity;
  final String? establishmentId;
  final bool isDeleted;
  final bool isVisible;
  final bool isEdited;
  final bool hasPartnerResponse;
  final String? partnerResponse;

  /// Когда партнёр ответил. Приходило с бэкенда с самого начала и молча
  /// отбрасывалось моделью — кадр 07 ставит эту дату рядом с самим ответом.
  final DateTime? partnerResponseAt;

  final DateTime createdAt;

  /// Рейтинг заведения — по **видимым** неудалённым отзывам.
  ///
  /// Источник не триггер `update_metrics_after_review`, хотя тот и пишет в те
  /// же колонки: на каждом пути записи после него вызывается
  /// `ReviewModel.updateEstablishmentAggregates`, а она фильтрует
  /// `is_deleted = false AND is_visible = true` — и последнее слово за ней.
  /// Скрытый отзыв в этих числах НЕ участвует.
  final double? establishmentAverageRating;
  final int? establishmentReviewCount;

  /// Сколько отзывов у этого автора и какова его средняя оценка. Нужны, чтобы
  /// отличить единичное недовольство от человека, ставящего единицы всем.
  final int? authorReviewCount;
  final double? authorAverageRating;

  const AdminReviewItem({
    required this.id,
    required this.rating,
    this.content,
    this.authorName,
    this.authorEmail,
    this.establishmentName,
    this.establishmentCity,
    this.establishmentId,
    this.isDeleted = false,
    this.isVisible = true,
    this.isEdited = false,
    this.hasPartnerResponse = false,
    this.partnerResponse,
    this.partnerResponseAt,
    required this.createdAt,
    this.establishmentAverageRating,
    this.establishmentReviewCount,
    this.authorReviewCount,
    this.authorAverageRating,
  });

  /// Каким станет рейтинг заведения, если этот отзыв убрать.
  ///
  /// `null`, когда вопрос не имеет смысла, и таких случаев три:
  /// - **удалённый** — он уже вне агрегата;
  /// - **скрытый** — тоже вне: агрегат считается по видимым (см. поле выше).
  ///   Вычесть его оттуда, где его нет, значит получить число из ниоткуда: на
  ///   двух видимых пятёрках и скрытой единице формула дала бы «9,00» —
  ///   оценку выше шкалы. Хуже незаметный случай: скрытая пятёрка при 4,0 из
  ///   50 дала бы правдоподобные «3,98» вместо честного «ничего не изменится»,
  ///   и решение об удалении было бы принято по выдуманному числу;
  /// - **единственный** — без него оценки не останется вовсе, и «0,0»
  ///   означало бы не ноль, а пустоту.
  double? get ratingWithoutThisReview {
    final average = establishmentAverageRating;
    final count = establishmentReviewCount;
    if (isDeleted || !isVisible || average == null || count == null ||
        count <= 1) {
      return null;
    }
    return (average * count - rating) / (count - 1);
  }

  factory AdminReviewItem.fromJson(Map<String, dynamic> json) {
    return AdminReviewItem(
      id: json['id'] as String,
      rating: json['rating'] as int? ?? 0,
      content: json['content'] as String?,
      authorName: json['author_name'] as String?,
      authorEmail: json['author_email'] as String?,
      establishmentName: json['establishment_name'] as String?,
      establishmentCity: json['establishment_city'] as String?,
      establishmentId: json['establishment_id'] as String?,
      isDeleted: json['is_deleted'] as bool? ?? false,
      isVisible: json['is_visible'] as bool? ?? true,
      isEdited: json['is_edited'] as bool? ?? false,
      hasPartnerResponse: json['has_partner_response'] as bool? ?? false,
      partnerResponse: json['partner_response'] as String?,
      partnerResponseAt: json['partner_response_at'] == null
          ? null
          : DateTime.parse(json['partner_response_at'] as String),
      createdAt: DateTime.parse(json['created_at'] as String),
      // Приходят числами: в SQL величины приведены к float8, потому что
      // node-pg отдаёт NUMERIC строкой. Приведение здесь строгое намеренно —
      // сторожем служит бэкенд-тест «числа приходят числами», а молчаливая
      // терпимость к строке спрятала бы дрейф проекции.
      establishmentAverageRating:
          (json['establishment_average_rating'] as num?)?.toDouble(),
      establishmentReviewCount: json['establishment_review_count'] as int?,
      authorReviewCount: json['author_review_count'] as int?,
      authorAverageRating: (json['author_average_rating'] as num?)?.toDouble(),
    );
  }

  /// Human-readable status label
  String get statusLabel {
    if (isDeleted) return 'Удалён';
    if (!isVisible) return 'Скрыт';
    return 'Активен';
  }

  /// Copy with updated visibility (for optimistic updates)
  AdminReviewItem copyWith({bool? isVisible, bool? isDeleted}) {
    return AdminReviewItem(
      id: id,
      rating: rating,
      content: content,
      authorName: authorName,
      authorEmail: authorEmail,
      establishmentName: establishmentName,
      establishmentCity: establishmentCity,
      establishmentId: establishmentId,
      isDeleted: isDeleted ?? this.isDeleted,
      isVisible: isVisible ?? this.isVisible,
      isEdited: isEdited,
      hasPartnerResponse: hasPartnerResponse,
      partnerResponse: partnerResponse,
      partnerResponseAt: partnerResponseAt,
      createdAt: createdAt,
      establishmentAverageRating: establishmentAverageRating,
      establishmentReviewCount: establishmentReviewCount,
      authorReviewCount: authorReviewCount,
      authorAverageRating: authorAverageRating,
    );
  }
}

/// Paginated response wrapper
class AdminReviewListResponse {
  final List<AdminReviewItem> reviews;
  final int total;

  /// Сколько отзывов выборки скрыто и какова её средняя оценка.
  ///
  /// Считаются по ТОЙ ЖЕ выборке, что и [total]: под фильтром «1–2 звезды»
  /// подпись описывает отфильтрованное, а не раздел целиком.
  final int hidden;

  /// `null` — оценивать нечего. «0,0» под брендовой звездой читается как
  /// плохая оценка, хотя означает отсутствие оценок.
  final double? averageRating;

  final int page;
  final int pages;

  const AdminReviewListResponse({
    required this.reviews,
    required this.total,
    this.hidden = 0,
    this.averageRating,
    required this.page,
    required this.pages,
  });
}
