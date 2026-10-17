import 'package:restaurant_guide_mobile/config/environment.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';

/// Запасные части адреса — те же, что у сайта для карточки, которой бэкенд
/// не дал город или категорию (`web/src/lib/establishment-path.ts`).
const String _fallbackCitySlug = 'minsk';
const String _fallbackCategorySlug = 'restaurants';

/// Ссылка на страницу заведения на сайте: `/{город}/{категория}/{slug}`.
///
/// Адрес у карточки один: сайт сам уводит чужой допустимый город или категорию
/// на свой. Без `slug` (старый ответ сервера) адреса нет — `null`, и в текст
/// «Поделиться» ссылка не попадает.
String? establishmentWebUrl(Establishment establishment, {String? siteBaseUrl}) {
  final slug = establishment.slug;
  if (slug == null || slug.isEmpty) return null;
  final base = _withoutTrailingSlash(siteBaseUrl ?? Environment.siteBaseUrl);
  final city = establishment.citySlug ?? _fallbackCitySlug;
  final category = establishment.categorySlug ?? _fallbackCategorySlug;
  return '$base/$city/$category/$slug';
}

/// Текст для системного меню «Поделиться»: название, адрес и ссылка на сайт.
String establishmentShareText(Establishment establishment,
    {String? siteBaseUrl}) {
  final buffer = StringBuffer()
    ..writeln('${establishment.name} — ${establishment.category.toLowerCase()}')
    ..writeln('📍 ${establishment.address}, ${establishment.city}');

  final url = establishmentWebUrl(establishment, siteBaseUrl: siteBaseUrl);
  if (url != null) buffer.writeln('🔗 $url');

  buffer.write('\nНайдено в NIRIVIO');
  return buffer.toString();
}

String _withoutTrailingSlash(String value) =>
    value.endsWith('/') ? value.substring(0, value.length - 1) : value;
