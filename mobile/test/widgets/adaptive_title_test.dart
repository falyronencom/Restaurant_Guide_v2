import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/widgets/adaptive_title.dart';
import 'package:restaurant_guide_mobile/widgets/establishment_card.dart';

/// Название заведения не рвётся посередине слова.
///
/// Найдено 21.09.2026 на iPhone mini (375 dp): «МонеМане» в карточке списка
/// рисовалась как «МонеМан / е», хотя `AdaptiveTitle` для того и заведён.
/// Причина — замер и отрисовка расходились: `Text` сливает стиль с
/// `DefaultTextStyle` экрана, а тема приложения приносит туда межбуквенный
/// интервал 0.1. Слово мерилось в 104.92 dp при колонке 105, рисовалось в
/// 105.72. На A72 (колонка 114) запаса хватало, и дефект выглядел закрытым.
///
/// **Всё здесь меряется настоящим шрифтом.** По умолчанию `flutter test`
/// рисует квадратным подстановочным шрифтом, и у него свои ширины: промах в
/// 0.8 dp на нём не воспроизводится вовсе. Onest SemiBold грузится из вшитого
/// ассета под тем же именем семейства, что даёт `GoogleFonts.onest(w600)`.
void main() {
  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    GoogleFonts.config.allowRuntimeFetching = false;
    await _loadOnest(AppTheme.canonCardTitle.fontFamily!);
  });

  group('карточка списка на разных ширинах экрана', () {
    testWidgets('iPhone mini: «МонеМане» не рвётся по буквам', (tester) async {
      await _pumpCard(tester, name: 'МонеМане', screenWidth: 375);

      _expectBreaksOnlyAtSpaces(tester, find.text('МонеМане'));
    });

    testWidgets('ни одно название не рвётся посередине ни на одной ширине',
        (tester) async {
      const names = <String>[
        'МонеМане',
        'Осмоловка',
        'MARKS',
        'Le Pigeon',
        'Bull&Roo',
        'Васильки',
        'Zalkind Kitchen',
        'МонеМане Кафе',
      ];
      const widths = <double>[360, 375, 384, 390, 393, 411, 430];

      for (final width in widths) {
        for (final name in names) {
          await _pumpCard(tester, name: name, screenWidth: width);
          _expectBreaksOnlyAtSpaces(tester, find.text(name),
              where: '$name на $width dp');
        }
      }
    });
  });

  group('AdaptiveTitle', () {
    testWidgets('пересчитывает кегль, когда догрузился шрифт', (tester) async {
      // Семейство, которого ещё нет: первый замер идёт подстановочным
      // шрифтом — ровно как на холодном старте, пока google_fonts поднимает
      // вшитый шрифт.
      const style = TextStyle(
        fontFamily: 'OnestLateLoad',
        fontFamilyFallback: <String>[],
        fontSize: 20,
        fontWeight: FontWeight.w600,
      );
      Widget title() => const MaterialApp(
            home: Scaffold(
              body: Center(
                child: SizedBox(
                  width: 105,
                  child: AdaptiveTitle(
                    text: 'МонеМане',
                    style: style,
                    minFontSize: 15,
                  ),
                ),
              ),
            ),
          );

      await tester.pumpWidget(title());
      final beforeLoad = _chosenSize(tester, 'МонеМане');

      await tester.runAsync(() => _loadOnest('OnestLateLoad'));
      await tester.pump();
      await tester.pump();
      final afterLoad = _chosenSize(tester, 'МонеМане');

      // Эталон — то, что виджет решает, когда шрифт есть с самого начала.
      await tester.pumpWidget(const SizedBox());
      await tester.pumpWidget(title());
      final withFontFromStart = _chosenSize(tester, 'МонеМане');

      expect(beforeLoad, isNot(withFontFromStart),
          reason: 'иначе проверка ниже ничего не различает: подстановочный '
              'шрифт обязан давать другое решение');
      expect(afterLoad, withFontFromStart,
          reason: 'абзац после загрузки шрифта перекладывается сам, а решение '
              'о кегле — только если его пересчитать');
    });

    testWidgets('на минимальном кегле — одна строка с многоточием, не разрыв',
        (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Center(
              child: SizedBox(
                width: 90,
                child: AdaptiveTitle(
                  text: 'Достопримечательность',
                  style: AppTheme.canonCardTitle,
                  minFontSize: 15,
                ),
              ),
            ),
          ),
        ),
      );

      final para = tester.renderObject<RenderParagraph>(
          find.text('Достопримечательность'));

      expect(para.maxLines, 1,
          reason: 'при двух строках слово, не влезающее в ширину, рвётся по '
              'буквам на вторую — многоточие Flutter ставит только на '
              'последней строке');
      expect(para.didExceedMaxLines, isTrue,
          reason: 'слово не влезает и на полу — значит, обрезано многоточием');
    });
  });
}

