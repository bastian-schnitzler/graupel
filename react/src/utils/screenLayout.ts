/** Screen dimensions are CSS pixels (already adjusted for OS display scaling).
 * Read once at startup; resizing a window must never change the visual scale.
 */
export function getScreenLayout(width: number, height: number) {
  const safeWidth = width > 0 ? width : 1920;
  const safeHeight = height > 0 ? height : 1080;
  return {
    scale: Math.min(2, Math.max(0.65, safeHeight / 1080)),
    inlineMarginRem: Math.min(
      2.5,
      Math.max(0.5, 1 + (safeWidth / safeHeight - 16 / 9) * 2),
    ),
  };
}

export function initializeScreenLayout() {
  const layout = getScreenLayout(
    window.screen.availWidth,
    window.screen.availHeight,
  );
  document.documentElement.style.setProperty('--app-scale', String(layout.scale));
  document.documentElement.style.setProperty(
    '--content-margin-inline',
    `${layout.inlineMarginRem}rem`,
  );
}
