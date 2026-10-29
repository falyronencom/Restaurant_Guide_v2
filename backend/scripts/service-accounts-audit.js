/**
 * Which accounts hold the panel and the catalogue, and whose mailbox each one
 * stands on. Read only.
 *
 * Why: the panel's admin and the seed house that owns the platform's cards
 * were found on addresses at domains the project does not own (2026-10-15,
 * cloud critic 2B S1); whoever owns such a domain receives the system's mail
 * to those accounts. This is the check that says how many are left — run
 * after every change to the service accounts, and whenever in doubt. The
 * answer it is for: «not on our mailboxes: 0».
 *
 * Lists every account that
 *   - has a panel role (admin, viewer) or the partner role, OR
 *   - owns at least one card, OR
 *   - stands on a domain the scripts have used for accounts (test.com,
 *     restaurantguide.by, example.com — scripts/lib/serviceAccounts.js),
 * whatever else is true of it, with: address and domain, role, active or
 * not, whether it has a password or a phone (never the value), sign-in
 * method and provider link, live sessions, unspent password-reset links and
 * e-mail codes, reset links ever issued and the last one, active push
 * devices, cards owned, when it was created — and the verdict: on our
 * mailbox or not. Ordinary user accounts elsewhere are only counted, by
 * domain: they are people.
 *
 * Two totals, because the list holds people too (Phase 3.5 review): service
 * accounts — panel roles, the flagged seed house, accounts on a script domain
 * — not on our mailboxes, the number that must reach 0; and partners or card
 * owners elsewhere, for the operator to classify. Switched-off accounts apart.
 * «Ours» is a mailbox the operator listed (lib/serviceAccounts.js): an
 * address at a project domain that is not listed is shown as such, and not
 * counted as closed.
 *
 * What it prints about people: the operator's own mailbox is shown as a label,
 * not as its value (the output is pasted into chats and reports); a partner
 * or an ordinary user (a card owner) on a domain that is neither ours nor a
 * script domain is a person — the name part of the address is masked, the
 * domain stays. Without SERVICE_ACCOUNT_MAILBOXES the operator's mailbox
 * cannot be recognised; the run says so first.
 *
 * Read only by construction: one READ ONLY transaction; the database refuses
 * any write inside it.
 *
 * Target: with --production, DATABASE_URL from the environment or
 * backend/.env.production, over TLS to the pinned certificate only
 * (scripts/lib/productionDb.js); without it, the DB_* variables of a local
 * database. The operator's mailbox comes from SERVICE_ACCOUNT_MAILBOXES in
 * the same environment.
 *
 * Usage (from backend/):
 *   node scripts/service-accounts-audit.js --production
 *   From a git worktree (no .env.production there):
 *   node --env-file=<main checkout>/backend/.env.production scripts/service-accounts-audit.js --production
 *   --json: the same, as JSON (for tests and for diffing two runs)
 */
import pg from 'pg';
import { ProductionClient, loadProductionEnvironment } from './lib/productionDb.js';
import {
  MAILBOXES_VARIABLE,
  SCRIPT_LITERAL_DOMAINS,
  displayAddress,
  domainOf,
  isOurAddress,
  isProjectDomain,
  mailboxSqlPatterns,
  mailboxesFrom,
  maskedAddress,
  OUR_DOMAINS,
} from './lib/serviceAccounts.js';

const { Client } = pg;

const args = process.argv.slice(2);
const production = args.includes('--production');
const asJson = args.includes('--json');

const buildClient = () => {
  if (production) {
    const connectionString = loadProductionEnvironment();
    return new ProductionClient({ connectionString });
  }
  return new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'restaurant_guide_belarus',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres_dev_password',
  });
};

/*
 * Counts are of rows not yet spent (used_at empty), whatever their expiry:
 * expiry columns are naive timestamps in the server's clock, and a count
 * that does not depend on the reader's time zone is the stricter one. Live
 * refresh tokens are counted a second time against the database's clock
 * (unspent and not expired) — the sessions someone may actually hold. A
 * panel account's token past a day without renewal is not live either: it
 * can no longer be renewed (config/panelRoles.js, PANEL_SESSION_IDLE_MS).
 */
