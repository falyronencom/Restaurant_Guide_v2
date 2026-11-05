#!/bin/bash
# =============================================================================
# Сквозные проверки (E2E) мобильного приложения на Maestro: стенд и прогон.
#
# Что это. Тонкий smoke-слой поверх unit/widget-тестов из mobile/test. Те
# работают с подставным API, а здесь собранное приложение целиком ходит на
# эмуляторе Android в настоящий сервер — локальный, на этом компьютере.
# Сценарии — файлы *.yaml рядом с этим скриптом, общий вход тестовым
# пользователем — subflows/login.yaml. Пилот 01.11.2026, только Android:
# для iOS нужен Mac, а bundle ID в Xcode-проекте пока шаблонный (build_ios.sh).
#
# Куда ходит приложение. Только в локальный сервер стенда. Сборка с
# --dart-define=ENV=development смотрит на http://10.0.2.2:3000 — так эмулятор
# видит localhost компьютера. Обычная сборка (без ENV) ходит в ПРОД, и на ней
# сценарии НЕ запускать: тестовое избранное, отзывы и брони увидели бы
# настоящие заведения. Поэтому шаг build собирает свою сборку, а шаг test
# сначала убеждается, что на :3000 отвечает именно стенд.
#
# Что нужно на компьютере (Windows 11, Git Bash):
#   - Docker: контейнер PostgreSQL+PostGIS на 5432 (у нас pg-test; из
#     docker-compose.yml — rg-pg, тогда E2E_PG_CONTAINER=rg-pg) и Redis на 6379;
#   - Node.js и зависимости сервера (npm ci в backend/);
#   - Flutter, Android SDK и эмулятор (AVD x86_64; у нас Pixel_6, API 36);
#   - Maestro CLI по docs.maestro.dev (Installing Maestro → Windows): архив
#     maestro.zip с GitHub-релиза распаковать в C:\maestro. PATH трогать не
#     обязательно: скрипт находит C:\maestro\bin сам (или MAESTRO_HOME);
#   - Java 17+: подходит встроенная в Android Studio (папка jbr) — её скрипт
#     тоже находит сам, если JAVA_HOME не задан.
#
# Порядок (из корня репозитория, в Git Bash):
#   mobile/.maestro/e2e.sh emulator  # 1. поднять эмулятор, если не поднят
#   mobile/.maestro/e2e.sh db        # 2. пересоздать базу стенда maestro_e2e
#   mobile/.maestro/e2e.sh server    # 3. сервер стенда — в ОТДЕЛЬНОМ окне,
#                                    #    не закрывать до конца прогона
#   mobile/.maestro/e2e.sh user      # 4. завести тестового пользователя
#   mobile/.maestro/e2e.sh build     # 5. собрать и поставить тестовую сборку
#                                    #    (то же, что apk, затем install)
#   mobile/.maestro/e2e.sh test      # 6. прогнать все сценарии
#   mobile/.maestro/e2e.sh test mobile/.maestro/02_search_card.yaml  # один
#
# Шаги 1–5 нужны один раз; дальше после правок приложения — build и test,
# после правок сервера — перезапуск server. Шаг db стирает базу стенда целиком
# вместе с пользователем: после него — снова user. Весь набор идёт около
# 4 минут (Pixel_6, отладочная сборка). Упал сценарий — Maestro печатает папку
# отчёта (C:\Users\<имя>\.maestro\tests\<дата_время>): там снимки экрана и
# журнал шагов.
#
# В CI те же шаги идут на Linux — .github/workflows/e2e.yml: база и Redis там
# сервисы задания (E2E_PG_CONTAINER — id контейнера базы), эмулятор поднимает
# сам workflow, а build разбит надвое — apk собирает сборку до эмулятора,
# install ставит её на поднятый эмулятор.
#
# Только эмулятор. Сценарии стирают данные приложения, а шаг test выключает
# на устройстве геолокацию, рукописный ввод стилусом и системные окна об
# ошибках. На телефоне это вывело бы владельца из профиля и поменяло бы его
# настройки, поэтому build, install и test на устройство без признака эмулятора
# (ro.boot.qemu) не пойдут.
#
# Известная заминка: изредка Maestro сразу пишет «Device emulator-5554 was
# requested, but it is not connected», хотя эмулятор работает, — запустить
# test ещё раз. 01.11.2026 так было один раз из пяти запусков; к компьютеру
# тогда был подключён ещё и телефон по USB, но связь не доказана.
#
# Тестовый пользователь. Почта и пароль — в mobile/.maestro/.env.local: файл
# создаётся сам при первом запуске user или test, пароль случайный, в git файл
# не попадает (.gitignore: .env.*). В сценарии они приходят переменными
# Maestro: -e E2E_EMAIL=… -e E2E_PASSWORD=… — в YAML их нет.
#
# Что видит Maestro. Flutter он видит через дерево доступности (Semantics):
# по видимому тексту, по semanticsLabel и tooltip или по Semantics(identifier:)
# — это селектор id:. Key из Flutter он НЕ видит. Метки id: в коде заведены
# только там, где без них не обойтись, и все начинаются с «e2e-». Посмотреть
# дерево экрана: C:\maestro\bin\maestro.bat --device emulator-5554 hierarchy
#
# Чего сценарии не проверяют: вход через Google и Яндекс (чужие окна входа) и
# содержимое Яндекс-карты — это нативный слой, маркеры Maestro не видит;
# на карте проверяются только Flutter-элементы поверх неё.
#
# Переменные (необязательные): E2E_DEVICE (emulator-5554), E2E_AVD (Pixel_6),
# E2E_PG_CONTAINER (pg-test), E2E_DB_NAME (maestro_e2e), E2E_REDIS_DB (0 —
# индекс dev; 1–15 заняты тестами backend), MAESTRO_HOME (C:\maestro),
# E2E_REPORT_DIR (не задана — отчёт только в выводе; задана — шаг test кладёт
# туда отчёт JUnit report.xml и журналы Maestro debug/, а при падении ещё и
# logcat.txt эмулятора).
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE="$(cd "$HERE/.." && pwd)"
ROOT="$(cd "$MOBILE/.." && pwd)"
BACKEND="$ROOT/backend"

