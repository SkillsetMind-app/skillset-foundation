// Somente CI efemero: duas conexoes reais, sobreposicao observada pelo Postgres.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
let stage = 'guard';
const check = (name, ok) => {
  console.log(`[certificate-concurrency] ${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failures.push(name);
};
const within = (promise, ms) => {
  let timer;
  return Promise.race([promise, new Promise((resolve) => {
    timer = setTimeout(resolve, ms, 'timeout');
  })]).finally(() => clearTimeout(timer));
};
const enrollmentLock = /(from public\.enrollments\s+where id = p_enrollment_id)\s+for update;/g;
function withoutEnrollmentLock(body) {
  assert((body.match(enrollmentLock) ?? []).length === 1);
  return body.replace(enrollmentLock, '$1;');
}

function isolatedDatabase(env, platform) {
  assert(env.CI === 'true' && env.GITHUB_ACTIONS === 'true' && platform === 'linux');
  const db = new URL(env.DATABASE_URL);
  assert(['postgres:', 'postgresql:'].includes(db.protocol));
  assert(db.hostname === '127.0.0.1' && db.port === '54322');
  assert(db.pathname === '/postgres' && db.username === 'postgres');
  assert(!db.search && !db.hash);
  return db;
}

// Exportado apenas para o teste unitario das guardas, sem banco ou subprocessos.
export function selfTest() {
  const env = { CI: 'true', GITHUB_ACTIONS: 'true',
    DATABASE_URL: 'postgresql://postgres@127.0.0.1:54322/postgres' };
  isolatedDatabase(env, 'linux');
  for (const url of ['postgresql://postgres@production.invalid:54322/postgres',
    `${env.DATABASE_URL}?host=production.invalid`, `${env.DATABASE_URL}#fragment`,
    env.DATABASE_URL.replace('54322', '5432'), env.DATABASE_URL.replace(/\/postgres$/, '/other'),
    env.DATABASE_URL.replace('//postgres@', '//service_role@')]) {
    assert.throws(() => isolatedDatabase({ ...env, DATABASE_URL: url }, 'linux'));
  }
  assert.throws(() => isolatedDatabase({ ...env, CI: 'false' }, 'linux'));
  assert.throws(() => isolatedDatabase({ ...env, GITHUB_ACTIONS: undefined }, 'linux'));
  assert.throws(() => isolatedDatabase(env, 'win32'));
  assert.throws(() => withoutEnrollmentLock('select 1;'));
  const body = 'from public.enrollments\nwhere id = p_enrollment_id for update;';
  assert(withoutEnrollmentLock(body) === 'from public.enrollments\nwhere id = p_enrollment_id;');
  assert.throws(() => withoutEnrollmentLock(body + body));
}

