/**
 * Access-control check for a Supabase-configured build.
 *
 *   VITE_SUPABASE_URL=https://stub.supabase.co VITE_SUPABASE_ANON_KEY=stub-key npm run build
 *   node scripts/e2e-auth.mjs
 *
 * Supabase itself is stubbed at the network boundary: this proves what the page
 * does with each answer — signed out, signed in without access, viewer, editor,
 * administrator — not what the database decides. The database's own rules live
 * in supabase/schema.sql and are enforced there, whatever this page renders.
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { extname, join } from 'path';

const root = new URL('../dist', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const srv = createServer((req, res) => {
  // Strip the query before mapping to a file, or '/?error=…' resolves to the
  // directory itself.
  const path = req.url.split('?')[0];
  const p = join(root, path === '/' ? 'index.html' : path);
  if (!existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(5610);

const ORIGIN = 'http://localhost:5610';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

let failures = 0;
const ok = (label, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};

// A token shaped like the real thing — header, claims, signature — because the
// page reads the claims out of it to say who the database took a request for.
const jwt = (email) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    email, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
  })}.stub-signature`;
};

const session = (email) => ({
  access_token: jwt(email),
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'stub-refresh-token',
  user: { id: 'stub-user', email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} },
});

/** Open the app with Supabase stubbed: `role` null means "not on the list".
 *  `down: true` makes every call to the project fail, as an unreachable or
 *  paused project does. */
async function open({ email, role, staffName = null, periods = [], teamPay = [], teamWrites = [], periodReads = [], down = false, path = '', installed = false, oldSchema = false, writes = [], refuse = 0, tokens = [] }) {
  // `refuse`: how many writes the database turns down as a policy violation
  // before accepting one. `tokens` collects each refresh, so a test can see one
  // happened.
  let refusals = refuse;
  const ctx = await browser.newContext();
  // iOS reports a home-screen app through navigator.standalone; the app reads it
  // to decide that a sign-in link cannot possibly work here.
  if (installed) {
    await ctx.addInitScript(() => {
      Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true });
    });
  }
  await ctx.route('**/stub.supabase.co/**', async (route) => {
    if (down) return route.abort('connectionrefused');
    const url = route.request().url();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/otp')) return json({});
    if (url.includes('/auth/v1/verify')) {
      const body = JSON.parse(route.request().postData() || '{}');
      // A pasted link arrives as a token hash rather than a typed code.
      if (body.token_hash) {
        if (body.token_hash === 'good-hash') return json(session(email ?? 'partner@company.com'));
        return route.fulfill({
          status: 403, contentType: 'application/json',
          body: JSON.stringify({ error: 'invalid_grant', error_description: 'Token has expired or is invalid' }),
        });
      }
      // The stub accepts one code, so the page's success and failure paths are
      // both exercised.
      if (body.token === '123456') return json(session(body.email));
      return route.fulfill({
        status: 403, contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid_grant', error_description: 'Token has expired or is invalid' }),
      });
    }
    if (url.includes('/auth/v1/token')) {
      tokens.push(url);
      return json(session(email ?? 'nobody@example.com'));
    }
    if (url.includes('/auth/v1/user')) return json(session(email ?? 'nobody@example.com').user);
    if (url.includes('/auth/v1/logout')) return route.fulfill({ status: 204, body: '' });
    if (url.includes('/rest/v1/app_users')) {
      if (route.request().method() !== 'GET') return json([]);
      return json(role ? [{ email, role, staff_name: staffName, created_at: '2026-01-01' }] : []);
    }
    if (url.includes('/rest/v1/team_pay')) {
      if (route.request().method() !== 'GET') {
        teamWrites.push({ method: route.request().method(), url, body: route.request().postData() ?? '' });
        return json([]);
      }
      return json(teamPay);
    }
    if (url.includes('/rest/v1/periods')) {
      if (route.request().method() === 'GET') periodReads.push(url);
      if (route.request().method() !== 'GET') {
        // Stand in for a project that has not run the latest schema: the first
        // write, carrying `visibility`, is rejected the way PostgREST rejects it.
        const body = route.request().postData() ?? '';
        // The column is a top-level key of the row. The word also appears inside
        // `data`, which PostgREST neither sees nor objects to.
        const sendsColumn = (() => {
          try {
            return JSON.parse(body)
              .some((row) => Object.prototype.hasOwnProperty.call(row, 'visibility'));
          } catch { return false; }
        })();
        if (refusals > 0) {
          refusals--;
          return route.fulfill({
            status: 403, contentType: 'application/json',
            body: JSON.stringify({ code: '42501', message: 'new row violates row-level security policy for table "periods"' }),
          });
        }
        if (oldSchema && sendsColumn) {
          return route.fulfill({
            status: 400, contentType: 'application/json',
            body: JSON.stringify({
              code: 'PGRST204',
              message: "Could not find the 'visibility' column of 'periods' in the schema cache",
            }),
          });
        }
        writes.push(body);
        return json([]);
      }
      return json(periods.map((p) => ({
        id: p.id, label: p.label, data: p,
        visibility: p.visibility ?? 'core', owner_email: 'nav8khan@gmail.com',
      })));
    }
    return json({});
  });
  if (email) {
    await ctx.addInitScript((s) => {
      // supabase-js restores its session from localStorage before any network call
      for (const key of ['sb-stub-auth-token', 'sb-localhost-auth-token']) {
        window.localStorage.setItem(key, JSON.stringify(s));
      }
    }, session(email));
  }
  const page = await ctx.newPage();
  ctx.__writes = writes;
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(ORIGIN + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  return { page, ctx, errors };
}

