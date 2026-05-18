import { describe, it, expect } from 'vitest';
import {
  slugForUrl,
  resolveUrl,
  parseViewport,
} from '../playwright/helpers.js';

// Pure helpers — no browser launch needed. Inspector itself is exercised
// end-to-end via npm scripts; running Playwright in a vitest unit test would
// pull in chromium and slow CI significantly without adding much beyond what
// the smoke test catches.

describe('playwright/helpers.slugForUrl', () => {
  it('strips protocol and replaces non-alnum with underscore', () => {
    expect(slugForUrl('http://localhost:8080/command-center'))
      .toBe('localhost_8080_command_center');
  });
  it('strips leading/trailing underscores', () => {
    expect(slugForUrl('http://example.com/')).toBe('example_com');
  });
  it('caps at 100 chars', () => {
    const long = 'http://example.com/' + 'a'.repeat(200);
    expect(slugForUrl(long).length).toBeLessThanOrEqual(100);
  });
});

describe('playwright/helpers.resolveUrl', () => {
  it('keeps absolute URLs as-is', () => {
    expect(resolveUrl('https://example.com/x')).toBe('https://example.com/x');
  });
  it('prefixes paths with default base', () => {
    expect(resolveUrl('/command-center')).toBe('http://localhost:8080/command-center');
  });
  it('handles paths without leading slash', () => {
    expect(resolveUrl('scanner')).toBe('http://localhost:8080/scanner');
  });
  it('respects custom base', () => {
    expect(resolveUrl('/x', 'http://staging:3000')).toBe('http://staging:3000/x');
  });
});

describe('playwright/helpers.parseViewport', () => {
  it('parses WxH', () => {
    expect(parseViewport('1920x1080')).toEqual({ width: 1920, height: 1080 });
  });
  it('falls back on bad input', () => {
    expect(parseViewport('garbage')).toEqual({ width: 1440, height: 900 });
  });
  it('defaults when empty', () => {
    expect(parseViewport()).toEqual({ width: 1440, height: 900 });
  });
});
