import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_dashboard_provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_registration_provider.dart';
import 'package:restaurant_guide_mobile/screens/partner/partner_registration_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';

import '../support/wire_stand.dart';

/// Мастер новой карточки: что становится с человеком и его профилем, когда
/// карточка на сервере уже есть, а отправка на модерацию не прошла.
///
/// Первая карточка делает пользователя партнёром — роль сервер меняет сам.
/// До 13.10.2026 приложение узнавало об этом только при полном успехе:
/// после неудачной отправки роль в приложении оставалась «пользователь», а
/// профиль показывал «Добавить заведение» вместо черновика — пока партнёр
/// не переключит вкладку. Черновик некуда было отправить, кроме как начать
/// заново и упереться в «You already have an establishment with this name».
const _id = '11111111-2222-3333-4444-555555555555';
const _base = '/api/v1/partner/establishments';

const _completeCard = PartnerRegistration(
  categories: ['restaurant'],
  cuisineTypes: ['european'],
  name: 'Кофейня у моста',
  // Итоговый шаг экрана не даёт нажать «Отправить» без телефона.
  phone: '+375291234567',
  priceRange: r'$$',
  interiorPhotos: ['https://res.cloudinary.com/demo/image/upload/a.jpg'],
  menuPhotos: ['https://res.cloudinary.com/demo/image/upload/b.jpg'],
  primaryPhotoUrl: 'https://res.cloudinary.com/demo/image/upload/a.jpg',
  city: 'Минск',
  street: 'Немига',
  building: '1',
  legalName: 'ООО «Мост»',
  unp: '123456789',
  contactPerson: 'Анна',
  contactEmail: 'anna@example.com',
);

Map<String, dynamic> _refusal(String message, String code) => {
      'success': false,
      'message': message,
      'error': {'code': code},
      'timestamp': '2026-10-13T10:00:00.000Z',
    };

