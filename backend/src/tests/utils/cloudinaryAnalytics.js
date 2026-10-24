/**
 * The query the Cloudinary SDK appends to a delivery link it builds (`?_a=…`).
 *
 * It is the SDK's analytics token and encodes the SDK version and the Node
 * major.minor (cloudinary/lib/utils/analytics/getSDKVersions.js), so a literal
 * of it holds on one Node only: PR #123 (21.10.2026) pinned the token of Node
 * 20.11 and went red in CI, which installs the newest 20.x from .nvmrc. An
 * expected link built by the server takes the token from here; the rest of
 * the link stays a literal.
 *
 * @returns {string} '?_a=…' of this process
 */
import { v2 as cloudinarySdk } from 'cloudinary';

export const sdkAnalyticsQuery = () =>
  new URL(cloudinarySdk.url('probe', { secure: true, cloud_name: 'test' })).search;
