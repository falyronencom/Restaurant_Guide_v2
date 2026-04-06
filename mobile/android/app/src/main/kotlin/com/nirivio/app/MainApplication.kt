package com.nirivio.app

import android.app.Application
import com.yandex.mapkit.MapKitFactory

class MainApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        MapKitFactory.setApiKey("***YANDEX_MAPKIT_KEY_REDACTED***")
    }
}
