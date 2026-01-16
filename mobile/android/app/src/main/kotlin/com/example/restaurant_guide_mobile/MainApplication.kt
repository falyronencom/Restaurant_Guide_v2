package com.example.restaurant_guide_mobile

import android.app.Application
import com.yandex.mapkit.MapKitFactory

class MainApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        MapKitFactory.setApiKey("***YANDEX_MAPKIT_KEY_REDACTED***")
    }
}
