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
 * (avatarDeletionLoop) repeats until the cloud has let the file go.
 */

import { isOwnedAsset, ownCloudPublicId, ownedFolders } from '../config/cloudinary.js';
import { enqueueAvatarFileDeletion } from '../models/avatarFileDeletionModel.js';

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
 * transaction.
 *
 * @param {Object} client - pg client inside the caller's transaction
 * @param {Object} change
 * @param {string} change.userId
 * @param {string|null} change.oldUrl - the link being dropped
 * @param {string|null} change.newUrl - the link replacing it (null when cleared)
 * @param {string} change.reason - AVATAR_FILE_REASONS
 * @returns {Promise<void>}
 */
export const retireAvatarFile = async (client, { userId, oldUrl, newUrl, reason }) => {
  if (!oldUrl || oldUrl === newUrl) return;
  const publicId = ownAvatarFile(oldUrl, userId);
  if (!publicId) return;
  // The new link may name the same file in another spelling (a plain resize of
  // it): the file stays.
  if (newUrl && ownCloudPublicId(newUrl) === publicId) return;
  await enqueueAvatarFileDeletion(client, { publicId, userId, reason });
};

/**
 * A new link — or none — is not the photo a moderator approved: the approval
 * goes with the old link, in the caller's transaction. Other people would not
 * see the new link anyway (the links differ); what this prevents is the old
 * approval coming back unreviewed — a person clears an approved Google
 * picture, and a later sign-in writes the very same link (Phase 3.5 review of
 * PR 1a, LOW-2).
 *
 * @param {Object} client - pg client inside the caller's transaction
 * @param {Object} change
 * @param {string} change.userId
 * @param {string|null} change.oldUrl
 * @param {string|null} change.newUrl
 * @returns {Promise<void>}
 */
export const forgetApproval = async (client, { userId, oldUrl, newUrl }) => {
  if (oldUrl === newUrl) return;
  await client.query('UPDATE users SET avatar_approved_url = NULL WHERE id = $1', [userId]);
};
