/**
 * Which files of the card wizard leave the cloud — the plan half of the
 * clean-up of the thread «Фото людей», step 1 (DISCOVERY 09.11.2026, finding 2;
 * docs/handoffs/ugc_moderation_step1_20261110/DIRECTIVE.md §2 п. 9). Pure
 * functions: no network, no database. The operator's list
 * (scripts/media-orphans-audit.js --sweep) and the server's loop
 * (src/services/mediaOrphanSweepLoop.js) both decide by this one plan.
 *
 * What may go — every condition at once:
 *   1. the file lies in a person's wizard folder, establishments/temp/<userId>/,
 *      or in the folder of a card, establishments/<cardId>/;
 *   2. NOTHING in the database names it: not a card, a promotion, an avatar, a
 *      document, an import's registry, and not the journal or any other
 *      column either (scripts/lib/mediaOrphans.js statusOf — NONE only; a
 *      reference in history or in an unknown place keeps the file). A folder
 *      or an age alone is never the reason;
 *   3. and the folder's owner is gone or quiet:
 *      - due at once only on the database's POSITIVE word that the owner is
 *        gone: the account's journal mark user_delete_account (directive: «с
 *        удалением учётной записи удаляются и её файлы-сироты»), or the card's
 *        journal mark partner_delete_establishment — a draft its partner
 *        deleted, or one deleted with the account;
 *      - an owner whose row is merely not there waits the term like a quiet
 *        one: a database restored from an earlier backup lacks the accounts and
 *        cards made since, and their files would otherwise go at once (Phase
 *        3.5 lens review of PR 1b, finding 1);
 *      - quiet: nothing uploaded into that folder for SWEEP_TERM_DAYS — the
 *        term runs from the LAST upload into the owner's folder, not from the
 *        file's own: a wizard filled over more than a month keeps all its
 *        photos while the person is at it. A person who comes back to an
 *        abandoned wizard later uploads the photos again (the Coordinator,
 *        09.11.2026).
 *   A card folder of a card that exists is never swept: deleting a card's photo
 *   is the partner's, through mediaService.
 *
 * Files uploaded at or after the moment of the database read (a snapshot's
 * time) are not judged: that database cannot name them yet. Only files of the
 * delivery type `upload` are judged: the project uploads nothing else, and the
 * destroy it calls would not reach another type.
 *
 * The database cannot see the wizard's unsaved drafts (the site keeps them in
 * the browser, the app in memory) — the term is what protects them.
 */

import { GROUP, STATUS, folderOf, isCheckable, statusOf } from './mediaOrphans.js';

/** The term of a quiet wizard folder — technical, held by the executor (directive п. 9). */
export const SWEEP_TERM_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Why a file is due. */
export const SWEEP_REASON = Object.freeze({
  QUIET_WIZARD: 'quiet_wizard',
  DELETED_ACCOUNT: 'deleted_account',
  ACCOUNT_GONE: 'account_gone',
  DELETED_CARD: 'deleted_card',
  CARD_GONE: 'card_gone',
});

/** The reasons that take a file at once — each a positive mark in the journal. */
export const AT_ONCE_REASONS = Object.freeze([SWEEP_REASON.DELETED_ACCOUNT, SWEEP_REASON.DELETED_CARD]);

/** The reasons that rest on a row not being there — the wrong-database guard counts them. */
export const ABSENCE_REASONS = Object.freeze([SWEEP_REASON.ACCOUNT_GONE, SWEEP_REASON.CARD_GONE]);

const timeOf = (createdAt) => {
  const t = Date.parse(createdAt ?? '');
  return Number.isNaN(t) ? null : t;
};

const folderKey = (group, ownerId) => `${group}:${ownerId}`;

/**
 * The newest upload into every owner's folder — a person's wizard folder, a
 * card's folder — whatever the file's references. A file without a date makes
 * the folder «active»: its age is unknown, so the folder is not judged quiet.
 *
 * @param {Array<{public_id: string, created_at?: string}>} assets
 * @returns {Map<string, number>} `${group}:${ownerId}` → time (Infinity when a date is missing)
 */
export const lastUploads = (assets) => {
  const out = new Map();
  for (const asset of assets) {
    const folder = folderOf(asset.public_id);
    if ((folder.group !== GROUP.TEMP && folder.group !== GROUP.CARDS) || !folder.ownerId) continue;
    const key = folderKey(folder.group, folder.ownerId);
    const t = timeOf(asset.created_at) ?? Infinity;
    out.set(key, Math.max(out.get(key) ?? -Infinity, t));
  }
  return out;
};

