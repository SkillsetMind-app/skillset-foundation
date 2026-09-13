// CI-only GoTrue integration check. No Supabase CLI status, env files, or logs.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:net';

const image = 'supabase/gotrue:v2.196.0';
const failures = [];
let stage = 'local-ci-guard';
const check = (label, ok) => {
  console.log(`[invite-auth] ${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isolatedDatabase(env, platform) {
  assert(env.CI === 'true' && env.GITHUB_ACTIONS === 'true' && platform === 'linux');
  const url = new URL(env.DATABASE_URL);
  // No libpq host/service/options overrides, DNS, sockets, or alternate DBs.
  assert(['postgres:', 'postgresql:'].includes(url.protocol));
  assert(url.hostname === '127.0.0.1' && url.port === '54322');
  assert(url.pathname === '/postgres' && url.username === 'postgres');
  assert(!url.search && !url.hash);
  return url;
}

function totp(secret, seconds = Math.floor(Date.now() / 1000)) {
  assert(/^[A-Z2-7]+$/.test(secret));
  const bits = [...secret].map((c) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c)
    .toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(seconds / 30)));
  const hash = createHmac('sha1', key).update(counter).digest();
  return ((hash.readUInt32BE(hash.at(-1) & 15) & 0x7fffffff) % 1000000)
    .toString().padStart(6, '0');
}

function selfTest() {
  const env = { CI: 'true', GITHUB_ACTIONS: 'true',
    DATABASE_URL: 'postgresql://postgres@127.0.0.1:54322/postgres' };
  isolatedDatabase(env, 'linux');
  for (const value of ['postgresql://postgres@db.example.test:54322/postgres',
    `${env.DATABASE_URL}?host=db.example.test`, `${env.DATABASE_URL}#fragment`,
    env.DATABASE_URL.replace('54322', '5432'), env.DATABASE_URL.replace('/postgres', '/other')]) {
    assert.throws(() => isolatedDatabase({ ...env, DATABASE_URL: value }, 'linux'));
  }
  assert.throws(() => isolatedDatabase({ ...env, CI: 'false' }, 'linux'));
  assert.throws(() => isolatedDatabase({ ...env, GITHUB_ACTIONS: 'false' }, 'linux'));
  assert.throws(() => isolatedDatabase(env, 'win32'));
  // RFC 6238 public test vector, six-digit truncation.
  assert(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59) === '287082');
  assert(quote("a'b") === "'a''b'");
  console.log('[invite-auth] PASS self-test (no Docker or database)');
}

