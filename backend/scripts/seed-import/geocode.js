/**
 * Geocoding — resolve a card's coordinates for the seed import.
 *
 * Priority (CAT-E-2.1 facts-on-site): sheet-provided coordinates win and are
 * used verbatim (validated + bounds-checked in preflight). Only when they are
 * absent do we geocode.
 *
 * Fallback chain: Nominatim (structured, countrycodes=by, ru) → city centre.
 * Phase-0 hardening:
 *   - structured query + countrycodes=by + accept-language=ru (materially better
 *     hit-rate on Belarusian addresses than free-form);
 *   - 1.1s throttle + persistent JSON cache (survives restarts; a re-run does not
 *     re-hit Nominatim) + a descriptive User-Agent (usage policy);
 *   - a geocode result outside the city's CITY_BOUNDS is treated as a miss;
 *   - city-centre fallback is JITTERED deterministically (seed = stable_id, ±~150m
 *     inside CITY_BOUNDS) so fallback cards do not stack into one un-clickable pin,
 *     and is flagged coords_source='city_fallback' for later refinement.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import crypto from 'crypto';
import { CITY_CENTERS, CITY_BOUNDS } from './contract.js';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'nirivio-seed-import/1.0 (https://nirivio.by; contact@nirivio.by)';
const THROTTLE_MS = 1100;
const JITTER_DEG = 0.0015; // ~150–170m in Belarus latitudes

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function inCityBounds(city, lat, lon) {
  const b = CITY_BOUNDS[city];
  if (!b) return true; // unknown city → no city-specific gate (canon guards city anyway)
  return lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax;
}

/** Deterministic ±JITTER offset from a seed string, clamped into CITY_BOUNDS. */
function jitteredCenter(city, seed) {
  const center = CITY_CENTERS[city];
  const h = crypto.createHash('sha256').update(seed).digest();
  // Map two bytes to [-1, 1).
  const fx = (h[0] / 128) - 1;
  const fy = (h[1] / 128) - 1;
  let lat = center.latitude + fx * JITTER_DEG;
  let lon = center.longitude + fy * JITTER_DEG;
  const b = CITY_BOUNDS[city];
  if (b) {
    lat = Math.min(Math.max(lat, b.latMin), b.latMax);
    lon = Math.min(Math.max(lon, b.lonMin), b.lonMax);
  }
  return { latitude: Number(lat.toFixed(8)), longitude: Number(lon.toFixed(8)) };
}

export class Geocoder {
  /**
   * @param {object} opts
   * @param {string} opts.cacheFile - JSON cache path
   * @param {boolean} [opts.disabled] - skip Nominatim, force city_fallback
   *   (offline / testing). Sheet coords still take priority.
   * @param {function} [opts.fetchImpl] - injectable fetch (tests)
   */
  constructor({ cacheFile, disabled = false, fetchImpl } = {}) {
    this.cacheFile = cacheFile;
    this.disabled = disabled;
    this.fetch = fetchImpl || globalThis.fetch;
    this.cache = cacheFile && existsSync(cacheFile)
      ? JSON.parse(readFileSync(cacheFile, 'utf8'))
      : {};
    this.lastCall = 0;
    this.stats = { sheet: 0, geocoded: 0, city_fallback: 0, cache_hits: 0 };
  }

  saveCache() {
    if (this.cacheFile) writeFileSync(this.cacheFile, JSON.stringify(this.cache, null, 0));
  }

  /**
   * Resolve coordinates for a normalized record.
   * @returns {Promise<{ latitude, longitude, coords_source }>}
   */
  async resolve(rec) {
    if (rec.latitude != null && rec.longitude != null) {
      this.stats.sheet++;
      return { latitude: rec.latitude, longitude: rec.longitude, coords_source: 'sheet' };
    }

    if (!this.disabled) {
      const hit = await this.queryNominatim(rec);
      if (hit && inCityBounds(rec.city, hit.latitude, hit.longitude)) {
        this.stats.geocoded++;
        return { ...hit, coords_source: 'geocoded' };
      }
    }

    this.stats.city_fallback++;
    return { ...jitteredCenter(rec.city, rec.stable_id), coords_source: 'city_fallback' };
  }

  async queryNominatim(rec) {
    const key = `${rec.city}|${rec.address}`.toLowerCase().replace(/\s+/g, ' ').trim();
    if (key in this.cache) {
      this.stats.cache_hits++;
      return this.cache[key];
    }

    // Throttle to ≤1 req / 1.1s (Nominatim usage policy).
    const wait = THROTTLE_MS - (Date.now() - this.lastCall);
    if (wait > 0) await sleep(wait);
    this.lastCall = Date.now();

    const params = new URLSearchParams({
      street: rec.address,
      city: rec.city,
      country: 'Belarus',
      countrycodes: 'by',
      format: 'jsonv2',
      limit: '1',
      'accept-language': 'ru',
    });
    let result = null;
    try {
      const res = await this.fetch(`${NOMINATIM_URL}?${params}`, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (res.ok) {
        const arr = await res.json();
        if (Array.isArray(arr) && arr.length > 0) {
          result = { latitude: parseFloat(arr[0].lat), longitude: parseFloat(arr[0].lon) };
        }
      }
    } catch {
      result = null; // network error → treat as miss → city_fallback
    }

    this.cache[key] = result;
    this.saveCache();
    return result;
  }
}
