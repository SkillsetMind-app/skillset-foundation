// CI-only concurrency proof for close_unpaid_course_order x settle_paid_course_order.
// Two real psql writers (service_role) race on one synthetic order; an observer
// lets the first one commit only after pg_blocking_pids shows the second waiting.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';

const failures = [];
let stage = 'local-ci-guard';
const check = (label, ok) => {
  console.log(`[order-concurrency] ${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const within = (promise, ms) => {
  let timer;
  const expiry = new Promise((resolve) => { timer = setTimeout(resolve, ms, 'timeout'); });
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
};
const sqlStateOf = (stderr) => stderr?.match(/(?:ERROR|FATAL):\s+([A-Z0-9]{5})(?:\s|$)/)?.[1] ?? 'none';

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

// Only the order-row lock at the top of each RPC. The reservation lock in
// close_unpaid_course_order and the coupon/reservation locks in finalize stay.
const orderRowLock = /(from public\.orders\s+where id = p_order_id)\s+for update;/g;
function withoutOrderRowLock(definition) {
  assert((definition.match(orderRowLock) ?? []).length === 1);
  return definition.replace(orderRowLock, '$1;');
}

// Writers print only `key=value` lines (psql -qAt); anything else is rejected.
function parseOutput(text) {
  const values = {};
  for (const line of text.split('\n').filter(Boolean)) {
    const [, key, value] = line.match(/^(outcome|paid_at)=(.*)$/) ?? [];
    assert(key && !(key in values));
    values[key] = value;
  }
  return values;
}

function selfTest() {
  stage = 'self-test';
  const env = { CI: 'true', GITHUB_ACTIONS: 'true',
    DATABASE_URL: 'postgresql://postgres@127.0.0.1:54322/postgres' };
  isolatedDatabase(env, 'linux');
  for (const value of ['postgresql://postgres@db.example.test:54322/postgres',
    `${env.DATABASE_URL}?host=db.example.test`, `${env.DATABASE_URL}#fragment`,
    env.DATABASE_URL.replace('54322', '5432'), env.DATABASE_URL.replace(/\/postgres$/, '/other'),
    env.DATABASE_URL.replace('//postgres@', '//service_role@'), 'http://postgres@127.0.0.1:54322/postgres']) {
    assert.throws(() => isolatedDatabase({ ...env, DATABASE_URL: value }, 'linux'));
  }
  assert.throws(() => isolatedDatabase({ ...env, CI: 'false' }, 'linux'));
  assert.throws(() => isolatedDatabase({ ...env, GITHUB_ACTIONS: undefined }, 'linux'));
  assert.throws(() => isolatedDatabase({ ...env, DATABASE_URL: undefined }, 'linux'));
  assert.throws(() => isolatedDatabase(env, 'win32'));
  // Shaped like the migration: one order-row lock, then the reservation lock.
  const close = 'select * into v_order\n    from public.orders\n   where id = p_order_id\n     for update;\n'
    + 'select status into v_reservation_status\n    from public.course_coupon_reservations\n'
    + '   where order_id = p_order_id\n     for update;';
  const mutated = withoutOrderRowLock(close);
  assert(mutated.match(orderRowLock) === null && mutated.split('for update;').length === 2);
  assert(mutated.includes('from public.orders\n   where id = p_order_id;\n'));
  assert.throws(() => withoutOrderRowLock('select 1;'));
  assert.throws(() => withoutOrderRowLock(close + close));
  assert.deepEqual(parseOutput('outcome=settled\npaid_at=\n'), { outcome: 'settled', paid_at: '' });
  assert.throws(() => parseOutput('outcome=paid\noutcome=paid\n'));
  assert.throws(() => parseOutput('BEGIN\n'));
  assert(sqlStateOf('psql:<stdin>:3: ERROR:  P0001\n') === 'P0001' && sqlStateOf('') === 'none');
  assert(quote("a'b") === "'a''b'");
  console.log('[order-concurrency] PASS self-test (no database or processes)');
}