void main() {
  // Состояние сервера: роль человека, создана ли карточка, её статус.
  late String role;
  late bool created;
  late String status;
  // Как сбоит отправка на модерацию: null — не сбоит.
  late DioExceptionType? submitFault;
  // Создание выполнено, а ответ потерян.
  late bool createAnswerLost;
  late StubAdapter wire;

  Map<String, dynamic> card() => {
        'id': _id,
        'name': 'Кофейня у моста',
        'city': 'Минск',
        'address': 'Немига, 1',
        'status': status,
        'created_at': '2026-10-13T10:00:00.000Z',
        'updated_at': '2026-10-13T10:00:00.000Z',
      };

  ResponseBody serve(RequestOptions o) {
    if (o.method == 'GET' && o.path == '/api/v1/auth/me') {
      return jsonBody({
        'success': true,
        'data': {
          'user': {
            'id': 'user-1',
            'email': 'anna@example.com',
            'name': 'Анна',
            'role': role,
          },
        },
      });
    }
    if (o.method == 'GET' && o.path == _base) {
      // Список заведений — только партнёру (authorize(['partner'])).
      if (role != 'partner') {
        return jsonBody(
          _refusal('Insufficient permissions to access this resource',
              'FORBIDDEN'),
          status: 403,
        );
      }
      return jsonBody({
        'success': true,
        'data': {
          'establishments': [if (created) card()],
        },
      });
    }
    if (o.method == 'POST' && o.path == _base) {
      if (created) {
        return jsonBody(
          _refusal('You already have an establishment with this name',
              'DUPLICATE_ESTABLISHMENT'),
          status: 409,
        );
      }
      created = true;
      role = 'partner';
      return jsonBody({
        'success': true,
        'data': {
          'establishment': card(),
          'tokens': {
            'accessToken': 'partner-access',
            'refreshToken': 'partner-refresh',
          },
        },
      }, status: 201);
    }
    if (o.method == 'POST' && o.path == '$_base/$_id/submit') {
      status = 'pending';
      return jsonBody({
        'success': true,
        'data': {
          'establishment': {'id': _id, 'status': 'pending'},
        },
      });
    }
    throw StateError('неожиданный запрос: ${o.method} ${o.path}');
  }

  setUp(() {
    AccountScope.debugReset();
    role = 'user';
    created = false;
    status = 'draft';
    submitFault = null;
    createAnswerLost = false;
    wire = installWireStand((o) {
      final fault = submitFault;
      if (fault != null && o.method == 'POST' && o.path.endsWith('/submit')) {
        throw DioException(requestOptions: o, type: fault);
      }
      if (createAnswerLost && o.method == 'POST' && o.path == _base) {
        createAnswerLost = false;
        serve(o);
        throw DioException(
          requestOptions: o,
          type: DioExceptionType.receiveTimeout,
        );
      }
      return serve(o);
    }, accessToken: 'user-access');
  });

  /// Профиль с открытым поверх него мастером на итоговом шаге. Список
  /// заведений профиль загрузил заранее — пользователю сервер его не отдал.
  Future<({AuthProvider auth, PartnerDashboardProvider dashboard})> openWizard(
    WidgetTester tester,
  ) async {
    final auth = AuthProvider();
    final dashboard = PartnerDashboardProvider();
    addTearDown(auth.dispose);
    addTearDown(dashboard.dispose);

    await tester.pumpWidget(MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: auth),
        ChangeNotifierProvider<PartnerDashboardProvider>.value(
          value: dashboard,
        ),
      ],
      child: MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: TextButton(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => const PartnerRegistrationScreen(
                      initialStep: 6,
                      initialData: _completeCard,
                    ),
                  ),
                ),
                child: const Text('Профиль'),
              ),
            ),
          ),
        ),
      ),
    ));
    await tester.pumpAndSettle();
    dashboard.initializeIfNeeded();
    await tester.pumpAndSettle();
    expect(auth.currentUser?.role, 'user');
    expect(dashboard.hasEstablishments, isFalse);

    await tester.tap(find.text('Профиль'));
    await tester.pumpAndSettle();
    return (auth: auth, dashboard: dashboard);
  }

  Future<void> tapSend(WidgetTester tester) async {
    final send = find.text('Отправить на верификацию');
    await tester.ensureVisible(send);
    await tester.pumpAndSettle();
    await tester.tap(send);
    await tester.pumpAndSettle();
  }

  testWidgets(
      'карточка создана, отправка не дошла: человек — партнёр, черновик в '
      'профиле, мастер открыт с объяснением', (tester) async {
    submitFault = DioExceptionType.connectionError;
    final (:auth, :dashboard) = await openWizard(tester);

    await tapSend(tester);

    expect(
      find.text('Нет связи. Проверьте подключение к интернету. '
          'Заведение сохранено как черновик — нажмите «Отправить на '
          'верификацию» ещё раз.'),
      findsOneWidget,
    );
    expect(auth.currentUser?.role, 'partner');
    expect(dashboard.establishments.map((e) => e.id), [_id],
        reason: 'черновик виден в профиле — оттуда его можно отправить');
    expect(find.text('Отправить на верификацию'), findsOneWidget,
        reason: 'мастер не закрылся — можно нажать ещё раз');
  });

  testWidgets(
      'ответ на создание потерялся, повтор упёрся в название: подсказка, '
      'человек — партнёр, карточка в профиле', (tester) async {
    createAnswerLost = true;
    final (:auth, :dashboard) = await openWizard(tester);

    await tapSend(tester);
    expect(find.text('Сервер не отвечает. Проверьте подключение.'),
        findsOneWidget);

    // Плашка первой попытки уходит, прежде чем нажать ещё раз.
    ScaffoldMessenger.of(tester.element(find.byType(PartnerRegistrationScreen)))
        .removeCurrentSnackBar();
    await tester.pumpAndSettle();
    await tapSend(tester);

    expect(
      find.text('Заведение с таким названием уже есть в вашем профиле — '
          'возможно, оно создалось при прошлой попытке. Откройте его в '
          'профиле и нажмите «Отправить на модерацию».'),
      findsOneWidget,
    );
    expect(auth.currentUser?.role, 'partner');
    expect(dashboard.establishments.map((e) => e.id), [_id]);
  });

  /// Стрелка «назад» мастера с первого шага — к диалогу выхода. Шаги между
  /// итоговым и первым (адрес с картой, фото из сети) в тестовой среде не
  /// строятся, поэтому на первый шаг мастер переводит его же провайдер, а
  /// диалог открывает настоящая стрелка экрана.
  Future<void> backFromFirstStep(WidgetTester tester) async {
    tester
        .element(find.text('Отправить на верификацию'))
        .read<PartnerRegistrationProvider>()
        .goToStep(0);
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.chevron_left));
    await tester.pumpAndSettle();
    expect(find.text('Выйти из добавления заведения?'), findsOneWidget);
  }

  testWidgets(
      'выход из мастера, когда черновик уже на сервере: данные не '
      'пропадут — где его найти', (tester) async {
    submitFault = DioExceptionType.connectionError;
    await openWizard(tester);
    await tapSend(tester);
    ScaffoldMessenger.of(tester.element(find.byType(PartnerRegistrationScreen)))
        .removeCurrentSnackBar();
    await tester.pumpAndSettle();

    await backFromFirstStep(tester);

    expect(
      find.text('Заведение сохранено как черновик — отправить его на '
          'модерацию можно из профиля.'),
      findsOneWidget,
    );
    expect(find.text('Введённые данные будут потеряны.'), findsNothing);
  });

  testWidgets('выход из мастера без карточки на сервере: данные пропадут',
      (tester) async {
    await openWizard(tester);

    await backFromFirstStep(tester);

    expect(find.text('Введённые данные будут потеряны.'), findsOneWidget);
  });

  testWidgets('всё прошло: партнёр, карточка в профиле, мастер закрыт',
      (tester) async {
    final (:auth, :dashboard) = await openWizard(tester);

    await tapSend(tester);

    expect(find.text('Заведение успешно создано!'), findsOneWidget);
    expect(auth.currentUser?.role, 'partner');
    expect(dashboard.establishments.map((e) => e.status.name), ['pending']);
    expect(find.byType(PartnerRegistrationScreen), findsNothing);
    expect(
      wire.requests
          .where((o) => o.method == 'POST')
          .map((o) => o.path)
          .toList(),
      [_base, '$_base/$_id/submit'],
    );
  });
}
