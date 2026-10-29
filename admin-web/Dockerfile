# syntax=docker/dockerfile:1
#
# Админ-панель (Flutter Web) как третий сервис Railway — SDL CAT-C-2.11,
# решение Координатора 2026-09-08.
#
# Railway сам находит Dockerfile в Root Directory сервиса (`admin-web`) и
# собирает по нему; Railpack при этом не участвует. Две стадии: первая
# собирает бандл тем же Flutter, что и гейт CI (3.35.2 — версия закреплена,
# иначе обновление канала меняло бы прод без единого коммита), вторая отдаёт
# статику Caddy на порту из переменной PORT, которую задаёт Railway.
#
# Бандл ходит в прод-API (lib/config/environment.dart) — сервису не нужна ни
# одна переменная; зато адрес этого сервиса обязан быть в CORS_ORIGIN
# бэкенда (docs/deployment/railway_admin_web.md).

FROM ghcr.io/cirruslabs/flutter:3.35.2 AS build

WORKDIR /app

# Сначала зависимости: слой pub-кэша переживает правки исходников.
COPY pubspec.yaml pubspec.lock ./
RUN flutter pub get

COPY . .

# ENV=production — без Dio LogInterceptor (OSB-M P1: пароль и токены в
# консоль). --pwa-strategy=none — без service worker: у админского
# инструмента после редеплоя не должно быть «старой» сборки в кэше браузера.
#
# PANEL_BUILD — номер этой сборки: вшивается в бандл и кладётся рядом в
# build.json. Открытая вкладка раз в 5 минут и при возврате на неё сверяет
# свой номер с файлом и при расхождении показывает плашку «Вышла новая версия
# панели» (проход по панели модератора, 20.10, К-7: вкладка без перезагрузки
# жила со сборкой 18.10). Номер — время сборки: `version` из pubspec между
# сборками не меняется. Слой с этой командой Docker берёт из кэша, только
# когда исходники те же, — тогда и бандл тот же, и номер прежний верно.
#
# --no-web-resources-cdn — движок отрисовки CanvasKit грузится из canvaskit/
# рядом с панелью, а не с www.gstatic.com (сверка меток панели 29.10, S3):
# движок видит всё на экране модератора, и третьей стороны в этой цепочке не
# должно быть. Шрифты-заменители (Roboto, Noto) движок по-прежнему берёт у
# fonts.gstatic.com — решение Координатора 29.10; их пропускает политика
# источников в Caddyfile.
RUN PANEL_BUILD="$(date -u +%Y%m%dT%H%M%SZ)" \
 && flutter build web --release --dart-define=ENV=production \
      --dart-define=PANEL_BUILD="$PANEL_BUILD" --pwa-strategy=none \
      --no-web-resources-cdn \
 && printf '{"build":"%s"}\n' "$PANEL_BUILD" > build/web/build.json

# Минор закреплён по той же причине, что и Flutter выше: `2-alpine` плавал бы
# на следующий минор без единого коммита. Патчи внутри 2.11 приходят сами.
FROM caddy:2.11-alpine

COPY --from=build /app/build/web /srv
COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 8080
