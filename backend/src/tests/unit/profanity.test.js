/* eslint-env jest */
/**
 * utils/profanity.js — the ways round a word list it holds, and the ordinary
 * words it must leave alone (decision of the Coordinator 17.10.2026, В8; the
 * tester's walkthrough 17.10: «обход через символы и сочетания»).
 *
 * The clean side is two sets: words that carry a dangerous piece inside
 * («страхуй», «оскорблять», «команда», «shiitake», «Slutsk»), and every string
 * literal of the seed data and test fixtures in this repository — reviews,
 * establishment names and descriptions, user names.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { containsProfanity } from '../../utils/profanity.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '../../..');

describe('containsProfanity — the words and the ways round', () => {
  test.each([
    // plain, Russian and Belarusian
    ['хуй'], ['нахуй'], ['похуй'], ['хуйня'], ['нихуя'], ['охуеть'], ['пиздец'], ['распиздяй'],
    ['ебать'], ['заебал'], ['уёбок'], ['ёбаный'], ['долбоёб'], ['въебать'], ['съебался'],
    ['бля'], ['блядь'], ['блять'], ['выблядок'], ['мудак'], ['мудила'], ['манда'], ['залупа'],
    ['пидор'], ['педераст'], ['сука'], ['сукин'], ['шлюха'], ['гандон'],
    ['пізда'], ['бляць'], ['ебаць'],
    // characters and spaces between the letters
    ['х.у.й'], ['х-у-й'], ['х_у_й'], ["х'у'й"], ['х у й'], ['х . у . й'], ['ху й'], ['п и з д е ц'],
    ['по х у й'], ['е б а т ь'],
    // look-alike Latin letters, digits, mixed alphabets
    ['xyй'], ['XYЙ'], ['cyka'], ['CYKA'], ['3ае6ал'], ['пи3дец'], ['nизда'], ['ебaть'], ['6ля'],
    // transliteration
    ['pizda'], ['pizdec'], ['nahuy'], ['blyat'], ['blyad'], ['suka'], ['ebat'], ['zaebal'], ['mudak'],
    ['pidor'], ['pi3da'],
    // stretched letters, case
    ['хуууууй'], ['ПИИИЗДЕЦ'], ['Бляяяя'], ['сууука'],
    // invisible, combining, full-width
    ['х\u200bу\u200bй'], ['х\u00adуй'], ['х\u0301у\u0301й'], ['ｘｙй'],
    // punctuation around
    ['бля!'], ['сука!!!'], ['(ебать)'], ['«пиздец»'],
    // English
    ['fuck'], ['FUCKING'], ['fuuuck'], ['f.u.c.k'], ['f u c k'], ['shit'], ['bullshit'], ['cunt'],
    ['bitch'], ['asshole'], ['whore'], ['slut'], ['motherfucker'], ['wanker'], ['dickhead'],
    ['shіt'],
  ])('catches %s', (text) => {
    expect(containsProfanity(text)).toBe(true);
  });

  test('catches a word inside a sentence', () => {
    expect(containsProfanity('Еда норм, но персонал х.у.й знает что')).toBe(true);
    expect(containsProfanity('Официант, мягко говоря, мудак.')).toBe(true);
  });

  test.each([
    // хуй-, хуе-
    ['страхуй'], ['застрахуйте'], ['перестрахуйся'], ['психуй'], ['страхует'], ['психует'],
    ['тихую'], ['сухую'], ['плохую'], ['глухую'], ['лихую'], ['хулиган'], ['худой'], ['хутор'],
    ['Хуан'], ['хуткі'], ['хуценька'],
    // еб-
    ['небо'], ['хлеб'], ['хлебать'], ['себе'], ['тебе'], ['ребёнок'], ['учебник'], ['требовать'],
    ['колебаться'], ['колеблется'], ['погребок'], ['серебро'], ['гребень'], ['служебный'],
    ['волшебный'], ['лечебный'], ['потребитель'], ['веб-сайт'], ['веб'], ['небяспека'], ['хлебны'],
    // бля-
    ['оскорблять'], ['употреблять'], ['употребление'], ['корабля'], ['рубля'], ['сабля'],
    ['стебля'], ['бляха'], ['бляшка'], ['бляск'], ['истреблять'], ['колебля'],
    // муд-, манд-, пид-, пед-
    ['мудрый'], ['премудрость'], ['команда'], ['командир'], ['мандарин'], ['мандат'],
    ['скипидар'], ['педаль'], ['педикюр'], ['педагог'], ['Педро'],
    // сук-, шлю-, гон-
    ['сукно'], ['сук'], ['суккулент'], ['шлюз'], ['гондола'], ['гонщик'],
    // whole words of a sentence that join when short
    ['в т. ч.'], ['и т. д.'], ['не бы'], ['я и ты'],
    // English and Latin
    ['shiitake'], ['shitake'], ['Scunthorpe'], ['Slutsk'], ['Slutski'], ['Loshitsa'],
    ['https://hit.relax.by/'], ['https://ikk-loshitski.relax.by/'], ['cocktail'], ['class'],
    ['assassin'], ['Dickens'], ['ebay'], ['ebook'], ['Ebony'], ['Ebola'], ['Hui'], ['Huynh'],
    ['Huey'], ['Moxy'], ['Roxy'], ['proxy'], ['taxi'], ['pizza'], ['Pizzeria'], ['Niger'],
    ['Sukiyaki'], ['Fukuoka'], ['therapist'], ['analysis'], ['Matsuhisa'], ['shih tzu'],
    // a review as people write them
    ['Отличное место! Хлеб свежий, небо чистое, официант Педро — молодец.'],
    ['Застрахуйте себе столик заранее: в пятницу тихую комнату не найти.'],
    ['Суп с шиитаке (shiitake), коктейль «Slutsk Sour», сабля в интерьере.'],
  ])('leaves %s alone', (text) => {
    expect(containsProfanity(text)).toBe(false);
  });

  test('anything but a string is clean', () => {
    expect(containsProfanity(undefined)).toBe(false);
    expect(containsProfanity(null)).toBe(false);
    expect(containsProfanity(42)).toBe(false);
    expect(containsProfanity('')).toBe(false);
  });
});

/**
 * Every quoted string of the files that hold this repository's sample texts.
 * This file and the vocabulary are not among them; the integration test of
 * the refusals is left out for the same reason (it carries the obscene side).
 */
const CORPUS_FILES = [
  'scripts/seed-data/reviews-config.js',
  'scripts/seed-data/content-templates.js',
  'scripts/seed-data/establishments-config.js',
  'src/tests/fixtures/reviews.js',
  'src/tests/fixtures/establishments.js',
  'src/tests/fixtures/users.js',
  'src/tests/fixtures/coordinates.js',
];

function stringLiterals(source) {
  const found = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const text = m[1] ?? m[2] ?? m[3];
    if (/\p{L}{2,}/u.test(text)) found.push(text);
  }
  return found;
}

describe('containsProfanity — the sample texts of this repository', () => {
  const corpus = CORPUS_FILES.flatMap((file) => (
    stringLiterals(fs.readFileSync(path.join(backendRoot, file), 'utf8'))
      .map((text) => ({ file, text }))
  ));

  test('the corpus is not empty', () => {
    expect(corpus.length).toBeGreaterThan(300);
  });

  test('no sample text reads as мат', () => {
    expect(corpus.filter(({ text }) => containsProfanity(text))).toEqual([]);
  });
});