const samplePeriod = {
  id: 'p1', label: 'September 2026', usdToPkr: 270,
  accounts: [{
    id: 'a1', name: 'Luxe', owner: 'Outside', currency: 'USD', rate: 10, entries: [20, 20, 20, 20],
    feePct: 0, adjustmentUsd: 0, freelancerPct: 70, status: 'Pending', notes: '',
  }],
  staff: [{ id: 's1', name: 'Naveed', shares: { a1: 1 }, adjustmentPkr: 0, retained: false, notes: '' }],
  reimbursements: [], otherPayables: [], withheld: [], localWages: [], transfers: [], timeFormat: 'decimal',
};

// 1. signed out
{
  const { page, ctx, errors } = await open({});
  ok('signed out shows the sign-in screen', await page.locator('.signin-card').isVisible());
  ok('signed out shows no figures', (await page.locator('.figure').count()) === 0);
  ok('sign-in asks for an email', await page.locator('#signin-email').isVisible());
  await page.locator('#signin-email').fill('partner@company.com');
  await page.getByRole('button', { name: /Email me a code/i }).click();
  await page.waitForTimeout(400);
  const sentText = await page.locator('.signin-card').innerText();
  ok('requesting a code confirms it was sent', sentText.includes('Check your email'));
  ok('the code box is the only way in', await page.locator('#signin-code').isVisible());
  ok('no link is offered anywhere on the screen',
     !/paste|link/i.test(sentText.replace('Use a different address', '')), sentText.replace(/\n/g, ' / '));
  // A sign-in button that silently does nothing is the worst failure there is.
  await page.locator('#signin-code').fill('');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForTimeout(300);
  ok('pressing sign in with an empty box says so, never nothing',
     /Type the six-digit code/.test(await page.locator('.signin-card').innerText()));

  await page.locator('#signin-code').fill('000000');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForTimeout(500);
  ok('a wrong code is rejected with a reason',
     /wrong or has expired/.test(await page.locator('.signin-card').innerText()));

  await page.locator('#signin-code').fill('123456');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForTimeout(900);
  ok('the right code signs in',
     (await page.locator('.signin-card').count()) === 0 || !(await page.locator('#signin-code').isVisible()),
     (await page.locator('h1').first().innerText().catch(() => 'signed in')));
  ok('no page errors while signed out', errors.length === 0, errors.join('; '));
  await ctx.close();
}

