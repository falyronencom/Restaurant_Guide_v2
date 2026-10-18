import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';
import 'package:restaurant_guide_mobile/providers/partner_registration_provider.dart';
import 'package:restaurant_guide_mobile/services/partner_service.dart';

import '../support/wire_stand.dart';

/// PDF-меню при правке карточки из кабинета партнёра в приложении.
///
/// До 18.10.2026 правка слала добавленный PDF полем `menu_pdfs`, а сервер на
/// правке читает только `menu_photos`: файл загружался в облако, партнёр
/// видел «PDF меню загружено», а к карточке он не прикладывался. Уже
/// приложенные PDF правка показывала в сетке фото меню, а не в списке PDF.
///
/// Сервер здесь — маленькая модель production (`establishmentService.js`):
/// карточка партнёра (GET) отдаёт всю корзину «меню» одним списком ссылок
/// `menu_photos`; правка (PUT) приводит корзину к присланному `menu_photos` —
/// удаляет ссылки, которых в списке нет, добавляет новые; поле `menu_pdfs`
/// на правке не читает; PDF узнаёт по `.pdf` в конце ссылки. Без
/// `menu_photos` в теле корзину не трогает. Провайдер, сервис и `ApiClient`
/// исполняются целиком: подменён только транспорт.
const _id = '11111111-2222-3333-4444-555555555555';
const _card = '/api/v1/partner/establishments/$_id';

const _cloud = 'https://res.cloudinary.com/demo/image/upload';
const _menuPhoto = '$_cloud/v1/establishments/temp/u1/menu/b';
const _cover = '$_cloud/v1/establishments/temp/u1/interior/a';
const _oldPdf = '$_cloud/v1/establishments/temp/u1/menu_pdf/old.pdf';
const _newPdfUrl = '$_cloud/v2/establishments/temp/u1/menu_pdf/new.pdf';

/// Ответ загрузки PDF (`POST /partner/media/upload`), как его собирает экран
/// шага «Медиа».
const _newPdf = MenuPdf(
  url: _newPdfUrl,
  thumbnailUrl: '$_cloud/c_fill,h_300,pg_1,w_400/f_jpg,q_auto/v2/'
      'establishments/temp/u1/menu_pdf/new.jpg',
  previewUrl: '$_cloud/c_limit,pg_1,w_1200/f_jpg,q_auto/v2/'
      'establishments/temp/u1/menu_pdf/new.jpg',
  fileName: 'Меню лето.pdf',
);

void main() {
  // Корзина «меню» карточки на сервере.
  late List<String> menu;
  late StubAdapter wire;

  Map<String, dynamic> cardJson() => {
        'id': _id,
        'name': 'Кофейня у моста',
        'status': 'active',
        'categories': ['Кофейня'],
        'cuisines': ['Европейская'],
        'city': 'Минск',
        'address': 'Немига, 1',
        'latitude': '53.9',
        'longitude': '27.55',
        'price_range': r'$$',
        'primary_photo': {'url': _cover, 'thumbnail_url': _cover},
        'interior_photos': [_cover],
        'menu_photos': List<String>.from(menu),
        'created_at': '2026-10-01T10:00:00.000Z',
        'updated_at': '2026-10-01T10:00:00.000Z',
      };

  ResponseBody serve(RequestOptions o) {
    if (o.method == 'GET' && o.path == _card) {
      return jsonBody({
        'success': true,
        'data': {'establishment': cardJson()},
      });
    }
    if (o.method == 'PUT' && o.path == _card) {
      final body = o.data as Map<String, dynamic>;
      final incoming = body['menu_photos'];
      if (incoming is List) menu = incoming.cast<String>().toList();
      return jsonBody({
        'success': true,
        'data': {'establishment': cardJson()},
      });
    }
    throw StateError('неожиданный запрос: ${o.method} ${o.path}');
  }

  setUp(() {
    menu = [_menuPhoto, _oldPdf];
    wire = installWireStand(serve);
  });

  /// Партнёр открывает правку раздела «Медиа», как экран кабинета: карточку
  /// берёт с сервера.
  Future<PartnerRegistrationProvider> openMediaEdit() async {
    final card = await PartnerService().getEstablishmentDetails(_id);
    final p = PartnerRegistrationProvider(
      editMode: true,
      establishmentId: _id,
      initialStep: 3,
      initialData: PartnerRegistrationProvider.dataFromEstablishment(card),
    );
    addTearDown(p.dispose);
    return p;
  }

  Map<String, dynamic> lastPut() => wire.requests
      .lastWhere((o) => o.method == 'PUT')
      .data as Map<String, dynamic>;

  test('добавленный при правке PDF прикладывается к карточке и виден при '
      'повторном открытии', () async {
    final p = await openMediaEdit();
    p.addMenuPdf(_newPdf);

    expect(await p.saveChanges(), isTrue);

    final body = lastPut();
    expect(body['menu_photos'], [_menuPhoto, _oldPdf, _newPdfUrl]);
    expect(body.containsKey('menu_pdfs'), isFalse,
        reason: 'поле только создания; правка его не читает');
    expect(menu, [_menuPhoto, _oldPdf, _newPdfUrl]);

    final again = await openMediaEdit();
    expect(again.data.menuPdfs.map((pdf) => pdf.url), [_oldPdf, _newPdfUrl]);
    expect(again.data.menuPhotos, [_menuPhoto]);
  });

  test('удалённый при правке PDF уходит с карточки, фото меню остаётся',
      () async {
    final p = await openMediaEdit();
    p.removeMenuPdf(_oldPdf);

    expect(await p.saveChanges(), isTrue);

    expect(lastPut()['menu_photos'], [_menuPhoto]);
    expect(menu, [_menuPhoto]);
  });

  test('правка другого раздела не теряет PDF карточки', () async {
    final p = await openMediaEdit();
    p.updateBasicInfo(name: 'Кофейня у реки');

    expect(await p.saveChanges(), isTrue);

    expect(lastPut()['name'], 'Кофейня у реки');
    expect(menu, [_menuPhoto, _oldPdf]);
  });

  test('приложенный PDF открывается плиткой PDF с первой страницей, а не '
      'картинкой в сетке фото', () async {
    final p = await openMediaEdit();

    expect(p.data.menuPhotos, [_menuPhoto]);
    final pdf = p.data.menuPdfs.single;
    expect(pdf.url, _oldPdf);
    expect(pdf.fileName, 'PDF-меню');
    expect(
      pdf.thumbnailUrl,
      '$_cloud/c_fill,h_300,pg_1,w_400/f_jpg,q_auto/v1/'
      'establishments/temp/u1/menu_pdf/old.jpg',
    );
  });

  test('карточку, у которой меню — только PDF, правка раздела «Медиа» '
      'сохраняет', () async {
    menu = [_oldPdf];
    final p = await openMediaEdit();

    expect(p.canProceed(), isTrue);
    expect(await p.saveChanges(), isTrue);
    expect(menu, [_oldPdf]);
  });

  test('ссылка не из облака: плитка без картинки первой страницы', () {
    final pdf = MenuPdf.fromCardLink('https://example.com/menu.pdf',
        label: 'PDF-меню');

    expect(pdf.thumbnailUrl, isEmpty);
    expect(MenuPdf.isPdfLink('$_cloud/v1/x/menu.PDF?x=1'), isTrue);
    expect(MenuPdf.isPdfLink(_menuPhoto), isFalse);
  });
}