const ACCOUNTS_SQL = `
  WITH cards AS (
    SELECT partner_id,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'active')::int AS active
    FROM establishments
    GROUP BY partner_id
  )
  SELECT u.id, u.email, u.role, u.is_active, u.auth_method,
         (u.oauth_provider_id IS NOT NULL) AS provider_linked,
         (u.password_hash IS NOT NULL) AS has_password,
         (u.phone IS NOT NULL) AS has_phone,
         u.email_verified, u.created_at, u.last_login_at,
         (to_jsonb(u) ->> 'sessions_revoked_at') AS sessions_revoked_at,
         COALESCE((to_jsonb(u) ->> 'is_service_account')::boolean, false) AS is_service_account,
         COALESCE(c.total, 0) AS cards,
         COALESCE(c.active, 0) AS active_cards,
         (SELECT COUNT(*)::int FROM refresh_tokens rt
           WHERE rt.user_id = u.id AND rt.used_at IS NULL) AS unspent_refresh,
         (SELECT COUNT(*)::int FROM refresh_tokens rt
           WHERE rt.user_id = u.id AND rt.used_at IS NULL AND rt.expires_at > LOCALTIMESTAMP
             AND (u.role NOT IN ('admin', 'viewer') OR rt.created_at > LOCALTIMESTAMP - INTERVAL '24 hours')) AS live_refresh,
         (SELECT COUNT(*)::int FROM password_reset_tokens pr
           WHERE pr.user_id = u.id AND pr.used_at IS NULL) AS unspent_reset_links,
         (SELECT COUNT(*)::int FROM password_reset_tokens pr WHERE pr.user_id = u.id) AS reset_links_ever,
         (SELECT MAX(pr.created_at) FROM password_reset_tokens pr WHERE pr.user_id = u.id) AS last_reset_link_at,
         (SELECT COUNT(*)::int FROM email_verification_codes ev
           WHERE ev.user_id = u.id AND ev.used_at IS NULL) AS unspent_email_codes,
         (SELECT COUNT(*)::int FROM device_tokens dt
           WHERE dt.user_id = u.id AND dt.is_active = TRUE) AS active_devices
  FROM users u
  LEFT JOIN cards c ON c.partner_id = u.id
  WHERE u.role IN ('admin', 'viewer', 'partner')
     OR COALESCE(c.total, 0) > 0
     OR lower(split_part(u.email, '@', 2)) = ANY($1::text[])
     OR COALESCE((to_jsonb(u) ->> 'is_service_account')::boolean, false)
     OR lower(u.email) = ANY($2::text[])
     OR lower(u.email) LIKE ANY($3::text[])
  ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'viewer' THEN 1 WHEN 'partner' THEN 2 ELSE 3 END,
           COALESCE(c.total, 0) DESC, u.created_at
`;

const OTHER_USERS_SQL = `
  WITH cards AS (SELECT DISTINCT partner_id FROM establishments)
  SELECT COALESCE(NULLIF(lower(split_part(u.email, '@', 2)), ''), '(без e-mail)') AS domain,
         COUNT(*)::int AS accounts
  FROM users u
  LEFT JOIN cards c ON c.partner_id = u.id
  WHERE u.role NOT IN ('admin', 'viewer', 'partner')
    AND c.partner_id IS NULL
    AND NOT (lower(split_part(COALESCE(u.email, ''), '@', 2)) = ANY($1::text[]))
    AND NOT (lower(COALESCE(u.email, '')) = ANY($2::text[]))
    AND NOT (lower(COALESCE(u.email, '')) LIKE ANY($3::text[]))
  GROUP BY 1
  ORDER BY 2 DESC, 1
`;

const MIGRATION_037_SQL = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'is_service_account'
  ) AS applied
`;

const MIGRATION_035_SQL = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'sessions_revoked_at'
  ) AS applied
`;

/** What the output may show of an account's address. */
const shownAddress = (row, mailboxes) => {
  if (isOurAddress(row.email, mailboxes)) return displayAddress(row.email, mailboxes);
  const scriptDomain = SCRIPT_LITERAL_DOMAINS.includes(domainOf(row.email));
  // A partner or a card owner elsewhere is a person (a business's contact):
  // the domain is enough to classify, the name is not ours to print.
  if ((row.role === 'partner' || row.role === 'user') && !scriptDomain && !isProjectDomain(row.email)) {
    return maskedAddress(row.email);
  }
  return row.email || '(без e-mail)';
};

