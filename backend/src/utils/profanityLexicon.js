/**
 * The obscene vocabulary the server refuses in a user's name, a review and an
 * owner's reply (decision of the Coordinator, 17.10.2026, В8). Read only by
 * utils/profanity.js; it never leaves the server — no client receives it.
 *
 * Composed for this project, not copied from a published list: Russian and
 * Belarusian мат (the four roots and their derivatives) with a few of the
 * strongest insults, and English obscenities. Rude words that are not мат
 * («жопа», «хрен», «говно») are deliberately absent: a review may be rude.
 *
 * Every pattern is matched against one word as utils/profanity.js prepares it:
 * lowercase, look-alike Latin letters and digits turned into Cyrillic (or the
 * other way round for the English list), punctuation inside the word dropped,
 * ё → е, і → и, ў → у. Every letter carries `+`, so a stretched «хууууй» is the
 * same word. The guards (^ and $, the lookarounds) are what keeps ordinary
 * words clean: «страхуй», «психуй», «тихую», «сухую», «небо», «хлебать»,
 * «оскорблять», «корабля», «сабля», «бляха», «бляск» (бел.), «команда»,
 * «мандарин», «мудрый», «педикюр», «скипидар», «гондола», «shiitake», «Scunthorpe»,
 * «Slutsk» — tests/unit/profanity.test.js holds them.
 *
 * `latin: false` — not applied to a word written in Latin letters only: read
 * through the look-alike table, an English word may begin like «еб» («ebay»,
 * «ebook»). Such a word is still read as transliteration, by `translit`.
 */

/** Prefixes before «еб» and «хуе/хуя/хую/хуи» that make no ordinary word. */
const EB_PREFIX = '(?:вы|до|за|зъ|зь|на|недо|ни|о|об|объ|отъ|от|пере|подъ|под|по|при|про|разъ|раз|рас|съ|сь|въ|у|долбо|мозго|зло)';
const HU_PREFIX = '(?:а|о|на|ни|до|за|от|об|вы|рас|раз|при|про|по|под|пере|у)';

/** Russian and Belarusian, matched against the Cyrillic reading of a word. */
export const CYRILLIC_PATTERNS = [
  // хуй and every word built on it, but not «страхуй», «психуй».
  { id: 'ru-h1', re: /(?<!с+т+р+а+|п+с+и+)х+у+й+/u },
  // хуе-, хуя-, хую-, хуи- only at the start or after a prefix: «тихую»,
  // «сухую», «плохую», «страхует», «психует» are ordinary words.
  { id: 'ru-h2', re: new RegExp(`^${HU_PREFIX}?х+у+[еияю]+`, 'u') },
  { id: 'ru-p1', re: /п+и+з+д+/u },
  // еб- at the start or after a prefix: «небо», «хлебать», «себе», «веб».
  { id: 'ru-e1', re: new RegExp(`^${EB_PREFIX}?е+б+`, 'u'), latin: false },
  // бля- at the start or after a prefix: «корабля», «оскорблять»; not
  // «бляха», «бляшка», бел. «бляск».
  { id: 'ru-b1', re: /^(?:вы|за|на|от|по|раз|у)?б+л+я+(?![яхшс])/u, latin: false },
  { id: 'ru-m1', re: /м+у+д+(?:а+[кч]+|и+л+|о+з+в+о+н+|о+е+б+|о+х+)/u },
  { id: 'ru-m2', re: /^м+а+н+д+(?:а+|ы+|е+|у+|о+й+|о+ю+|а+в+о+ш+к+\p{L}*)$/u },
  { id: 'ru-z1', re: /з+а+л+у+п+/u },
  { id: 'ru-g1', re: /г+[ао]+н+д+[оа]+н+/u },
  { id: 'ru-pd1', re: /(?<!с+к+и+)п+[иеё]+д+[оа]+р+|п+и+д+р+|п+е+д+е+р+а+с+т+|п+е+д+р+и+л+/u },
  { id: 'ru-pd2', re: /^п+е+д+и+к+(?:и+|а+|у+|о+м+|о+в+|а+м+|а+м+и+)?$/u },
  { id: 'ru-s1', re: /^с+у+к+(?:а+|и+|е+|у+|о+й+|о+ю+|а+м+|а+м+и+|а+х+|и+н+\p{L}*)$/u },
  { id: 'ru-sh1', re: /ш+л+ю+х+/u },
];

/**
 * The same words spelt in Latin letters as sounds («pizda», «blyat», «nahuy»),
 * matched against the Cyrillic transliteration of a word that has Latin
 * letters. Narrower than the list above: transliterated English words begin
 * with «еб» («ebay» → «ебай»), and Chinese and Vietnamese names begin with
 * «ху» («Hui», «Huynh»).
 */
export const TRANSLIT_PATTERNS = [
  { id: 'tr-h1', re: /^(?:на|по|ни|до|за)?х+у+й+(?:н+я+)?$/u },
  { id: 'tr-h2', re: /^(?:на|ни|по|до)х+у+[ияе]+$/u },
  { id: 'tr-p1', re: /п+и+з+д+/u },
  { id: 'tr-b1', re: /^(?:вы)?б+л+я+(?:[дт]+|$)/u },
  { id: 'tr-e1', re: new RegExp(`^${EB_PREFIX}?е+б+(?:а+[тлнш]+|л+[аои]+|н+у+|у+ч+|и+с+ь*)`, 'u') },
  { id: 'tr-m1', re: /м+у+д+а+[кч]+/u },
  { id: 'tr-pd1', re: /п+и+д+[оа]+р+/u },
  { id: 'tr-s1', re: /^с+у+к+а+$/u },
];

/** English, matched against the Latin reading of a word that has Latin letters. */
export const LATIN_PATTERNS = [
  { id: 'en-f1', re: /f+u+c+k+/u },
  // at the start of a word only: «Loshitsa» (Лошица), a link «https://hit…»;
  // not «shiitake», «shitake»
  { id: 'en-s1', re: /^(?:bull|horse|dip|holy|bat)?s+h+i+t+(?!a+k+e+|t+a+k+e+)/u },
  // not «Scunthorpe»
  { id: 'en-c1', re: /(?<!s+)c+u+n+t+/u },
  { id: 'en-b1', re: /b+i+t+c+h+/u },
  { id: 'en-a1', re: /a+s{2,}h+o+l+e+/u },
  { id: 'en-w1', re: /w+h+o+r+e+/u },
  // whole word only: «Slutsk» is a Belarusian town
  { id: 'en-sl1', re: /^s+l+u+t+(?:s+|t+y+)?$/u },
  { id: 'en-n1', re: /n+i+g{2,}(?:e+r+|a+)/u },
  { id: 'en-wk1', re: /w+a+n+k+e+r+/u },
  { id: 'en-ck1', re: /c+o+c+k+s+u+c+k+/u },
  { id: 'en-d1', re: /d+i+c+k+h+e+a+d+/u },
];
