import Flutter
import UIKit
import YandexMapsMobile

@main
@objc class AppDelegate: FlutterAppDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    // Read API key from Info.plist (injected from Secrets.xcconfig at build time)
    let apiKey = Bundle.main.infoDictionary?["YandexMapKitApiKey"] as? String ?? ""
    YMKMapKit.setApiKey(apiKey)
    GeneratedPluginRegistrant.register(with: self)
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