APP_ID="com.nirivio.app"
DEVICE="${E2E_DEVICE:-emulator-5554}"
AVD="${E2E_AVD:-Pixel_6}"
PG_CONTAINER="${E2E_PG_CONTAINER:-pg-test}"
DB_NAME="${E2E_DB_NAME:-maestro_e2e}"
REDIS_DB="${E2E_REDIS_DB:-0}"
# Порт не настраивается: сборка development зашита на :3000
# (mobile/lib/config/environment.dart).
PORT=3000
API="http://127.0.0.1:$PORT/api/v1"
ENV_FILE="$HERE/.env.local"
# Заведение из stand/seed.sql: отвечает сервер карточкой с этим id — значит,
# на :3000 стенд, а не dev-сервер с другой базой.
STAND_MARKER_ID="e2e00000-0000-4000-8000-000000000101"
# Готовая сборка кладётся отдельно от build/app/outputs/flutter-apk: там её
# можно спутать с обычной debug-сборкой и поставить на телефон, а эта ходит
# на 10.0.2.2 — на телефоне получится «Не удалось загрузить заведения».
E2E_APK="$MOBILE/build/maestro/app-e2e-debug.apk"

die() { echo "Ошибка: $*" >&2; exit 1; }

# Пути для программ Windows (node, adb, docker): C:/Users/…, а не /c/Users/….
# На Linux (CI) cygpath нет, и пути остаются как есть.
win_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s\n' "$1"; fi; }
unix_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -u "$1"; else printf '%s\n' "$1"; fi; }

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-${LOCALAPPDATA:-}/Android/Sdk}}"
SDK="$(unix_path "$SDK")"
ADB="$SDK/platform-tools/adb"

find_maestro() {
  if command -v maestro >/dev/null 2>&1; then command -v maestro; return; fi
  local home; home="$(unix_path "${MAESTRO_HOME:-C:/maestro}")"
  [ -x "$home/bin/maestro" ] || die "Maestro не найден: нет $home/bin/maestro (см. шапку скрипта)"
  echo "$home/bin/maestro"
}

