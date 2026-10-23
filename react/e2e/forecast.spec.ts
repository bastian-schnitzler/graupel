import { expect, test } from '@playwright/test';
import { installForecastBridge } from './bridgeFixture';

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', (route) => route.abort());
  await installForecastBridge(page);
});

test('keeps snowy precipitation white in both chart modes without fullscreen snow labels', async ({ page }) => {
  await page.goto('/');
  const embedded = page.locator('svg[data-render-mode="embedded"]');
  const snowBars = embedded.locator('[data-testid="precip-bar"][fill="#ffffff"]');
  await expect(snowBars).toHaveCount(3);
  await expect(embedded.locator('[data-testid="precip-bar"][fill="#2563eb"]')).toHaveCount(1);

  await snowBars.first().hover({ force: true });
  await expect(page.getByTestId('snowfall-row')).toBeVisible();
  await expect(page.getByTestId('accumulated-snowfall-val')).toHaveText('3 cm');
  await expect(page.getByTestId('accumulated-precip-val')).toHaveText('8 mm');
  await expect(page.getByTestId('tooltip-divider-snow')).toBeVisible();

  await embedded.dblclick({ position: { x: 300, y: 100 } });
  const fullscreen = page.locator('svg[data-render-mode="fullscreen"]');
  await expect(fullscreen.locator('[data-testid="precip-bar"][fill="#ffffff"]')).toHaveCount(3);
  await expect(page.getByTestId('fullscreen-details-grid')).not.toContainText(/snow/i);
  await expect(page.getByTestId('fullscreen-details-grid')).toContainText('Accumulated');
  await page.keyboard.press('Escape');
  await expect(fullscreen).toHaveCount(0);
});

test('shows a forecast error and recovers through Retry Fetch', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('meteogram-chart-viewport')).toBeVisible();
  await page.evaluate(() => { (window as any).__e2e.failForecast = true; });
  await page.getByRole('button', { name: 'Refresh Forecast' }).click();
  await expect(page.getByText('E2E forecast failure')).toBeVisible();
  await page.evaluate(() => { (window as any).__e2e.failForecast = false; });
  await page.getByRole('button', { name: 'Retry Fetch' }).click();
  await expect(page.getByTestId('meteogram-chart-viewport')).toBeVisible();
  await expect(page.getByText('E2E forecast failure')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__e2e.forecastCalls)).toBeGreaterThanOrEqual(3);
});

test('aligns the location label and attribution with the drawing-area borders', async ({ page }) => {
  await page.goto('/');
  const shotDir = process.env.E2E_SHOT_DIR;

  const check = async (svgSelector: string, labelId: string, attributionId: string) => {
    const svg = await page.locator(svgSelector).boundingBox();
    const label = await page.getByTestId(labelId).boundingBox();
    const link = await page.getByTestId(attributionId).boundingBox();
    expect(svg && label && link).toBeTruthy();
    if (!svg || !label || !link) return;
    // paddingLeft / paddingRight = 50 of 1000 viewBox units = 5% of the SVG width.
    expect(Math.abs(label.x - (svg.x + svg.width * 0.05))).toBeLessThan(1.5);
    expect(Math.abs(link.x + link.width - (svg.x + svg.width * 0.95))).toBeLessThan(1.5);
    expect(Math.abs(label.y + label.height - (link.y + link.height))).toBeLessThan(1.5);
  };

  // Place, elevation, generation time in brackets (locale format, Europe/Berlin).
  await expect(page.getByTestId('meteogram-footer-location')).toHaveText(/^Test Valley, 1200 m \(.*:45.*\)$/);
  await check('svg[data-render-mode="embedded"]', 'meteogram-footer-location', 'meteogram-footer-attribution');
  if (shotDir) await page.screenshot({ path: `${shotDir}/embedded.png` });

  await page.locator('svg[data-render-mode="embedded"]').dblclick({ position: { x: 300, y: 100 } });
  await expect(page.getByTestId('fullscreen-header-location')).toHaveText(/^Test Valley, 1200 m \(.*\)$/);
  await check('svg[data-render-mode="fullscreen"]', 'fullscreen-header-location', 'fullscreen-header-attribution');
  if (shotDir) await page.screenshot({ path: `${shotDir}/fullscreen.png` });
});