// 1b. the same screen from a home-screen app: one way in, and it works there
{
  const { page, ctx } = await open({ installed: true });
  await page.locator('#signin-email').fill('partner@company.com');
  await page.getByRole('button', { name: /Email me a code/i }).click();
  await page.waitForTimeout(400);
  ok('an installed app gets the same code box', await page.locator('#signin-code').isVisible());
  ok('an installed app is never sent to another app',
     !/Safari|Copy Link|paste/i.test(await page.locator('.signin-card').innerText()));
  await page.locator('#signin-code').fill('123456');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForTimeout(900);
  ok('an installed app signs itself in', (await page.locator('#signin-code').count()) === 0);
  await ctx.close();
}

// 1c. a project that has not run the latest schema still saves the books
{
  const writes = [];
  // An administrator, because the case ends by hiding a month — which only an
  // administrator may do.
  const { page, ctx } = await open({
    email: 'nav8khan@gmail.com', role: 'super_admin', periods: [samplePeriod], oldSchema: true, writes,
  });
  await page.getByRole('button', { name: 'Revenue' }).click();
  await page.waitForTimeout(300);
  const rate = page.locator('table tbody tr').first().locator('input').nth(3);
  await rate.fill('99');
  await page.waitForTimeout(1500);
  // The retry drops the column but keeps the setting inside `data`, so the test
  // has to look at the row's own keys rather than for the word.
  const sentColumn = (body) => {
    try { return JSON.parse(body).some((row) => Object.prototype.hasOwnProperty.call(row, 'visibility')); }
    catch { return false; }
  };
  ok('a write rejected for the missing column is repeated without it',
     writes.length > 0 && writes.every((w) => !sentColumn(w)), `${writes.length} write(s) got through`);
  ok('and the setting still travels inside the month itself',
     writes.some((w) => w.includes('"visibility"')));
  ok('and the books are not reported as lost',
     !/Not saved/.test(await page.locator('body').innerText()));
  // Hiding a month is not something to fail quietly at.
  await page.locator('#visibility').selectOption('private');
  await page.waitForTimeout(1500);
  ok('but hiding a month that could not be hidden says so, and does not call it a failure',
     /not being enforced on the database side/.test(await page.locator('body').innerText())
     && !/Not saved/.test(await page.locator('.toast').innerText().catch(() => '')),
     (await page.locator('.toast').innerText().catch(() => 'no toast')));
  await ctx.close();
}

// 1d. a session that lapsed while the page stayed open
{
  const tokens = [];
  const { page, ctx } = await open({
    email: 'nav8khan@gmail.com', role: 'super_admin', periods: [samplePeriod], refuse: 1, tokens,
  });
  const before = tokens.length;
  await page.getByRole('button', { name: 'Revenue' }).click();
  await page.waitForTimeout(300);
  await page.locator('table tbody tr').first().locator('input').nth(3).fill('77');
  await page.waitForTimeout(1800);
  ok('a policy refusal refreshes the session and tries again', tokens.length > before,
     `${tokens.length - before} refresh(es)`);
  ok('and when that cures it, nothing is reported', !/Not saved/.test(await page.locator('body').innerText()));
  await ctx.close();
}
{
  const { page, ctx } = await open({
    email: 'nav8khan@gmail.com', role: 'super_admin', periods: [samplePeriod], refuse: 99,
  });
  await page.getByRole('button', { name: 'Revenue' }).click();
  await page.waitForTimeout(300);
  await page.locator('table tbody tr').first().locator('input').nth(3).fill('78');
  await page.waitForTimeout(1800);
  const said = await page.locator('.toast').innerText().catch(() => '');
  ok('a refusal a refresh cannot cure names who the database took you for',
     /nav8khan@gmail\.com/.test(said), said);
  ok('and, for an administrator, blames the rules rather than the sign-in',
     /super admin/.test(said) && /repair-visibility/.test(said));
  await ctx.close();
}

// 2. signed in, not on the access list
{
  const { page, ctx } = await open({ email: 'stranger@example.com', role: null, periods: [samplePeriod] });
  const text = await page.locator('.signin-card').innerText();
  ok('an address with no access is told so', text.includes('No access yet'));
  ok('an address with no access sees no figures', (await page.locator('.figure').count()) === 0);
  await ctx.close();
}

