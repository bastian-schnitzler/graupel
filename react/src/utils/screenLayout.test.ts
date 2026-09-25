import { describe, it, expect } from 'vitest';
import { getScreenLayout, initializeScreenLayout } from './screenLayout';

describe('startup screen layout', () => {
  it.each([[1366,768],[1440,900],[1680,1050],[1920,1080],[1920,1200],[2560,1440],[3840,2160]])('scales from available screen %i×%i', (width,height) => {
    expect(getScreenLayout(width,height).scale).toBeCloseTo(height/1080);
  });
  it('bounds aspect margins and scale', () => {
    expect(getScreenLayout(10000,500)).toEqual({scale:0.65,inlineMarginRem:2.5});
    expect(getScreenLayout(500,10000)).toEqual({scale:2,inlineMarginRem:0.5});
    expect(getScreenLayout(0,0).scale).toBe(1);
  });
  it('keeps the initialized scale on window resize', () => {
    initializeScreenLayout();
    const initial = document.documentElement.style.getPropertyValue('--app-scale');
    window.dispatchEvent(new Event('resize'));
    expect(document.documentElement.style.getPropertyValue('--app-scale')).toBe(initial);
  });
});
