import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/router.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/providers/approved_provider.dart';
import 'package:restaurant_guide_admin_web/providers/moderation_provider.dart';
import 'package:restaurant_guide_admin_web/providers/dashboard_provider.dart';
import 'package:restaurant_guide_admin_web/providers/establishments_analytics_provider.dart';
import 'package:restaurant_guide_admin_web/providers/rejected_provider.dart';
import 'package:restaurant_guide_admin_web/providers/reviews_analytics_provider.dart';
import 'package:restaurant_guide_admin_web/providers/users_analytics_provider.dart';
import 'package:restaurant_guide_admin_web/providers/audit_log_provider.dart';
import 'package:restaurant_guide_admin_web/providers/admin_reviews_provider.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
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
        ChangeNotifierProvider(create: (_) => DashboardProvider()),
        ChangeNotifierProvider(create: (_) => EstablishmentsAnalyticsProvider()),
        ChangeNotifierProvider(create: (_) => UsersAnalyticsProvider()),
        ChangeNotifierProvider(create: (_) => ReviewsAnalyticsProvider()),
        ChangeNotifierProvider(create: (_) => AuditLogProvider()),
        ChangeNotifierProvider(create: (_) => AdminReviewsProvider()),
      ],
      child: MaterialApp.router(
        title: '{N}YAMA Admin',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          useMaterial3: true,
          colorSchemeSeed: const Color(0xFFDB4F13),
        ),
        routerConfig: _router,
      ),
    );
  }
}
