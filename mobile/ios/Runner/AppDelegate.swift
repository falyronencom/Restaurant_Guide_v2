import Flutter
import UIKit
import YandexMapsMobile

@main
@objc class AppDelegate: FlutterAppDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    // Initialize Yandex MapKit (non-blocking — empty key disables maps but won't crash)
    let apiKey = Bundle.main.infoDictionary?["YandexMapKitApiKey"] as? String ?? ""
    if !apiKey.isEmpty && apiKey != "$(YANDEX_MAPKIT_API_KEY)" {
      YMKMapKit.setApiKey(apiKey)
    } else {
      print("Warning: YandexMapKitApiKey not found in Info.plist — map features disabled")
    }
    GeneratedPluginRegistrant.register(with: self)
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
