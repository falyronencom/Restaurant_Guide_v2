/// Belarus cities with regions — single source of truth.
/// Used by search home screen, results list, and city persistence.
class BelarusCities {
  BelarusCities._();

  /// Default city for first-ever launch
  static const String defaultCity = 'Минск';

  /// SharedPreferences key for persisted city selection
  static const String persistenceKey = 'selected_city';

  /// City list with regions (Figma design)
  static const List<Map<String, String>> citiesWithRegions = [
    {'city': 'Минск', 'region': 'Минская область'},
    {'city': 'Гродно', 'region': 'Гродненская область'},
    {'city': 'Брест', 'region': 'Брестская область'},
    {'city': 'Гомель', 'region': 'Гомельская область'},
    {'city': 'Витебск', 'region': 'Витебская область'},
    {'city': 'Могилёв', 'region': 'Могилёвская область'},
    {'city': 'Бобруйск', 'region': 'Могилёвская область'},
  ];
}
