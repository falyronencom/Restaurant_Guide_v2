#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""nirivio_mark.py — единственный источник знака NIRIVIO для всех поверхностей.

Знак-кокарда (три диска: василёк / светлое кольцо / оранжевое ядро) сдан на
заставке mobile 14.09.2026 (коммит 3cf6fb8, решение SDL CAT-C-1.4). Этот скрипт
переносит ТОТ ЖЕ знак на иконки приложения, вкладки браузера и PWA-иконки —
чтобы на всех поверхностях он был одним и тем же знаком, а не похожим.

──────────────────────────────────────────────────────────────────────────────
ЗАПУСК (Python 3 + Pillow; ничего больше не нужно, пакетов не добавляется)

    python tools/brand/nirivio_mark.py --all          # все поверхности
    python tools/brand/nirivio_mark.py android ios    # только выбранные
    python tools/brand/nirivio_mark.py sheets         # листы сравнения
    python tools/brand/nirivio_mark.py --list         # что куда пишется

Поверхности: android · ios · admin-web · web · sheets
Листы сравнения кладутся в --sheet-dir (по умолчанию — системный temp): в
репозиторий они НЕ входят, это материал для решения, а не ассет.

Отчёт печатается в кодировке консоли (cp1251 её держит). Если нужен UTF-8 —
    PYTHONIOENCODING=utf-8 python tools/brand/nirivio_mark.py --check

──────────────────────────────────────────────────────────────────────────────
ОТКУДА ЧИСЛА

Рецепт глянца и пропорции взяты из кода заставки, не выдуманы:
  mobile/lib/screens/splash/painters/cockade_painter.dart
      ringRatio = .60, coreRatio = .34;
      _disc()   — двухточечный радиальный градиент: фокус (−.36r, −.40r)
                  радиуса .04r → центр радиуса 1.12r; стопы 0 / .5 / 1 =
                  цвет, осветлённый к белому на 34 % / сам цвет / цвет,
                  затемнённый к чёрному на edgeDarken (.16 внешний,
                  .05 светлое кольцо, .16 ядро);
      _sheen()  — блик, обрезанный по внешнему кругу: радиальный градиент из
                  (−.30R, −.42R) радиуса .75R, белый α .34 → прозрачный;
      _paintSign() — тень: круг радиуса R со смещением 5·u вниз, цвет
                  cockadeShadow α .30, MaskFilter.blur(normal, 9·u),
                  где u = R / 62 (сетка лаборатории).
  mobile/lib/config/theme.dart
      cockadeCornflower / cockadeRing / cockadeAccent / cockadeShadow,
      splashBgInner / splashBgMid / splashBgOuter.
  mobile/lib/screens/splash/splash_screen.dart
      _stageGradient() — бежевый радиальный подмаз, стопы 0 / .55 / 1.

Масштаб знака на каждой поверхности замерен по СУЩЕСТВУЮЩИМ иконкам, чтобы
оптический размер не поехал (см. таблицу COMPOSITIONS).

──────────────────────────────────────────────────────────────────────────────
ОТКРЫТЫЙ ВОПРОС: ГЛЯНЕЦ НА МЕЛКИХ РАЗМЕРАХ

На 16 и 32 пикселях блик и градиент превращаются в грязь, а тень съедает
контур. Умолчание этого скрипта: файл размером >= GLOSS_MIN_PX рисуется
глянцевым (канон заставки, кольца .60R / .34R), меньше — плоским упрощённым
(те же три цвета, без блика, без тени, кольца чуть толще: .66R / .36R).

GLOSS_MIN_PX — одна константа ниже. Порог меняется одной строкой; после этого
надо перегнать поверхности. Листы сравнения (`sheets`) показывают оба варианта
на всех размерах, включая полосу вокруг самого порога.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import math
import re
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps

REPO = Path(__file__).resolve().parents[2]

# ══════════════════════════════════════════════════════════════════════════════
# КАНОН — цвета (mobile/lib/config/theme.dart)
# ══════════════════════════════════════════════════════════════════════════════

CORNFLOWER = (0x3F, 0x63, 0xB8)   # cockadeCornflower — внешний диск
RING_LIGHT = (0xFB, 0xF7, 0xEE)   # cockadeRing       — светлое кольцо
ACCENT = (0xE8, 0x74, 0x2B)       # cockadeAccent     — ядро
SHADOW = (0x28, 0x3A, 0x6B)       # cockadeShadow     — тень знака

BG_INNER = (0xF7, 0xF1, 0xE2)     # splashBgInner
BG_MID = (0xF0, 0xE7, 0xD2)       # splashBgMid
BG_OUTER = (0xE9, 0xDE, 0xC5)     # splashBgOuter

# ══════════════════════════════════════════════════════════════════════════════
# КАНОН — геометрия и материал (cockade_painter.dart)
# ══════════════════════════════════════════════════════════════════════════════

GLOSS_MIN_PX = 180                # порог «глянец / плоский» по размеру файла

RING_RATIO_GLOSS, CORE_RATIO_GLOSS = 0.60, 0.34   # канон заставки
RING_RATIO_FLAT, CORE_RATIO_FLAT = 0.66, 0.36     # мелкие: кольца толще

FOCAL = (-0.36, -0.40)            # _disc: центр фокусного круга, в долях r
FOCAL_R = 0.04                    # _disc: радиус фокусного круга
END_R = 1.12                      # _disc: радиус внешнего круга градиента
LIGHTEN = 0.34                    # _disc: стоп 0 — осветление к белому
EDGE_DARKEN = {"outer": 0.16, "ring": 0.05, "core": 0.16}  # _disc: стоп 1

SHEEN_AT = (-0.30, -0.42)         # _sheen: центр блика, в долях R
SHEEN_R = 0.75                    # _sheen: радиус блика
SHEEN_ALPHA = 0.34                # _sheen: белый с этой альфой в центре

GRID_R = 62.0                     # сетка лаборатории: R = 62 логических px
SHADOW_DY_U = 5.0                 # _paintSign: смещение тени, 5·u
SHADOW_SIGMA_U = 9.0              # _paintSign: сигма размытия, 9·u
SHADOW_ALPHA = 0.30               # _paintSign: альфа тени

# Бежевый подмаз — splash_screen.dart::_stageGradient, приведённый к квадрату:
# центр чуть выше геометрического (как на заставке — на 30 клеток выше знака),
# стопы те же. Даёт ту же асимметрию, что и у нынешних иконок: верх светлее.
WASH_CENTER = (0.50, 0.42)
WASH_RADIUS = 0.78
WASH_MID_STOP = 0.55

# Разрешение мастер-рендера: каждая поверхность рисуется аналитически около
# этого размера и ОДИН раз уменьшается LANCZOS'ом до целевого. Один рецепт →
# один знак на всех размерах; сглаживание даёт само уменьшение.
MASTER_TARGET = 1536
TILE_N = 768                      # разрешение кэшируемых нормированных полей


# ══════════════════════════════════════════════════════════════════════════════
# КОМПОЗИЦИИ — доля R от ширины холста, замерена по нынешним иконкам
# ══════════════════════════════════════════════════════════════════════════════

class Composition:
    """Как знак стоит на холсте: доля радиуса и есть ли бежевый фон."""

    def __init__(self, sign_ratio: float, background: bool) -> None:
        self.sign_ratio = sign_ratio
        self.background = background


COMPOSITIONS = {
    # iOS 1024 замерен: R = 395.5 / 1024 = .3862; legacy mipmap-xxxhdpi — .3854.
    "app": Composition(0.386, True),
    # Android adaptive foreground замерен: R = 132.5 / 432 = .3067 — это ровно
    # безопасное поле 66dp из 108dp. Тот же масштаб годится и для maskable.
    "adaptive": Composition(0.3056, False),
    "maskable": Composition(0.3056, True),
    # Вкладка браузера: пикселей мало, фон тратить нельзя — знак почти во всю
    # плитку, углы прозрачные.
    "tab": Composition(0.47, False),
    # Отдельный PNG знака для OG-карточки: запас под тень (R·1.37 < .5).
    "loose": Composition(0.36, False),
    # Слой background у adaptive icon: только подмаз, знак живёт в foreground.
    "wash": Composition(0.0, True),
}


# ══════════════════════════════════════════════════════════════════════════════
# НОРМИРОВАННЫЕ ПОЛЯ — считаются один раз за запуск, дальше только resize
# ══════════════════════════════════════════════════════════════════════════════

_CACHE: dict[str, Image.Image] = {}