// 3. team member
{
  const periodReads = [];
  const summary = {
    label: 'September 2026', name: 'Naveed', usdToPkr: 280,
    projects: [{ name: 'Luxe', hours: 80, sharePct: 100, earnedPkr: 112000, earnedUsd: 400,
      cycleStart: '2026-09-01', cycleEnd: '2026-09-30' }],
    sharePkr: 112000, adjustmentPkr: 0, payPkr: 112000, payUsd: 400, takenPkr: 12000, stillOwedPkr: 100000,
  };
  const { page, ctx, errors } = await open({
    email: 'partner@company.com', role: 'viewer', staffName: 'Naveed', periods: [samplePeriod],
    teamPay: [{ period_id: 'p1', label: 'September 2026', summary }], periodReads,
  });
  await page.waitForTimeout(500);
  ok('a team member is labelled Team', (await page.locator('.role').innerText()).trim() === 'Team');
  ok('a team member never asks for the books', periodReads.length === 0, periodReads.join(', '));
  ok('a team member sees their own pay', /112,000/.test(await page.locator('.team-sheet').innerText()));
  ok('and the projects it came from', /Luxe/.test(await page.locator('.team-sheet').innerText()));
  ok('and what is still owed', /100,000/.test(await page.locator('.team-sheet').innerText()));
  ok("and each project's billing cycle", /Sep 1 – Sep 30, 2026/.test(await page.locator('.team-sheet').innerText()));
  ok('a team member gets no month list, settings or tabs',
     (await page.locator('.period-list, .rail-nav, .tabs, #grant-email').count()) === 0);
  ok('a team member gets no way to change anything',
     (await page.locator('.team-sheet input').count()) === 0);
  ok('no page errors for a team member', errors.length === 0, errors.join('; '));
  await ctx.close();
}