# Maestro — программа на Java 17+. Отдельной Java на этой машине нет, Flutter
# собирает Android встроенной в Android Studio — ею же пользуемся.
ensure_java() {
  if [ -n "${JAVA_HOME:-}" ] || command -v java >/dev/null 2>&1; then return; fi
  local jbr
  for jbr in "/c/Android/Android Studio/jbr" "/c/Program Files/Android/Android Studio/jbr" \
             "$(unix_path "${LOCALAPPDATA:-C:/}")/Programs/Android Studio/jbr"; do
    if [ -x "$jbr/bin/java" ]; then export JAVA_HOME="$jbr"; return; fi
  done
  die "Java 17+ не найдена: задайте JAVA_HOME (подходит папка jbr из Android Studio)"
}

device_ready() {
  [ "$("$ADB" -s "$DEVICE" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]
}

require_device() {
  device_ready || die "эмулятор $DEVICE не готов — сначала: $0 emulator"
  # Защита от телефона в E2E_DEVICE: см. «Только эмулятор» в шапке.
  local qemu
  qemu="$("$ADB" -s "$DEVICE" shell getprop ro.boot.qemu 2>/dev/null | tr -d '\r')"
  [ "$qemu" = "1" ] || qemu="$("$ADB" -s "$DEVICE" shell getprop ro.kernel.qemu 2>/dev/null | tr -d '\r')"
  [ "$qemu" = "1" ] || die "$DEVICE — не эмулятор. Сценарии стирают данные приложения и меняют настройки устройства — только на эмуляторе"
}

psql_stand() {
  # PGOPTIONS гасит NOTICE «already exists, skipping»: миграции поверх
  # снапшота повторяемы, и шум скрывал бы настоящие ошибки.
  docker exec -i -e PGOPTIONS='-c client_min_messages=warning' "$PG_CONTAINER" \
    psql -U postgres -d "$DB_NAME" -v ON_ERROR_STOP=1 -q "$@"
}

psql_admin() {
  docker exec "$PG_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c "$1"
}

# Почта и пароль тестового пользователя. Файл создаётся один раз; пароль
# отвечает правилам регистрации (8+ символов, заглавная, строчная, цифра).
load_credentials() {
  if [ ! -f "$ENV_FILE" ]; then
    local pass
    pass="E2e$(node -e "process.stdout.write(require('crypto').randomBytes(9).toString('hex'))")x9"
    printf 'E2E_EMAIL=maestro-e2e@example.com\nE2E_PASSWORD=%s\n' "$pass" > "$ENV_FILE"
    echo "Создан $ENV_FILE — почта и пароль тестового пользователя (в git не попадает)"
  fi
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  [ -n "${E2E_EMAIL:-}" ] && [ -n "${E2E_PASSWORD:-}" ] || die "в $ENV_FILE нет E2E_EMAIL или E2E_PASSWORD"
}

http_code() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@" || true
}

require_stand_server() {
  local code
  code="$(http_code "$API/search/establishments/$STAND_MARKER_ID")"
  case "$code" in
    200) ;;
    000) die "сервер на :$PORT не отвечает — запустите в отдельном окне: $0 server" ;;
    *) die "на :$PORT отвечает не стенд (карточка $STAND_MARKER_ID → $code). Остановите тот сервер и запустите: $0 server" ;;
  esac
}

# --- шаги -------------------------------------------------------------------

step_emulator() {
  if device_ready; then echo "Эмулятор уже работает: $DEVICE"; return; fi
  [ -x "$SDK/emulator/emulator" ] || die "нет эмулятора в $SDK/emulator"
  # -no-snapshot-save: каждый запуск — с чистой загрузки, без сохранённого
  # состояния прошлой сессии; данные приложения сценарии всё равно стирают.
  "$SDK/emulator/emulator" -avd "$AVD" -no-snapshot-save -no-audio >/dev/null 2>&1 &
  echo "Запущен эмулятор $AVD (PID $!), жду загрузки — первая занимает несколько минут…"
  "$ADB" -s "$DEVICE" wait-for-device
  until device_ready; do sleep 3; done
  echo "Эмулятор готов: $DEVICE"
}

