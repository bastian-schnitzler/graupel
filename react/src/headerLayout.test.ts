/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const css = readFileSync('src/App.css', 'utf8');

describe('header layout', () => {
  it('removes inherited heading margins and groups branding above navigation', () => {
    const style = document.createElement('style');
    style.textContent = 'h1 { margin: 32px 0; }' + css;
    document.head.append(style);
    const group = document.createElement('div');
    group.className = 'header-top-row';
    group.innerHTML = '<div class="brand"><img width="28" height="28"/><h1 class="brand-title">Graupel</h1></div><nav class="nav-tabs">Meteo Config</nav>';
    document.body.append(group);
    try {
      expect(getComputedStyle(group).flexDirection).toBe('column');
      expect(getComputedStyle(group).alignItems).toBe('flex-start');
      expect(getComputedStyle(group).gap).toBe('0.5rem');
      expect(getComputedStyle(group.querySelector('h1')!).marginTop).toBe('0px');
      expect(getComputedStyle(group.querySelector('h1')!).marginLeft).toBe('0px');
      expect(getComputedStyle(group.querySelector('.brand')!).display).toBe('flex');
    } finally {group.remove();style.remove();}
  });
});
