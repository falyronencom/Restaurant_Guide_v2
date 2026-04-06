import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/screens/main_navigation.dart';
import 'package:restaurant_guide_mobile/screens/splash/splash_screen.dart';
import 'package:restaurant_guide_mobile/screens/auth/method_selection_screen.dart';
import 'package:restaurant_guide_mobile/screens/auth/email_registration_screen.dart';
import 'package:restaurant_guide_mobile/screens/auth/email_verification_screen.dart';
import 'package:restaurant_guide_mobile/screens/auth/phone_registration_screen.dart';
import 'package:restaurant_guide_mobile/screens/auth/phone_verification_screen.dart';
import 'package:restaurant_guide_mobile/screens/auth/login_screen.dart';
import 'package:restaurant_guide_mobile/screens/search/results_list_screen.dart';
import 'package:restaurant_guide_mobile/screens/search/filter_screen.dart';
import 'package:restaurant_guide_mobile/screens/establishment/detail_screen.dart';
import 'package:restaurant_guide_mobile/screens/profile/edit_profile_screen.dart';
import 'package:restaurant_guide_mobile/screens/partner/partner_registration_screen.dart';
import 'package:restaurant_guide_mobile/screens/partner/partner_statistics_screen.dart';
import 'package:restaurant_guide_mobile/screens/partner/partner_reviews_screen.dart';
import 'package:restaurant_guide_mobile/screens/partner/edit_establishment_screen.dart';
import 'package:restaurant_guide_mobile/providers/partner_dashboard_provider.dart';
import 'package:restaurant_guide_mobile/providers/notification_provider.dart';
import 'package:restaurant_guide_mobile/providers/promotion_provider.dart';
import 'package:restaurant_guide_mobile/providers/booking_settings_provider.dart';
import 'package:restaurant_guide_mobile/providers/booking_provider.dart';
import 'package:restaurant_guide_mobile/providers/notification_preferences_provider.dart';

/// Restaurant Guide Belarus v2.0 Mobile Application
/// Entry point for the Flutter application
void main() async {
  // Ensure Flutter bindings are initialized
  WidgetsFlutterBinding.ensureInitialized();

  // Initialize Firebase (required before any Firebase service)
  await Firebase.initializeApp();

  // Lock to portrait orientation only
  SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  runApp(const RestaurantGuideApp());
}

/// Root application widget with state management
class RestaurantGuideApp extends StatelessWidget {
  const RestaurantGuideApp({super.key});

  @override
  Widget build(BuildContext context) {
    // Wrap application in MultiProvider for state management
    return MultiProvider(
      providers: [
        // Authentication provider
        ChangeNotifierProvider(
          create: (_) => AuthProvider(),
        ),

        // Establishments provider
        ChangeNotifierProvider(
          create: (_) => EstablishmentsProvider(),
        ),

        // Partner Dashboard provider (Phase 5.2)
        ChangeNotifierProvider(
          create: (_) => PartnerDashboardProvider(),
        ),

        // Notification provider (polling, badge count, notification list)
        ChangeNotifierProvider(
          create: (_) => NotificationProvider(),
        ),

        // Promotion provider (partner promotion management)
        ChangeNotifierProvider(
          create: (_) => PromotionProvider(),
        ),

        // Booking settings provider (partner booking configuration)
        ChangeNotifierProvider(
          create: (_) => BookingSettingsProvider(),
        ),

        // Booking provider (partner booking management)
        ChangeNotifierProvider(
          create: (_) => BookingProvider(),
        ),

        // Notification preferences provider (push settings)
        ChangeNotifierProvider(
          create: (_) => NotificationPreferencesProvider(),
        ),
      ],
      child: MaterialApp(
        title: 'Restaurant Guide Belarus',
        debugShowCheckedModeBanner: false,

        // Application theme from Phase B
        theme: AppTheme.lightTheme,

        // Main navigation with bottom tabs from Phase E
        home: const SplashScreen(),

        // Named routes for navigation
        routes: {
          '/home': (context) => const MainNavigationScreen(),
          '/search/results': (context) => const ResultsListScreen(),
          '/filter': (context) => const FilterScreen(),
          '/auth/method-selection': (context) =>
              const MethodSelectionScreen(),
          '/auth/login': (context) => const LoginScreen(),
          '/auth/email-registration': (context) =>
              const EmailRegistrationScreen(),
          '/auth/email-verification': (context) =>
              const EmailVerificationScreen(),
          '/auth/phone-registration': (context) =>
              const PhoneRegistrationScreen(),
          '/auth/phone-verification': (context) =>
              const PhoneVerificationScreen(),
          '/profile/edit': (context) => const EditProfileScreen(),
          '/partner/register': (context) => const PartnerRegistrationScreen(),
        },

        // Dynamic routes with parameters
        onGenerateRoute: (settings) {
          // Establishment detail route: /establishment/:id
          if (settings.name != null &&
              settings.name!.startsWith('/establishment/')) {
            final id = settings.name!.split('/').last;
            if (id.isNotEmpty) {
              final args = settings.arguments as Map<String, dynamic>?;
              final distanceKm = args?['distanceKm'] as double?;
              return MaterialPageRoute(
                builder: (context) => EstablishmentDetailScreen(
                  establishmentId: id,
                  distanceKm: distanceKm,
                ),
                settings: settings,
              );
            }
          }

          // Partner statistics route: /partner/statistics/:id
          if (settings.name != null &&
              settings.name!.startsWith('/partner/statistics/')) {
            final id = settings.name!.split('/').last;
            if (id.isNotEmpty) {
              return MaterialPageRoute(
                builder: (context) => PartnerStatisticsScreen(
                  establishmentId: id,
                ),
                settings: settings,
              );
            }
          }

          // Partner reviews route: /partner/reviews (with arguments)
          if (settings.name == '/partner/reviews') {
            final id = settings.arguments as String?;
            if (id != null) {
              return MaterialPageRoute(
                builder: (context) => PartnerReviewsScreen(
                  establishmentId: id,
                ),
                settings: settings,
              );
            }
          }

          // Partner edit establishment route: /partner/edit/:id
          if (settings.name != null &&
              settings.name!.startsWith('/partner/edit/')) {
            final id = settings.name!.split('/').last;
            if (id.isNotEmpty) {
              return MaterialPageRoute(
                builder: (context) => EditEstablishmentScreen(
                  establishmentId: id,
                ),
                settings: settings,
              );
            }
          }

          return null;
        },
      ),
    );
  }
}
