import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';
import { beforeEach } from 'vitest';

// waitFor / findBy* limit: the 1 s default is too short for debounced
// searches on slow CI runners (Windows).
configure({ asyncUtilTimeout: 3000 });
import { MockMap, MockMarker } from './maplibreMock';

beforeEach(() => {
  MockMap.instances = [];
  MockMarker.instances = [];
  if (typeof localStorage !== 'undefined') {
    localStorage.clear();
  }
});

declare global {
  namespace vi {
    interface Assertion<T = any> extends jest.Matchers<void, T> {}
  }
}

if (typeof window !== 'undefined') {
  window.URL.createObjectURL = () => 'blob:mock';
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverMock as any;
  if (typeof window !== 'undefined') {
    window.ResizeObserver = ResizeObserverMock as any;
  }
}
