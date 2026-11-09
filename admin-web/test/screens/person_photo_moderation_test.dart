import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/admin_badges.dart';
import 'package:restaurant_guide_admin_web/models/admin_review_item.dart';
import 'package:restaurant_guide_admin_web/models/admin_user.dart';
import 'package:restaurant_guide_admin_web/providers/admin_reviews_provider.dart';
import 'package:restaurant_guide_admin_web/providers/admin_users_provider.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/screens/reviews/reviews_management_screen.dart';
import 'package:restaurant_guide_admin_web/screens/users/users_screen.dart';
import 'package:restaurant_guide_admin_web/services/admin_review_service.dart';
import 'package:restaurant_guide_admin_web/services/admin_user_service.dart';
import 'package:restaurant_guide_admin_web/widgets/person_photo.dart';

import '../helpers/stub_auth.dart';
import '../helpers/wire_stand.dart';

// Фото профиля другие люди видят только после одобрения модератором
// (решение Координатора 09.11.2026, нитка «Фото людей»; миграция 041).
//
// Модератор видит фото человека и его состояние в «Пользователях» и рядом с
// отзывом, находит очередь фильтром «Фото: на проверке», одобряет фото или
// снимает его — по той ссылке, что видел. Просмотрщик видит состояние, но не
// само фото и без кнопок. На старой панели красный каждый тест: ни фото, ни
// фильтра, ни кнопок не было.
//
// Ответы идут по проводу: подставной транспорт, настоящие сервис,
// перехватчики, провайдер и экран.

const String _id = '0d9a6c1e-4b7f-4a52-9e3d-1f2a3b4c5d6e';
const String _photo =
    'https://res.cloudinary.com/test/image/upload/v1/avatars/$_id/face0001.jpg';

Map<String, dynamic> _person({
  String? avatarUrl = _photo,
  String avatarState = 'pending',
  bool viewerRedacted = false,
}) =>
    <String, dynamic>{
      'id': _id,
      'name': viewerRedacted ? null : 'Фото Тестов',
      'email': viewerRedacted ? null : 'photo@example.com',
      'phone': null,
      'avatar_url': viewerRedacted ? null : avatarUrl,
      'avatar_state': avatarState,
      'role': 'user',
      'is_active': true,
      'is_deleted': false,
      'is_service_account': false,
      'created_at': '2026-09-01T10:00:00.000Z',
      'review_count': 2,
      'hidden_review_count': 0,
      'establishment_count': 0,
      'live_establishment_count': 0,
      'viewer_redacted': viewerRedacted,
    };

class _Server {
  Map<String, dynamic> person = _person();
  final List<RequestOptions> requests = <RequestOptions>[];

  /// Ответ сервера на действие с фото вместо обычного.
  ResponseBody Function()? photoAnswer;

  late final StubAdapter adapter = StubAdapter(_respond, maxRequests: 60);

  Iterable<RequestOptions> to(String method, String suffix) => requests
      .where((r) => r.method == method && r.uri.path.endsWith(suffix));

  ResponseBody _respond(RequestOptions options) {
    requests.add(options);
    final path = options.uri.path;
    if (options.method == 'GET' && path == '/api/v1/admin/users') {
      return jsonBody(<String, dynamic>{
        'success': true,
        'data': <Map<String, dynamic>>[person],
        'meta': <String, dynamic>{'total': 1, 'page': 1, 'pages': 1},
      });
    }
    if (options.method == 'GET' && path == '/api/v1/admin/users/$_id') {
      return jsonBody(<String, dynamic>{'success': true, 'data': person});
    }
    if (path.endsWith('/avatar/approve') || path.endsWith('/avatar/remove')) {
      final special = photoAnswer;
      if (special != null) return special();
      final removed = path.endsWith('/remove');
      person = _person(
        avatarUrl: removed ? null : _photo,
        avatarState: removed ? 'none' : 'approved',
      );
      return jsonBody(<String, dynamic>{
        'success': true,
        'data': <String, dynamic>{'id': _id, 'changed': true},
      });
    }
    if (options.method == 'GET' && path == '/api/v1/admin/reviews') {
      return jsonBody(<String, dynamic>{
        'success': true,
        'data': <Map<String, dynamic>>[
          <String, dynamic>{
            'id': 'r-1',
            'rating': 5,
            'content': 'Отзыв автора с фото',
            'is_deleted': false,
            'is_visible': true,
            'is_edited': false,
            'created_at': '2026-10-09T12:30:00.000Z',
            'has_partner_response': false,
            'author_id': _id,
            'author_name': 'Фото Тестов',
            'author_email': 'photo@example.com',
            'author_avatar_url': person['avatar_url'],
            'author_avatar_state': person['avatar_state'],
            'establishment_name': 'Кухмістр',
            'establishment_city': 'Минск',
            'establishment_id': 'e-1',
            'author_is_active': true,
            'viewer_redacted': false,
          },
        ],
        'meta': <String, dynamic>{'total': 1, 'hidden': 0, 'page': 1, 'pages': 1},
      });
    }
    throw StateError('стенд не знает запроса ${options.method} $path');
  }
}

