import 'package:restaurant_guide_mobile/models/establishment.dart';

/// Фото для галереи открытой карточки — то же правило, что у сайта
/// (`web/src/components/establishment/Gallery.tsx`):
///   - в галерею идут все картинки, кроме меню: зал, фасад, блюда и старые
///     строки с типом `photo`; PDF и строки без единого адреса отбрасываются;
///   - обложка встаёт первой. Признак обложки — `is_primary`; если флага нет
///     ни у одной строки, обложку ищем по адресу [primaryUrl]
///     (`primary_image_url`).
///
/// Раньше в галерею брались только `photo` и `interior`. Кабинет других типов
/// не пишет, а загрузчик пишет фасад — и если обложкой был фасад, превью в
/// выдаче его показывало, а в открытой карточке его не было.
List<EstablishmentMedia> galleryPhotos(
  List<EstablishmentMedia> media, {
  String? primaryUrl,
}) {
  final photos = media
      .where((m) =>
          !m.isPdf &&
          m.type != 'menu' &&
          (m.url ?? m.previewUrl ?? m.thumbnailUrl) != null)
      .toList();
  if (photos.length <= 1) return photos;

  var primaryIndex = photos.indexWhere((m) => m.isPrimary);
  if (primaryIndex < 0 && primaryUrl != null) {
    primaryIndex = photos.indexWhere((m) =>
        m.url == primaryUrl ||
        m.previewUrl == primaryUrl ||
        m.thumbnailUrl == primaryUrl);
  }
  if (primaryIndex > 0) {
    photos.insert(0, photos.removeAt(primaryIndex));
  }
  return photos;
}