/**
 * Service account (its address must be ours) or an account for the operator
 * to classify (a partner or card owner who may be a person). An account on
 * the operator's mailbox is a service account whatever its role — the
 * account given to Apple's reviewers is an ordinary user.
 */
const kindOf = (row, mailboxes) => {
  if (isOurAddress(row.email, mailboxes)) return 'service';
  if (row.role === 'admin' || row.role === 'viewer') return 'service';
  if (row.is_service_account === true) return 'service';
  if (SCRIPT_LITERAL_DOMAINS.includes(domainOf(row.email))) return 'service';
  return 'classify';
};

const verdictOf = (row, mailboxes) => {
  if (isOurAddress(row.email, mailboxes)) return 'НАШ ящик';
  if (isProjectDomain(row.email)) return 'домен проекта, ящик не подтверждён (не в SERVICE_ACCOUNT_MAILBOXES)';
  return 'НЕ наш ящик';
};

const describe = (row, mailboxes) => ({
  id: row.id,
  address: shownAddress(row, mailboxes),
  domain: row.email ? domainOf(row.email) : null,
  ours: isOurAddress(row.email, mailboxes),
  verdict: verdictOf(row, mailboxes),
  kind: kindOf(row, mailboxes),
  serviceFlag: row.is_service_account === true,
  role: row.role,
  active: row.is_active === true,
  hasPassword: row.has_password === true,
  hasPhone: row.has_phone === true,
  authMethod: row.auth_method,
  providerLinked: row.provider_linked === true,
  emailVerified: row.email_verified === true,
  cards: row.cards,
  activeCards: row.active_cards,
  unspentRefreshTokens: row.unspent_refresh,
  liveRefreshTokens: row.live_refresh,
  unspentResetLinks: row.unspent_reset_links,
  resetLinksEver: row.reset_links_ever,
  lastResetLinkAt: row.last_reset_link_at,
  unspentEmailCodes: row.unspent_email_codes,
  activeDevices: row.active_devices,
  sessionsRevokedAt: row.sessions_revoked_at,
  createdAt: row.created_at,
  lastLoginAt: row.last_login_at,
});

const yesNo = (value) => (value ? 'да' : 'нет');
const stamp = (value, length) => (value instanceof Date ? value.toISOString().slice(0, length) : String(value));

const printReport = (report) => {
  console.log('════════════════════════════════════════════════');
  console.log('  СЛУЖЕБНЫЕ УЧЁТКИ — проверка (только чтение)');
  console.log('════════════════════════════════════════════════');
  console.log(`  База:        ${report.target}`);
  console.log(`  Наши домены: ${OUR_DOMAINS.join(', ')}; ящиков Координатора в ${MAILBOXES_VARIABLE}: ${report.mailboxCount}`);
  console.log(`  Миграция 035 (отзыв выданных сеансов): ${report.migration035 ? 'применена' : 'НЕ применена'}`);
  console.log(`  Миграция 037 (признак служебной учётки): ${report.migration037 ? 'применена' : 'НЕ применена'}`);
  if (report.mailboxCount === 0) {
    console.log(`  ⚠ ${MAILBOXES_VARIABLE} не задан: ящик Координатора не распознаётся — «наших» адресов нет, а сам ящик, если встретится, будет показан как есть.`);
  }
  console.log('');
  report.accounts.forEach((a, i) => {
    console.log(`${i + 1}. ${a.address}  — ${a.verdict}`);
    console.log(`   ${a.kind === 'service' ? 'служебная' : 'к классификации'}${a.serviceFlag ? ' (признак служебной)' : ''}; роль ${a.role}, активна: ${yesNo(a.active)}, создана ${stamp(a.createdAt, 10)}`);
    console.log(`   вход: ${a.authMethod}; пароль есть: ${yesNo(a.hasPassword)}; телефон есть: ${yesNo(a.hasPhone)}; провайдер привязан: ${yesNo(a.providerLinked)}; адрес подтверждён: ${yesNo(a.emailVerified)}`);
    console.log(`   ссылок сброса выдавалось всего: ${a.resetLinksEver}${a.lastResetLinkAt ? `, последняя ${stamp(a.lastResetLinkAt, 16)}` : ''}`);
    console.log(`   карточек: ${a.cards} (активных ${a.activeCards})`);
    console.log(`   сеансов (непогашенных / из них не истёкших): ${a.unspentRefreshTokens} / ${a.liveRefreshTokens}; ссылок сброса: ${a.unspentResetLinks}; кодов подтверждения: ${a.unspentEmailCodes}; устройств push: ${a.activeDevices}`);
  });
  console.log('');
  console.log('Прочие учётки (роль user, без карточек) — только счёт по доменам:');
  report.otherUsersByDomain.forEach((d) => console.log(`   ${d.domain}: ${d.accounts}`));
  console.log('');
  console.log('════════════════════════════════════════════════');
  const s = report.summary;
  console.log(`  Учёток в перечне: ${s.listed}`);
  console.log(`  Служебных активных НЕ на наших ящиках: ${s.serviceNotOurs}   ← должно стать 0`);
  console.log(`  Партнёров и владельцев карточек на прочих адресах (к классификации): ${s.classifyNotOurs}`);
  console.log(`  Выключенных НЕ на наших ящиках (в счёт не входят): ${s.inactiveNotOurs}`);
  console.log(`  На наших ящиках — непогашенных сеансов: ${s.oursUnspentRefreshTokens}, ссылок сброса: ${s.oursUnspentResetLinks}, кодов: ${s.oursUnspentEmailCodes}, привязок провайдера: ${s.oursProviderLinks}`);
  console.log('════════════════════════════════════════════════');
};

