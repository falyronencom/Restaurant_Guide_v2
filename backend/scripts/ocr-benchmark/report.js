/**
 * Run artifacts — per model × photo JSON dumps + a Coordinator-facing
 * SUMMARY.md (Russian: the Coordinator is the reader, and the double-verify
 * step in BENCHMARK_BRIEF is their visual pass over these dumps).
 *
 * Layout under runs/<timestamp>/:
 *   manifest.json                     — run metadata (models, photos, flags)
 *   results.json                      — machine-readable aggregate
 *   dumps/<model-slug>/<unit-slug>.json  — full per-call dump incl. raw OCR text
 *   SUMMARY.md                        — side-by-side comparison + manual-notes section
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

/** Windows-safe path fragments. OpenRouter variant suffixes (:free, :nitro)
 *  carry a colon — reserved on Windows, so sanitize beyond the separators. */
const winReserved = /[<>:"|?*]/g;
export const slugModel = (id) => id.replace(/\//g, '--').replace(winReserved, '-');
export const slugUnit = (id) => id.replace(/[\\/]/g, '__').replace(winReserved, '-');

export function writeManifest(runDir, manifest) {
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

export function writeDump(runDir, result) {
  const dir = join(runDir, 'dumps', slugModel(result.model));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${slugUnit(result.unitId)}.json`), JSON.stringify(result, null, 2), 'utf8');
}

export function writeResults(runDir, results) {
  writeFileSync(join(runDir, 'results.json'), JSON.stringify(results, null, 2), 'utf8');
}

const fmtMs = (ms) => (ms == null ? '—' : `${Math.round(ms)}`);
const fmtCost = (usd) => (usd == null ? '—' : `$${usd.toFixed(4)}`);
const fmtPct = (num, den) => (den > 0 ? `${((num / den) * 100).toFixed(0)}%` : '—');
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

/** Aggregate one model's results into a summary row. Quality metrics run
 *  over error-free rows; tokens/cost run over ALL rows — spend on a unit
 *  that later errored is still real money. */
function aggregate(model, rows) {
  const ok = rows.filter((r) => !r.error);
  const errors = rows.length - ok.length;
  const itemsTotal = ok.reduce((a, r) => a + r.metrics.itemsCount, 0);
  const caution = ok.reduce((a, r) => a + r.metrics.needsCaution, 0);
  const empty = ok.filter((r) => r.metrics.itemsCount === 0).length;
  const parseFails = ok.filter((r) => !r.structurer.parseOk || !r.structurer.zodOk).length;
  const tokensIn = rows.reduce(
    (a, r) => a + (r.vision.usage?.prompt_tokens || 0) + (r.structurer.usage?.prompt_tokens || 0), 0,
  );
  const tokensOut = rows.reduce(
    (a, r) => a + (r.vision.usage?.completion_tokens || 0) + (r.structurer.usage?.completion_tokens || 0), 0,
  );
  const costKnown = rows.map((r) => r.metrics.costUsd).filter((c) => c != null);
  const cost = costKnown.length ? costKnown.reduce((a, b) => a + b, 0) : null;
  return {
    model,
    menus: ok.length,
    errors,
    itemsTotal,
    avgItems: ok.length ? (itemsTotal / ok.length).toFixed(1) : '—',
    empty,
    parseFails,
    cautionPct: fmtPct(caution, itemsTotal),
    tokensIn,
    tokensOut,
    cost,
    avgVisionMs: avg(ok.map((r) => r.vision.ms).filter((m) => m != null)),
    avgStructMs: avg(ok.map((r) => r.structurer.ms).filter((m) => m != null)),
  };
}

/**
 * Build SUMMARY.md.
 *
 * @param {object} meta - { startedAt, photoCount, sources, skippedModels, warnings }
 * @param {string[]} models - usable model ids, run order
 * @param {object[]} results - flat per unit × model result objects
 */
export function buildSummary(meta, models, results) {
  const byModel = new Map(models.map((m) => [m, results.filter((r) => r.model === m)]));
  const units = [...new Set(results.map((r) => r.unitId))];

  const lines = [];
  lines.push(`# OCR Benchmark — ${meta.startedAt}`);
  lines.push('');
  lines.push(`Фото: **${meta.photoCount}** (${meta.sources.join('; ')})`);
  lines.push(`Модели: ${models.map((m) => `\`${m}\``).join(', ')}`);
  if (meta.skippedModels.length) {
    lines.push(`Пропущены при верификации по каталогу: ${meta.skippedModels.map((s) => `\`${s.id}\` (${s.reason})`).join('; ')}`);
  }
  if (meta.warnings.length) {
    lines.push('');
    lines.push('Предупреждения обнаружения фото:');
    for (const w of meta.warnings) lines.push(`- ${w}`);
  }
  lines.push('');

  lines.push('## Сводка по моделям');
  lines.push('');
  lines.push('| Модель | Меню OK | Ошибки | Позиций всего | Ср. позиций/меню | Пустые | JSON-fail | needs_caution | Токены in/out | Стоимость | Ср. vision, мс | Ср. structurer, мс |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const model of models) {
    const a = aggregate(model, byModel.get(model));
    lines.push(
      `| \`${a.model}\` | ${a.menus} | ${a.errors} | ${a.itemsTotal} | ${a.avgItems} | ${a.empty} | ${a.parseFails} | ${a.cautionPct} | ${a.tokensIn}/${a.tokensOut} | ${fmtCost(a.cost)} | ${fmtMs(a.avgVisionMs)} | ${fmtMs(a.avgStructMs)} |`,
    );
  }
  lines.push('');

  lines.push('## Матрица: позиций на меню (⚠ = needs_caution)');
  lines.push('');
  lines.push(`| Меню | ${models.map((m) => `\`${m.split('/').pop()}\``).join(' | ')} |`);
  lines.push(`|---|${models.map(() => '---').join('|')}|`);
  for (const unit of units) {
    const cells = models.map((model) => {
      const r = byModel.get(model).find((x) => x.unitId === unit);
      if (!r) return '—';
      if (r.error) return 'ERR';
      const caution = r.metrics.needsCaution ? ` (⚠${r.metrics.needsCaution})` : '';
      return `${r.metrics.itemsCount}${caution}`;
    });
    lines.push(`| ${unit} | ${cells.join(' | ')} |`);
  }
  lines.push('');

  const errored = results.filter((r) => r.error);
  if (errored.length) {
    lines.push('## Ошибки');
    lines.push('');
    for (const r of errored) lines.push(`- \`${r.model}\` × ${r.unitId}: ${r.error}`);
    lines.push('');
  }

  lines.push('## Ручные пометки Координатора');
  lines.push('');
  lines.push('Авто-метрики галлюцинаций НЕ ловят (позиция может быть «валидной», но выдуманной).');
  lines.push('Для каждого меню откройте фото рядом с дампами `dumps/<модель>/<меню>.json` и сверьте:');
  lines.push('выдуманные позиции, перевранные цены, битую кириллицу, потерянные разделы.');
  lines.push('');
  lines.push('| Меню | Модель | Галлюцинации / цены / кириллица — заметки |');
  lines.push('|---|---|---|');
  for (const unit of units) {
    for (const model of models) {
      lines.push(`| ${unit} | \`${model.split('/').pop()}\` |  |`);
    }
  }
  lines.push('');

  lines.push('## Как выбирать (критерии из BENCHMARK_BRIEF)');
  lines.push('');
  lines.push('**accuracy > hallucination-rate > cost/speed** — точность извлечения важнее');
  lines.push('доли галлюцинаций, та важнее стоимости и скорости. Победитель → `AI_OCR_MODEL`');
  lines.push('в Railway backend env → redeploy → пилот-импорт дренируется уже выбранной моделью.');
  lines.push('');

  return lines.join('\n');
}

export function writeSummary(runDir, summaryMd) {
  writeFileSync(join(runDir, 'SUMMARY.md'), summaryMd, 'utf8');
}
