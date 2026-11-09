/**
 * A person's photo that stops being their photo leaves the cloud — reliably,
 * with the CDN's copies (the Coordinator's word, 09.11.2026, thread «Фото
 * людей», directive п. 4 and п. 7).
 *
 * Who calls it, inside the transaction that drops or replaces the link:
 *   - the moderator's take-down (avatarModerationService);
 *   - the person clearing the photo or pointing the link at another of their
 *     files (PUT /auth/profile) and uploading a new one (POST /auth/avatar) —
 *     authService.updateUserProfile;
 *   - the takeover of an unconfirmed account by the address's owner — the
 *     registrant's photo goes with everything else they set up.
 *
 * Only a file of our cloud inside the person's own avatar folder is ever
 * queued: a Google or Yandex picture lives with the provider, and the link is
 * all there is to drop. A link into anyone else's folder (a value stored before
 * the input gate of 02.10.2026) is not ours to destroy.
 *
 * The queue (avatar_file_deletions, migration 041) is written in the caller's
 * transaction, so the task cannot be lost apart from the change; the loop
 * (avatarDeletionLoop) repeats until the cloud has let the file go. In the
 * window before 041 the caller has asked avatarFileDeletionTableExists() before
 * BEGIN, and the file goes the old way after COMMIT: one destroy, no retry.
 */

import { deleteAvatarFile, isOwnedAsset, ownCloudPublicId, ownedFolders } from '../config/cloudinary.js';
import { enqueueAvatarFileDeletion } from '../models/avatarFileDeletionModel.js';
import logger from '../utils/logger.js';

/**
 * The file behind a stored avatar link, when it is one of this person's files in
 * our cloud — its public_id; null otherwise (no link, a provider's picture,
 * someone else's folder).
 *
 * @param {string|null} url - users.avatar_url as stored
 * @param {string} userId
 * @returns {string|null}
 */
export const ownAvatarFile = (url, userId) => {
  const publicId = ownCloudPublicId(url);
  if (!publicId) return null;
  return isOwnedAsset(publicId, [ownedFolders.avatars(userId)]) ? publicId : null;
};

/**
 * The old photo's file stops being shown: queue its removal in the caller's
 * transaction. Without the queue (the window before 041) nothing is written, and
 * the public_id comes back for the caller to pass to destroyLaterWithoutQueue
 * after COMMIT.
 *
 * @param {Object} client - pg client inside the caller's transaction
 * @param {Object} change
 * @param {string} change.userId
 * @param {string|null} change.oldUrl - the link being dropped
 * @param {string|null} change.newUrl - the link replacing it (null when cleared)
 * @param {string} change.reason - AVATAR_FILE_REASONS
 * @param {boolean} change.queueReady - avatarFileDeletionTableExists(), asked before BEGIN
 * @returns {Promise<string|null>} the file for after COMMIT, when there is no queue
 */
export const retireAvatarFile = async (client, { userId, oldUrl, newUrl, reason, queueReady }) => {
  if (!oldUrl || oldUrl === newUrl) return null;
  const publicId = ownAvatarFile(oldUrl, userId);
  if (!publicId) return null;
  // The new link may name the same file in another spelling (a plain resize of
  // it): the file stays.
  if (newUrl && ownCloudPublicId(newUrl) === publicId) return null;
  if (!queueReady) return publicId;
  await enqueueAvatarFileDeletion(client, { publicId, userId, reason });
  return null;
};

/**
 * A new link — or none — is not the photo a moderator approved: the approval
 * goes with the old link, in the caller's transaction. Other people would not
 * see the new link anyway (the links differ); what this prevents is the old
 * approval coming back unreviewed — a person clears an approved Google
 * picture, and a later sign-in writes the very same link (Phase 3.5 review of
 * PR 1a, LOW-2). Without migration 041 there is nothing to drop.
 *
 * @param {Object} client - pg client inside the caller's transaction
 * @param {Object} change
 * @param {string} change.userId
 * @param {string|null} change.oldUrl
 * @param {string|null} change.newUrl
 * @param {boolean} change.moderationReady - avatarModerationReady(), asked before BEGIN
 * @returns {Promise<void>}
 */
export const forgetApproval = async (client, { userId, oldUrl, newUrl, moderationReady }) => {
  if (!moderationReady || oldUrl === newUrl) return;
  await client.query('UPDATE users SET avatar_approved_url = NULL WHERE id = $1', [userId]);
};

/**
 * The window before migration 041 only: the old way — one destroy after COMMIT,
 * with the CDN's copies; the answer does not wait for the cloud, a failure goes
 * to the journal and the file stays until the account's folder is emptied.
 *
 * @param {string|null} publicId - what retireAvatarFile returned
 * @param {string} userId
 */
export const destroyLaterWithoutQueue = (publicId, userId) => {
  if (!publicId) return;
  deleteAvatarFile(publicId, userId).catch((error) => {
    logger.warn('Failed to delete old avatar from Cloudinary', { publicId, error: error.message });
  });
};