const main = async () => {
  let client;
  try {
    client = buildClient();
  } catch (error) {
    console.error(`❌ ${error.message}`);
    return 1;
  }
  let mailboxes;
  try {
    mailboxes = await mailboxesFrom(process.env);
  } catch (error) {
    console.error(`❌ ${error.message}`);
    return 1;
  }

  try {
    await client.connect();
  } catch (error) {
    console.error(`❌ ${error.message}`);
    return 1;
  }
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    // Every account on the operator's mailbox is listed too, whatever its role
    // (an ordinary user without cards — the Apple account — fell out of the
    // list otherwise). The patterns follow mailboxOf exactly (escaped local
    // part, Gmail tags only), so SQL and the verdict agree on what is ours.
    const { exact, like } = mailboxSqlPatterns(mailboxes);
    const params = [SCRIPT_LITERAL_DOMAINS, exact, like];
    const accounts = (await client.query(ACCOUNTS_SQL, params)).rows.map((row) => describe(row, mailboxes));
    const otherUsersByDomain = (await client.query(OTHER_USERS_SQL, params)).rows;
    const migration035 = (await client.query(MIGRATION_035_SQL)).rows[0].applied;
    const migration037 = (await client.query(MIGRATION_037_SQL)).rows[0].applied;
    await client.query('ROLLBACK');

    const ours = accounts.filter((a) => a.ours);
    const report = {
      target: production ? `PRODUCTION (${client.host}:${client.port}/${client.database})` : `local ${client.host}:${client.port}/${client.database}`,
      mailboxCount: mailboxes.length,
      migration035,
      migration037,
      accounts,
      otherUsersByDomain,
      summary: {
        listed: accounts.length,
        serviceNotOurs: accounts.filter((a) => a.active && !a.ours && a.kind === 'service').length,
        classifyNotOurs: accounts.filter((a) => a.active && !a.ours && a.kind === 'classify').length,
        inactiveNotOurs: accounts.filter((a) => !a.active && !a.ours).length,
        oursUnspentRefreshTokens: ours.reduce((n, a) => n + a.unspentRefreshTokens, 0),
        oursUnspentResetLinks: ours.reduce((n, a) => n + a.unspentResetLinks, 0),
        oursUnspentEmailCodes: ours.reduce((n, a) => n + a.unspentEmailCodes, 0),
        oursProviderLinks: ours.filter((a) => a.providerLinked).length,
      },
    };

    if (asJson) console.log(JSON.stringify(report, null, 2));
    else printReport(report);
    return 0;
  } catch (error) {
    console.error('❌ Failed:', error.message);
    return 1;
  } finally {
    await client.end();
  }
};

process.exitCode = await main();
