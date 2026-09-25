import { describe, it, expect } from 'vitest';
import { getTextTransform, getMeteogramLayout } from './meteogramLayout';

describe('meteogramLayout', () => {
  describe('getTextTransform', () => {
    it('returns undefined when textScaleX is undefined or equal to 1', () => {
      expect(getTextTransform(100, 200, undefined)).toBeUndefined();
      expect(getTextTransform(100, 200, 1)).toBeUndefined();
    });

    it('returns translate and scale transformation string centered on (x, y) when textScaleX != 1', () => {
      const transform = getTextTransform(150, 250, 0.75);
      expect(transform).toBe('translate(150 250) scale(0.75 1) translate(-150 -250)');
    });

    it('formats scale factor correctly in SVG transform string', () => {
      const transform = getTextTransform(100, 50, 0.5556);
      expect(transform).toBe('translate(100 50) scale(0.5556 1) translate(-100 -50)');
    });
  });

  describe('getMeteogramLayout', () => {
    it('calculates layout dimensions and textScaleX correctly', () => {
      const layout = getMeteogramLayout({
        mode: 'embedded',
        width: 1800,
        height: 450,
        viewBoxHeight: 450,
      });

      expect(layout.renderedWidth).toBe(1800);
      expect(layout.renderedHeight).toBe(450);
      expect(layout.textScaleX).toBeDefined();
      expect(layout.textScaleX!).toBeCloseTo(1000 / 1800, 4);
    });

    it('defaults textScaleX to 1 when width equals 1000 and height equals viewBoxHeight', () => {
      const layout = getMeteogramLayout({
        mode: 'embedded',
        width: 1000,
        height: 450,
        viewBoxHeight: 450,
      });

      expect(layout.textScaleX).toBeCloseTo(1, 4);
      expect(getTextTransform(100, 50, layout.textScaleX)).toBeUndefined();
    });
  });
});