/**
 * The plan: every file due, with why.
 *
 * @param {Object} input
 * @param {Array<{public_id, created_at, bytes, resource_type}>} input.assets - the cloud's listing
 * @param {{byId: Map<string, Set<string>>}} input.refs - indexReferences()
 * @param {{users: Map<string, {role, service, deleted}>, cards: Map<string, {status}>,
 *   deletedCards?: Set<string>}} input.owners - deletedCards: ids with the journal
 *   mark partner_delete_establishment
 * @param {string[]} input.topFolders
 * @param {Date} input.asOf
 * @param {string|null} [input.dbMoment] - when the database was read; null — now
 * @param {number} [input.termDays]
 * @returns {Array<{public_id, resource_type, bytes, created_at, group, ownerId, reason}>}
 */
export const planSweep = ({
  assets, refs, owners, topFolders, asOf, dbMoment = null, termDays = SWEEP_TERM_DAYS,
}) => {
  const dbTime = dbMoment ? Date.parse(dbMoment) : NaN;
  const newest = lastUploads(assets);
  const quietSince = asOf.getTime() - termDays * DAY_MS;
  const deletedCards = owners.deletedCards ?? new Set();
  const due = [];

  for (const asset of assets) {
    const id = String(asset.public_id);
    const folder = folderOf(id);
    if ((folder.group !== GROUP.TEMP && folder.group !== GROUP.CARDS) || !folder.ownerId) continue;
    if (asset.type && asset.type !== 'upload') continue;
    if (!isCheckable(id, topFolders)) continue;
    const created = timeOf(asset.created_at);
    if (!Number.isNaN(dbTime) && (created === null || created >= dbTime)) continue;
    if (statusOf(refs.byId.get(id)) !== STATUS.NONE) continue;

    const quiet = (newest.get(folderKey(folder.group, folder.ownerId)) ?? Infinity) <= quietSince;
    let reason = null;
    if (folder.group === GROUP.TEMP) {
      const user = owners.users.get(folder.ownerId);
      if (user?.deleted) reason = SWEEP_REASON.DELETED_ACCOUNT;
      else if (quiet) reason = user ? SWEEP_REASON.QUIET_WIZARD : SWEEP_REASON.ACCOUNT_GONE;
    } else if (!owners.cards.has(folder.ownerId)) {
      if (deletedCards.has(folder.ownerId)) reason = SWEEP_REASON.DELETED_CARD;
      else if (quiet) reason = SWEEP_REASON.CARD_GONE;
    }
    if (!reason) continue;

    due.push({
      public_id: id,
      resource_type: asset.resource_type || 'image',
      bytes: asset.bytes || 0,
      created_at: asset.created_at ?? null,
      group: folder.group,
      ownerId: folder.ownerId,
      reason,
    });
  }
  return due.sort((a, b) => a.public_id.localeCompare(b.public_id));
};

/**
 * The plan by owner, for the Coordinator's table: how many files, how much
 * space, of which account or card, since when quiet.
 *
 * @param {Array} due - planSweep()
 * @param {Object} owners - as for planSweep
 * @param {Map<string, number>} newest - lastUploads()
 * @returns {Array<{group, ownerId, role, service, deleted, reason, files, bytes, lastUpload}>}
 */
export const summarizeSweep = (due, owners, newest) => {
  const byOwner = new Map();
  for (const file of due) {
    const key = `${file.group}:${file.ownerId}`;
    if (!byOwner.has(key)) {
      const user = file.group === GROUP.TEMP ? owners.users.get(file.ownerId) : null;
      const last = newest.get(folderKey(file.group, file.ownerId));
      byOwner.set(key, {
        group: file.group,
        ownerId: file.ownerId,
        role: user?.role ?? null,
        service: user?.service === true,
        deleted: user?.deleted === true,
        reason: file.reason,
        files: 0,
        bytes: 0,
        lastUpload: Number.isFinite(last) ? new Date(last).toISOString().slice(0, 10) : null,
      });
    }
    const row = byOwner.get(key);
    row.files += 1;
    row.bytes += file.bytes;
  }
  return [...byOwner.values()].sort((a, b) => b.bytes - a.bytes || a.ownerId.localeCompare(b.ownerId));
};
