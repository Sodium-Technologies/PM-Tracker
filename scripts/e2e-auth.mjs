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

const session = (email) => ({
  access_token: 'stub-access-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'stub-refresh-token',
  user: { id: 'stub-user', email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} },
});

/** Open the app with Supabase stubbed: `role` null means "not on the list".
 *  `down: true` makes every call to the project fail, as an unreachable or
 *  paused project does. */
async function open({ email, role, periods = [], down = false, path = '' }) {
  const ctx = await browser.newContext();
  await ctx.route('**/stub.supabase.co/**', async (route) => {
    if (down) return route.abort('connectionrefused');
    const url = route.request().url();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/otp')) return json({});
    if (url.includes('/auth/v1/verify')) {
      const body = JSON.parse(route.request().postData() || '{}');
      // The stub accepts one code, so the page's success and failure paths are
      // both exercised.
      if (body.token === '123456') return json(session(body.email));
      return route.fulfill({
        status: 403, contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid_grant', error_description: 'Token has expired or is invalid' }),
      });
    }
    if (url.includes('/auth/v1/token')) return json(session(email ?? 'nobody@example.com'));
    if (url.includes('/auth/v1/user')) return json(session(email ?? 'nobody@example.com').user);
    if (url.includes('/auth/v1/logout')) return route.fulfill({ status: 204, body: '' });
    if (url.includes('/rest/v1/app_users')) {
      if (route.request().method() !== 'GET') return json([]);
      return json(role ? [{ email, role, created_at: '2026-01-01' }] : []);
    }
    if (url.includes('/rest/v1/periods')) {
      if (route.request().method() !== 'GET') return json([]);
      return json(periods.map((p) => ({ id: p.id, label: p.label, data: p })));
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
  await page.getByRole('button', { name: /sign-in link/i }).click();
  await page.waitForTimeout(400);
  ok('requesting a link confirms it was sent', (await page.locator('.signin-card').innerText()).includes('Check your email'));
  ok('the link is the main instruction', /Click the link/.test(await page.locator('.signin-card').innerText()));
  ok('code entry is offered but not demanded', !(await page.locator('#signin-code').isVisible()));

  await page.locator('.code-fallback summary').click();
  ok('the code option opens on request', await page.locator('#signin-code').isVisible());
  await page.locator('#signin-code').fill('000000');
  await page.getByRole('button', { name: /Sign in with code/ }).click();
  await page.waitForTimeout(500);
  ok('a wrong code is rejected with a reason',
     /wrong or has expired/.test(await page.locator('.signin-card').innerText()));

  await page.locator('#signin-code').fill('123456');
  await page.getByRole('button', { name: /Sign in with code/ }).click();
  await page.waitForTimeout(900);
  ok('the right code signs in without touching a redirect URL',
     (await page.locator('.signin-card').count()) === 0 || !(await page.locator('#signin-code').isVisible()),
     (await page.locator('h1').first().innerText().catch(() => 'signed in')));
  ok('no page errors while signed out', errors.length === 0, errors.join('; '));
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

// 3. viewer
{
  const { page, ctx, errors } = await open({ email: 'partner@company.com', role: 'viewer', periods: [samplePeriod] });
  ok('viewer sees the books', (await page.locator('.figure').count()) > 0);
  ok('viewer sees the shared period', (await page.locator('.period-name').inputValue()) === 'September 2026');
  ok('viewer is labelled view only', (await page.locator('.role').innerText()).trim() === 'Can look');
  ok('viewer gets no New period button', (await page.getByRole('button', { name: 'Start a new month' }).count()) === 0);
  ok('viewer gets no Import button', (await page.getByRole('button', { name: /Load a sheet/ }).count()) === 0);
  ok('viewer gets no Delete button', (await page.getByRole('button', { name: 'Delete' }).count()) === 0);
  ok('viewer gets no way in to access', (await page.getByRole('button', { name: 'Who can open this' }).count()) === 0);
  ok('viewer sees the view-only badge', await page.locator('.readonly-badge').isVisible());
  ok('viewer lands on the summary', (await page.locator('.tab.active').innerText()) === 'Summary');
  ok('the summary charts the history', (await page.locator('.chart .bar').count()) > 0);
  await page.getByRole('button', { name: 'Revenue' }).click();
  await page.waitForTimeout(300);
  const rate = page.locator('table tbody tr').first().locator('input').nth(2);
  ok('figure inputs are locked for a viewer', await rate.getAttribute('readonly') !== null);
  const before = await rate.inputValue();
  await rate.fill('999').catch(() => {});
  ok('a viewer cannot change a figure', (await rate.inputValue()) === before,
     `was ${before}, now ${await rate.inputValue()}`);
  ok('viewer can still export', (await page.getByRole('button', { name: 'Download as Excel' }).count()) === 1);
  ok('no page errors for a viewer', errors.length === 0, errors.join('; '));
  await ctx.close();
}

// 4. editor
{
  const { page, ctx } = await open({ email: 'editor@company.com', role: 'editor', periods: [samplePeriod] });
  ok('editor is labelled can edit', (await page.locator('.role').innerText()).trim() === 'Can change');
  ok('editor gets New period', (await page.getByRole('button', { name: 'Start a new month' }).count()) === 1);
  ok('editor gets no way in to access', (await page.getByRole('button', { name: 'Who can open this' }).count()) === 0);
  await page.getByRole('button', { name: 'Revenue' }).click();
  await page.waitForTimeout(300);
  const rate = page.locator('table tbody tr').first().locator('input').nth(2);
  ok('figure inputs are editable for an editor', await rate.getAttribute('readonly') === null);
  await ctx.close();
}

// 5. super admin
{
  const { page, ctx, errors } = await open({ email: 'nav8khan@gmail.com', role: 'super_admin', periods: [samplePeriod] });
  ok('administrator is labelled administrator', (await page.locator('.role').innerText()).trim() === 'Runs it');
  ok('administrator gets the access panel', (await page.getByRole('button', { name: 'Who can open this' }).count()) === 1);
  await page.getByRole('button', { name: 'Who can open this' }).click();
  await page.waitForTimeout(400);
  ok('access tab offers to add someone', await page.locator('#grant-email').isVisible());
  ok('access tab lists the three levels',
    (await page.locator('.settle .row').count()) === 3,
    (await page.locator('.settle dt').allInnerTexts()).join(', '));
  ok('administrator cannot change their own row',
    await page.locator('table tbody tr').first().locator('select').isDisabled());
  ok('no page errors for an administrator', errors.length === 0, errors.join('; '));
  await ctx.close();
}

// 6. a sign-in link that failed, reported back in the URL
{
  const { page, ctx } = await open({ path: '/?error=access_denied&error_description=Email+link+is+invalid+or+has+expired' });
  const text = await page.locator('.signin-card').innerText();
  ok('an expired link explains itself', /expired or was already used/.test(text), text.split('\n').slice(-2)[0]);
  ok('an expired link still offers a new one', await page.locator('#signin-email').isVisible());
  ok('the error is cleared from the address bar', !(await page.evaluate(() => window.location.search)));
  await ctx.close();
}

{
  const { page, ctx } = await open({ path: '/?error=invalid_request&error_description=code+verifier+should+be+non-empty' });
  const text = await page.locator('.signin-card').innerText();
  ok('a link opened in another browser says so', /different browser/.test(text), text.split('\n').slice(-2)[0]);
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
