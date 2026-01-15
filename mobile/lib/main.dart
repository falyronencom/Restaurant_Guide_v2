import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/screens/main_navigation.dart';
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

/// Restaurant Guide Belarus v2.0 Mobile Application
/// Entry point for the Flutter application
void main() {
  // Ensure Flutter bindings are initialized
  WidgetsFlutterBinding.ensureInitialized();

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

        // Additional providers can be added here as needed
      ],
      child: MaterialApp(
        title: 'Restaurant Guide Belarus',
        debugShowCheckedModeBanner: false,

        // Application theme from Phase B
        theme: AppTheme.lightTheme,

        // Main navigation with bottom tabs from Phase E
        home: const MainNavigationScreen(),

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
        },

        // Dynamic routes with parameters
        onGenerateRoute: (settings) {
          // Establishment detail route: /establishment/:id
          if (settings.name != null &&
              settings.name!.startsWith('/establishment/')) {
            final idString = settings.name!.split('/').last;
            final id = int.tryParse(idString);
            if (id != null) {
              return MaterialPageRoute(
                builder: (context) => EstablishmentDetailScreen(
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