def _gloss_field() -> Image.Image:
    """Параметр t двухточечного радиального градиента — «L» над квадратом
    [-1, 1]² в долях радиуса диска.

    Аналог `ui.Gradient.radial` с фокусным кругом: ищем наибольшее t, при
    котором точка лежит на круге, интерполированном между фокусным кругом
    (FOCAL, FOCAL_R) и внешним (центр, END_R). TileMode.clamp → t ∈ [0, 1].
    """
    key = "gloss"
    if key in _CACHE:
        return _CACHE[key]

    fx, fy = FOCAL
    dx, dy = -fx, -fy                       # внешний центр (0,0) минус фокус
    dr = END_R - FOCAL_R
    a = dx * dx + dy * dy - dr * dr         # < 0 при нашей геометрии
    two_a = 2.0 * a

    n = TILE_N
    buf = bytearray(n * n)
    step = 2.0 / n
    for j in range(n):
        y = -1.0 + (j + 0.5) * step
        pdy = y - fy
        row = j * n
        for i in range(n):
            x = -1.0 + (i + 0.5) * step
            pdx = x - fx
            b = -2.0 * (pdx * dx + pdy * dy + FOCAL_R * dr)
            c = pdx * pdx + pdy * pdy - FOCAL_R * FOCAL_R
            d = b * b - 4.0 * a * c
            if d <= 0.0:
                buf[row + i] = 255
                continue
            s = math.sqrt(d)
            t = None
            for cand in ((-b + s) / two_a, (-b - s) / two_a):
                if FOCAL_R + cand * dr >= 0.0 and (t is None or cand > t):
                    t = cand
            if t is None:
                buf[row + i] = 255
            elif t <= 0.0:
                buf[row + i] = 0
            elif t >= 1.0:
                buf[row + i] = 255
            else:
                buf[row + i] = int(t * 255.0 + 0.5)

    img = Image.frombytes("L", (n, n), bytes(buf))
    _CACHE[key] = img
    return img


def _radial_field() -> Image.Image:
    """Расстояние от центра — «L» над квадратом [-1, 1]², 0 в центре, 255 на
    вписанной окружности и дальше. Основа бежевого подмаза и блика."""
    key = "radial"
    if key in _CACHE:
        return _CACHE[key]

    n = TILE_N
    buf = bytearray(n * n)
    step = 2.0 / n
    for j in range(n):
        y = -1.0 + (j + 0.5) * step
        row = j * n
        yy = y * y
        for i in range(n):
            x = -1.0 + (i + 0.5) * step
            d = math.sqrt(x * x + yy)
            buf[row + i] = 255 if d >= 1.0 else int(d * 255.0 + 0.5)

    img = Image.frombytes("L", (n, n), bytes(buf))
    _CACHE[key] = img
    return img


# ══════════════════════════════════════════════════════════════════════════════
# СЛОИ
# ══════════════════════════════════════════════════════════════════════════════

def _mix(color, towards, t: float) -> tuple[int, int, int]:
    return tuple(int(round(c + (w - c) * t)) for c, w in zip(color, towards))


def _box(center: float, radius: float) -> tuple[int, int]:
    """Целочисленный левый край и диаметр для круга радиуса `radius`."""
    d = max(1, int(round(radius * 2.0)))
    return int(round(center - radius)), d


def _wash(size: int) -> Image.Image:
    """Бежевый радиальный подмаз во всю плитку — стопы заставки."""
    cx, cy = WASH_CENTER[0] * size, WASH_CENTER[1] * size
    r = WASH_RADIUS * size
    x0, d = _box(cx, r)
    y0, _ = _box(cy, r)

    field = Image.new("L", (size, size), 255)          # за радиусом — внешний цвет
    field.paste(_radial_field().resize((d, d), Image.BICUBIC), (x0, y0))
    rgb = ImageOps.colorize(
        field,
        black=BG_INNER,
        mid=BG_MID,
        white=BG_OUTER,
        midpoint=int(round(WASH_MID_STOP * 255)),
    )
    return rgb.convert("RGBA")


def _disc(size: int, cx: float, cy: float, r: float, color, band: str,
          gloss: bool) -> Image.Image:
    """Один диск кокарды: глянцевый (градиент с фокусом) или плоский."""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    x0, d = _box(cx, r)
    y0, _ = _box(cy, r)

    if gloss:
        fill = ImageOps.colorize(
            _gloss_field().resize((d, d), Image.BICUBIC),
            black=_mix(color, (255, 255, 255), LIGHTEN),   # стоп 0
            mid=color,                                     # стоп .5
            white=_mix(color, (0, 0, 0), EDGE_DARKEN[band]),  # стоп 1
            midpoint=128,
        ).convert("RGBA")
    else:
        fill = Image.new("RGBA", (d, d), color + (255,))

    mask = Image.new("L", (d, d), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, d - 1, d - 1), fill=255)
    layer.paste(fill, (x0, y0), mask)
    return layer


def _sheen(size: int, cx: float, cy: float, r: float) -> Image.Image:
    """Блик поверх знака, обрезанный по внешнему диску."""
    hx, hy = cx + SHEEN_AT[0] * r, cy + SHEEN_AT[1] * r
    rs = SHEEN_R * r
    x0, d = _box(hx, rs)
    y0, _ = _box(hy, rs)

    cone = ImageOps.invert(_radial_field()).resize((d, d), Image.BICUBIC)
    cone = cone.point(lambda v: int(v * SHEEN_ALPHA))
    alpha = Image.new("L", (size, size), 0)
    alpha.paste(cone, (x0, y0))

    clip = Image.new("L", (size, size), 0)
    bx0, bd = _box(cx, r)
    by0, _ = _box(cy, r)
    ImageDraw.Draw(clip).ellipse((bx0, by0, bx0 + bd - 1, by0 + bd - 1), fill=255)
    alpha = ImageChops.multiply(alpha, clip)

    layer = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    layer.putalpha(alpha)
    return layer


def _shadow(size: int, cx: float, cy: float, r: float) -> Image.Image:
    """Мягкая тень под знаком — размытый круг, как MaskFilter.blur(normal)."""
    u = r / GRID_R
    dy = SHADOW_DY_U * u
    sigma = SHADOW_SIGMA_U * u

    alpha = Image.new("L", (size, size), 0)
    x0, d = _box(cx, r)
    y0, _ = _box(cy + dy, r)
    ImageDraw.Draw(alpha).ellipse(
        (x0, y0, x0 + d - 1, y0 + d - 1), fill=int(round(255 * SHADOW_ALPHA))
    )
    alpha = alpha.filter(ImageFilter.GaussianBlur(sigma))

    layer = Image.new("RGBA", (size, size), SHADOW + (0,))
    layer.putalpha(alpha)
    return layer


# ══════════════════════════════════════════════════════════════════════════════
# РЕНДЕР ПОВЕРХНОСТИ
# ══════════════════════════════════════════════════════════════════════════════

def _supersample(target: int) -> int:
    return max(2, math.ceil(MASTER_TARGET / target))


def render(target: int, comp: Composition, gloss: bool | None = None,
           sign: bool = True) -> Image.Image:
    """Одна плитка target×target: подмаз (если есть) + знак.

    `gloss=None` — решает порог GLOSS_MIN_PX по размеру файла.
    `sign=False` — только фон (слой background у adaptive icon).
    """
    if gloss is None:
        gloss = target >= GLOSS_MIN_PX

    ss = _supersample(target)
    m = target * ss
    img = _wash(m) if comp.background else Image.new("RGBA", (m, m), (0, 0, 0, 0))

    if sign:
        cx = cy = m / 2.0
        r = comp.sign_ratio * m
        ring = RING_RATIO_GLOSS if gloss else RING_RATIO_FLAT
        core = CORE_RATIO_GLOSS if gloss else CORE_RATIO_FLAT

        if gloss:
            img = Image.alpha_composite(img, _shadow(m, cx, cy, r))
        for radius, color, band in (
            (r, CORNFLOWER, "outer"),
            (r * ring, RING_LIGHT, "ring"),
            (r * core, ACCENT, "core"),
        ):
            img = Image.alpha_composite(img, _disc(m, cx, cy, radius, color, band, gloss))
        if gloss:
            img = Image.alpha_composite(img, _sheen(m, cx, cy, r))

    return img.resize((target, target), Image.LANCZOS)


# ══════════════════════════════════════════════════════════════════════════════
# ПОВЕРХНОСТИ — ОДНА таблица на всё
# ══════════════════════════════════════════════════════════════════════════════
#
# План строится один раз и обслуживает и запись, и --list, и проверку части D.
# Первая версия держала состав дважды (в ветке записи и в ветке --list), и они
# разошлись молча: слой background у adaptive icon получил ПРОЗРАЧНУЮ
# композицию и вышел пустым на 803 байта, а --list рядом печатал «(подмаз)».

ANDROID_ADAPTIVE = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
ANDROID_LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}

IOS_SET = REPO / "mobile/ios/Runner/Assets.xcassets/AppIcon.appiconset"


class Job:
    """Один файл: куда, какого размера, какой композиции, со знаком или без."""

    def __init__(self, path: Path, px: int, comp: str, mode: str,
                 sign: bool = True, note: str = "") -> None:
        self.path = path
        self.px = px
        self.comp = COMPOSITIONS[comp]
        self.comp_name = comp
        self.mode = mode
        self.sign = sign
        self.note = note

    @property
    def gloss(self) -> bool:
        return self.sign and self.px >= GLOSS_MIN_PX

    def describe(self) -> str:
        what = self.note or ("знак" if self.sign else "только фон")
        return ("%-72s %4dpx %-4s %-9s %s"
                % (self.path.relative_to(REPO).as_posix(), self.px, self.mode,
                   "глянец" if self.gloss else ("плоский" if self.sign else "--"),
                   what))