Future<void> _loadOnest(String family) async {
  final loader = FontLoader(family)
    ..addFont(rootBundle.load('google_fonts/Onest-SemiBold.ttf'));
  await loader.load();
}

Establishment _establishment(String name) => Establishment(
      id: 'e1',
      name: name,
      category: 'restaurant',
      cuisine: 'Европейская',
      priceRange: r'$$',
      rating: 0,
      address: 'проспект Независимости, 18',
      city: 'Минск',
      status: 'active',
      createdAt: DateTime(2026, 1, 1),
      updatedAt: DateTime(2026, 1, 1),
    );

/// Карточка ровно в той геометрии, что на экране результатов: `SliverList`
/// без внешних полей, поля у карточки собственные.
Future<void> _pumpCard(
  WidgetTester tester, {
  required String name,
  required double screenWidth,
}) async {
  tester.view.devicePixelRatio = 1.0;
  tester.view.physicalSize = Size(screenWidth, 812);
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.lightTheme,
      home: Scaffold(
        body: ListView(
          padding: EdgeInsets.zero,
          children: [EstablishmentCard(establishment: _establishment(name))],
        ),
      ),
    ),
  );
  await tester.pump();
}

double _chosenSize(WidgetTester tester, String text) =>
    tester.widget<Text>(find.text(text)).style!.fontSize!;

/// Разрывы строк отрисованного абзаца стоят только у пробелов.
///
/// Проверка не повторяет логику [AdaptiveTitle]: абзац перекладывается заново
/// тем же текстом, слитым стилем, масштабом и шириной, что и на экране, и
/// каждый разрыв строки обязан соседствовать с пробелом. Так ловится разрыв по
/// буквам, откуда бы он ни взялся.
void _expectBreaksOnlyAtSpaces(
  WidgetTester tester,
  Finder finder, {
  String? where,
}) {
  final para = tester.renderObject<RenderParagraph>(finder);
  // Одна строка разорваться посередине не может; обрезка многоточием на полу
  // кегля — задуманное поведение.
  if (para.maxLines == 1) return;

  final text = para.text.toPlainText();
  final painter = TextPainter(
    text: para.text,
    textDirection: TextDirection.ltr,
    textScaler: para.textScaler,
    maxLines: para.maxLines,
    ellipsis: para.overflow == TextOverflow.ellipsis ? '…' : null,
  )..layout(maxWidth: para.constraints.maxWidth);
  try {
    var offset = 0;
    while (true) {
      final line = painter.getLineBoundary(TextPosition(offset: offset));
      if (line.end >= text.length || line.end <= offset) break;
      final before = text[line.end - 1];
      final after = text[line.end];
      expect(before == ' ' || after == ' ', isTrue,
          reason: 'разрыв внутри слова${where == null ? '' : ' ($where)'}: '
              '«${text.substring(0, line.end)} | ${text.substring(line.end)}»');
      offset = line.end;
    }
  } finally {
    painter.dispose();
  }
}