step_db() {
  docker exec "$PG_CONTAINER" pg_isready -U postgres >/dev/null \
    || die "PostgreSQL в контейнере $PG_CONTAINER не отвечает (docker start $PG_CONTAINER)"
  # Рецепт схемы — тот же, что у CI: список файлов читается из ci.yml тем же
  # разбором, что у изолированного раннера тестов backend. Свой список отстал
  # бы от гейта при первой новой миграции.
  local recipe
  recipe="$(node --input-type=module -e '
    import { readFileSync } from "node:fs";
    import { pathToFileURL } from "node:url";
    const [ciPath, sessionJs] = process.argv.slice(1);
    const { parseSchemaRecipe } = await import(pathToFileURL(sessionJs).href);
    console.log(parseSchemaRecipe(readFileSync(ciPath, "utf8")).join("\n"));
  ' "$(win_path "$ROOT/.github/workflows/ci.yml")" "$(win_path "$BACKEND/scripts/test-isolated/session.js")")"

  # FORCE обрывает соединения запущенного сервера стенда: база пересоздаётся
  # целиком, сервер потом переподключится сам.
  psql_admin "DROP DATABASE IF EXISTS $DB_NAME WITH (FORCE)"
  # template_postgis есть в любом контейнере образа postgis/postgis: в нём уже
  # стоят расширения, которые снапшот схемы только упоминает.
  psql_admin "CREATE DATABASE $DB_NAME TEMPLATE template_postgis"
  local file
  for file in $recipe; do
    echo "  схема: $file"
    # CRLF из выгрузки на Windows (core.autocrlf) — в LF, как в CI.
    tr -d '\r' < "$BACKEND/migrations/$file" | psql_stand
  done
  echo "  данные: stand/seed.sql"
  tr -d '\r' < "$HERE/stand/seed.sql" | psql_stand
  echo "База $DB_NAME готова: $(psql_stand -At -c "SELECT count(*) FROM establishments") заведений."
  echo "Тестового пользователя в ней нет — после запуска сервера: $0 user"
}

step_server() {
  [ "$(http_code "$API/health")" = "000" ] \
    || die "порт $PORT уже занят другим сервером — сначала остановите его"
  docker exec "$PG_CONTAINER" psql -U postgres -At -c "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" \
    | grep -q 1 || die "базы $DB_NAME нет — сначала: $0 db"
  # Сервер читает .env из ТЕКУЩЕЙ папки (dotenv.config() без пути). Запуск из
  # stand/, где .env нет, закрывает backend/.env с боевыми ключами: Cloudinary
  # (боевое облако), OpenRouter (платный ключ), почта. Всё нужное задано ниже
  # явно, а -u снимает те же ключи, если они пришли из окружения оболочки.
  # Без ключа OpenRouter умный поиск уходит в обычный — сценариям этого
  # достаточно. TZ=UTC — как на Railway, иначе даты уезжают на день.
  # Значения — через export, не аргументами env: аргументы видны в списке
  # процессов, а среди них случайный ключ JWT этого запуска.
  export NODE_ENV=development PORT="$PORT" TZ=UTC \
    DB_HOST=localhost DB_PORT=5432 DB_NAME="$DB_NAME" DB_USER=postgres DB_PASSWORD=postgres \
    REDIS_HOST=localhost REDIS_PORT=6379 REDIS_DB="$REDIS_DB" REDIS_PASSWORD= \
    CLOUDINARY_CLOUD_NAME=e2e-stub CLOUDINARY_API_KEY=e2e-stub CLOUDINARY_API_SECRET=e2e-stub
  JWT_SECRET="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")"
  export JWT_SECRET
  cd "$HERE/stand"
  echo "Сервер стенда: http://127.0.0.1:$PORT, база $DB_NAME, Redis индекс $REDIS_DB. Остановить — Ctrl+C."
  exec env -u DATABASE_URL -u OPENROUTER_API_KEY -u RESEND_API_KEY \
    -u CLOUDINARY_URL -u FIREBASE_SERVICE_ACCOUNT -u FIREBASE_SERVICE_ACCOUNT_PATH \
    -u SITE_REQUEST_SECRET -u SITE_REQUEST_SECRET_PREVIOUS \
    node "$(win_path "$BACKEND/src/server.js")"
}