def _ios_targets() -> dict[str, int]:
    """Имя файла → размер в пикселях, строго по Contents.json."""
    meta = json.loads((IOS_SET / "Contents.json").read_text(encoding="utf-8"))
    targets: dict[str, int] = {}
    for entry in meta["images"]:
        base = float(entry["size"].split("x")[0])
        scale = int(entry["scale"].rstrip("x"))
        px = int(round(base * scale))
        name = entry["filename"]
        if name in targets and targets[name] != px:
            raise SystemExit(
                "Contents.json: %s объявлен и как %d, и как %d" % (name, targets[name], px))
        targets[name] = px
    return targets


def plan_android() -> list[Job]:
    """Adaptive icon (оба слоя, все плотности) + растровые mipmap."""
    res = REPO / "mobile/android/app/src/main/res"
    jobs: list[Job] = []
    for density, px in ANDROID_ADAPTIVE.items():
        jobs.append(Job(res / ("drawable-%s/ic_launcher_background.png" % density),
                        px, "wash", "RGBA", sign=False, note="подмаз, слой background"))
        jobs.append(Job(res / ("drawable-%s/ic_launcher_foreground.png" % density),
                        px, "adaptive", "RGBA", note="знак, слой foreground"))
    for density, px in ANDROID_LEGACY.items():
        jobs.append(Job(res / ("mipmap-%s/ic_launcher.png" % density),
                        px, "app", "RGB", note="растровая иконка до Android 8"))
    return jobs


def plan_ios() -> list[Job]:
    """Весь набор AppIcon — состав и размеры берутся из Contents.json."""
    return [Job(IOS_SET / name, px, "app", "RGB")
            for name, px in sorted(_ios_targets().items(), key=lambda kv: kv[1])]


def plan_admin_web() -> list[Job]:
    """Вкладка браузера + четыре PWA-иконки админки."""
    web = REPO / "admin-web/web"
    return [
        Job(web / "favicon.png", 32, "tab", "RGBA", note="вкладка браузера"),
        Job(web / "icons/Icon-192.png", 192, "app", "RGB", note="PWA, purpose any"),
        Job(web / "icons/Icon-512.png", 512, "app", "RGB", note="PWA, purpose any"),
        Job(web / "icons/Icon-maskable-192.png", 192, "maskable", "RGBA",
            note="PWA maskable, своё безопасное поле"),
        Job(web / "icons/Icon-maskable-512.png", 512, "maskable", "RGBA",
            note="PWA maskable, своё безопасное поле"),
    ]


def plan_web() -> list[Job]:
    """Публичный сайт: apple-touch-icon и знак для OG-карточки.

    `favicon.ico` (три кадра в одном контейнере) и знак для OG-карточки
    (base64 внутри TS-модуля) собираются отдельно — это не одиночные PNG;
    см. surface_web().
    """
    app_dir = REPO / "web/src/app"
    return [
        Job(app_dir / "apple-icon.png", 180, "app", "RGB", note="apple-touch-icon"),
    ]


PLANS = {
    "android": plan_android,
    "ios": plan_ios,
    "admin-web": plan_admin_web,
    "web": plan_web,
}

WEB_ICO = REPO / "web/src/app/favicon.ico"
WEB_ICO_SIZES = (48, 32, 16)

# Знак для OG-карточки едет в код, а не файлом рядом: `ImageResponse` (Satori)
# принимает в <img src> только строку, а `new URL('./x.png', import.meta.url)`
# под webpack превращается в КЛИЕНТСКИЙ путь `/_next/static/media/...` — fetch
# такого не разбирает и сборка падает на пререндере /opengraph-image. Base64 в
# сгенерированном модуле не зависит ни от сборщика, ни от режима вывода.
WEB_MARK_TS = REPO / "web/src/app/_brand/nirivio-mark.ts"
WEB_MARK_PX = 320

WEB_MARK_HEADER = """/**
 * СГЕНЕРИРОВАННЫЙ ФАЙЛ — руками не править.
 *
 * Знак NIRIVIO (кокарда) для OG-карточки: тот же знак, что на заставке
 * mobile, иконках приложения и вкладках браузера. Источник рецепта —
 * `mobile/lib/screens/splash/painters/cockade_painter.dart`; раскладывает
 * по поверхностям `tools/brand/nirivio_mark.py`. Перегенерировать:
 *
 *     python tools/brand/nirivio_mark.py web
 *
 * Почему base64 в коде, а не .png рядом: `ImageResponse` (Satori) принимает
 * в `<img src>` только строку, а `new URL('./x.png', import.meta.url)` под
 * webpack даёт клиентский путь `/_next/static/media/...` — `fetch` его не
 * разбирает и сборка падает на пререндере `/opengraph-image`. Модуль
 * потребляется только на сервере при сборке и в клиентский бандл не идёт.
 */

/** Сторона PNG в пикселях: столько же он занимает на карточке. */
export const NIRIVIO_MARK_PX = %d;

/** Прозрачный PNG знака, data-URI. */
export const NIRIVIO_MARK_PNG =
"""


def write_web_mark() -> None:
    img = render(WEB_MARK_PX, COMPOSITIONS["loose"])
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    data = base64.b64encode(buf.getvalue()).decode("ascii")
    WEB_MARK_TS.parent.mkdir(parents=True, exist_ok=True)
    with io.open(WEB_MARK_TS, "w", encoding="utf-8", newline=chr(10)) as fh:
        fh.write(WEB_MARK_HEADER % WEB_MARK_PX)
        fh.write("  'data:image/png;base64,' +" + chr(10))
        # Перенос по строкам: одна строка на 96 символов, иначе файл — одна
        # простыня, которую не прочитать ни в диффе, ни в ревью.
        chunks = [data[i:i + 96] for i in range(0, len(data), 96)]
        for k, chunk in enumerate(chunks):
            tail = " +" if k < len(chunks) - 1 else ";"
            fh.write("  '%s'%s%s" % (chunk, tail, chr(10)))