async function run() {
  const db = isolatedDatabase(process.env, process.platform);
  const withoutLock = process.env.WITHOUT_CERTIFICATE_ENROLLMENT_LOCK === '1';
  // Nao herda PGHOST/PGSERVICE/PGOPTIONS nem outros destinos do ambiente.
  const env = { PATH: process.env.PATH, HOME: '/tmp', LANG: 'C.UTF-8',
    PGHOST: '127.0.0.1', PGPORT: db.port, PGDATABASE: 'postgres', PGUSER: 'postgres',
    PGPASSWORD: decodeURIComponent(db.password), PGPASSFILE: '/dev/null',
    PGSERVICEFILE: '/dev/null', PGCONNECT_TIMEOUT: '5',
    PGOPTIONS: '-c statement_timeout=15000 -c lock_timeout=15000 -c idle_in_transaction_session_timeout=30000' };
  const args = ['-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '-f', '-'];
  const suffix = randomBytes(6).toString('hex');
  const app = `ci-cert-${suffix}`;
  const writers = [];
  const enrollments = [];
  const course = `ci_cert_course_${suffix}`;
  let original;
  const fn = 'public.issue_skillset_certificate(text,text)';
  const sql = (name, body) => {
    stage = name;
    const result = spawnSync('psql', args, { env: { ...env, PGAPPNAME: `${app}-observer` },
      input: `begin; set local request.jwt.claim.role='service_role';
        set local request.jwt.claims='{"role":"service_role"}';\n${body}\n;\ncommit;`, encoding: 'utf8', timeout: 30000,
      maxBuffer: 1024 * 1024 });
    assert(!result.error && result.status === 0);
    return result.stdout.trim();
  };
  function writer(name) {
    const child = spawn('psql', args, { env: { ...env, PGAPPNAME: name },
      stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 });
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
  async function observed(name, query, active) {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      if (sql(name, query) === 't') return;
      assert(active.every((w) => !w.failed && w.child.exitCode === null && w.child.signalCode === null));
      await pause(75);
    }
    assert.fail();
  }
  const cleanup = () => {
    const ids = `array[${enrollments.map(quote).join(',')}]::text[]`;
    return sql('cleanup', `delete from public.certificates where enrollment_id=any(${ids});
      delete from public.lesson_progress where enrollment_id=any(${ids});
      delete from public.enrollments where id=any(${ids});
      select (select count(*) from public.enrollments where id=any(${ids}))
        + (select count(*) from public.certificates where enrollment_id=any(${ids}));`);
  };
  try {
    if (withoutLock) {
      original = sql('read-function', `select pg_get_functiondef(${quote(fn)}::regprocedure);`);
      sql('remove-enrollment-lock', withoutEnrollmentLock(original));
    }
    const fixture = JSON.parse(sql('fixture', `select json_build_object('uid',id)
      from auth.users order by id limit 1;`));
    fixture.course = course;
    sql('seed-course', `insert into public.courses(id,owner_id,slug,title,summary,category,status,
      currency,price_amount_minor,product_format,modules)
      values (${quote(course)},${quote(fixture.uid)},${quote(course)},'CI certificate','CI only',
        'test','published','usd',100,'course',
        '[{"id":"ci-module","lessons":[{"id":"ci-lesson","title":"CI","type":"text"}]}]');`);
    const authenticate = `set local role authenticated;
      select set_config('request.jwt.claims',${quote(JSON.stringify({ sub: fixture.uid,
        role: 'authenticated', aal: 'aal2' }))},true) is not null;
      select set_config('request.jwt.claim.sub',${quote(fixture.uid)},true) is not null;
      select set_config('request.jwt.claim.role','authenticated',true) is not null;`;
    const cases = [['refund-first', 'refund', 'issue', true],
      ['refund-before-first-issue', 'refund', 'issue', false],
      ['first-issue-first', 'issue', 'refund', false],
      ['duplicate-first-issue', 'issue', 'issue', false],
      ['fulfillment-first', 'fulfill', 'issue', false],
      ['issue-before-fulfillment', 'issue', 'fulfill', false]];
    for (const [index, [name, firstKind, secondKind, existing]] of cases.entries()) {
      if (withoutLock && index > 0) break;
      const id = `${fixture.uid}__${fixture.course}`;
      enrollments.push(id);
      sql('seed-enrollment', `insert into public.enrollments
        (id,user_id,course_id,course_slug,course_title,course_category,course_image,status,source,progress_percent)
        values (${quote(id)},${quote(fixture.uid)},${quote(fixture.course)},'ci-cert','CI certificate','test','','completed','payment',100);
        insert into public.lesson_progress(enrollment_id,lesson_id,user_id)
        select ${quote(id)},l->>'id',${quote(fixture.uid)} from public.courses c
        cross join lateral jsonb_array_elements(c.modules) m
        cross join lateral jsonb_array_elements(m->'lessons') l
        where c.id=${quote(fixture.course)} and coalesce(l->>'id','')<>''
        on conflict do nothing;`);
      const issue = `select public.issue_skillset_certificate(${quote(id)},'CI Learner');`;
      if (existing) sql('seed-certificate', `${authenticate}\n${issue}`);
      const service = `set local role service_role;
        set local request.jwt.claim.role='service_role';
        set local request.jwt.claims='{"role":"service_role"}';`;
      const statement = (kind) => kind === 'refund'
        ? `begin; ${service}
          update public.enrollments set status='refunded' where id=${quote(id)};`
        : kind === 'fulfill'
          ? `begin; ${service}
            select public.fulfill_paid_course_access(${quote(fixture.uid)},${quote(fixture.course)},'payment');`
        : `begin; ${authenticate}
          do $body$ begin
            perform public.issue_skillset_certificate(${quote(id)},'CI Learner');
            perform set_config('test.certificate_outcome','issued',true);
          exception when sqlstate 'P0001' then
            if sqlerrm <> 'This enrollment is not eligible for certificate issuance.' then raise; end if;
            perform set_config('test.certificate_outcome','ineligible',true);
          end; $body$;
          select current_setting('test.certificate_outcome');`;
      const first = writer(`${app}-${index}-a`);
      const second = writer(`${app}-${index}-b`);
      await send(first, `${statement(firstKind)}\nselect 'ready' /* certificate-ready */;\n`);
      await observed(`${name}-ready`, `select exists(select 1 from pg_stat_activity
        where application_name=${quote(first.name)} and state='idle in transaction'
        and position('/* certificate-ready */' in query)>0);`, [first]);
      await send(second, `${statement(secondKind)}\ncommit;\n`, true);
      await observed(`${name}-overlap`, `select exists(select 1 from pg_stat_activity a,pg_stat_activity b
        where a.application_name=${quote(first.name)} and b.application_name=${quote(second.name)}
        and a.pid=any(pg_blocking_pids(b.pid)) and b.wait_event_type='Lock');`, [first, second]);
      check(`${name}-overlap`, true);
      await send(first, 'commit;\n', true);
      for (const w of [first, second]) {
        stage = `${name}-writer-exit`;
        assert(await within(w.done, 30000) === 0 && !w.failed);
      }
      const state = JSON.parse(sql('final-state', `select json_build_object('enrollment',e.status,
        'certificate',(select status from public.certificates where enrollment_id=e.id),
        'count',(select count(*) from public.certificates where enrollment_id=e.id))
        from public.enrollments e where id=${quote(id)};`));
      const refunded = firstKind === 'refund' || secondKind === 'refund';
      const noCertificate = firstKind === 'refund' && !existing;
      check(`${name}-state`, state.enrollment === (refunded ? 'refunded' : 'completed')
        && state.certificate === (noCertificate ? null : refunded ? 'refund_revoked' : 'issued')
        && state.count === (noCertificate ? 0 : 1));
      if (firstKind === 'refund') check(`${name}-rejected`, second.out.split('\n').includes('ineligible')
        && !second.out.split('\n').includes('issued'));
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
    if (original) {
      sql('restore-function', original);
      assert(sql('verify-restore', `select pg_get_functiondef(${quote(fn)}::regprocedure);`) === original);
      check('function-restored', true);
    }
    check('cleanup', cleanup() === '0');
    assert(sql('cleanup-course', `delete from public.courses where id=${quote(course)};
      select count(*) from public.courses where id=${quote(course)};`) === '0');
  }
  check('assertions', failures.length === 0);
  if (failures.length) process.exitCode = 1;
}

// Importar pelo Vitest nao deve criar conexoes.
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/check-certificate-concurrency.mjs')) {
  try {
    selfTest();
    await run();
  } catch {
    console.error(`[certificate-concurrency] FAIL infrastructure-${stage}`);
    process.exitCode = 1;
  }
}