step_user() {
  load_credentials
  require_stand_server
  # Тело запроса — через stdin: пароль не виден в списке процессов.
  local code
  code="$(printf '{"email":"%s","password":"%s","name":"Maestro Test","authMethod":"email"}' \
      "$E2E_EMAIL" "$E2E_PASSWORD" \
    | curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
        -H 'Content-Type: application/json' --data-binary @- "$API/auth/register" || true)"
  case "$code" in
    201) echo "Пользователь $E2E_EMAIL заведён." ;;
    409) echo "Пользователь $E2E_EMAIL уже есть — проверяю пароль." ;;
    *) die "регистрация ответила $code" ;;
  esac
  code="$(printf '{"email":"%s","password":"%s"}' "$E2E_EMAIL" "$E2E_PASSWORD" \
    | curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
        -H 'Content-Type: application/json' --data-binary @- "$API/auth/login" || true)"
  [ "$code" = "200" ] || die "вход тестового пользователя ответил $code (пароль из $ENV_FILE не подходит? пересоздайте базу: $0 db, затем $0 user)"
  echo "Вход проверен."
}

# Сборка без устройства: в CI она идёт до того, как поднят эмулятор.
step_apk() {
  # Ключ входа через Яндекс — как у обычной сборки (run.sh); ключ MapKit
  # Gradle берёт из android/local.properties сам.
  local yandex
  yandex="$(sed -n 's/^YANDEX_CLIENT_ID=//p' "$MOBILE/android/local.properties" 2>/dev/null | tr -d '\r')"
  [ -n "$yandex" ] || yandex="$(grep -o 'YANDEX_CLIENT_ID=[A-Za-z0-9]*' "$MOBILE/run.sh" | head -1 | cut -d= -f2)"
  # Один ABI под эмулятор (x86_64) — сборка в разы быстрее полной.
  (cd "$MOBILE" && flutter build apk --debug --target-platform android-x64 \
    --dart-define=ENV=development --dart-define=YANDEX_CLIENT_ID="$yandex")
  mkdir -p "$(dirname "$E2E_APK")"
  mv -f "$MOBILE/build/app/outputs/flutter-apk/app-debug.apk" "$E2E_APK"
  echo "Тестовая сборка готова: $E2E_APK (ENV=development → 10.0.2.2:$PORT)."
}

step_install() {
  require_device
  [ -f "$E2E_APK" ] || die "нет тестовой сборки $E2E_APK — сначала: $0 apk"
  "$ADB" -s "$DEVICE" install -r "$(win_path "$E2E_APK")"
  echo "Тестовая сборка стоит на $DEVICE: $APP_ID (ENV=development → 10.0.2.2:$PORT)."
}

step_build() {
  # Устройство — до сборки: без эмулятора минуты сборки ушли бы впустую.
  require_device
  step_apk
  step_install
}

