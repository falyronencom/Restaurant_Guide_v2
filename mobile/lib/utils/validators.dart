/// Form validation utilities
/// Provides validators for email, phone, password, and other inputs

/// Email validation
/// Returns null if valid, error message if invalid
String? validateEmail(String? value) {
  if (value == null || value.isEmpty) {
    return 'Email is required';
  }

  // RFC 5322 compliant regex (simplified)
  final emailRegex = RegExp(
    r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$',
  );

  if (!emailRegex.hasMatch(value)) {
    return 'Please enter a valid email address';
  }

  return null;
}

/// Belarus phone validation
/// Accepts formats: +375291234567 or +375 29 123 45 67
/// Returns null if valid, error message if invalid
String? validateBelarusPhone(String? value) {
  if (value == null || value.isEmpty) {
    return 'Phone number is required';
  }

  // Remove all non-digit characters for validation
  final digitsOnly = value.replaceAll(RegExp(r'\D'), '');

  // Belarus: +375 XX XXX XX XX (12 digits total with country code)
  if (!digitsOnly.startsWith('375') || digitsOnly.length != 12) {
    return 'Please enter a valid Belarus phone number';
  }

  // Check operator prefix (25, 29, 33, 44)
  final operatorPrefix = digitsOnly.substring(3, 5);
  if (!['25', '29', '33', '44'].contains(operatorPrefix)) {
    return 'Phone number must start with 25, 29, 33, or 44';
  }

  return null;
}

/// Format Belarus phone number for display
/// Converts 375291234567 to +375 29 123 45 67
String formatBelarusPhone(String phone) {
  final digitsOnly = phone.replaceAll(RegExp(r'\D'), '');

  if (digitsOnly.length != 12 || !digitsOnly.startsWith('375')) {
    return phone; // Return as-is if invalid format
  }

  return '+${digitsOnly.substring(0, 3)} ${digitsOnly.substring(3, 5)} ${digitsOnly.substring(5, 8)} ${digitsOnly.substring(8, 10)} ${digitsOnly.substring(10, 12)}';
}

/// Format Belarus phone for storage (remove formatting)
/// Converts +375 29 123 45 67 to +375291234567
String unformatBelarusPhone(String phone) {
  final digitsOnly = phone.replaceAll(RegExp(r'\D'), '');
  return '+$digitsOnly';
}

/// Password validation with complexity rules
/// Returns null if valid, error message if invalid
String? validatePassword(String? value) {
  if (value == null || value.isEmpty) {
    return 'Password is required';
  }

  if (value.length < 8) {
    return 'Password must be at least 8 characters';
  }

  // Check for at least one uppercase letter
  if (!RegExp(r'[A-Z]').hasMatch(value)) {
    return 'Password must contain at least one uppercase letter';
  }

  // Check for at least one lowercase letter
  if (!RegExp(r'[a-z]').hasMatch(value)) {
    return 'Password must contain at least one lowercase letter';
  }

  // Check for at least one digit
  if (!RegExp(r'[0-9]').hasMatch(value)) {
    return 'Password must contain at least one number';
  }

  return null;
}

/// Password match validation
/// Returns null if passwords match, error message if not
String? validatePasswordMatch(String? value, String? password) {
  if (value == null || value.isEmpty) {
    return 'Please confirm your password';
  }

  if (value != password) {
    return 'Passwords do not match';
  }

  return null;
}

/// Name validation for profile
/// Returns null if valid, error message if invalid
String? validateName(String? value) {
  if (value == null || value.isEmpty) {
    return 'Name is required';
  }

  if (value.trim().length < 2) {
    return 'Name must be at least 2 characters';
  }

  if (value.trim().length > 50) {
    return 'Name must be less than 50 characters';
  }

  return null;
}

/// Password strength enum
enum PasswordStrength {
  /// Weak password (score 0-2)
  weak,

  /// Medium password (score 3)
  medium,

  /// Strong password (score 4+)
  strong,
}

/// Get password strength
/// Returns PasswordStrength enum based on password complexity
PasswordStrength getPasswordStrength(String password) {
  if (password.length < 8) return PasswordStrength.weak;

  int score = 0;

  // Has uppercase
  if (RegExp(r'[A-Z]').hasMatch(password)) score++;

  // Has lowercase
  if (RegExp(r'[a-z]').hasMatch(password)) score++;

  // Has digit
  if (RegExp(r'[0-9]').hasMatch(password)) score++;

  // Has special character
  if (RegExp(r'[!@#\$%\^&\*]').hasMatch(password)) score++;

  // Is long enough (12+ chars)
  if (password.length >= 12) score++;

  if (score <= 2) return PasswordStrength.weak;
  if (score <= 3) return PasswordStrength.medium;
  return PasswordStrength.strong;
}

/// Get password strength percentage (0.0 to 1.0)
double getPasswordStrengthProgress(String password) {
  final strength = getPasswordStrength(password);
  switch (strength) {
    case PasswordStrength.weak:
      return 0.33;
    case PasswordStrength.medium:
      return 0.66;
    case PasswordStrength.strong:
      return 1.0;
  }
}

/// Verification code validation (6 digits)
/// Returns null if valid, error message if invalid
String? validateVerificationCode(String? value) {
  if (value == null || value.isEmpty) {
    return 'Verification code is required';
  }

  if (value.length != 6) {
    return 'Verification code must be 6 digits';
  }

  if (!RegExp(r'^[0-9]{6}$').hasMatch(value)) {
    return 'Verification code must contain only numbers';
  }

  return null;
}