async function run() {
  const db = isolatedDatabase(process.env, process.platform);
  const withoutFix = process.env.WITHOUT_INVITE_FIX === '1';
  const withoutAuthRevocation = process.env.WITHOUT_INVITE_AUTH_REVOCATION === '1';
  assert(!(withoutFix && withoutAuthRevocation));
  const childEnv = { PATH: process.env.PATH, HOME: '/tmp', LANG: 'C.UTF-8' };
  const pgEnv = { ...childEnv, PGHOST: '127.0.0.1', PGPORT: db.port,
    PGDATABASE: 'postgres', PGUSER: 'postgres', PGPASSWORD: decodeURIComponent(db.password),
    PGPASSFILE: '/dev/null', PGSERVICEFILE: '/dev/null', PGCONNECT_TIMEOUT: '5',
    PGOPTIONS: '-c statement_timeout=15000 -c log_statement=none -c log_min_error_statement=panic' };
  function command(program, args, input, env = childEnv) {
    const result = spawnSync(program, args, { env, input, encoding: 'utf8',
      timeout: 30000, maxBuffer: 2 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
    // Raw stdout/stderr stay in memory. Never print process errors or SQL bodies.
    if (result.error || result.status !== 0) {
      console.error(`[invite-auth] COMMAND ${stage} exit=${result.status ?? 'unavailable'}`);
    }
    assert(!result.error && result.status === 0);
    return result.stdout.trim();
  }
  function sql(label, body, claims) {
    stage = label;
    const context = claims ? `do $$ begin
      perform set_config('request.jwt.claims', ${quote(JSON.stringify(claims))}, true);
      perform set_config('request.jwt.claim.sub', ${quote(claims.sub)}, true);
      perform set_config('request.jwt.claim.role', ${quote(claims.role)}, true);
      perform set_config('skillset.trusted_write', 'off', true);
    end $$; set local role authenticated;` : '';
    return command('psql', ['-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
      `begin; ${context}\n${body}\ncommit;`, pgEnv);
  }
  const key = randomBytes(48).toString('base64url');
  const suffix = randomBytes(8).toString('hex');
  const container = `invite-auth-${suffix}`;
  let auth;
  let restore;
  let smtp;
  const sockets = new Set();
  let delivered = 0;
  const listen = (server) => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  try {
    stage = 'smtp-start';
    // Sink only: no relay, no storage, no STARTTLS/AUTH advertisement, no body logs.
    smtp = createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => {});
      socket.setTimeout(10000, () => socket.destroy());
      socket.write('220 localhost ESMTP\r\n');
      let buffer = '';
      let data = false;
      socket.on('data', (chunk) => {
        buffer += chunk.toString();
        if (buffer.length > 1024 * 1024) return socket.destroy();
        let end;
        while ((end = buffer.indexOf('\r\n')) !== -1) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (data) {
            if (line === '.') {
              data = false;
              delivered++;
              socket.write('250 accepted\r\n');
            }
          } else if (/^(EHLO|HELO)\b/i.test(line)) socket.write('250 localhost\r\n');
          else if (/^RCPT TO:/i.test(line)) socket.write(/@example\.test>$/i.test(line)
            ? '250 accepted\r\n' : '550 test recipients only\r\n');
          else if (line === 'DATA') { data = true; socket.write('354 end with dot\r\n'); }
          else if (line === 'QUIT') socket.end('221 bye\r\n');
          else socket.write('250 OK\r\n');
        }
      });
    });
    const smtpPort = await listen(smtp);
    const reservation = createServer();
    const port = await listen(reservation);
    await new Promise((resolve) => reservation.close(resolve));
    const origin = `http://127.0.0.1:${port}`;
    const config = {
      GOTRUE_DB_DRIVER: 'postgres', GOTRUE_DB_DATABASE_URL: db.href, GOTRUE_DB_NAMESPACE: 'auth',
      GOTRUE_API_HOST: '127.0.0.1', PORT: String(port), API_EXTERNAL_URL: origin,
      GOTRUE_SITE_URL: origin, GOTRUE_JWT_SECRET: key, GOTRUE_JWT_EXP: '3600',
      GOTRUE_JWT_AUD: 'authenticated', GOTRUE_JWT_ADMIN_ROLES: 'service_role',
      GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated', GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
      GOTRUE_EXTERNAL_PHONE_ENABLED: 'false', GOTRUE_DISABLE_SIGNUP: 'false',
      GOTRUE_MAILER_AUTOCONFIRM: 'false', GOTRUE_SMTP_HOST: '127.0.0.1',
      GOTRUE_SMTP_PORT: String(smtpPort), GOTRUE_SMTP_ADMIN_EMAIL: 'auth@example.test',
      GOTRUE_SMTP_SENDER_NAME: 'Local Auth Test', GOTRUE_SMTP_MAX_FREQUENCY: '1ms',
      GOTRUE_RATE_LIMIT_EMAIL_SENT: '1000', GOTRUE_RATE_LIMIT_VERIFY: '1000',
      GOTRUE_RATE_LIMIT_TOKEN_REFRESH: '1000', GOTRUE_RATE_LIMIT_SIGN_IN_SIGN_UP: '1000',
      GOTRUE_MFA_TOTP_ENROLL_ENABLED: 'true', GOTRUE_MFA_TOTP_VERIFY_ENABLED: 'true',
      GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED: 'true',
      GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL: '0', LOG_LEVEL: 'error',
    };
    stage = 'gotrue-start';
    auth = spawn('docker', ['run', '--rm', '--network', 'host', '--log-driver', 'none',
      '--name', container, ...Object.keys(config).flatMap((name) => ['-e', name]), image],
    { env: { ...childEnv, ...config }, stdio: ['ignore', 'pipe', 'pipe'] });
    // Capture bounded raw output without artifacts, Docker logs, or exception bodies.
    let rawOutput = '';
    auth.stdout.on('data', (chunk) => { rawOutput = (rawOutput + chunk).slice(-1024 * 1024); });
    auth.stderr.on('data', (chunk) => { rawOutput = (rawOutput + chunk).slice(-1024 * 1024); });
    let launchError = false;
    auth.on('error', () => { launchError = true; });
    const startupDiagnostic = () => {
      const categories = [
        ['image-pull', /pull access denied|toomanyrequests|manifest unknown|failed to resolve|unauthorized/i],
        ['database-connection', /failed to connect|connection refused|no pg_hba|password authentication|SSL|TLS/i],
        ['database-migration', /migration|schema|relation|permission denied|must be owner/i],
        ['configuration', /configuration|envconfig|required|invalid.*(port|url|duration)|unable to load/i],
        ['listener', /address already in use|bind:/i],
      ].filter(([, pattern]) => pattern.test(rawOutput)).map(([label]) => label);
      const sqlState = rawOutput.match(/SQLSTATE ([A-Z0-9]{5})/)?.[1] ?? 'none';
      console.error(`[invite-auth] STARTUP exit=${auth.exitCode ?? 'running'} categories=${categories.join(',') || 'unclassified'} sqlstate=${sqlState}`);
    };
    let healthy = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (launchError || auth.exitCode !== null) { startupDiagnostic(); assert.fail(); }
      try {
        const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1000) });
        healthy = response.ok;
        await response.arrayBuffer();
      } catch { /* Waiting for image pull, migrations, and the local listener. */ }
      if (healthy) break;
      await pause(1000);
    }
    if (!healthy) { startupDiagnostic(); assert.fail(); }
    check('gotrue-ready-v2.196.0', true);

    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const adminInput = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
      role: 'service_role', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 600,
    })}`;
    // Only the sessionless Auth admin key is synthesized. User JWTs come from GoTrue.
    const admin = `${adminInput}.${createHmac('sha256', key).update(adminInput).digest('base64url')}`;
    async function request(label, path, body, token, method = 'POST', expected = [200]) {
      stage = label;
      const response = await fetch(`${origin}${path}`, { method, redirect: 'error',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      const raw = await response.text();
      console.log(`[invite-auth] HTTP ${label} ${response.status}`);
      assert(expected.includes(response.status));
      return { status: response.status, body: raw ? JSON.parse(raw) : {} };
    }
    function claims(session, aal = 'aal1') {
      stage = 'real-jwt-validation';
      assert(typeof session.access_token === 'string' && typeof session.refresh_token === 'string');
      const [header, payload, signature] = session.access_token.split('.');
      assert(JSON.parse(Buffer.from(header, 'base64url')).alg === 'HS256');
      const actual = Buffer.from(signature, 'base64url');
      const expected = createHmac('sha256', key).update(`${header}.${payload}`).digest();
      assert(actual.length === expected.length && timingSafeEqual(actual, expected));
      const value = JSON.parse(Buffer.from(payload, 'base64url'));
      assert(value.role === 'authenticated' && value.aal === aal && value.exp > Date.now() / 1000);
      assert(value.sub === session.user.id && /^[0-9a-f-]{36}$/.test(value.sub));
      assert(/^[0-9a-f-]{36}$/.test(value.session_id));
      return value;
    }
    const password = () => `Aa1!${randomBytes(24).toString('base64url')}`;
    const email = (name) => `${name}-${suffix}@example.test`;
    async function login(label, address, pass) {
      return (await request(label, '/token?grant_type=password', { email: address, password: pass })).body;
    }
    async function linkSession(label, type, address, pass) {
      const link = (await request(`${label}-generate-link`, '/admin/generate_link',
        { type, email: address, ...(pass ? { password: pass } : {}) }, admin)).body;
      assert(typeof link.hashed_token === 'string');
      const session = (await request(`${label}-verify`, '/verify',
        { type, token_hash: link.hashed_token })).body;
      claims(session);
      return session;
    }
    async function signup(label, address, pass) {
      const before = delivered;
      const user = (await request(label, '/signup', { email: address, password: pass })).body;
      assert(user.id && !user.email_confirmed_at && !user.access_token && delivered > before);
      return user;
    }
    const state = (label, session) => JSON.parse(sql(label, `select json_build_object(
      'allowed', public.account_session_allowed(), 'admin', public.is_admin(),
      'roles', (select roles from public.users where uid = auth.uid()::text));`, claims(session)));
    const persistedRoles = (uid) => JSON.parse(sql('persisted-roles',
      `select roles from public.users where uid = ${quote(uid)};`));
    const hasNoPassword = (uid) => sql('stored-password-empty',
      `select coalesce(encrypted_password, '') = '' from auth.users where id = ${quote(uid)};`) === 't';

    stage = 'issuer-setup';
    const issuerEmail = email('issuer');
    const issuerPassword = password();
    const issuer = (await request('issuer-create', '/admin/users',
      { email: issuerEmail, password: issuerPassword, email_confirm: true }, admin)).body;
    sql('issuer-role-fixture', `do $$ begin
      perform set_config('skillset.trusted_write', 'on', true);
      update public.users set roles = '["student","admin"]' where uid = ${quote(issuer.id)};
    end $$;`);
    const issuerLogin = await login('issuer-login', issuerEmail, issuerPassword);
    claims(issuerLogin);
    const factor = (await request('issuer-enroll-totp', '/factors',
      { factor_type: 'totp', friendly_name: 'CI issuer' }, issuerLogin.access_token)).body;
    const challenge = (await request('issuer-challenge', `/factors/${factor.id}/challenge`,
      {}, issuerLogin.access_token)).body;
    const strong = (await request('issuer-verify-totp', `/factors/${factor.id}/verify`,
      { challenge_id: challenge.id, code: totp(factor.totp.secret) }, issuerLogin.access_token)).body;
    const issuerClaims = claims(strong, 'aal2');
    check('issuer-real-mfa-admin', sql('issuer-is-admin', 'select public.is_admin();', issuerClaims) === 't');
    const invite = (address, level = 'admin') => JSON.parse(sql('issuer-create-invite',
      `select public.admin_create_platform_invite(${quote(address)}, ${quote(level)}, false);`, issuerClaims));

    if (withoutFix || withoutAuthRevocation) {
      restore = sql('reversal-snapshot', "select pg_get_functiondef('public.accept_platform_invite(uuid)'::regprocedure);");
      const needle = withoutAuthRevocation
        ? 'delete from auth.sessions where user_id = auth.uid();'
        : 'if v_password_predates_proof then';
      assert(restore.split(needle).length === 2);
      sql('reversal-disable-revocation', restore.replace(needle, withoutAuthRevocation ? 'null;' : 'if false then'));
      console.log(`[invite-auth] MODE ${withoutAuthRevocation ? 'auth-session' : 'credential'}-revocation-mutation (expected FAIL)`);
    }

    const victimEmail = email('preregistered');
    const oldPassword = password();
    const victim = await signup('preregistration', victimEmail, oldPassword);
    check('unconfirmed-no-operational-roles', !persistedRoles(victim.id).includes('admin'));
    const unconfirmed = await request('unconfirmed-password-denied', '/token?grant_type=password',
      { email: victimEmail, password: oldPassword }, undefined, 'POST', [400]);
    check('unconfirmed-login-fail-closed', unconfirmed.body.error_code === 'email_not_confirmed');
    const pending = invite(victimEmail);
    const recipient = await linkSession('recipient-confirm', 'signup', victimEmail, oldPassword);
    assert(recipient.user.id === victim.id);
    const attacker = await login('attacker-password-before-acceptance', victimEmail, oldPassword);
    check('attacker-session-live-before-acceptance', state('attacker-before', attacker).allowed);
    const receipt = JSON.parse(sql('recipient-accept-aal1',
      `select public.accept_platform_invite(${quote(pending.id)});`, claims(recipient)));
    check('acceptance-requires-reauthentication', receipt.reauthentication_required === true);
    check('invited-role-persisted', persistedRoles(victim.id).includes('admin'));
    check('preregistered-password-cleared', hasNoPassword(victim.id));
    check('attacker-old-session-app-denied', state('attacker-after', attacker).allowed === false);
    check('recipient-old-session-app-denied', state('recipient-after', recipient).allowed === false);
    const oldLogin = await request('old-password-after-acceptance', '/token?grant_type=password',
      { email: victimEmail, password: oldPassword }, undefined, 'POST', [200, 400]);
    check('old-password-auth-denied', oldLogin.status === 400 && oldLogin.body.error_code === 'invalid_credentials');

    // An RLS-only cutoff is insufficient if Auth still lets an old session set a password.
    const authDenied = (result) => [401, 403].includes(result.status)
      && ['session_not_found', 'session_expired', 'bad_jwt'].includes(result.body.error_code);
    for (const [label, session] of [['attacker', attacker], ['recipient', recipient]]) {
      const oldUser = await request(`${label}-old-auth-session`, '/user', undefined,
        session.access_token, 'GET', [200, 401, 403]);
      check(`${label}-old-auth-session-denied`, authDenied(oldUser));
    }
    const refresh = await request('attacker-old-refresh', '/token?grant_type=refresh_token',
      { refresh_token: attacker.refresh_token }, undefined, 'POST', [200, 400, 401, 403]);
    check('old-refresh-auth-denied', [400, 401, 403].includes(refresh.status)
      && ['refresh_token_not_found', 'refresh_token_already_used', 'session_not_found', 'session_expired']
        .includes(refresh.body.error_code));
    const takeover = await request('attacker-old-session-password-write', '/user',
      { password: password() }, attacker.access_token, 'PUT', [200, 401, 403]);
    check('old-session-cannot-reinstall-password', authDenied(takeover));

    const recovered = await linkSession('recipient-recovery', 'recovery', victimEmail);
    const recoveredState = state('recovered-session-state', recovered);
    check('recovery-new-session-allowed', recoveredState.allowed === true
      && claims(recovered).session_id !== claims(attacker).session_id);
    check('recovery-role-retained-without-mfa-bypass', recoveredState.roles?.includes('admin')
      && recoveredState.admin === false);
    const newPassword = password();
    await request('recovered-set-password', '/user', { password: newPassword }, recovered.access_token, 'PUT');
    const finalLogin = await login('recovered-password-login', victimEmail, newPassword);
    check('new-password-login-allowed', state('final-password-session', finalLogin).allowed === true);

    const bootstrapEmail = email('bootstrap');
    const bootstrapPassword = password();
    sql('bootstrap-invite-fixture', `insert into public.admin_bootstrap_invites(email, roles)
      values (${quote(bootstrapEmail)}, '["admin","teacher"]');`);
    const bootstrap = await signup('bootstrap-unconfirmed-signup', bootstrapEmail, bootstrapPassword);
    check('bootstrap-unconfirmed-student-only', JSON.stringify(persistedRoles(bootstrap.id)) === '["student"]');
    check('bootstrap-invite-not-consumed-before-proof', sql('bootstrap-pending',
      `select exists(select 1 from public.admin_bootstrap_invites where email = ${quote(bootstrapEmail)});`) === 't');
    const bootSession = await linkSession('bootstrap-confirm', 'signup', bootstrapEmail, bootstrapPassword);
    assert(bootSession.user.id === bootstrap.id);
    check('bootstrap-confirm-password-not-overwritten', hasNoPassword(bootstrap.id));
    check('bootstrap-confirm-roles-persisted', ['admin', 'teacher'].every((role) => persistedRoles(bootstrap.id).includes(role)));
    check('bootstrap-invite-consumed-after-proof', sql('bootstrap-consumed',
      `select not exists(select 1 from public.admin_bootstrap_invites where email = ${quote(bootstrapEmail)});`) === 't');
    const bootOldLogin = await request('bootstrap-old-password', '/token?grant_type=password',
      { email: bootstrapEmail, password: bootstrapPassword }, undefined, 'POST', [200, 400]);
    check('bootstrap-old-password-denied', bootOldLogin.status === 400
      && bootOldLogin.body.error_code === 'invalid_credentials');
    const bootRecovery = await linkSession('bootstrap-recovery', 'recovery', bootstrapEmail);
    const bootNewPassword = password();
    check('bootstrap-recovery-allowed', state('bootstrap-recovered-state', bootRecovery).allowed === true);
    await request('bootstrap-set-new-password', '/user', { password: bootNewPassword }, bootRecovery.access_token, 'PUT');
    check('bootstrap-new-password-login', state('bootstrap-new-login',
      await login('bootstrap-login', bootstrapEmail, bootNewPassword)).allowed === true);

    const existingEmail = email('confirmed');
    const existingPassword = password();
    await signup('existing-signup', existingEmail, existingPassword);
    const existing = await linkSession('existing-confirm', 'signup', existingEmail, existingPassword);
    const existingLogin = await login('existing-password-before', existingEmail, existingPassword);
    const existingInvite = invite(existingEmail, 'staff');
    const existingReceipt = JSON.parse(sql('existing-accept-aal1',
      `select public.accept_platform_invite(${quote(existingInvite.id)});`, claims(existing)));
    check('confirmed-account-no-reset-required', existingReceipt.reauthentication_required === false);
    const retained = state('confirmed-retained-session', existingLogin);
    check('confirmed-account-session-retained', retained.allowed === true);
    check('confirmed-account-roles-retained', ['support', 'moderator', 'ops'].every((role) => retained.roles?.includes(role)));
    await request('confirmed-auth-session-retained', '/user', undefined, existingLogin.access_token, 'GET');
    check('confirmed-account-password-retained', state('confirmed-password-session',
      await login('confirmed-password-after', existingEmail, existingPassword)).allowed === true);
    stage = 'security-assertions';
    assert(failures.length === 0);
    console.log('[invite-auth] PASS all-real-auth-checks');
  } finally {
    const failedStage = stage;
    try {
      if (restore) sql('reversal-restore', restore);
    } finally {
      stage = failedStage;
      if (auth) {
        const removed = spawnSync('docker', ['rm', '-f', container],
          { env: childEnv, stdio: 'pipe', timeout: 15000 });
        if (removed.status !== 0 && auth.exitCode === null) {
          process.exitCode = 1;
          console.log('[invite-auth] FAIL container-cleanup');
        }
        auth.kill();
      }
      for (const socket of sockets) socket.destroy();
      if (smtp?.listening) await new Promise((resolve) => smtp.close(resolve));
    }
  }
}

try {
  if (process.argv.includes('--self-test')) selfTest();
  else await run();
} catch {
  // Assertion diagnostics can contain passwords, JWTs, SQL, and remote error bodies.
  console.error(`[invite-auth] FAIL ${stage}`);
  process.exitCode = 1;
}