step_test() {
  load_credentials
  require_device
  require_stand_server
  ensure_java
  local maestro; maestro="$(find_maestro)"
  local targets=("$@")
  [ ${#targets[@]} -gt 0 ] || targets=("$HERE")
  local converted=() t
  for t in "${targets[@]}"; do converted+=("$(win_path "$t")"); done
  # Геолокация устройства — выключена. Тогда приложение не спрашивает ни
  # разрешение, ни «Точность геолокации» Google (окно Play Services поверх
  # приложения) и работает с городом по умолчанию — Минском, где и лежат
  # заведения стенда. Включённая геолокация давала эти окна в случайный
  # момент и роняла сценарии.
  "$ADB" -s "$DEVICE" shell cmd location set-location-enabled false
  # Рукописный ввод стилусом — выключен. Сенсорный экран эмулятора объявлен
  # и как стилус (dumpsys input: TOUCHSCREEN | STYLUS), и на нажатие в поле
  # клавиатура Google открывала обучение «Try out your stylus» — оно
  # перехватывало ввод: из «Maestro» в поле доходило «Mae».
  "$ADB" -s "$DEVICE" shell settings put secure stylus_handwriting_enabled 0
  # Системные окна об ошибках («… isn't responding», «… keeps stopping») —
  # скрыты, уже открытое — закрыто (настройка на него не действует). На
  # медленном эмуляторе подвисает оболочка рабочего стола, её окно ложится
  # поверх приложения, Maestro видит только окно — и красные все сценарии, хотя
  # приложение работает (CI, 03.11.2026). Поломку приложения это не прячет:
  # упавшее исчезает с экрана, зависшее система закрывает сама — сценарий падает
  # на следующем шаге.
  "$ADB" -s "$DEVICE" shell settings put global hide_error_dialogs 1
  "$ADB" -s "$DEVICE" shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null
  # Метка начала прогона — для уборки ниже. Временная папка — та, куда Java
  # кладёт копии: на Windows %LOCALAPPDATA%\Temp, на Linux /tmp.
  local tmp_dir=/tmp marker
  if command -v cygpath >/dev/null 2>&1; then tmp_dir="$(cygpath -u "${LOCALAPPDATA:-C:/}")/Temp"; fi
  marker="$(mktemp "$tmp_dir/maestro-run.XXXXXX")"
  # Отчёт для CI: JUnit и журналы Maestro в одну папку, без подпапок с датой.
  local report=()
  if [ -n "${E2E_REPORT_DIR:-}" ]; then
    mkdir -p "$E2E_REPORT_DIR"
    report=(--format junit --output "$(win_path "$E2E_REPORT_DIR/report.xml")"
            --debug-output "$(win_path "$E2E_REPORT_DIR/debug")" --flatten-debug-output)
  fi
  # MAESTRO_CLI_NO_ANALYTICS: не отправлять разработчику Maestro статистику
  # запусков. JAVA_OPTS: Java на русской Windows печатает в cp1251, и
  # кириллица в выводе Maestro превращается в «?».
  local code=0
  MAESTRO_CLI_NO_ANALYTICS=1 \
  JAVA_OPTS="${JAVA_OPTS:-} -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8" \
    "$maestro" --device "$DEVICE" test \
    -e E2E_EMAIL="$E2E_EMAIL" -e E2E_PASSWORD="$E2E_PASSWORD" \
    ${report[@]+"${report[@]}"} "${converted[@]}" || code=$?
  # Журнал устройства — для разбора падения: там видно, не упало ли само
  # приложение.
  if [ "$code" -ne 0 ] && [ -n "${E2E_REPORT_DIR:-}" ]; then
    "$ADB" -s "$DEVICE" logcat -d > "$E2E_REPORT_DIR/logcat.txt" 2>&1 || true
  fi
  # Уборка — и после упавшего прогона. Maestro на каждом сценарии кладёт во
  # временную папку копию установленного приложения (tmp….apk, ~190 МБ) и не
  # убирает её: 01.11.2026 за день прогонов набралось 34 копии, 6,1 ГБ, и диск C
  # кончился. Удаляются только копии этого прогона: моложе метки и ровно того
  # же размера, что приложение на эмуляторе, — его Maestro и копирует, из какой
  # бы папки репозитория оно ни было собрано.
  local apk_size
  apk_size="$("$ADB" -s "$DEVICE" shell "stat -c %s \$(pm path $APP_ID | head -1 | cut -d: -f2)" 2>/dev/null | tr -d '\r')"
  case "$apk_size" in
    ''|*[!0-9]*) echo "Предупреждение: размер приложения на $DEVICE не прочитан — копии Maestro во временной папке не убраны" >&2 ;;
    *) find "$tmp_dir" -maxdepth 1 -name 'tmp*.apk' -newer "$marker" -size "${apk_size}c" -delete ;;
  esac
  rm -f "$marker"
  return "$code"
}

case "${1:-}" in
  emulator) step_emulator ;;
  db) step_db ;;
  server) step_server ;;
  user) step_user ;;
  build) step_build ;;
  apk) step_apk ;;
  install) step_install ;;
  test) shift; step_test "$@" ;;
  *)
    echo "Использование: $0 emulator|db|server|user|build|apk|install|test [сценарий.yaml…]" >&2
    echo "Порядок и подробности — в шапке скрипта." >&2
    exit 2
    ;;
esac
