import Flutter
import UIKit
import YandexMapsMobile

@main
@objc class AppDelegate: FlutterAppDelegate {
  /// Ключ MapKit валиден — только тогда вообще допустимо трогать YMKMapKit.
  /// Сохраняем решение из didFinishLaunching, чтобы наблюдатель ниже не
  /// обращался к движку, когда карты намеренно отключены пустым ключом.
  private var mapKitEnabled = false

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    // Initialize Yandex MapKit (non-blocking — empty key disables maps but won't crash)
    let apiKey = Bundle.main.infoDictionary?["YandexMapKitApiKey"] as? String ?? ""
    if !apiKey.isEmpty && apiKey != "$(YANDEX_MAPKIT_API_KEY)" {
      YMKMapKit.setApiKey(apiKey)
      mapKitEnabled = true
    } else {
      print("Warning: YandexMapKitApiKey not found in Info.plist — map features disabled")
    }
    GeneratedPluginRegistrant.register(with: self)

    // Перезапуск MapKit при возврате приложения из фона.
    //
    // Плагин yandex_mapkit зовёт YMKMapKit.onStart() ОДИН раз — при регистрации
    // плагина (ios/Classes/lite/InitLite.swift), и onStop() не зовёт никогда.
    // После ухода приложения в фон движок останавливается, а обратно его никто
    // не запускает: карта остаётся белой до полного перезапуска приложения.
    // Переключение вкладок не помогает — запуск привязан к регистрации плагина,
    // а не к созданию вида. На Android тот же плагин цикл обрабатывает
    // (android/.../lite/InitLite.java), на iOS — нет, поэтому доводим здесь.
    //
    // Через NotificationCenter, а не переопределением applicationDidBecomeActive:
    // так мы не вмешиваемся в то, как FlutterAppDelegate раздаёт события
    // жизненного цикла плагинам.
    NotificationCenter.default.addObserver(
      forName: UIApplication.didBecomeActiveNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      guard self?.mapKitEnabled == true else { return }
      YMKMapKit.sharedInstance().onStart()
    }

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