def _write(img: Image.Image, path: Path, mode: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    out = img
    if mode == "RGB":
        # Непрозрачные поверхности: знак там всегда стоит на подмазе, так что
        # видимой разницы нет, а альфы в файле не остаётся — iOS её в 1024 не
        # принимает, да и незачем.
        flat = Image.new("RGB", img.size, BG_MID)
        flat.paste(img, (0, 0), img)
        out = flat
    out.save(path, format="PNG", optimize=True)


def run_jobs(jobs: list[Job], dry: bool) -> list[str]:
    lines = []
    for job in jobs:
        if not dry:
            _write(render(job.px, job.comp, gloss=job.gloss, sign=job.sign),
                   job.path, job.mode)
        lines.append(job.describe())
    return lines


def surface_web(dry: bool) -> list[str]:
    """web: сначала многокадровый .ico, затем обычные Job'ы."""
    lines = ["%-72s %s ICO  плоский   вкладка браузера"
             % (WEB_ICO.relative_to(REPO).as_posix(),
                "/".join(str(s) for s in sorted(WEB_ICO_SIZES)))]
    if not dry:
        tab = COMPOSITIONS["tab"]
        # Каждый кадр рисуется ПОД СВОЙ размер, а не уменьшается из старшего:
        # PIL берёт из append_images кадр с точно совпадающим размером.
        frames = {px: render(px, tab, gloss=False) for px in WEB_ICO_SIZES}
        biggest = max(WEB_ICO_SIZES)
        WEB_ICO.parent.mkdir(parents=True, exist_ok=True)
        frames[biggest].save(
            WEB_ICO, format="ICO",
            sizes=[(s, s) for s in sorted(WEB_ICO_SIZES)],
            append_images=[frames[s] for s in WEB_ICO_SIZES if s != biggest],
        )
    lines.append("%-72s %4dpx --   глянец    знак для OG-карточки, base64"
                 % (WEB_MARK_TS.relative_to(REPO).as_posix(), WEB_MARK_PX))
    if not dry:
        write_web_mark()
    return lines + run_jobs(plan_web(), dry)


def surface(name: str, dry: bool) -> list[str]:
    if name == "web":
        return surface_web(dry)
    return run_jobs(PLANS[name](), dry)


# ══════════════════════════════════════════════════════════════════════════════
# ЛИСТЫ СРАВНЕНИЯ — материал для решения Координатора, не ассеты
# ══════════════════════════════════════════════════════════════════════════════

SHEET_SIZES = (16, 32, 48, 64, 192, 512, 1024)
THRESHOLD_SIZES = (64, 96, 120, 144, 167, 180, 216)

SHEET_BG = (0x2B, 0x2B, 0x30)
SHEET_INK = (0xEC, 0xE8, 0xE0)
SHEET_DIM = (0x9A, 0x96, 0x90)
LIGHT_STRIP = (0xF5, 0xF5, 0xF6)
DARK_STRIP = (0x20, 0x21, 0x24)


def _font(px: int) -> ImageFont.ImageFont:
    for name in ("arial.ttf", "segoeui.ttf", "calibri.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, px)
        except OSError:
            continue
    try:
        return ImageFont.load_default(size=px)
    except TypeError:                                  # Pillow < 10.1
        return ImageFont.load_default()


def _label(draw: ImageDraw.ImageDraw, xy, text: str, font, fill=SHEET_INK,
           anchor: str = "la") -> None:
    draw.text(xy, text, font=font, fill=fill, anchor=anchor)


def _zoom(img: Image.Image, factor: int) -> Image.Image:
    return img.resize((img.size[0] * factor, img.size[1] * factor), Image.NEAREST)


def sheet_material(path: Path) -> str:
    """Лист 1 — знак 1:1 на всех размерах, глянец против плоского."""
    app = COMPOSITIONS["app"]
    gloss = {px: render(px, app, gloss=True) for px in SHEET_SIZES}
    flat = {px: render(px, app, gloss=False) for px in SHEET_SIZES}

    pad, gap, head, row_head = 48, 96, 120, 44
    biggest = max(SHEET_SIZES)
    width = pad * 2 + sum(SHEET_SIZES) + gap * (len(SHEET_SIZES) - 1)
    row_h = row_head + biggest
    height = head + row_h * 2 + gap + pad

    sheet = Image.new("RGB", (width, height), SHEET_BG)
    draw = ImageDraw.Draw(sheet)
    f_title, f_row, f_cap = _font(34), _font(26), _font(20)

    _label(draw, (pad, pad), "Знак NIRIVIO — материал на разных размерах, 1:1", f_title)
    _label(draw, (pad, pad + 46),
           f"композиция иконки приложения (беж, знак 77 % ширины) · умолчание: "
           f"глянец от {GLOSS_MIN_PX} px", f_cap, SHEET_DIM)

    for row, (title, bank) in enumerate(
        (("ГЛЯНЕЦ — канон заставки (кольца .60R / .34R, блик, тень)", gloss),
         ("ПЛОСКИЙ — упрощённый (кольца .66R / .36R, без блика и тени)", flat))
    ):
        top = head + row * (row_h + gap)
        _label(draw, (pad, top), title, f_row)
        base = top + row_head + biggest
        x = pad
        for px in SHEET_SIZES:
            sheet.paste(bank[px], (x, base - px))
            _label(draw, (x, base + 8), f"{px}", f_cap, SHEET_DIM)
            x += px + gap

    sheet.save(path, format="PNG", optimize=True)
    return f"{path.name}  {sheet.size[0]}×{sheet.size[1]}"


def sheet_zoom(path: Path) -> str:
    """Лист 2 — мелкие размеры под увеличением плюс вкладка на свету и в тьме.

    Решение живёт здесь: на 16 и 32 видно, во что превращается блик.
    """
    app, tab = COMPOSITIONS["app"], COMPOSITIONS["tab"]
    small = (16, 32, 48, 64)
    factor = 9

    pad, gap, head = 48, 56, 116
    cell = max(small) * factor
    col_w = cell + gap
    width = pad * 2 + col_w * len(small) - gap
    block_h = 44 + cell
    height = head + (block_h + gap) * 2 + 58 + (32 * 4 + 24 + 14) * 2 + pad

    sheet = Image.new("RGB", (width, height), SHEET_BG)
    draw = ImageDraw.Draw(sheet)
    f_title, f_row, f_cap = _font(34), _font(26), _font(20)

    _label(draw, (pad, pad), "Мелкие размеры под увеличением ×9 (пиксель в пиксель)", f_title)
    _label(draw, (pad, pad + 46),
           "именно здесь решается порог: блик и тень на 16 и 32 px", f_cap, SHEET_DIM)

    for row, (title, is_gloss) in enumerate(
        (("ГЛЯНЕЦ", True), ("ПЛОСКИЙ", False))
    ):
        top = head + row * (block_h + gap)
        _label(draw, (pad, top), title, f_row)
        y = top + 44
        for col, px in enumerate(small):
            img = _zoom(render(px, app, gloss=is_gloss), factor)
            x = pad + col * col_w + (cell - img.size[0]) // 2
            sheet.paste(img, (x, y + (cell - img.size[1]) // 2))
            _label(draw, (pad + col * col_w + cell // 2, y + cell + 6),
                   f"{px} px", f_cap, SHEET_DIM, anchor="ma")

    # Полоса «как это выглядит во вкладке»: композиция tab на светлом и тёмном.
    # Высота полосы считается по САМОЙ ВЫСОКОЙ плитке — иначе увеличенные
    # кадры вылезают на подпись (так и было в первой версии листа).
    tab_shots = ((16, 1), (16, 6), (32, 1), (32, 4))
    band_h = max(px * mult for px, mult in tab_shots) + 24
    strip_top = head + (block_h + gap) * 2 + 16
    _label(draw, (pad, strip_top),
           "Вкладка браузера на светлой и тёмной панели: 16 ×1, 16 ×6, 32 ×1, 32 ×4",
           f_row)
    y = strip_top + 42
    for bg_color, note in ((LIGHT_STRIP, "светлая панель"), (DARK_STRIP, "тёмная панель")):
        sheet.paste(Image.new("RGB", (width - pad * 2, band_h), bg_color), (pad, y))
        x = pad + 20
        for is_gloss in (True, False):
            for px_size, mult in tab_shots:
                img = render(px_size, tab, gloss=is_gloss)
                if mult > 1:
                    img = _zoom(img, mult)
                tile = Image.new("RGB", img.size, bg_color)
                tile.paste(img, (0, 0), img)
                sheet.paste(tile, (x, y + (band_h - img.size[1]) // 2))
                x += img.size[0] + 16
            _label(draw, (x + 6, y + band_h // 2),
                   "глянец" if is_gloss else "плоский", f_cap, SHEET_DIM, anchor="lm")
            x += 150
        _label(draw, (width - pad - 12, y + band_h // 2), note, f_cap, SHEET_DIM, anchor="rm")
        y += band_h + 14

    sheet.save(path, format="PNG", optimize=True)
    return f"{path.name}  {sheet.size[0]}×{sheet.size[1]}"


def sheet_threshold(path: Path) -> str:
    """Лист 3 — полоса вокруг порога: где именно глянец начинает читаться."""
    app = COMPOSITIONS["app"]
    pad, gap, head = 48, 92, 116
    biggest = max(THRESHOLD_SIZES)
    width = pad * 2 + sum(THRESHOLD_SIZES) + gap * (len(THRESHOLD_SIZES) - 1)
    row_h = 44 + biggest
    height = head + (row_h + gap) * 2 + 70 + pad

    sheet = Image.new("RGB", (max(width, 900), height), SHEET_BG)
    draw = ImageDraw.Draw(sheet)
    f_title, f_row, f_cap = _font(34), _font(26), _font(20)

    _label(draw, (pad, pad), "Полоса вокруг порога, 1:1", f_title)
    _label(draw, (pad, pad + 46),
           f"умолчание — глянец от {GLOSS_MIN_PX} px; под самой чертой стоят "
           f"167 px (iPad) и 162 px (Android hdpi)", f_cap, SHEET_DIM)

    for row, (title, is_gloss) in enumerate((("ГЛЯНЕЦ", True), ("ПЛОСКИЙ", False))):
        top = head + row * (row_h + gap)
        _label(draw, (pad, top), title, f_row)
        base = top + 44 + biggest
        x = pad
        for px in THRESHOLD_SIZES:
            sheet.paste(render(px, app, gloss=is_gloss), (x, base - px))
            mark = f"{px}" + (" ←" if px == GLOSS_MIN_PX else "")
            _label(draw, (x, base + 8), mark, f_cap,
                   SHEET_INK if px == GLOSS_MIN_PX else SHEET_DIM)
            x += px + gap

    _label(draw, (pad, height - pad - 24),
           "если глянец читается уже на 120–144, порог GLOSS_MIN_PX опускается "
           "одной строкой в tools/brand/nirivio_mark.py", f_cap, SHEET_DIM)

    sheet.save(path, format="PNG", optimize=True)
    return f"{path.name}  {sheet.size[0]}×{sheet.size[1]}"


# Доля 108dp-слоя, которую лончер гарантированно показывает: центральные 72dp.
# Остальное — запас под параллакс и масштабирование (спека adaptive icons).
ADAPTIVE_VIEWPORT = 72.0 / 108.0


def _shape_mask(side: int, shape: str, ss: int = 4) -> Image.Image:
    """Маска лончера: круг, суперэллипс (One UI) или скруглённый квадрат."""
    n = side * ss
    if shape == "circle":
        mask = Image.new("L", (n, n), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, n - 1, n - 1), fill=255)
    elif shape == "rounded":
        mask = Image.new("L", (n, n), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            (0, 0, n - 1, n - 1), radius=int(n * 0.22), fill=255)
    elif shape == "squircle":
        # |x|^k + |y|^k = 1, k = 3.6 — та самая «капля» One UI.
        k = 3.6
        buf = bytearray(n * n)
        step = 2.0 / n
        for j in range(n):
            y = abs(-1.0 + (j + 0.5) * step) ** k
            row = j * n
            for i in range(n):
                x = abs(-1.0 + (i + 0.5) * step) ** k
                buf[row + i] = 255 if x + y <= 1.0 else 0
        mask = Image.frombytes("L", (n, n), bytes(buf))
    else:
        raise ValueError(shape)
    return mask.resize((side, side), Image.LANCZOS)


def launcher_preview(density: str, side: int, shape: str) -> Image.Image:
    """Иконка, как её соберёт лончер — ИЗ ФАЙЛОВ НА ДИСКЕ, а не из рецепта.

    Именно поэтому лист годится в доказательства: он читает те же PNG, что
    уедут в APK, складывает их в том же порядке (background, потом foreground)
    и режет по маске оболочки.
    """
    res = REPO / "mobile/android/app/src/main/res" / ("drawable-%s" % density)
    with Image.open(res / "ic_launcher_background.png") as bg_raw:
        base = bg_raw.convert("RGBA")
    with Image.open(res / "ic_launcher_foreground.png") as fg_raw:
        base = Image.alpha_composite(base, fg_raw.convert("RGBA"))

    full = base.size[0]
    keep = int(round(full * ADAPTIVE_VIEWPORT))
    off = (full - keep) // 2
    view = base.crop((off, off, off + keep, off + keep)).resize((side, side), Image.LANCZOS)

    out = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    out.paste(view, (0, 0), _shape_mask(side, shape))
    return out


def sheet_masks(path: Path) -> str:
    """Лист 4 — что увидит рабочий стол Android: маски поверх слоёв с диска."""
    shapes = (("circle", "круг (Pixel)"), ("squircle", "капля (One UI)"),
              ("rounded", "скруглённый квадрат"))
    sizes = (192, 128, 96, 64)
    density = "xxxhdpi"

    pad, gutter, gap = 48, 120, 56
    head = 196
    cell = max(sizes)
    col_w = cell + gap
    row_h = cell + 30
    zoom_side, zoom_factor = 104, 4
    zoom_w = zoom_side * zoom_factor

    width = pad * 2 + gutter + col_w * len(shapes) + zoom_w + gap
    height = max(head + row_h * len(sizes) + 110 + pad, head + zoom_w + 200)

    sheet = Image.new("RGB", (width, height), SHEET_BG)
    draw = ImageDraw.Draw(sheet)
    f_title, f_row, f_cap = _font(34), _font(25), _font(20)

    _label(draw, (pad, pad), "Рабочий стол Android: слои с диска под масками лончера", f_title)
    _label(draw, (pad, pad + 48),
           "сложено из drawable-%s/ic_launcher_background.png + _foreground.png —" % density,
           f_cap, SHEET_DIM)
    _label(draw, (pad, pad + 74),
           "тех самых файлов, что уедут в APK; показана центральная зона 72dp из 108dp",
           f_cap, SHEET_DIM)

    col_x = [pad + gutter + col * col_w for col in range(len(shapes))]
    for x, (_shape, caption) in zip(col_x, shapes):
        _label(draw, (x + cell // 2, head - 40), caption, f_row, anchor="ma")

    zoom_x = pad + gutter + col_w * len(shapes) + gap
    _label(draw, (zoom_x + zoom_w // 2, head - 40),
           "край маски под увеличением ×%d" % zoom_factor, f_row, anchor="ma")

    for row, side in enumerate(sizes):
        top = head + row * row_h
        _label(draw, (pad + gutter - gap // 2, top + cell // 2), "%d px" % side,
               f_cap, SHEET_DIM, anchor="rm")
        for x, (shape, _caption) in zip(col_x, shapes):
            img = launcher_preview(density, side, shape)
            tile = Image.new("RGB", img.size, SHEET_BG)
            tile.paste(img, (0, 0), img)
            sheet.paste(tile, (x + (cell - side) // 2, top + (cell - side) // 2))

    # Увеличенный край: доходит ли тень знака до границы маски обрубком.
    zoom = launcher_preview(density, zoom_side, "circle")
    zoom_rgb = Image.new("RGB", zoom.size, SHEET_BG)
    zoom_rgb.paste(zoom, (0, 0), zoom)
    sheet.paste(_zoom(zoom_rgb, zoom_factor), (zoom_x, head))
    _label(draw, (zoom_x, head + zoom_w + 22),
           "тень доходит до границы маски виньеткой,", f_cap, SHEET_DIM)
    _label(draw, (zoom_x, head + zoom_w + 48),
           "а не обрубленным контуром — это и надо", f_cap, SHEET_DIM)
    _label(draw, (zoom_x, head + zoom_w + 74),
           "подтвердить на устройстве", f_cap, SHEET_DIM)

    _label(draw, (pad, height - pad - 30),
           "Знак занимает безопасное поле 66dp из 108dp — ровно как прежняя иконка; "
           "поехал материал, не размер.", f_cap, SHEET_DIM)

    sheet.save(path, format="PNG", optimize=True)
    return "%s  %d×%d" % (path.name, sheet.size[0], sheet.size[1])


def surface_sheets(dry: bool, sheet_dir: Path) -> list[str]:
    if dry:
        return [f"{(sheet_dir / n).as_posix()}" for n in
                ("sheet_1_material.png", "sheet_2_zoom.png", "sheet_3_threshold.png",
                 "sheet_4_android_masks.png")]
    sheet_dir.mkdir(parents=True, exist_ok=True)
    return [
        sheet_material(sheet_dir / "sheet_1_material.png"),
        sheet_zoom(sheet_dir / "sheet_2_zoom.png"),
        sheet_threshold(sheet_dir / "sheet_3_threshold.png"),
        sheet_masks(sheet_dir / "sheet_4_android_masks.png"),
    ]


# ══════════════════════════════════════════════════════════════════════════════
# САМОПРОВЕРКА
# ══════════════════════════════════════════════════════════════════════════════
#
# Две независимые части, потому что одной мало:
#
#   A. КАНОН ПРОТИВ ИСХОДНИКА. Числа рецепта вычитываются регулярками прямо из
#      Dart заставки и сверяются с константами этого файла. Только эта часть
#      способна поймать «число выдумано» и расхождение, если заставку однажды
#      перерисуют. Каждый шаблон обязан дать РОВНО одно совпадение — иначе
#      проверка красная, а не «пропустим».
#
#   D. ФАЙЛЫ ПРОТИВ ПЛАНА. Каждый записанный файл открывается заново и
#      сверяется с планом: размер, режим, масштаб знака замером по срезу,
#      материал против объявленного порогом варианта, геометрия подмаза.
#      Чего эта часть НЕ ловит и не притворяется, что ловит: MASTER_TARGET и
#      TILE_N — ручки КАЧЕСТВА сглаживания, их подмена портит края, но не
#      утверждение; это видно глазом на листах, а не проверкой.
#
#   B. КОНВЕЙЕР ПРОТИВ ФОРМУЛЫ. Ожидаемый пиксель выводится из констант заново
#      (градиент → трёхстоповая рампа → блик) и сверяется с готовым PNG. Эта
#      часть НЕ видит подмены самой константы — она их обе берёт из одного
#      места; она ловит поломку конвейера: порядок слоёв, маски, ресайзы.
#
# Первая версия проверки состояла только из части B и была зелёной на ПЯТИ
# подменах канона подряд — тавтология, ровно та форма, о которой предупреждает
# память проекта. Часть A добавлена после этого.

DART_PAINTER = REPO / "mobile/lib/screens/splash/painters/cockade_painter.dart"
DART_THEME = REPO / "mobile/lib/config/theme.dart"
DART_SPLASH = REPO / "mobile/lib/screens/splash/splash_screen.dart"


class CanonMissing(Exception):
    """Шаблон не нашёл ровно одного совпадения — исходник заставки изменился."""


def _one(text: str, pattern: str, where: str):
    found = re.findall(pattern, text)
    if len(found) != 1:
        raise CanonMissing(
            "%s: шаблон дал %d совпадений вместо одного — %s" % (where, len(found), pattern))
    return found[0]


def _hex(value: str) -> tuple[int, int, int]:
    return (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16))


def canon_from_dart() -> list[tuple[str, object, object, str]]:
    """Что заставка говорит о знаке: (имя, из Dart, из этого файла, источник)."""
    painter = DART_PAINTER.read_text(encoding="utf-8")
    theme = DART_THEME.read_text(encoding="utf-8")
    splash = DART_SPLASH.read_text(encoding="utf-8")
    pf, tf, sf = DART_PAINTER.name, DART_THEME.name, DART_SPLASH.name

    rows: list[tuple[str, object, object, str]] = []

    # ── цвета (theme.dart) ────────────────────────────────────────────────────
    for token, mine in (("cockadeCornflower", CORNFLOWER), ("cockadeRing", RING_LIGHT),
                        ("cockadeAccent", ACCENT), ("cockadeShadow", SHADOW),
                        ("splashBgInner", BG_INNER), ("splashBgMid", BG_MID),
                        ("splashBgOuter", BG_OUTER)):
        raw = _one(theme, token + r"\s*=\s*Color\(0xFF([0-9A-Fa-f]{6})\)", tf)
        rows.append((token, _hex(raw), tuple(mine), tf))

    # ── пропорции колец ───────────────────────────────────────────────────────
    rows.append(("ringRatio", float(_one(painter, r"double ringRatio = ([.\d]+);", pf)),
                 RING_RATIO_GLOSS, pf))
    rows.append(("coreRatio", float(_one(painter, r"double coreRatio = ([.\d]+);", pf)),
                 CORE_RATIO_GLOSS, pf))
    rows.append(("gridRadius", float(_one(painter, r"double gridRadius = ([.\d]+);", pf)),
                 GRID_R, pf))

    # ── глянцевый диск: двухточечный градиент ────────────────────────────────
    rows.append(("_disc endRadius",
                 float(_one(painter, r"Gradient\.radial\(\s*center,\s*r \* ([.\d]+),", pf)),
                 END_R, pf))
    fx, fy, fr = _one(
        painter,
        r"center\.translate\(-r \* ([.\d]+), -r \* ([.\d]+)\),\s*r \* ([.\d]+),", pf)
    rows.append(("_disc focal", (-float(fx), -float(fy)), FOCAL, pf))
    rows.append(("_disc focalRadius", float(fr), FOCAL_R, pf))
    rows.append(("_disc stop mid",
                 float(_one(painter, r"const <double>\[0, ([.\d]+), 1\],", pf)), 0.5, pf))
    rows.append(("_disc lighten",
                 float(_one(painter, r"Color\.lerp\(color, Colors\.white, ([.\d]+)\)", pf)),
                 LIGHTEN, pf))

    # Затемнение края берётся с ТОЧЕК ВЫЗОВА — это заодно сверяет привязку
    # цвета к полосе: василёк снаружи, светлое кольцо в середине, ядро внутри.
    for band, call in (
        ("outer", r"_disc\(canvas, r, AppTheme\.cockadeCornflower, ([.\d]+)\);"),
        ("ring", r"_disc\(canvas, r \* ringRatio, AppTheme\.cockadeRing, ([.\d]+)\);"),
        ("core", r"_disc\(canvas, r \* coreRatio, AppTheme\.cockadeAccent, ([.\d]+)\);"),
    ):
        rows.append(("edgeDarken " + band, float(_one(painter, call, pf)),
                     EDGE_DARKEN[band], pf))

    # ── блик ──────────────────────────────────────────────────────────────────
    hx, hy = _one(painter,
                  r"Offset highlight = center\.translate\(-r \* ([.\d]+), -r \* ([.\d]+)\);", pf)
    rows.append(("_sheen at", (-float(hx), -float(hy)), SHEEN_AT, pf))
    rows.append(("_sheen radius",
                 float(_one(painter, r"Gradient\.radial\(\s*highlight,\s*r \* ([.\d]+),", pf)),
                 SHEEN_R, pf))
    rows.append(("_sheen alpha", float(_one(
        painter,
        r"Colors\.white\.withValues\(alpha: ([.\d]+)\),\s*Colors\.white\.withValues\(alpha: 0\)",
        pf)), SHEEN_ALPHA, pf))

    # ── тень ──────────────────────────────────────────────────────────────────
    rows.append(("shadow dy·u",
                 float(_one(painter, r"center\.translate\(0, ([.\d]+) \* shadow \* u\),", pf)),
                 SHADOW_DY_U, pf))
    rows.append(("shadow sigma·u", float(_one(
        painter, r"MaskFilter\.blur\(BlurStyle\.normal, ([.\d]+) \* shadow \* u\)", pf)),
        SHADOW_SIGMA_U, pf))
    rows.append(("shadow alpha", float(_one(
        painter, r"cockadeShadow\.withValues\(alpha: ([.\d]+) \* shadow\)", pf)),
        SHADOW_ALPHA, pf))

    # ── бежевый подмаз (splash_screen.dart) ──────────────────────────────────
    rows.append(("wash stop mid",
                 float(_one(splash, r"stops: const \[0, ([.\d]+), 1\],", sf)),
                 WASH_MID_STOP, sf))

    return rows


def _solve_t(x: float, y: float) -> float:
    """t двухточечного градиента в точке, нормированной радиусом диска."""
    fx, fy = FOCAL
    dx, dy = -fx, -fy
    dr = END_R - FOCAL_R
    a = dx * dx + dy * dy - dr * dr
    pdx, pdy = x - fx, y - fy
    b = -2.0 * (pdx * dx + pdy * dy + FOCAL_R * dr)
    c = pdx * pdx + pdy * pdy - FOCAL_R * FOCAL_R
    d = b * b - 4.0 * a * c
    if d <= 0.0:
        return 1.0
    s = math.sqrt(d)
    best = None
    for cand in ((-b + s) / (2.0 * a), (-b - s) / (2.0 * a)):
        if FOCAL_R + cand * dr >= 0.0 and (best is None or cand > best):
            best = cand
    if best is None:
        return 1.0
    return min(1.0, max(0.0, best))


def _ramp(t: float, low, mid, high):
    """Трёхстоповая рампа 0 / .5 / 1 — то же, что ImageOps.colorize."""
    if t <= 0.5:
        k = t / 0.5
        return tuple(l + (m - l) * k for l, m in zip(low, mid))
    k = (t - 0.5) / 0.5
    return tuple(m + (h - m) * k for m, h in zip(mid, high))


def _expected_gloss_pixel(n: int, comp: Composition, i: int, j: int):
    """Ожидаемый RGB пикселя (i, j) глянцевого знака — вывод из констант."""
    r = comp.sign_ratio * n
    x = ((i + 0.5) - n / 2.0) / r
    y = ((j + 0.5) - n / 2.0) / r
    dist = math.hypot(x, y)

    if dist <= CORE_RATIO_GLOSS:
        band, color, scale = "core", ACCENT, CORE_RATIO_GLOSS
    elif dist <= RING_RATIO_GLOSS:
        band, color, scale = "ring", RING_LIGHT, RING_RATIO_GLOSS
    elif dist <= 1.0:
        band, color, scale = "outer", CORNFLOWER, 1.0
    else:
        return None

    base = _ramp(_solve_t(x / scale, y / scale),
                 _mix(color, (255, 255, 255), LIGHTEN),
                 color,
                 _mix(color, (0, 0, 0), EDGE_DARKEN[band]))
    sheen = math.hypot(x - SHEEN_AT[0], y - SHEEN_AT[1]) / SHEEN_R
    alpha = SHEEN_ALPHA * max(0.0, min(1.0, 1.0 - sheen))
    return tuple(c * (1.0 - alpha) + 255.0 * alpha for c in base)


def _is_beige(rgb) -> bool:
    """Похоже на бежевый подмаз: светлое и тёплое (R >= G >= B)."""
    return min(rgb[:3]) > 185 and rgb[0] >= rgb[1] >= rgb[2]


def _is_mark_pixel(pixel) -> bool:
    """Пиксель принадлежит знаку: непрозрачный и не бежевый.

    Светлое кольцо знака под определение бежевого попадает, но оно кольцо, а
    не край: внешний радиус мерится по самому дальнему НЕбежевому пикселю,
    то есть по васильковому диску.
    """
    return pixel[3] > 128 and not _is_beige(pixel)


def _expected_wash_pixel(n: int, i: int, j: int):
    """Ожидаемый цвет бежевого подмаза в точке (i, j) — вывод из констант."""
    cx, cy = WASH_CENTER[0] * n, WASH_CENTER[1] * n
    r = WASH_RADIUS * n
    t = min(1.0, math.hypot((i + 0.5) - cx, (j + 0.5) - cy) / r)
    if t <= WASH_MID_STOP:
        k = t / WASH_MID_STOP
        return tuple(a + (b - a) * k for a, b in zip(BG_INNER, BG_MID))
    k = (t - WASH_MID_STOP) / (1.0 - WASH_MID_STOP)
    return tuple(a + (b - a) * k for a, b in zip(BG_MID, BG_OUTER))


PROBES = ((0.05, 0.10), (-0.15, -0.15), (0.47, 0.0), (0.0, -0.47),
          (0.82, 0.0), (-0.55, 0.55), (0.0, 0.80))
TOLERANCE = 3


def check() -> int:
    failures: list[str] = []

    # ── A ────────────────────────────────────────────────────────────────────
    print("  A. канон против исходника заставки")
    try:
        rows = canon_from_dart()
    except CanonMissing as exc:
        print("     ШАБЛОН МИМО: %s" % exc)
        print()
        print("  ПРОВЕРКА КРАСНАЯ: канон из Dart не вычитывается")
        return 1

    for name, from_dart, mine, source in rows:
        same = from_dart == mine
        if isinstance(from_dart, float) and isinstance(mine, float):
            same = abs(from_dart - mine) < 1e-9
        if isinstance(from_dart, tuple) and isinstance(mine, tuple):
            same = len(from_dart) == len(mine) and all(
                abs(a - b) < 1e-9 for a, b in zip(from_dart, mine))
        print("     %s %-20s dart=%-22s тут=%-22s %s"
              % ("ok " if same else "МИМО", name, from_dart, mine, source))
        if not same:
            failures.append("канон %s: в %s %s, тут %s" % (name, source, from_dart, mine))
    print("     сверено значений: %d" % len(rows))

    # ── B ────────────────────────────────────────────────────────────────────
    comp = COMPOSITIONS["loose"]
    n = 1024
    print("  B. конвейер против формулы (допуск +-%d на канал)" % TOLERANCE)
    px = render(n, comp, gloss=True).convert("RGBA").load()
    for gx, gy in PROBES:
        r = comp.sign_ratio * n
        i, j = int(n / 2.0 + gx * r), int(n / 2.0 + gy * r)
        want = _expected_gloss_pixel(n, comp, i, j)
        got = px[i, j]
        if want is None:
            failures.append("проба (%.2f, %.2f) вне знака" % (gx, gy))
            continue
        delta = max(abs(a - b) for a, b in zip(got[:3], want))
        print("     %s (%+.2f, %+.2f) rgb%s  ждали (%d, %d, %d)  расхождение %.1f"
              % ("ok " if delta <= TOLERANCE else "МИМО", gx, gy, got[:3],
                 round(want[0]), round(want[1]), round(want[2]), delta))
        if delta > TOLERANCE:
            failures.append("проба (%.2f, %.2f): расхождение %.1f" % (gx, gy, delta))
        if got[3] != 255:
            failures.append("проба (%.2f, %.2f): альфа %d вместо 255" % (gx, gy, got[3]))

    # Блик обрезан по внешнему кругу: за диском белизны быть не должно. Пробы
    # выше все внутри знака и снятую обрезку не увидели бы.
    spill = []
    for deg in range(0, 360, 5):
        rad = math.radians(deg)
        i = int(n / 2.0 + math.cos(rad) * comp.sign_ratio * n * 1.08)
        j = int(n / 2.0 + math.sin(rad) * comp.sign_ratio * n * 1.08)
        pix = px[i, j]
        if pix[3] > 8 and min(pix[:3]) > 140:
            spill.append((deg, pix))
    print("     %s блик за диском: %d проб из 72 светлее порога"
          % ("ok " if not spill else "МИМО", len(spill)))
    if spill:
        failures.append("блик вылез за диск: %d проб, первая %s" % (len(spill), spill[0]))

    # ── плоский вариант ──────────────────────────────────────────────────────
    # Толщина колец плоского знака — СВОБОДНЫЙ параметр решения, а не канон:
    # в Dart её нет, сверять «саму с собой» бессмысленно (первая версия этой
    # проверки так и делала и была зелёной на подмене). Здесь проверяется то,
    # что утверждать можно: замысел «кольца толще канона», материал «ровно три
    # цвета без градиента» и внешний радиус против таблицы композиций.
    flat_img = render(n, comp, gloss=False).convert("RGBA")
    flat = flat_img.load()
    row, r = n // 2, comp.sign_ratio * n

    intents = (
        ("светлое кольцо толще канона", RING_RATIO_FLAT > RING_RATIO_GLOSS),
        ("ядро крупнее канона", CORE_RATIO_FLAT > CORE_RATIO_GLOSS),
        ("белая полоса шире канона",
         (RING_RATIO_FLAT - CORE_RATIO_FLAT) > (RING_RATIO_GLOSS - CORE_RATIO_GLOSS)),
    )
    for label, held in intents:
        print("     %s плоский замысел: %s" % ("ok " if held else "МИМО", label))
        if not held:
            failures.append("плоский замысел нарушен: " + label)

    # Материал: внутри каждой полосы должен стоять РОВНО канонический цвет.
    # Глянцевая заливка, случайно попавшая в плоский путь, красит эту строку.
    for name, color, lo, hi in (
        ("core", ACCENT, 0.0, CORE_RATIO_FLAT - 0.04),
        ("ring", RING_LIGHT, CORE_RATIO_FLAT + 0.04, RING_RATIO_FLAT - 0.04),
        ("outer", CORNFLOWER, RING_RATIO_FLAT + 0.04, 0.96),
    ):
        worst, samples = 0, 0
        for k in range(24):
            rad = math.radians(k * 15)
            for step in range(9):
                q = lo + (hi - lo) * step / 8.0
                i = int(n / 2.0 + math.cos(rad) * q * r)
                j = int(n / 2.0 + math.sin(rad) * q * r)
                pix = flat[i, j]
                worst = max(worst, max(abs(a - b) for a, b in zip(pix[:3], color)))
                samples += 1
        print("     %s плоский %-5s %d проб, худшее отклонение от канона %d"
              % ("ok " if worst <= 2 else "МИМО", name, samples, worst))
        if worst > 2:
            failures.append("плоский %s: отклонение %d от канонического цвета" % (name, worst))

    # Плоский вариант обязан быть БЕЗ тени: на мелких размерах тень съедает
    # контур — это и есть причина, по которой плоский вариант существует.
    # Без этой строки протёкшая в плоский путь тень проходила незамеченной.
    opaque_outside = []
    for deg in range(0, 360, 5):
        rad = math.radians(deg)
        for q in (1.06, 1.15, 1.28):
            i = int(n / 2.0 + math.cos(rad) * q * r)
            j = int(n / 2.0 + math.sin(rad) * q * r)
            if 0 <= i < n and 0 <= j < n and flat[i, j][3] > 2:
                opaque_outside.append((deg, q, flat[i, j][3]))
    print("     %s плоский без тени: %d проб из 216 за диском непрозрачны"
          % ("ok " if not opaque_outside else "МИМО", len(opaque_outside)))
    if opaque_outside:
        failures.append("плоский не пуст за диском (тень?): %d проб, первая %s"
                        % (len(opaque_outside), opaque_outside[0]))

    # Внешний радиус — против таблицы композиций, а не против себя.
    xs = [i for i in range(n) if flat[i, row][3] > 128]
    if not xs:
        failures.append("плоский: знак не найден в срезе")
        print("     МИМО плоский: знак не найден в срезе")
    else:
        measured = (max(xs) - min(xs) + 1) / 2.0
        off = abs(measured - r)
        print("     %s плоский внешний радиус %.1f px, композиция объявляет %.1f px"
              % ("ok " if off <= 1.5 else "МИМО", measured, r))
        if off > 1.5:
            failures.append("плоский внешний радиус: %.1f против %.1f px" % (measured, r))

    # ── C ────────────────────────────────────────────────────────────────────
    print("  C. состав iOS против Contents.json")
    declared = _ios_targets()
    on_disk = {p.name for p in IOS_SET.glob("*.png")}
    missing = sorted(set(declared) - on_disk)
    extra = sorted(on_disk - set(declared))
    wrong = []
    for name, want_px in sorted(declared.items()):
        path = IOS_SET / name
        if path.exists():
            with Image.open(path) as im:
                if im.size != (want_px, want_px):
                    wrong.append("%s: %s вместо %dx%d" % (name, im.size, want_px, want_px))
    print("     объявлено %d, на диске %d, лишних %d, не хватает %d, размер мимо %d"
          % (len(declared), len(on_disk), len(extra), len(missing), len(wrong)))
    if missing:
        failures.append("iOS не хватает: " + ", ".join(missing))
    if extra:
        failures.append("iOS лишние: " + ", ".join(extra))
    if wrong:
        failures.append("iOS размеры: " + "; ".join(wrong))

    # ── D ────────────────────────────────────────────────────────────────────
    # Файлы на диске против плана. Часть B проверяет РИСОВАНИЕ, а эта — что
    # нарисованное попало куда следует и не оказалось пустым: именно так молча
    # прошёл пустой слой background у adaptive icon (803 байта прозрачности).
    print("  D. файлы на диске против плана")
    checked = 0
    for name in PLANS:
        for job in PLANS[name]():
            checked += 1
            label = job.path.relative_to(REPO).as_posix()
            if not job.path.exists():
                failures.append("нет файла: " + label)
                print("     МИМО нет файла %s" % label)
                continue
            with Image.open(job.path) as raw:
                mode, size = raw.mode, raw.size
                im = raw.convert("RGBA")
            problems = []
            if size != (job.px, job.px):
                problems.append("размер %s вместо %dx%d" % (size, job.px, job.px))
            if mode != job.mode:
                problems.append("режим %s вместо %s" % (mode, job.mode))

            px = im.load()
            corner = px[0, 0]
            centre = px[job.px // 2, job.px // 2]

            # Масштаб знака — замером, а не на глаз. Ревью Phase 3.5 показало,
            # что без этого подмена sign_ratio или переворот GLOSS_MIN_PX
            # уезжают в APK молча: двух пикселей (угол + центр) не хватает.
            # «Пиксель знака» = непрозрачный и НЕ бежевый; порог альфы 128
            # заодно выкидывает тень (её альфа не превышает 76 до размытия).
            if job.sign:
                row = job.px // 2
                xs = [i for i in range(job.px) if _is_mark_pixel(px[i, row])]
                if not xs:
                    problems.append("знак не найден в срезе через центр")
                else:
                    measured = (max(xs) - min(xs) + 1) / 2.0
                    want_r = job.comp.sign_ratio * job.px
                    slack = max(1.5, want_r * 0.02)
                    if abs(measured - want_r) > slack:
                        problems.append("радиус знака %.1f px, композиция объявляет %.1f"
                                        % (measured, want_r))

                # Материал — против того варианта, который объявил порог.
                want_centre = (_expected_gloss_pixel(job.px, job.comp,
                                                     job.px // 2, job.px // 2)
                               if job.gloss else ACCENT)
                off = max(abs(a - b) for a, b in zip(centre[:3], want_centre))
                if off > 6:
                    problems.append("центр %s, а для %s ждали (%d, %d, %d)"
                                    % (centre[:3], "глянца" if job.gloss else "плоского",
                                       round(want_centre[0]), round(want_centre[1]),
                                       round(want_centre[2])))

            # Геометрия подмаза — по точке у ВЕРХНЕГО края над знаком. Место
            # выбрано двумя промахами: (2, h/2) садится прямо на край диска на
            # 20 px, а (w/2, h-2) ловит тень — она смещена вниз и подкрашивает
            # низ на 5 единиц, то есть расхождение было настоящим, но
            # ожидание тени не учитывало. Сверху тень не достаёт (2.5 сигмы).
            # Только для плиток от 64 px: ниже одиночный пиксель уже размыт
            # уменьшением, и утверждение о цвете в точке перестаёт быть
            # утверждением.
            if job.comp.background and job.px >= 64:
                probe = (job.px // 2, 2)
                off = max(abs(a - b) for a, b in
                          zip(px[probe][:3], _expected_wash_pixel(job.px, *probe)))
                if off > 4:
                    problems.append("подмаз у нижнего края %s расходится с рецептом на %d"
                                    % (px[probe][:3], off))
            if job.comp.background:
                if corner[3] != 255:
                    problems.append("угол прозрачен, а фон объявлен")
                elif not (min(corner[:3]) > 170 and corner[0] >= corner[1] >= corner[2]):
                    problems.append("угол %s не похож на беж" % (corner[:3],))
            elif corner[3] != 0:
                problems.append("угол непрозрачен, а фон не объявлен")

            orange = centre[3] == 255 and centre[0] > 200 and centre[0] > centre[1] > centre[2] \
                and centre[2] < 160
            if job.sign and not orange:
                problems.append("в центре %s, а должно быть ядро знака" % (centre[:3],))
            if not job.sign and orange:
                problems.append("в центре ядро знака, а слой объявлен без знака")
            if not job.sign and job.comp.background and centre[3] != 255:
                problems.append("слой только с фоном, а центр прозрачен")

            if problems:
                failures.append(label + ": " + "; ".join(problems))
                print("     МИМО %-62s %s" % (label, "; ".join(problems)))

    # Многокадровый .ico — отдельно: кадры обязаны БЫТЬ, а не досчитаться из
    # старшего, и углы у вкладки обязаны остаться прозрачными.
    checked += 1
    if not WEB_ICO.exists():
        failures.append("нет файла: " + WEB_ICO.relative_to(REPO).as_posix())
        print("     МИМО нет favicon.ico")
    else:
        with Image.open(WEB_ICO) as ico:
            have = sorted(s[0] for s in ico.ico.sizes())
            want = sorted(WEB_ICO_SIZES)
            if have != want:
                failures.append("favicon.ico: кадры %s вместо %s" % (have, want))
                print("     МИМО favicon.ico кадры %s вместо %s" % (have, want))
            for s in want:
                if s not in have:
                    continue
                frame = ico.ico.getimage((s, s)).convert("RGBA")
                fp = frame.load()
                c = fp[s // 2, s // 2]
                if not (c[3] == 255 and c[0] > 200 and c[0] > c[1] > c[2]):
                    failures.append("favicon.ico %dpx: в центре %s" % (s, c))
                    print("     МИМО favicon.ico %dpx центр %s" % (s, c))
                if fp[0, 0][3] != 0:
                    failures.append("favicon.ico %dpx: угол непрозрачен" % s)
                    print("     МИМО favicon.ico %dpx угол непрозрачен" % s)

    # TS-модуль со знаком: base64 обязан разбираться в PNG нужного размера с
    # ядром знака в центре — иначе на OG-карточке вместо знака будет ничего.
    checked += 1
    if not WEB_MARK_TS.exists():
        failures.append("нет файла: " + WEB_MARK_TS.relative_to(REPO).as_posix())
        print("     МИМО нет nirivio-mark.ts")
    else:
        text = WEB_MARK_TS.read_text(encoding="utf-8")
        payload = "".join(re.findall(r"'([A-Za-z0-9+/=]{8,})'", text))
        declared = re.search(r"NIRIVIO_MARK_PX = (\d+);", text)
        if not payload or declared is None:
            failures.append("nirivio-mark.ts: не нашёл ни base64, ни NIRIVIO_MARK_PX")
            print("     МИМО nirivio-mark.ts: base64 или размер не читаются")
        else:
            # Против ПЛАНА (WEB_MARK_PX), а не против числа из того же файла:
            # внутренняя согласованность модуля — не доказательство.
            want = WEB_MARK_PX
            if int(declared.group(1)) != WEB_MARK_PX:
                failures.append("nirivio-mark.ts: объявлено NIRIVIO_MARK_PX = %s, план — %d"
                                % (declared.group(1), WEB_MARK_PX))
            try:
                with Image.open(io.BytesIO(base64.b64decode(payload))) as mark:
                    got_size, got_mode = mark.size, mark.mode
                    mp = mark.convert("RGBA").load()
                    centre = mp[got_size[0] // 2, got_size[1] // 2]
                    corner = mp[0, 0]
            except Exception as exc:                      # noqa: BLE001
                failures.append("nirivio-mark.ts: base64 не разбирается в PNG (%s)" % exc)
                print("     МИМО nirivio-mark.ts: base64 не разбирается")
            else:
                bad = []
                if got_size != (want, want):
                    bad.append("размер %s против объявленных %d" % (got_size, want))
                if not (centre[3] == 255 and centre[0] > 200 and centre[0] > centre[1] > centre[2]):
                    bad.append("в центре %s, а должно быть ядро знака" % (centre[:3],))
                if corner[3] != 0:
                    bad.append("угол непрозрачен")
                print("     %s nirivio-mark.ts %s %s, центр %s"
                      % ("ok " if not bad else "МИМО", got_size, got_mode, centre[:3]))
                if bad:
                    failures.append("nirivio-mark.ts: " + "; ".join(bad))

    print("     проверено файлов: %d" % checked)

    print()
    if failures:
        print("  ПРОВЕРКА КРАСНАЯ (%d):" % len(failures))
        for f in failures:
            print("    - " + f)
        return 1
    print("  проверка зелёная")
    return 0


# ══════════════════════════════════════════════════════════════════════════════
# CLI
# ══════════════════════════════════════════════════════════════════════════════

SURFACES = tuple(PLANS)


def main(argv: list[str] | None = None) -> int:
    # Консоль Windows бывает cp1251: кириллицу она держит, а редкие
    # символы (рамки, знаки сравнения) — нет. Без страховки скрипт падал
    # бы на печати отчёта, ничего не нарисовав.
    try:
        sys.stdout.reconfigure(errors="replace")
    except (AttributeError, OSError):
        pass
    parser = argparse.ArgumentParser(
        description="Раскладывает знак NIRIVIO по всем поверхностям из одного рецепта.")
    parser.add_argument("surfaces", nargs="*", metavar="ПОВЕРХНОСТЬ",
                        help="android · ios · admin-web · web · sheets")
    parser.add_argument("--all", action="store_true", help="все поверхности приложений")
    parser.add_argument("--list", action="store_true", help="только показать, что куда пишется")
    parser.add_argument("--check", action="store_true",
                        help="сверить отрисованное с рецептом из Dart")
    parser.add_argument("--sheet-dir", default=None,
                        help="куда класть листы сравнения (по умолчанию — системный temp)")
    args = parser.parse_args(argv)

    # Опечатку ловим ДО раскрытия --all: иначе `--all sheetz` молча делал всё
    # кроме листов, а `--check web` молча игнорировал поверхность.
    unknown = [s for s in args.surfaces if s not in SURFACES and s != "sheets"]
    if unknown:
        print(f"Неизвестная поверхность: {', '.join(unknown)}", file=sys.stderr)
        return 2

    if args.check:
        if args.surfaces or args.all:
            print("--check запускается без поверхностей", file=sys.stderr)
            return 2
        print(chr(10) + "-- check " + "-" * 60)
        return check()

    wanted = list(args.surfaces)
    if args.all:
        wanted = list(SURFACES) + (["sheets"] if "sheets" in wanted else [])
    if not wanted:
        parser.print_help()
        return 2

    sheet_dir = (Path(args.sheet_dir) if args.sheet_dir
                 else Path(tempfile.gettempdir()) / "nirivio_mark_sheets")

    for name in wanted:
        print(chr(10) + f"-- {name} " + "-" * max(0, 66 - len(name)))
        if name == "sheets":
            lines = surface_sheets(args.list, sheet_dir)
        else:
            lines = surface(name, args.list)
        for line in lines:
            print("  " + line)

    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
