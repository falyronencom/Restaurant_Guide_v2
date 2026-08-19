import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/widgets/media/media_viewer.dart';

// Просмотрщик медиа. Проверяется то, ради чего он появился: модератор должен
// добраться до полноразмерного снимка и уметь ходить между снимками, а PDF
// должен вести себя как PDF, а не как битая картинка.

MediaItem _image(String name) => MediaItem(
      id: name,
      url: 'https://example.test/$name-full',
      thumbnailUrl: 'https://example.test/$name-thumb',
      previewUrl: 'https://example.test/$name-preview',
    );

MediaItem _pdf(String name) => MediaItem(
      id: name,
      url: 'https://example.test/$name.pdf',
      thumbnailUrl: 'https://example.test/$name-thumb',
      previewUrl: 'https://example.test/$name-page1',
      fileType: 'pdf',
    );

void main() {
  Future<void> pumpViewer(
    WidgetTester tester,
    List<MediaItem> items, {
    String title = 'Фото',
    int initialIndex = 0,
  }) async {
    tester.view.physicalSize = const Size(1180, 820);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.lightTheme,
        home: MediaViewer(
          items: items,
          title: title,
          initialIndex: initialIndex,
        ),
      ),
    );
    await tester.pump();
  }

  group('MediaItem', () {
    test('картинка показывается оригиналом', () {
      expect(_image('a').viewableUrl, 'https://example.test/a-full');
      expect(_image('a').isPdf, isFalse);
    });

    test('PDF показывается растром первой страницы, а не самим файлом', () {
      final pdf = _pdf('menu');
      expect(pdf.isPdf, isTrue);
      // Оригинал остаётся доступен отдельным действием.
      expect(pdf.url, endsWith('.pdf'));
      expect(pdf.viewableUrl, 'https://example.test/menu-page1');
    });

    test('без preview PDF откатывается на миниатюру, но не на сам файл', () {
      const pdf = MediaItem(
        url: 'https://example.test/x.pdf',
        thumbnailUrl: 'https://example.test/x-thumb',
        fileType: 'pdf',
      );
      expect(pdf.viewableUrl, 'https://example.test/x-thumb');
    });

    test('проекция без file_type трактуется как картинка', () {
      final item = MediaItem.fromJson(const {
        'id': 'a',
        'url': 'https://example.test/a',
      });
      expect(item.isPdf, isFalse);
      expect(item.viewableUrl, 'https://example.test/a');
    });

    test('разбирает новые поля проекции', () {
      final item = MediaItem.fromJson(const {
        'id': 'm',
        'url': 'https://example.test/m.pdf',
        'thumbnail_url': 'https://example.test/m-t',
        'preview_url': 'https://example.test/m-p',
        'file_type': 'pdf',
      });
      expect(item.previewUrl, 'https://example.test/m-p');
      expect(item.isPdf, isTrue);
    });
  });

  group('MediaViewer', () {
    testWidgets('показывает раздел и позицию в наборе', (tester) async {
      await pumpViewer(
        tester,
        [_image('a'), _image('b'), _image('c')],
        title: 'Меню',
      );

      expect(find.text('Меню'), findsOneWidget);
      expect(find.text('1 из 3'), findsOneWidget);
    });

    testWidgets('стрелка вперёд листает набор', (tester) async {
      await pumpViewer(tester, [_image('a'), _image('b'), _image('c')]);

      await tester.tap(find.byIcon(Icons.chevron_right));
      await tester.pump();
      expect(find.text('2 из 3'), findsOneWidget);

      await tester.tap(find.byIcon(Icons.chevron_left));
      await tester.pump();
      expect(find.text('1 из 3'), findsOneWidget);
    });

    testWidgets('на краях набора соответствующей стрелки нет', (tester) async {
      await pumpViewer(tester, [_image('a'), _image('b')]);

      // Первый снимок — назад некуда.
      expect(find.byIcon(Icons.chevron_left), findsNothing);
      expect(find.byIcon(Icons.chevron_right), findsOneWidget);

      await tester.tap(find.byIcon(Icons.chevron_right));
      await tester.pump();

      expect(find.byIcon(Icons.chevron_left), findsOneWidget);
      expect(find.byIcon(Icons.chevron_right), findsNothing);
    });

    testWidgets('единственный снимок листать нечем', (tester) async {
      await pumpViewer(tester, [_image('only')]);

      expect(find.byIcon(Icons.chevron_left), findsNothing);
      expect(find.byIcon(Icons.chevron_right), findsNothing);
      expect(find.text('1 из 1'), findsOneWidget);
    });

    testWidgets('открывается сразу на выбранном снимке', (tester) async {
      await pumpViewer(
        tester,
        [_image('a'), _image('b'), _image('c')],
        initialIndex: 2,
      );

      expect(find.text('3 из 3'), findsOneWidget);
    });

    testWidgets('PDF помечен и предлагает открыть файл, а не «оригинал»',
        (tester) async {
      await pumpViewer(tester, [_pdf('menu')], title: 'Меню');

      expect(find.text('PDF — показана первая страница'), findsOneWidget);
      expect(find.text('Открыть PDF'), findsOneWidget);
      expect(find.text('Открыть оригинал'), findsNothing);
    });

    testWidgets('у картинки пометки PDF нет', (tester) async {
      await pumpViewer(tester, [_image('a')]);

      expect(find.text('PDF — показана первая страница'), findsNothing);
      expect(find.text('Открыть оригинал'), findsOneWidget);
    });

    testWidgets('масштабирование доступно и сбрасывается при перелистывании',
        (tester) async {
      await pumpViewer(tester, [_image('a'), _image('b')]);

      final viewer = tester.widget<InteractiveViewer>(
        find.byType(InteractiveViewer),
      );
      final controller = viewer.transformationController!;
      expect(controller.value.getMaxScaleOnAxis(), 1);

      // Двойное нажатие приближает к точке.
      await tester.tapAt(const Offset(500, 400));
      await tester.pump(const Duration(milliseconds: 50));
      await tester.tapAt(const Offset(500, 400));
      // Распознаватель двойного нажатия держит таймер ожидания третьего
      // нажатия — без этого кадра он останется висеть к концу теста.
      await tester.pump(const Duration(milliseconds: 500));
      expect(controller.value.getMaxScaleOnAxis(), greaterThan(1));

      // Соседний снимок начинается с исходного масштаба: увеличенный угол
      // предыдущего кадра на новом означает совсем другое место.
      await tester.tap(find.byIcon(Icons.chevron_right));
      await tester.pump();
      expect(controller.value.getMaxScaleOnAxis(), 1);
    });
  });
}
