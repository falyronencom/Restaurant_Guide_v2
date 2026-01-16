package com.example.restaurant_guide_mobile

import android.app.Application
import com.yandex.mapkit.MapKitFactory

class MainApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        MapKitFactory.setApiKey("e585b056-a3fe-4667-9fd8-210fef26236e")
    }
}