async function run() {
  const db = isolatedDatabase(process.env, process.platform);
  const withoutLock = process.env.WITHOUT_ORDER_ROW_LOCK === '1';
  const env = { PATH: process.env.PATH, HOME: '/tmp', LANG: 'C.UTF-8',
    PGHOST: '127.0.0.1', PGPORT: db.port, PGDATABASE: 'postgres', PGUSER: 'postgres',
    PGPASSWORD: decodeURIComponent(db.password), PGPASSFILE: '/dev/null',
    PGSERVICEFILE: '/dev/null', PGCONNECT_TIMEOUT: '5',
    PGOPTIONS: '-c statement_timeout=15000 -c lock_timeout=15000 -c idle_in_transaction_session_timeout=30000 -c TimeZone=UTC' };
  const args = ['-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '-f', '-'];
  const suffix = randomBytes(6).toString('hex');
  const app = `ci-order-${suffix}`;
  const writers = [];
  const orders = [];
  const coupons = [];
  let originals;
  function sql(label, body) {
    stage = label;
    const result = spawnSync('psql', args, { env: { ...env, PGAPPNAME: `${app}-observer` },
      input: `begin;\n${body}\n;\ncommit;`, encoding: 'utf8', timeout: 30000,
      maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
    if (result.error || result.status !== 0) {
      console.error(`[order-concurrency] SQLSTATE ${label} ${sqlStateOf(result.stderr)}`);
    }
    assert(!result.error && result.status === 0);
    return result.stdout.trim();
  }
  function writer(name) {
    const child = spawn('psql', args, { env: { ...env, PGAPPNAME: name },
      stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000, killSignal: 'SIGTERM' });
    const w = { child, name, out: '', err: '', failed: false };
    child.stdout.on('data', (chunk) => { w.out = (w.out + chunk).slice(-65536); });
    child.stderr.on('data', (chunk) => { w.err = (w.err + chunk).slice(-65536); });
    child.stdin.on('error', () => {});
    w.done = new Promise((resolve) => {
      child.once('error', () => { w.failed = true; resolve(null); });
      child.once('close', resolve);
    });
    writers.push(w);
    return w;
  }
  const send = (w, body, end = false) => new Promise((resolve, reject) => {
    w.child.stdin.write(body, (error) => error ? reject(error) : resolve());
    if (end) w.child.stdin.end();
  });
  async function observed(label, query, active) {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      if (sql(label, query) === 't') return;
      assert(active.every((w) => !w.failed && w.child.exitCode === null && w.child.signalCode === null));
      await pause(75);
    }
    assert.fail();
  }
  function cleanup() {
    const ownOrders = `array[${orders.map(quote).join(',')}]::text[]`;
    const ownCoupons = `array[${coupons.map(quote).join(',')}]::uuid[]`;
    return sql('fixture-cleanup', `
      delete from public.checkout_locks where order_id = any(${ownOrders});
      delete from public.course_coupon_reservations where order_id = any(${ownOrders});
      delete from public.orders where id = any(${ownOrders});
      delete from public.course_coupons where id = any(${ownCoupons});
      select (select count(*) from public.orders where id = any(${ownOrders}))
        + (select count(*) from public.course_coupons where id = any(${ownCoupons}))
        + (select count(*) from public.course_coupon_reservations where order_id = any(${ownOrders}))
        + (select count(*) from public.checkout_locks where order_id = any(${ownOrders}));`);
  }
  const rpc = (kind, order) => kind === 'paid'
    ? `public.settle_paid_course_order(${quote(order)}, ${quote(`cs_${order}`)}, ${quote(`pi_${order}`)}, 'acct_ci_concurrency', null)`
    : `public.close_unpaid_course_order(${quote(order)}, ${quote(`cs_${order}`)}, 'cancelled', 'acct_ci_concurrency')`;
  try {
    if (withoutLock) {
      originals = ['public.close_unpaid_course_order(text,text,text,text)',
        'public.settle_paid_course_order(text,text,text,text,text)'].map((fn) => ({ fn,
        body: sql('read-function', `select pg_get_functiondef(${quote(fn)}::regprocedure);`) }));
      const mutations = originals.map(({ body }) => withoutOrderRowLock(body));
      sql('remove-order-lock', mutations.join('\n'));
    }
    const pair = JSON.parse(sql('fixture-pair', `select json_build_object('course', c.id, 'buyer', c.owner_id)
      from public.courses c join public.users u on u.uid = c.owner_id
      where not exists (select 1 from public.checkout_locks l where l.lock_key = c.owner_id || '__' || c.id)
      order by c.id limit 1;`));
    const cases = [['paid-wins-no-coupon', 'paid', 'close', false],
      ['paid-wins', 'paid', 'close', true], ['terminal-wins', 'close', 'paid', true],
      ['duplicate-paid', 'paid', 'paid', true]];
    for (const [index, [name, firstKind, secondKind, withCoupon]] of cases.entries()) {
      // The negative control changes actual paid state without a coupon masking the stale read.
      if (withoutLock && index > 0) break;
      const order = `ci_order_${suffix}_${index}`;
      const coupon = randomUUID();
      orders.push(order);
      if (withCoupon) coupons.push(coupon);
      sql(`${name}-fixture`, `insert into public.orders
        (id,user_id,course_id,amount_minor,currency,status,checkout_session_id,payout_model,teacher_stripe_connected_account_id)
        values (${quote(order)},${quote(pair.buyer)},${quote(pair.course)},9000,'USD','pending',
          ${quote(`cs_${order}`)},'direct_charge','acct_ci_concurrency');
        insert into public.checkout_locks (lock_key,user_id,course_id,order_id)
        values (${quote(`${pair.buyer}__${pair.course}`)},${quote(pair.buyer)},${quote(pair.course)},${quote(order)});
        ${withCoupon ? `insert into public.course_coupons
          (id,course_id,owner_id,code,percent_off,max_redemptions,redeemed_count,active)
          values (${quote(coupon)},${quote(pair.course)},${quote(pair.buyer)},${quote(`CICONC-${suffix.toUpperCase()}-${index}`)},10,10,0,true);
          insert into public.course_coupon_reservations (order_id,coupon_id,user_id,status,expires_at)
          values (${quote(order)},${quote(coupon)},${quote(pair.buyer)},'reserved',now()+interval '1 hour');` : ''}`);
      const first = writer(`${app}-${index}-a`);
      const second = writer(`${app}-${index}-b`);
      const statement = (kind) => `begin; set local role service_role;
        select 'outcome=' || ${rpc(kind, order)};
        select 'paid_at=' || coalesce(paid_at::text,'') from public.orders where id=${quote(order)} /* order-concurrency-ready */;\n`;
      await send(first, statement(firstKind));
      await observed(`${name}-first-ready`, `select exists(select 1 from pg_stat_activity
        where application_name=${quote(first.name)} and state='idle in transaction'
          and position('/* order-concurrency-ready */' in query)>0);`, [first]);
      await send(second, statement(secondKind) + 'commit;\n', true);
      await observed(`${name}-overlap`, `select exists(select 1 from pg_stat_activity a,pg_stat_activity b
        where a.application_name=${quote(first.name)} and b.application_name=${quote(second.name)}
          and a.pid=any(pg_blocking_pids(b.pid)) and b.wait_event_type='Lock');`, [first, second]);
      check(`${name}-overlap`, true);
      await send(first, 'commit;\n', true);
      for (const w of [first, second]) {
        stage = `${name}-writer-exit`;
        const exit = await within(w.done, 30000);
        if (exit !== 0 || w.failed) console.error(`[order-concurrency] SQLSTATE ${stage} ${sqlStateOf(w.err)}`);
        assert(exit === 0 && !w.failed);
      }
      const a = parseOutput(first.out);
      const b = parseOutput(second.out);
      const paid = firstKind === 'paid';
      check(`${name}-outcome`, a.outcome === (paid ? 'settled' : 'closed')
        && b.outcome === (paid ? secondKind === 'paid' ? 'paid' : 'settled' : 'closed'));
      const state = JSON.parse(sql(`${name}-state`, `select json_build_object('status',o.status,
        'intent',o.payment_intent_id,'paid_at',coalesce(o.paid_at::text,''),
        'locks',(select count(*) from public.checkout_locks where order_id=o.id),
        'coupon',(select status from public.course_coupon_reservations where order_id=o.id),
        'redemptions',(select redeemed_count from public.course_coupons where id=${quote(coupon)}))
        from public.orders o where o.id=${quote(order)};`));
      check(`${name}-state`, state.status === (paid ? 'paid' : 'cancelled')
        && state.intent === (paid ? `pi_${order}` : null) && state.locks === (paid ? 1 : 0)
        && (!withCoupon || (state.coupon === (paid ? 'redeemed' : 'released') && state.redemptions === (paid ? 1 : 0))));
      check(`${name}-timestamp`, state.paid_at === a.paid_at && b.paid_at === a.paid_at
        && (paid ? a.paid_at !== '' : a.paid_at === ''));
      assert(cleanup() === '0');
    }
  } finally {
    for (const w of writers) if (w.child.exitCode === null && w.child.signalCode === null) w.child.kill('SIGTERM');
    for (const w of writers) {
      if (await within(w.done, 2000) === 'timeout') {
        w.child.kill('SIGKILL');
        assert(await within(w.done, 2000) !== 'timeout');
      }
    }
    if (writers.length) sql('stop-backends', `select pg_terminate_backend(pid) from pg_stat_activity
      where application_name=any(array[${writers.map(({ name }) => quote(name)).join(',')}]::text[]);`);
    if (originals) {
      sql('restore-functions', originals.map(({ body }) => body).join('\n'));
      for (const { fn, body } of originals) assert(sql('verify-restore',
        `select pg_get_functiondef(${quote(fn)}::regprocedure);`) === body);
      check('functions-restored', true);
    }
    check('cleanup', cleanup() === '0');
  }
  check('assertions', failures.length === 0);
  if (failures.length) process.exitCode = 1;
}

try {
  selfTest();
  if (!process.argv.includes('--self-test')) await run();
} catch {
  console.error(`[order-concurrency] FAIL infrastructure-${stage}`);
  process.exitCode = 1;
}
