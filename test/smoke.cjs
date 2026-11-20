const { chromium } = require('/opt/npm-tools/node_modules/playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 960 } });
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load/.test(m.text())) errs.push('console: ' + m.text()); });
  await p.goto('file:///home/claude/responder-review/dist/responder-review.html');
  await p.waitForSelector('.tile img');
  const dsErr = await p.evaluate(() => window.FlywheelVisionDesignSystem_6c883d.__errors);
  console.log('ds errors', JSON.stringify(dsErr));
  await p.screenshot({ path: 'test/01-grid.png' });
  // select images & approve S101
  const picks = p.locator('.tile .pick button');
  await picks.nth(1).click(); await picks.nth(5).click();
  await p.locator('.tile').nth(9).click();
  await p.screenshot({ path: 'test/02-picked.png' });
  await p.getByRole('button', { name: 'Record Decision...' }).click();
  await p.waitForTimeout(500); await p.screenshot({ path: 'test/03-confirm.png' });
  await p.getByRole('button', { name: /Record as/ }).click();
  await p.waitForTimeout(300);
  // consent-declined subject
  await p.getByRole('option').filter({ hasText: 'S107' }).click();
  await p.waitForTimeout(4500); await p.screenshot({ path: 'test/04-declined.png' });
  // no label -> run gear
  await p.getByRole('button', { name: /No Label/ }).click();
  await p.getByRole('option').filter({ hasText: 'S130' }).click();
  await p.getByRole('button', { name: /Run Derm Foundation/ }).click();
  await p.waitForTimeout(1500);
  await p.screenshot({ path: 'test/05-gear-running.png' });
  await p.waitForTimeout(3500);
  await p.screenshot({ path: 'test/06-gear-done.png' });
  // compare
  await p.getByRole('button', { name: 'All 12' }).click();
  await p.getByRole('option').filter({ hasText: 'S104' }).click();
  await p.getByRole('button', { name: 'Compare' }).click();
  await p.waitForTimeout(300);
  await p.screenshot({ path: 'test/07-compare.png' });
  await p.getByRole('tab', { name: 'Audit Trail' }).click().catch(()=>p.getByText('Audit Trail').click());
  await p.screenshot({ path: 'test/08-audit.png' });
  await p.getByRole('button', { name: 'Info' }).click();
  await p.screenshot({ path: 'test/09-info.png' });
  await p.getByRole('button', { name: /Export Approved/ }).click();
  await p.waitForTimeout(500); await p.screenshot({ path: 'test/10-export.png' });
  console.log('errors', errs.length, errs.slice(0, 10));
  await b.close();
})();
