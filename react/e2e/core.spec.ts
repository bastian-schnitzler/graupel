import { expect, test } from '@playwright/test';

// The browser fallback uses local storage and generated forecasts. External map
// tiles are irrelevant to these flows; routing them away keeps runs offline.
test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'geocoding-api.open-meteo.com') {
      return route.fulfill({
        json: {
          results: [{ name: 'Berlin', latitude: 52.52, longitude: 13.405,
            country: 'Germany', admin1: 'Berlin', elevation: 34,
            timezone: 'Europe/Berlin' }],
        },
      });
    }
    if (url.hostname === 'styles.maptoolkit.org' && url.pathname.endsWith('/hiking.json')) {
      return route.fulfill({ json: { version: 8, sources: {}, layers: [] } });
    }
    return route.abort();
  });
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
});

test('starts, renders the forecast, and switches views', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('meteogram-chart-viewport')).toBeVisible();
  await expect(page.locator('svg[data-render-mode="embedded"]')).toBeVisible();
  await page.getByRole('button', { name: 'Config', exact: true }).click();
  await expect(page.getByTestId('config-list')).toBeVisible();
  await page.getByRole('button', { name: 'Meteo', exact: true }).click();
  await expect(page.getByTestId('meteogram-chart-viewport')).toBeVisible();
});

test('creates, renames, persists, duplicates, and deletes a configuration', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Config', exact: true }).click();
  await page.getByRole('button', { name: 'Create new configuration' }).click();
  const name = page.getByPlaceholder('e.g. European Short Range');
  await name.fill('Alpine E2E');
  await name.blur();
  await expect(page.getByTestId('config-list')).toContainText('Alpine E2E');
  await page.reload();
  await page.getByRole('button', { name: 'Config', exact: true }).click();
  await expect(page.getByTestId('config-list')).toContainText('Alpine E2E');
  await page.getByRole('button', { name: 'Duplicate selected configuration' }).click();
  await expect(page.locator('.config-item-card')).toHaveCount(3);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete selected configuration' }).click();
  await expect(page.locator('.config-item-card')).toHaveCount(2);
});

test('opens the location map and cancels without changing the selected location', async ({ page }) => {
  await page.goto('/');
  const location = page.getByRole('textbox', { name: 'Search location' });
  await expect(location).toHaveValue('Offenbach am Main');
  await page.locator('.map-wrapper').click();
  await expect(page.locator('.fullscreen-map-modal')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.fullscreen-map-modal')).toHaveCount(0);
  await expect(location).toHaveValue('Offenbach am Main');
});

test('selects a location and refreshes the forecast', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('meteogram-chart-viewport')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search location' }).fill('Berlin');
  await page.getByRole('option', { name: /Berlin/ }).click();
  await expect(page.getByRole('textbox', { name: 'Search location' })).toHaveValue('Berlin');
  await expect(page.getByTestId('meteogram-chart-viewport')).toBeVisible();
  await page.getByRole('button', { name: 'Refresh Forecast' }).click();
  await expect(page.getByTestId('meteogram-chart-viewport')).toBeVisible();
});

test('sets a configuration location and display name in the Config view (#175)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('meteogram-chart-viewport')).toBeVisible();
  await page.getByRole('button', { name: 'Config', exact: true }).click();
  const header = page.getByRole('textbox', { name: 'Search location' });
  await expect(header).toBeDisabled();
  // The configuration field's pin opens the map picker (no preview map).
  await page.locator('[data-testid="config-location-group"] [data-testid="location-pin-button"]').click();
  await expect(page.locator('.fullscreen-map-modal')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.fullscreen-map-modal')).toHaveCount(0);
  const field = page.getByRole('textbox', { name: 'Configuration location' });
  await field.fill('Berlin');
  await page.getByRole('option', { name: /Berlin/ }).click();
  await expect(field).toHaveValue('Berlin');
  await expect(header).toHaveValue('Berlin');
  await page.getByTestId('config-location-name-btn').click();
  await page.getByTestId('config-location-name-input').fill('BER');
  await page.getByTestId('config-location-name-input').press('Enter');
  await expect(header).toHaveValue('BER');
  await page.getByRole('button', { name: 'Meteo', exact: true }).click();
  await expect(page.getByTestId('config-select')).toContainText('(BER)');
});

test('opens the fullscreen chart and closes it with Escape', async ({ page }) => {
  await page.goto('/');
  const embedded = page.locator('svg[data-render-mode="embedded"]');
  await expect(embedded).toBeVisible();
  await embedded.dblclick({ position: { x: 300, y: 100 } });
  await expect(page.getByTestId('fullscreen-meteogram-overlay')).toBeVisible();
  await expect(page.getByTestId('fullscreen-details-grid')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('fullscreen-meteogram-overlay')).toHaveCount(0);
});

test('edits a meteogram layout with live preview (#142)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('svg[data-render-mode="embedded"]')).toBeVisible();
  await page.getByRole('button', { name: 'Config', exact: true }).click();
  await page.getByRole('tab', { name: 'Meteogram' }).click();
  await page.getByTestId('layout-item-power-default').click();
  const preview = page.getByTestId('layout-preview');
  await expect(preview.locator('[data-testid="panel-convective"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Remove area convective' }).click();
  await expect(preview.locator('[data-testid="panel-convective"]')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/layout-editor.png', fullPage: true });
  await page.waitForTimeout(800);
  await page.reload();
  await page.getByRole('button', { name: 'Config', exact: true }).click();
  await page.getByRole('tab', { name: 'Meteogram' }).click();
  await page.getByTestId('layout-item-power-default').click();
  await expect(page.getByRole('button', { name: 'Remove area convective' })).toHaveCount(0);
});

test('power mode offers the auto chain as first dropdown entry (#165)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('svg[data-render-mode="embedded"]')).toBeVisible();
  const select = page.getByTestId('config-select');
  await expect(select.locator('option').first()).toHaveText('✦ Auto · Global');

  await select.selectOption('__auto__');
  await expect(select).toHaveClass(/auto-selected/);
  await expect(page.locator('svg[data-render-mode="embedded"]')).toBeVisible();
  await expect(page.locator('.model-chains-container')).toBeVisible();
  if (process.env.AUTO_ENTRY_SHOT) {
    await page.screenshot({ path: process.env.AUTO_ENTRY_SHOT });
  }
});
