import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/utils/gallery_photos.dart';

import '../support/wire_fixtures.dart';

/// Галерея открытой карточки.
///
/// Правило то же, что у сайта (`web/src/components/establishment/Gallery.tsx`):
/// в галерее все картинки, кроме меню, и обложка — первой. Повод: у карточек
/// из загрузчика обложкой бывает фасад; превью в выдаче его показывало, а
/// открытая карточка теряла, потому что брала только `photo` и `interior`.
EstablishmentMedia media({
  required String id,
  String type = 'interior',
  String? fileType,
  int position = 0,
  bool isPrimary = false,
  String? url,
}) =>
    EstablishmentMedia.fromJson(mediaRow(
      id: id,
      type: type,
      fileType: fileType,
      position: position,
      isPrimary: isPrimary,
      url: url ?? 'https://cdn.example/$id',
      previewUrl: 'https://cdn.example/$id/preview',
      thumbnailUrl: 'https://cdn.example/$id/thumb',
    ));

List<String> ids(List<EstablishmentMedia> photos) =>
    photos.map((m) => m.id).toList();

void main() {
  test('обложка-фасад попадает в галерею и встаёт первой', () {
    final photos = galleryPhotos([
      media(id: 'hall-1', position: 0),
      media(id: 'hall-2', position: 1),
      media(id: 'facade', type: 'exterior', position: 2, isPrimary: true),
      media(id: 'menu', type: 'menu', position: 3),
    ]);

    expect(ids(photos), ['facade', 'hall-1', 'hall-2']);
  });

  test('фасад без статуса обложки тоже в галерее — на своём месте', () {
    final photos = galleryPhotos([
      media(id: 'hall', position: 0, isPrimary: true),
      media(id: 'facade', type: 'exterior', position: 1),
    ]);

    expect(ids(photos), ['hall', 'facade']);
  });

  test('блюда и старый тип photo в галерее, меню и PDF — нет', () {
    final photos = galleryPhotos([
      media(id: 'dish', type: 'dishes', position: 0),
      media(id: 'legacy', type: 'photo', position: 1),
      media(id: 'menu-img', type: 'menu', position: 2),
      media(id: 'menu-pdf', type: 'menu', fileType: 'pdf', position: 3),
    ]);

    expect(ids(photos), ['dish', 'legacy']);
  });

  test('без флага обложка находится по primary_image_url — и по превью', () {
    // Обложку бэкенд синхронизирует в primary_image_url; у старых карточек
    // флага в ответе может не быть. Адрес бывает и полным, и превью.
    final byPreview = galleryPhotos(
      [media(id: 'hall', position: 0), media(id: 'facade', type: 'exterior')],
      primaryUrl: 'https://cdn.example/facade/preview',
    );
    final byUrl = galleryPhotos(
      [media(id: 'hall', position: 0), media(id: 'facade', type: 'exterior')],
      primaryUrl: 'https://cdn.example/facade',
    );

    expect(ids(byPreview), ['facade', 'hall']);
    expect(ids(byUrl), ['facade', 'hall']);
  });

  test('флаг важнее совпадения адреса', () {
    final photos = galleryPhotos(
      [
        media(id: 'hall', position: 0),
        media(id: 'facade', type: 'exterior', position: 1),
        media(id: 'cover', position: 2, isPrimary: true),
      ],
      primaryUrl: 'https://cdn.example/facade',
    );

    expect(ids(photos).first, 'cover');
  });

  test('без обложки порядок сервера не меняется', () {
    final photos = galleryPhotos([
      media(id: 'a', position: 0),
      media(id: 'b', type: 'exterior', position: 1),
      media(id: 'c', type: 'dishes', position: 2),
    ]);

    expect(ids(photos), ['a', 'b', 'c']);
  });

  test('строка без единого адреса в галерею не идёт', () {
    final empty = EstablishmentMedia.fromJson(<String, dynamic>{
      'id': 'empty',
      'establishment_id': '11111111-1111-4111-8111-111111111111',
      'type': 'interior',
      'position': 1,
      'created_at': '2026-04-01T09:00:00.000Z',
    });

    expect(ids(galleryPhotos([media(id: 'hall'), empty])), ['hall']);
  });
}
