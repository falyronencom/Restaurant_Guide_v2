/**
 * Word guard: the site's texts say «учётная запись», never «аккаунт» or
 * «учётка» (Coordinator, 29.10.2026). The last pass over the words missed one
 * capitalised «Аккаунт» in the app — the search did not see the capital
 * letter; this guard looks for both cases. Mirror of the app's guard
 * (mobile/test/config/account_word_guard_test.dart).
 *
 * It reads quoted strings and JSX text in src/ — what can reach a screen.
 * Comments are not text for a person. The page address /udalenie-uchetki is
 * a URL, not a word, and is written in Latin letters.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..', 'src');
const WORD = /[Аа]ккаунт|[Уу]чётк/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

it('no «аккаунт» or «учётка» in the site texts', () => {
  const found: string[] = [];
  const scanned = files(SRC);
  for (const file of scanned) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((raw, i) => {
        const line = raw.trimStart();
        if (/^(\/\/|\*|\/\*|\{\/\*)/.test(line)) return;
        // Drop a trailing `// …` comment; a URL's `//` sits inside quotes.
        const code = line.replace(/\s\/\/\s.*$/, '');
        if (WORD.test(code)) found.push(`${file}:${i + 1}: ${line.trim()}`);
      });
  }
  // A scan that read nothing would pass with the word in place.
  expect(scanned.length).toBeGreaterThan(100);
  expect(found).toEqual([]);
});
