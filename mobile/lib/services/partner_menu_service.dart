import 'package:dio/dio.dart';
import 'package:restaurant_guide_mobile/models/menu_recognition.dart';
import 'package:restaurant_guide_mobile/models/partner_menu_item.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';

/// Код отказа перезапуска, у которого постановка упала у всех файлов
/// (сервер — `OCR_RESTART_FAILED`, 500, с 25.10.2026, находка Н40). Тем же
/// кодом приложение называет ответ прежнего сервера «поставлено 0»: это был
/// тот же случай, отвеченный успехом.
const String retryOcrNotQueuedCode = 'OCR_RESTART_FAILED';

/// Фраза партнёру на этот отказ, если сервер не прислал свою.
const String retryOcrNotQueuedMessage =
    'Не удалось запустить распознавание. Попробуйте позже.';

/// Outcome of a retry-OCR request. Captures both success and rate-limit
/// cases without throwing, so the UI can render a friendly message using
/// the backend-provided retry-after value.
class RetryOcrResult {
  final bool success;
  final int enqueuedJobs;
  final int totalPdfs;

  /// Seconds to wait before next retry, surfaced from backend on 429.
  final int? retryAfterSeconds;

  /// Error code from backend when not rate-limited (e.g. NO_PDF_MENUS).
  final String? errorCode;

  /// Готовая фраза для партнёра, если она есть. `null` — экран берёт свою.
  final String? errorMessage;

  RetryOcrResult.success({
    required this.enqueuedJobs,
    required this.totalPdfs,
  })  : success = true,
        retryAfterSeconds = null,
        errorCode = null,
        errorMessage = null;

  RetryOcrResult.rateLimited({
    required int retryAfter,
    required String message,
  })  : success = false,
        enqueuedJobs = 0,
        totalPdfs = 0,
        retryAfterSeconds = retryAfter,
        errorCode = 'RATE_LIMITED',
        errorMessage = message;

  RetryOcrResult.failure({
    required String code,
    String? message,
  })  : success = false,
        enqueuedJobs = 0,
        totalPdfs = 0,
        retryAfterSeconds = null,
        errorCode = code,
        errorMessage = message;
}

/// The partner's menu as the list request answers it: the items, and the
/// state of their recognition (`null` from a server that does not send it).
class PartnerMenuSnapshot {
  final List<PartnerMenuItem> items;
  final MenuRecognition? recognition;

  /// Сервер прислал `recognition: null` — состояние он прочитать не смог
  /// (`partnerMenuItemService.readRecognitionState`), а не «поля нет»: сервер
  /// до 24.10.2026 его не присылал вовсе, а незнакомое значение — не `null`.
  final bool recognitionUnread;

  /// У заведения есть позиции, скрытые модератором (`hasHiddenItems`, с
  /// 29.10.2026, находка КО-1): пустой список тогда — не «в файле ничего не
  /// нашлось», и совет загрузить фото чётче не поможет. Ни названий, ни числа
  /// сервер не присылает. Сервер без поля — `false`, прежний экран.
  final bool hasHiddenItems;

  /// Сервер прислал `hasHiddenItems: null` — не смог прочитать; как с
  /// [recognitionUnread], показанное остаётся.
  final bool hiddenItemsUnread;

  const PartnerMenuSnapshot({
    required this.items,
    this.recognition,
    this.recognitionUnread = false,
    this.hasHiddenItems = false,
    this.hiddenItemsUnread = false,
  });
}

/// API service for partner-scoped menu item operations.
///   GET   /api/v1/partner/establishments/:id/menu-items
///   PATCH /api/v1/partner/menu-items/:id
///   POST  /api/v1/partner/establishments/:id/retry-ocr
class PartnerMenuService {
  final ApiClient _apiClient;

  static final PartnerMenuService _instance = PartnerMenuService._internal();
  factory PartnerMenuService() => _instance;

  PartnerMenuService._internal() : _apiClient = ApiClient();

  /// Items and recognition state; `recognition` sits beside `data` in the
  /// answer (from 24.10.2026), `data` is the list it always was.
  Future<PartnerMenuSnapshot> fetchMenu(String establishmentId) async {
    final response = await _apiClient
        .get('/api/v1/partner/establishments/$establishmentId/menu-items');

    if (response.statusCode != 200 || response.data is! Map<String, dynamic>) {
      throw Exception('Не удалось загрузить позиции меню');
    }

    final data = response.data as Map<String, dynamic>;
    final list = data['data'] as List? ?? [];
    return PartnerMenuSnapshot(
      items: list
          .map((e) => PartnerMenuItem.fromJson(e as Map<String, dynamic>))
          .toList(),
      recognition: MenuRecognition.fromJson(data['recognition']),
      recognitionUnread:
          data.containsKey('recognition') && data['recognition'] == null,
      hasHiddenItems: data['hasHiddenItems'] == true,
      hiddenItemsUnread:
          data.containsKey('hasHiddenItems') && data['hasHiddenItems'] == null,
    );
  }

