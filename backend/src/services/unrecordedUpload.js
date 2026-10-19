/**
 * A file sent to the cloud before the database wrote the row that names it —
 * a promotion's picture, a card's photo or PDF menu. Until 18.10.2026 a
 * failure of that write left the file in the paid cloud with no row naming
 * it (brief «500 вместо отказа», p. 9). The Coordinator's word of 17.10.2026:
 * when the database refuses, the file just uploaded is deleted.
 *
 * «Refused» is the database's own answer to the statement. A lost connection
 * is not one: the server may have committed the row and lost only the answer,
 * and deleting the file then leaves the row pointing at nothing — a broken
 * picture the guests see (Phase 3.5 review of 18.10.2026, both reviewers).
 * With the outcome unknown the file stays, and the log names it: an orphan
 * costs storage, a broken row costs the partner's picture. The same rule as
 * cloudRefusedUpload for the cloud's own answers (config/cloudinary.js).
 */

import { DatabaseError } from 'pg';
import * as CloudinaryUtil from '../config/cloudinary.js';
import logger from '../utils/logger.js';

/**
 * Whether the database answered the statement with an error: an ERROR from
 * the server aborts the statement's transaction, so a single statement wrote
 * nothing. A connection lost before the answer (pg's «Connection terminated
 * unexpectedly»), a socket error or a FATAL as the server goes down leave the
 * outcome unknown.
 *
 * @param {*} error - What the query threw
 * @returns {boolean}
 */
export const databaseRefused = (error) => error instanceof DatabaseError && error.severity === 'ERROR';

/**
 * After the write of the row failed — or found no row to update: delete the
 * file this request uploaded, unless the row may hold it. Only inside the
 * folders given (deleteImage refuses the rest); a refused or failed deletion
 * is logged with the file's id, never thrown — the caller rethrows the
 * database's error as before.
 *
 * @param {string} publicId - What the upload returned
 * @param {string[]} folders - The card's folders (CloudinaryUtil.ownedFolders)
 * @param {Error|null} writeError - What the row's write threw; null when no
 *   row was written for certain (a read failed before the write, an UPDATE
 *   matched no row)
 * @returns {Promise<void>}
 */
export const discardUnrecordedUpload = async (publicId, folders, writeError) => {
  if (writeError && !databaseRefused(writeError)) {
    logger.warn('Uploaded file kept: the database may have recorded it', {
      publicId,
      error: writeError.message,
    });
    return;
  }
  try {
    const result = await CloudinaryUtil.deleteImage(publicId, folders);
    if (result?.result === 'refused') {
      logger.warn('Uploaded file the database did not record is left in the cloud', { publicId });
    }
  } catch (err) {
    logger.warn('Failed to delete an uploaded file the database did not record', {
      publicId,
      error: err.message,
    });
  }
};
