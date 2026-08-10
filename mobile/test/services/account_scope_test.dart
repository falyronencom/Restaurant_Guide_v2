import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';

void main() {
  setUp(AccountScope.debugReset);

  test('resetAll fires every registered reset once', () {
    var a = 0;
    var b = 0;
    AccountScope.register(() => a++);
    AccountScope.register(() => b++);

    AccountScope.resetAll();

    expect(a, 1);
    expect(b, 1);
  });

  test('resetAll without registrations is a no-op', () {
    expect(AccountScope.resetAll, returnsNormally);
  });

  test('providers registering resetAccountScope are all wiped together', () {
    final wiped = <String>[];
    AccountScope.register(() => wiped.add('dashboard'));
    AccountScope.register(() => wiped.add('bookings'));
    AccountScope.register(() => wiped.add('favorites'));

    AccountScope.resetAll();

    expect(wiped, unorderedEquals(['dashboard', 'bookings', 'favorites']));
  });
}