  /// Inline edit a single menu item. Returns updated item on success.
  /// Throws on failure; provider handles optimistic rollback.
  Future<PartnerMenuItem> updateMenuItem(
    String menuItemId, {
    String? itemName,
    double? priceByn,
    String? categoryRaw,
  }) async {
    final payload = <String, dynamic>{};
    if (itemName != null) payload['item_name'] = itemName;
    if (priceByn != null) payload['price_byn'] = priceByn;
    if (categoryRaw != null) payload['category_raw'] = categoryRaw;

    final response = await _apiClient.patch(
      '/api/v1/partner/menu-items/$menuItemId',
      data: payload,
    );

    if (response.statusCode != 200 || response.data is! Map<String, dynamic>) {
      throw Exception('Не удалось сохранить изменения');
    }
    final data = response.data as Map<String, dynamic>;
    return PartnerMenuItem.fromJson(data['data'] as Map<String, dynamic>);
  }

  /// Retry OCR for all PDF menus. Handles 429 and domain-level 400 without
  /// throwing, returning a structured RetryOcrResult for the UI.
  Future<RetryOcrResult> retryOcr(String establishmentId) async {
    try {
      final response = await _apiClient
          .post('/api/v1/partner/establishments/$establishmentId/retry-ocr');

      if (response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        final result = data['data'] as Map<String, dynamic>? ?? {};
        final enqueuedJobs = (result['enqueuedJobs'] as num?)?.toInt() ?? 0;
        // Успех без единого поставленного файла — так прежний сервер отвечал,
        // когда постановка упала у всех: файл с идущим заданием он считает
        // поставленным. До 25.10.2026 экран показывал на это зелёное
        // «Распознавание уже выполняется».
        if (enqueuedJobs == 0) {
          return RetryOcrResult.failure(
            code: retryOcrNotQueuedCode,
            message: retryOcrNotQueuedMessage,
          );
        }
        return RetryOcrResult.success(
          enqueuedJobs: enqueuedJobs,
          totalPdfs: (result['totalPdfs'] as num?)?.toInt() ?? 0,
        );
      }
      return RetryOcrResult.failure(
        code: 'UNKNOWN',
        message: 'Неожиданный ответ сервера',
      );
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if (status == 429) {
        // Prefer backend Retry-After header (seconds); fallback to 60s
        final retryAfterHeader = e.response?.headers.value('retry-after');
        final retryAfter = int.tryParse(retryAfterHeader ?? '') ?? 60;
        return RetryOcrResult.rateLimited(
          retryAfter: retryAfter,
          message: 'Лимит перезапусков исчерпан',
        );
      }
      if (e.response?.data is Map<String, dynamic>) {
        final data = e.response!.data as Map<String, dynamic>;
        final err = data['error'];
        final code = err is Map<String, dynamic> ? err['code'] : null;
        if (status == 400 && err is Map<String, dynamic>) {
          return RetryOcrResult.failure(
            code: code?.toString() ?? 'BAD_REQUEST',
          );
        }
        // Постановка упала у всех файлов: у этого отказа фраза сервера
        // русская (MENU_RECOGNITION_REFUSALS).
        if (code == retryOcrNotQueuedCode) {
          final message = data['message'];
          return RetryOcrResult.failure(
            code: retryOcrNotQueuedCode,
            message: message is String && message.trim().isNotEmpty
                ? message
                : retryOcrNotQueuedMessage,
          );
        }
      }
      // Ответа сервера нет (нет связи, таймаут) — у транспорта готова русская
      // фраза («Нет связи…»), она точнее общей. На всё прочее — фраза экрана:
      // тексты сервера по меню пока английские. До 13.10.2026 здесь стоял
      // `e.message` dio: у отказа, пересобранного транспортом, он пуст, и на
      // 404 удалённой карточки партнёр читал «Ошибка сети»; у сбоя сервера
      // после повторов это английский текст библиотеки, и он шёл на экран.
      if (e.response == null && e.error is String) {
        return RetryOcrResult.failure(
          code: 'NETWORK',
          message: e.error as String,
        );
      }
      return RetryOcrResult.failure(code: 'REQUEST_FAILED');
    }
  }
}