test('copies the meteogram with labels as PNG to the clipboard in both views', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  const shotDir = process.env.E2E_SHOT_DIR;

  const readClipboardPng = () =>
    page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      const item = items.find((entry) => entry.types.includes('image/png'));
      if (!item) return null;
      const blob = await item.getType('image/png');
      const bitmap = await createImageBitmap(blob);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      return { width: bitmap.width, height: bitmap.height, base64: btoa(binary) };
    });

  const copyAndCheck = async (buttonId: string, svgSelector: string, rowId: string, file: string) => {
    await page.getByTestId(buttonId).click();
    await expect(page.getByTestId(buttonId)).toHaveAttribute('data-state', 'done');
    const png = await readClipboardPng();
    expect(png).not.toBeNull();
    const svg = (await page.locator(svgSelector).boundingBox())!;
    const row = (await page.getByTestId(rowId).boundingBox())!;
    const scale = png!.width / svg.width;
    expect(scale).toBeGreaterThanOrEqual(2);
    // Chart and label row, nothing else; the row takes the font size of the
    // weekday labels (#170) and its height scales with it.
    const growth = await page.evaluate(
      ([svgSel, rowTestId]) => {
        const svgEl = document.querySelector(svgSel) as SVGSVGElement;
        const rowEl = document.querySelector(`[data-testid="${rowTestId}"]`)!;
        const headerPx = (11 * svgEl.getBoundingClientRect().height) / svgEl.viewBox.baseVal.height;
        const rowPx = parseFloat(getComputedStyle(rowEl).fontSize);
        return headerPx / rowPx;
      },
      [svgSelector, rowId],
    );
    const expectedHeight =
      (Math.max(svg.y + svg.height, row.y + row.height) - Math.min(svg.y, row.y) + row.height * (growth - 1)) * scale;
    expect(Math.abs(png!.height - expectedHeight)).toBeLessThan(3);
    if (shotDir) {
      const fs = await import('node:fs');
      fs.writeFileSync(`${shotDir}/${file}`, Buffer.from(png!.base64, 'base64'));
    }
  };

  await copyAndCheck('copy-png-button', 'svg[data-render-mode="embedded"]', 'meteogram-footer-row', 'copy-embedded.png');
  if (shotDir) await page.screenshot({ path: `${shotDir}/copy-button.png` });

  await page.locator('svg[data-render-mode="embedded"]').dblclick({ position: { x: 300, y: 100 } });
  await copyAndCheck('fullscreen-copy-png-button', 'svg[data-render-mode="fullscreen"]', 'fullscreen-header-row', 'copy-fullscreen.png');
  // The button never toggles fullscreen.
  await expect(page.getByTestId('fullscreen-meteogram-overlay')).toBeVisible();
});

test('shows an archived forecast and returns to live (#144)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('svg[data-render-mode="embedded"]')).toBeVisible();
  await page.getByTestId('history-button').click();
  await page.getByTestId('history-item-1').click();
  await expect(page.getByTestId('historic-badge')).toContainText('historic: fetched');
  await expect(page.getByTestId('historic-version')).toContainText('E2E Forecast');
  await expect(page.getByTestId('historic-missing')).toContainText('Not archived:');
  await expect(page.getByRole('button', { name: 'Refresh Forecast' })).toBeDisabled();
  await expect(page.locator('svg[data-render-mode="embedded"]')).toBeVisible();
  await page.screenshot({ path: 'test-results/historic-viewer.png' });
  await page.getByTestId('historic-back-to-live').click();
  await expect(page.getByTestId('historic-badge')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Refresh Forecast' })).toBeEnabled();
});
