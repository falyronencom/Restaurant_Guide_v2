package com.nirivio.app

import android.app.Application
import android.content.pm.PackageManager
import com.yandex.mapkit.MapKitFactory

class MainApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // Read API key from AndroidManifest meta-data (injected from local.properties at build time)
        val appInfo = packageManager.getApplicationInfo(packageName, PackageManager.GET_META_DATA)
        val apiKey = appInfo.metaData?.getString("com.yandex.android.mapkit.MAPKIT_API_KEY") ?: ""
        MapKitFactory.setApiKey(apiKey)
    }
}