class _Badges extends BadgesProvider {
  int loads = 0;

  @override
  AdminBadges? get badges => const AdminBadges(avatarsPending: 1);

  @override
  Future<void> load() async {
    loads++;
  }
}

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

void main() {
  setUp(() => installSecureStorageStand(initial: {'access_token': 'a-1'}));

  Future<(AdminUsersProvider, _Badges)> pumpUsers(
    WidgetTester tester,
    _Server server, {
    bool viewer = false,
    String? open = _id,
  }) async {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    final provider = AdminUsersProvider(
        service: AdminUserService.withClient(stubClient(server.adapter)));
    final badges = _Badges();
    addTearDown(badges.dispose);
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AdminUsersProvider>.value(value: provider),
          ChangeNotifierProvider<BadgesProvider>.value(value: badges),
          ChangeNotifierProvider<AuthProvider>(
            create: (_) =>
                viewer ? StubAuthProvider.viewer() : StubAuthProvider.admin(),
          ),
        ],
        child: MaterialApp(
          theme: AppTheme.lightTheme,
          home: Scaffold(body: UsersScreen(initialUserId: open)),
        ),
      ),
    );
    await _settle(tester);
    addTearDown(provider.dispose);
    return (provider, badges);
  }

  Future<void> tap(WidgetTester tester, Finder finder) async {
    await tester.ensureVisible(finder);
    await tester.tap(finder);
    await _settle(tester);
  }

  test('модели читают фото и его состояние; прежний сервер — «фото нет»', () {
    final user = AdminUser.fromJson(_person());
    expect(user.avatarUrl, _photo);
    expect(user.avatarState, PersonPhotoState.pending);
    expect(user.canModeratePhoto, isTrue);

    final old = AdminUser.fromJson(<String, dynamic>{'id': _id, 'role': 'user'});
    expect(old.avatarState, PersonPhotoState.none);
    expect(old.canRemovePhoto, isFalse);

    final review = AdminReviewItem.fromJson(<String, dynamic>{
      'id': 'r-1',
      'created_at': '2026-10-09T12:30:00.000Z',
      'author_avatar_url': _photo,
      'author_avatar_state': 'approved',
    });
    expect(review.authorAvatarState, PersonPhotoState.approved);
    expect(review.copyWith(isVisible: false).authorAvatarUrl, _photo);
  });

  testWidgets('фото на проверке: метка в строке, фото в карточке; «Одобрить» '
      'уходит с той ссылкой, что видел модератор', (tester) async {
    final server = _Server();
    final (_, badges) = await pumpUsers(tester, server);

    expect(find.text('фото на проверке'), findsOneWidget);
    expect(find.byKey(PersonPhoto.imageKey), findsNWidgets(2)); // строка и карточка
    expect(find.text('Фото на проверке — другие видят букву'), findsOneWidget);
    expect(find.byKey(const ValueKey<String>('user-photo-remove')), findsOneWidget);

    await tap(tester, find.byKey(const ValueKey<String>('user-photo-approve')));

    final sent = server.to('POST', '/users/$_id/avatar/approve').single;
    expect(sent.data, <String, dynamic>{'avatar_url': _photo});
    expect(find.text('Фото одобрено — другие люди видят его рядом с отзывами'),
        findsOneWidget);
    expect(find.text('Фото одобрено — другие его видят'), findsOneWidget);
    expect(find.byKey(const ValueKey<String>('user-photo-approve')), findsNothing,
        reason: 'одобренное фото — только «Снять»');
    expect(badges.loads, 1, reason: 'счётчик очереди на рейле перечитан');
  });

  testWidgets('снять фото: подтверждение с необязательной причиной; отмена '
      'ничего не шлёт', (tester) async {
    final server = _Server();
    final (_, badges) = await pumpUsers(tester, server);
    final remove = find.byKey(const ValueKey<String>('user-photo-remove'));

    await tap(tester, remove);
    expect(find.text('Снять фото?'), findsOneWidget);
    await tap(tester, find.text('Отмена'));
    expect(server.to('POST', '/avatar/remove'), isEmpty);

    await tap(tester, remove);
    await tester.enterText(
        find.byKey(const ValueKey<String>('user-photo-remove-reason')),
        '  неподобающее  ');
    await tap(tester, find.byKey(const ValueKey<String>('user-photo-remove-confirm')));

    final sent = server.to('POST', '/users/$_id/avatar/remove').single;
    expect(sent.data,
        <String, dynamic>{'avatar_url': _photo, 'reason': 'неподобающее'});
    expect(find.text('Фото снято — вместо него у всех буква'), findsOneWidget);
    expect(find.byKey(const ValueKey<String>('user-photo-block')), findsNothing,
        reason: 'фото нет — и блока нет');
    expect(badges.loads, 1);
  });

  testWidgets('фото сменилось, пока модератор смотрел: отказ сервера его '
      'словами', (tester) async {
    final server = _Server()
      ..photoAnswer = () => jsonBody(<String, dynamic>{
            'success': false,
            'message': 'Фото уже сменилось или убрано. Обновите список и '
                'посмотрите, что стоит сейчас',
            'error': <String, dynamic>{'code': 'AVATAR_CHANGED'},
          }, status: 409);
    await pumpUsers(tester, server);

    await tap(tester, find.byKey(const ValueKey<String>('user-photo-approve')));

    expect(find.byKey(const ValueKey<String>('user-action-error')), findsOneWidget);
    expect(find.textContaining('Фото уже сменилось'), findsOneWidget);
  });

  testWidgets('фильтр «Фото: на проверке» просит у сервера очередь',
      (tester) async {
    final server = _Server();
    await pumpUsers(tester, server, open: null);

    await tap(tester, find.byKey(const ValueKey<String>('users-avatar-filter')));
    expect(server.to('GET', '/admin/users').last.queryParameters['avatar'],
        'pending');

    await tap(tester, find.byKey(const ValueKey<String>('users-avatar-filter')));
    expect(server.to('GET', '/admin/users').last.queryParameters['avatar'],
        isNull, reason: 'второе касание снимает отбор');
  });

  testWidgets('просмотрщик: состояние без самого фото и без кнопок',
      (tester) async {
    final server = _Server()..person = _person(viewerRedacted: true);
    await pumpUsers(tester, server, viewer: true);

    expect(find.byKey(PersonPhoto.imageKey), findsNothing);
    expect(
      find.text('Фото на проверке — другие видят букву. '
          'Само фото скрыто в режиме просмотра.'),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey<String>('user-photo-approve')), findsNothing);
    expect(find.byKey(const ValueKey<String>('user-photo-remove')), findsNothing);
  });

  testWidgets('«Отзывы»: фото автора рядом с отзывом, состояние и путь к '
      'решению', (tester) async {
    final server = _Server();
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    final reviews = AdminReviewsProvider(
        service: AdminReviewService.withClient(stubClient(server.adapter)));
    addTearDown(reviews.dispose);
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AdminReviewsProvider>.value(value: reviews),
          ChangeNotifierProvider<AuthProvider>(
              create: (_) => StubAuthProvider.admin()),
        ],
        child: MaterialApp(
          theme: AppTheme.lightTheme,
          home: const Scaffold(body: ReviewsManagementScreen()),
        ),
      ),
    );
    await _settle(tester);

    expect(find.byKey(PersonPhoto.imageKey), findsOneWidget); // строка списка
    await tap(tester, find.text('Отзыв автора с фото').first);

    expect(find.byKey(PersonPhoto.imageKey), findsNWidgets(2)); // и карточка
    expect(find.byKey(const ValueKey<String>('review-author-photo-state')),
        findsOneWidget);
    expect(find.byKey(const ValueKey<String>('review-author-photo')),
        findsOneWidget);
  });
}
