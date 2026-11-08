import { test, expect } from '@playwright/test';

async function analyze(page, scenario = 'complete') {
  await page.goto('/security');
  await expect(page.getByText('Demonstração local com evidências sintéticas. Nenhum site é acessado.')).toBeVisible();
  await page.getByLabel('Domínio do site').fill('example.com');
  await expect(page.getByText('Alvo:', { exact: false })).toContainText('https://example.com/');
  await page.getByLabel('Cenário sintético').selectOption(scenario);
  await page.getByRole('button', { name: 'Analisar site' }).click();
  await expect(page.locator('#report')).toBeVisible({ timeout: 15000 });
}
test('desktop: complete report, safe text, consent, durable lead, reload and deletion', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await analyze(page);
  await expect(page.locator('#score')).toHaveText('75');
  await expect(page.locator('#priorities article')).toHaveCount(2);
  await expect(page.locator('#coverage')).toHaveText('100%');
  await expect(page.locator('#disclaimer')).toContainText('Não garante que o site seja seguro.');
  await page.locator('#technical summary').click();await expect(page.locator('#report-versions')).toContainText('normalized-v2-proposal');
  await expect(page.locator('#collection-checks article')).toHaveCount(4);await expect(page.locator('#collection-checks')).toContainText('DNS informativo');
  await page.getByRole('button', { name: 'Pedir ajuda' }).click();
  await page.getByRole('button', { name: 'Registrar pedido sintético' }).click();
  await expect(page.locator('#lead-status')).toContainText('marque o consentimento');
  await page.locator('#lead-consent').check();
  await page.getByRole('button', { name: 'Registrar pedido sintético' }).click();
  await expect(page.locator('#lead-status')).toContainText('Nenhum contato foi enviado ao CRM.');
  await page.screenshot({ path: 'test-results/browser/desktop-report.png', fullPage: true });
  await page.reload(); await expect(page.locator('#score')).toHaveText('75');
  await page.getByRole('button', { name: 'Excluir dados deste diagnóstico' }).click();
  await expect(page.locator('#job-panel')).toBeHidden();
  expect(errors).toEqual([]);
});
test('partial report: number with partial label and explicit limitation', async ({ page }) => {
  await analyze(page, 'partial'); await expect(page.locator('#score')).toHaveText('100');
  await expect(page.locator('#coverage')).toHaveText('95%'); await expect(page.locator('#report-label')).toContainText('Parcial');
  await expect(page.locator('#limitations')).toContainText('REFERRER');
});
test('mobile: insufficient coverage suppresses score, no overflow, keyboard path works', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await analyze(page, 'insufficient');
  await expect(page.locator('#score')).toHaveText('—'); await expect(page.locator('#score-message')).toContainText('Cobertura insuficiente');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#technical summary').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#evaluations')).toBeVisible();
  await page.screenshot({ path: 'test-results/browser/mobile-report.png', fullPage: true });
});
test('collection failure stops polling and never shows a positive score', async ({ page }) => {
  await analyze(page, 'inconclusive'); await expect(page.locator('#job-heading')).toHaveText('Análise inconclusiva');
  await expect(page.locator('#score')).toHaveText('—'); await expect(page.locator('#help')).toBeHidden();
  let polls = 0; page.on('request', r => { if (r.method() === 'GET' && /\/analyses\//u.test(r.url())) polls++; });
  await page.waitForTimeout(3000); expect(polls).toBe(0);
});
test('invalid target preserves input and sends no creation request', async ({ page }) => {
  await page.goto('/security'); await expect(page.locator('#analyze-button')).toBeEnabled();
  await page.getByLabel('Domínio do site').fill('https://example.com/private');
  let posts = 0; page.on('request', r => { if (r.method() === 'POST') posts++; });
  await page.getByRole('button', { name: 'Analisar site' }).click();
  await expect(page.locator('#target-error')).toContainText('Informe um domínio válido');
  await expect(page.getByLabel('Domínio do site')).toHaveValue('https://example.com/private'); expect(posts).toBe(0);
});
test('removed report on reload shows retention state rather than hiding the panel', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('sc-job', '00000000-0000-4000-8000-000000000001'));
  await page.route('**/api/v1/analyses/*', route => route.fulfill({ status: 410, contentType: 'application/json', body: JSON.stringify({ message: 'Relatório removido por retenção.' }) }));
  await page.goto('/security'); await expect(page.locator('#job-heading')).toHaveText('Relatório removido por retenção');
  await expect(page.locator('#job-panel')).toBeVisible(); await expect(page.locator('#report')).toBeHidden();
  await expect(page.locator('#resume')).toBeHidden();
});
test('polling network failure keeps the job and resumes without another POST', async ({ page }) => {
  await analyze(page); const id = await page.evaluate(() => sessionStorage.getItem('sc-job'));
  let posts = 0; let unavailable = true;
  page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/analyses')) posts++; });
  await page.route('**/api/v1/analyses/*', async route => { if (unavailable) await route.abort(); else await route.continue(); });
  await page.reload(); await expect(page.locator('#resume')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('sc-job'))).toBe(id);
  unavailable = false; await page.getByRole('button', { name: 'Retomar consulta' }).click();
  await expect(page.locator('#report')).toBeVisible(); expect(posts).toBe(0);
});
test('hostile evidence is rendered as text and a new job resets prior consent', async ({ page }) => {
  await page.route('**/api/v1/analyses/*', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch(); const body = await response.json();
    if (body.report) {
      body.report.priorities[0].observation = '<img src=x onerror="window.fixtureExecuted=true">';
      return route.fulfill({ response, json: body });
    }
    return route.fulfill({ response, json: body });
  });
  await analyze(page); await expect(page.locator('#priorities')).toContainText('<img src=x');
  await expect(page.locator('#priorities img')).toHaveCount(0);
  expect(await page.evaluate(() => window.fixtureExecuted)).toBeUndefined();
  await page.getByRole('button', { name: 'Pedir ajuda' }).click(); await page.locator('#lead-consent').check();
  await page.getByRole('button', { name: 'Analisar site' }).click();
  await expect(page.locator('#lead-form')).toBeHidden(); await expect(page.locator('#lead-consent')).not.toBeChecked();
});
test('corrupt stored request does not disable the page', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('sc-pending', 'not-json'));
  await page.goto('/security'); await expect(page.locator('#analyze-button')).toBeEnabled();
});
