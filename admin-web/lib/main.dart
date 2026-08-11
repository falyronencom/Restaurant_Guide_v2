import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/router.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/providers/approved_provider.dart';
import 'package:restaurant_guide_admin_web/providers/menu_items_moderation_provider.dart';
import 'package:restaurant_guide_admin_web/providers/moderation_provider.dart';
import 'package:restaurant_guide_admin_web/providers/dashboard_provider.dart';
import 'package:restaurant_guide_admin_web/providers/establishments_analytics_provider.dart';
import 'package:restaurant_guide_admin_web/providers/rejected_provider.dart';
import 'package:restaurant_guide_admin_web/providers/suspended_provider.dart';
import 'package:restaurant_guide_admin_web/providers/reviews_analytics_provider.dart';
import 'package:restaurant_guide_admin_web/providers/users_analytics_provider.dart';
import 'package:restaurant_guide_admin_web/providers/audit_log_provider.dart';
import 'package:restaurant_guide_admin_web/providers/admin_reviews_provider.dart';
import 'package:restaurant_guide_admin_web/providers/quality_health_provider.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();

  // Шрифты канона вшиты в сборку (admin-web/google_fonts/) — из сети ничего
  // не тянем. Если какое-то начертание забыли вшить, пакет напишет ошибку
  // в лог и откатится на системный шрифт, приложение не упадёт.
  GoogleFonts.config.allowRuntimeFetching = false;

  runApp(const AdminApp());
}

class AdminApp extends StatefulWidget {
  const AdminApp({super.key});

  @override
  State<AdminApp> createState() => _AdminAppState();
}

class _AdminAppState extends State<AdminApp> {
  late final AuthProvider _authProvider;
  late final GoRouter _router;

  @override
  void initState() {
    super.initState();
    _authProvider = AuthProvider();
    _router = createRouter(_authProvider);
  }

  @override
  void dispose() {
    _authProvider.dispose();
    _router.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: _authProvider),
        ChangeNotifierProvider(create: (_) => ModerationProvider()),
        ChangeNotifierProvider(create: (_) => ApprovedProvider()),
        ChangeNotifierProvider(create: (_) => RejectedProvider()),
        ChangeNotifierProvider(create: (_) => SuspendedProvider()),
        ChangeNotifierProvider(create: (_) => DashboardProvider()),
        ChangeNotifierProvider(create: (_) => EstablishmentsAnalyticsProvider()),
        ChangeNotifierProvider(create: (_) => UsersAnalyticsProvider()),
        ChangeNotifierProvider(create: (_) => ReviewsAnalyticsProvider()),
        ChangeNotifierProvider(create: (_) => AuditLogProvider()),
        ChangeNotifierProvider(create: (_) => AdminReviewsProvider()),
        ChangeNotifierProvider(create: (_) => MenuItemsModerationProvider()),
        ChangeNotifierProvider(create: (_) => QualityHealthProvider()),
      ],
      child: MaterialApp.router(
        title: 'NIRIVIO · Админ-панель',
        debugShowCheckedModeBanner: false,
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: const [
          Locale('ru'),
          Locale('en'),
        ],
        locale: const Locale('ru'),
        theme: AppTheme.lightTheme,
        routerConfig: _router,
      ),
    );
  }
}
