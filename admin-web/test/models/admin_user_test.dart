import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/models/admin_review_item.dart';
import 'package:restaurant_guide_admin_web/models/admin_user.dart';

// Разбор ответа /admin/users и /admin/users/:id — ключи как их пишет
// backend/src/models/adminUserModel.js (проход тестировщика 17.10, п. 8).

void main() {
  test('карточка человека: числа, состояние и последняя блокировка', () {
    final user = AdminUser.fromJson(<String, dynamic>{
      'id': 'u1',
      'name': 'Пользователь',
      'email': null,
      'phone': '+375291234567',
      'role': 'user',
      'auth_method': 'phone',
      'is_active': false,
      'is_service_account': false,
      'created_at': '2026-10-01T09:00:00.000Z',
      'review_count': 4,
      'hidden_review_count': 4,
      'establishment_count': 0,
      'last_block_action': <String, dynamic>{
        'action': 'user_block',
        'reason': 'мат',
        'created_at': '2026-10-17T12:00:00',
        'admin_name': 'Сергей Админов',
      },
      'viewer_redacted': false,
    });

    expect(user.isActive, isFalse);
    expect(user.contact, '+375291234567');
    expect(user.reviewCount, 4);
    expect(user.hiddenReviewCount, 4);
    expect(user.protection, isNull);
    expect(user.lastBlockAction!.isBlock, isTrue);
    expect(user.lastBlockAction!.reason, 'мат');
    expect(user.lastBlockAction!.adminName, 'Сергей Админов');
  });

  test('порядок защиты — как у сервера: учётка панели, служебная, партнёр', () {
    AdminUser user(String role, {bool service = false, int cards = 0}) =>
        AdminUser(
          id: 'x',
          role: role,
          isServiceAccount: service,
          establishmentCount: cards,
          liveEstablishmentCount: cards,
        );

    expect(user('viewer').protection, AdminUserProtection.panelAccount);
    expect(user('admin', service: true).protection,
        AdminUserProtection.panelAccount);
    expect(user('partner', service: true, cards: 3).protection,
        AdminUserProtection.serviceAccount);
    expect(user('partner', cards: 1).protection,
        AdminUserProtection.partnerWithEstablishments);
    expect(user('partner').protection, isNull);
    expect(user('partner', cards: 1).canResetName, isTrue);
    expect(user('admin').canResetName, isFalse);
  });

  test('роль и служебность — из ключей сервера, а не значения по умолчанию',
      () {
    // Разбор по умолчанию даёт «user» и «не служебная» — карточка выше их и
    // подаёт, поэтому ключи `role` и `is_service_account` она не видит, а
    // проверка порядка защиты строит человека конструктором. От этих ключей
    // зависит, предложит ли панель блокировку.
    AdminUser parse(Map<String, dynamic> keys) =>
        AdminUser.fromJson(<String, dynamic>{'id': 'p', ...keys});

    final admin = parse(<String, dynamic>{'role': 'admin'});
    expect(admin.role, 'admin');
    expect(admin.protection, AdminUserProtection.panelAccount);

    final service = parse(<String, dynamic>{
      'role': 'partner',
      'is_service_account': true,
    });
    expect(service.isServiceAccount, isTrue);
    expect(service.protection, AdminUserProtection.serviceAccount);
  });

  test('защищают карточки в каталоге или на модерации, а не черновики', () {
    AdminUser parse(Map<String, dynamic> extra) => AdminUser.fromJson(
        <String, dynamic>{'id': 'p', 'role': 'partner', ...extra});

    expect(
      parse(<String, dynamic>{
        'establishment_count': 2,
        'live_establishment_count': 0,
      }).protection,
      isNull,
    );
    expect(
      parse(<String, dynamic>{
        'establishment_count': 2,
        'live_establishment_count': 1,
      }).protection,
      AdminUserProtection.partnerWithEstablishments,
    );
    // Поля нет (ответ старого сервера) — осторожно: кнопки нет.
    expect(
      parse(<String, dynamic>{'establishment_count': 2}).protection,
      AdminUserProtection.partnerWithEstablishments,
    );
  });

  test('отзыв в панели несёт id автора', () {
    final review = AdminReviewItem.fromJson(<String, dynamic>{
      'id': 'r1',
      'rating': 1,
      'author_id': 'u1',
      'created_at': '2026-08-12T16:24:00.000Z',
    });
    expect(review.authorId, 'u1');
    expect(review.copyWith(isVisible: false).authorId, 'u1');
  });
}
