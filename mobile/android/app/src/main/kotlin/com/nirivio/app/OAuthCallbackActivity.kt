package com.nirivio.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import com.linusu.flutter_web_auth_2.FlutterWebAuth2Plugin

/**
 * Возврат из браузера после входа через Яндекс (`restaurantguide://…`).
 *
 * Замена `CallbackActivity` из flutter_web_auth_2. Та отдаёт ответ и закрывает
 * только собственную задачу в расчёте, что под ней окажется окно приложения.
 * У нас окно живёт в задаче без привязки: `taskAffinity=""` у [MainActivity] —
 * защита шаблона Flutter от подмены окна чужим приложением на Android 8–10.
 * Android не находит, к какой задаче приложить возврат, заводит для него
 * отдельную, и, когда она закрывается, наверху снова вкладка браузера с
 * «Войти как …», хотя вход уже прошёл (Samsung A72, Samsung Internet,
 * 08.10.2026). Человек видит «аккаунт не реагирует» и нажимает ещё раз.
 * Поэтому окно приложения выводится наверх явно.
 */
class OAuthCallbackActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Сначала ответ, потом окно — порядок обязателен. Плагин, увидев
        // приложение снова на экране, отменяет все незавершённые входы
        // («Вход отменён»): ответ, отданный после этого, уже некому принять.
        val url = intent?.data
        val scheme = url?.scheme
        if (scheme != null) {
            FlutterWebAuth2Plugin.callbacks.remove(scheme)?.success(url.toString())
        }

        // Android ищет задачу для окна по самому окну, а не по привязке, —
        // поэтому существующая задача приложения находится и при
        // `taskAffinity=""` и выходит наверх. `SINGLE_TOP` — второго окна
        // приложения поверх первого не будет, даже если у [MainActivity]
        // когда-нибудь снимут `singleTop` в манифесте. Если приложение успели
        // выгрузить, оно запустится заново — лучше, чем оставить человека во
        // вкладке.
        startActivity(
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        )
        finishAndRemoveTask()
    }
}