{
  const { page, ctx } = await open({ email: 'partner@company.com', role: 'viewer', staffName: null, periods: [samplePeriod] });
  await page.waitForTimeout(500);
  ok('a team member with no person is told why they see nothing',
     /isn't linked/.test(await page.locator('.team-sheet').innerText()));
  await ctx.close();
}

// 4. editor
{
  const { page, ctx } = await open({ email: 'editor@company.com', role: 'editor', periods: [samplePeriod] });
  ok('editor is labelled can edit', (await page.locator('.role').innerText()).trim() === 'Admin');
  ok('editor gets New period', (await page.getByRole('button', { name: 'Start a new month' }).count()) === 1);
  ok('editor can set who sees a month', await page.locator('#visibility').isVisible());
  ok('a month defaults to the core team', (await page.locator('#visibility').inputValue()) === 'core');
  ok('an editor is not offered hiding a month',
     !(await page.locator('#visibility option').allInnerTexts()).some((t) => /Only me/.test(t)),
     (await page.locator('#visibility option').allInnerTexts()).join(', '));
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.waitForTimeout(300);
  ok('editor gets no access panel', (await page.locator('#grant-email').count()) === 0);
  await page.getByRole('button', { name: /Back to/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Revenue' }).click();
  await page.waitForTimeout(300);
  const rate = page.locator('table tbody tr').first().locator('input').nth(4);
  ok('figure inputs are editable for an editor', await rate.getAttribute('readonly') === null);

  // Billing cycle
  ok('the revenue table has a billing cycle column',
     (await page.locator('thead th').allInnerTexts()).slice(0, 2).join('|').toLowerCase() === 'client|billing cycle',
     (await page.locator('thead th').allInnerTexts()).slice(0, 2).join('|'));
  const fill = page.getByRole('button', { name: /Fill 1 empty cycle/ });
  ok('a client with no cycle can be filled from the month', await fill.isVisible());
  await fill.click();
  await page.waitForTimeout(300);
  const start = page.getByLabel('Luxe billing cycle starts');
  const end = page.getByLabel('Luxe billing cycle ends');
  ok('filling uses the whole month', (await start.inputValue()) === '2026-09-01' && (await end.inputValue()) === '2026-09-30',
     `${await start.inputValue()} to ${await end.inputValue()}`);
  ok('the cycle says how long it runs', /30 days/.test(await page.locator('td.cycle').first().innerText()));
  ok('nothing is left to fill', (await page.getByRole('button', { name: /empty cycle/ }).count()) === 0);
  await start.fill('2026-09-15');
  await end.fill('2026-10-14');
  await page.waitForTimeout(200);
  ok('a cycle can run across two months', /30 days/.test(await page.locator('td.cycle').first().innerText()));
  await end.fill('2026-09-10');
  await page.waitForTimeout(200);
  ok('a cycle that ends before it starts is flagged',
     /ends before it starts/.test(await page.locator('td.cycle').first().innerText()));
  await ctx.close();
}

// 5. super admin
{
  const teamWrites = [];
  const { page, ctx, errors } = await open({ email: 'nav8khan@gmail.com', role: 'super_admin', periods: [samplePeriod], teamWrites });
  await page.waitForTimeout(500);
  const published = teamWrites.find((w) => w.method === 'POST');
  ok("opening the books publishes each person's pay to the team", !!published);
  ok('what is published carries no client rate or revenue',
     !!published && !/"rate"|grossUsd|freelancerPct|feePct|companyPkr/.test(published.body), published?.body.slice(0, 200));
  ok('administrator is labelled administrator', (await page.locator('.role').innerText()).trim() === 'Super admin');
  ok('an administrator is offered all three levels',
     (await page.locator('#visibility option').allInnerTexts()).join(', ')
       === 'Only me, Core — admins only, Team — each sees their own pay',
     (await page.locator('#visibility option').allInnerTexts()).join(', '));
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.waitForTimeout(400);
  ok('administrator gets the access panel in settings', await page.locator('#grant-email').isVisible());
  ok('settings offers loading a sheet', (await page.getByRole('button', { name: /Load a sheet/ }).count()) === 1);
  ok('settings offers saving a backup', (await page.getByRole('button', { name: 'Save a backup' }).count()) === 1);
  ok('access tab lists the three levels',
    (await page.locator('.settle .row').count()) === 3,
    (await page.locator('.settle dt').allInnerTexts()).join(', '));
  await page.locator('select[aria-label="Access level"]').selectOption('viewer');
  ok('adding a team member asks which person they are', await page.locator('#grant-person').isVisible());
  ok('the people offered are the ones on the payroll',
     (await page.locator('#grant-person option').allInnerTexts()).join('|') === 'Which person?|Naveed');
  ok('a team member cannot be let in without a person',
     await page.getByRole('button', { name: 'Let them in' }).isDisabled());
  ok('administrator cannot change their own row',
    await page.locator('table tbody tr').first().locator('select').isDisabled());
  ok('no page errors for an administrator', errors.length === 0, errors.join('; '));
  await ctx.close();
}

// 6. a sign-in link that failed, reported back in the URL
{
  const { page, ctx } = await open({ path: '/?error=access_denied&error_description=Email+link+is+invalid+or+has+expired' });
  const text = await page.locator('.signin-card').innerText();
  ok('an old link explains itself', /no longer works/.test(text), text.split('\n').slice(-2)[0]);
  ok('an old link still offers a code', await page.locator('#signin-email').isVisible());
  ok('the error is cleared from the address bar', !(await page.evaluate(() => window.location.search)));
  await ctx.close();
}

{
  const { page, ctx } = await open({ path: '/?error=invalid_request&error_description=code+verifier+should+be+non-empty' });
  const text = await page.locator('.signin-card').innerText();
  ok('any old link points at the code', /no longer works/.test(text), text.split('\n').slice(-2)[0]);
  await ctx.close();
}

// 7. configured, but the project cannot be reached
{
  const { page, ctx } = await open({ email: 'nav8khan@gmail.com', role: 'super_admin', down: true });
  const text = await page.locator('.signin-card').innerText();
  ok('an unreachable project says so instead of hanging', text.includes('Cannot reach sign-in'), text.split('\n')[0]);
  ok('an unreachable project shows no figures', (await page.locator('.figure').count()) === 0);
  await ctx.close();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll access checks passed');
await browser.close();
srv.close();
process.exit(failures ? 1 : 0);
