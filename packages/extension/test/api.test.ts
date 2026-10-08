import { readFileSync } from 'node:fs';
import { API_VERSION, colorOf, emptyScene, satisfiesApi } from '@phy-vscode/api';
import { describe, expect, it } from 'vitest';

describe('API_VERSION', () => {
  it('matches the api package version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../api/package.json', import.meta.url), 'utf8'));
    expect(API_VERSION).toBe(pkg.version);
  });
});

describe('satisfiesApi', () => {
  it('caret on 0.x pins the minor', () => {
    expect(satisfiesApi('^0.2.0', '0.2.0')).toBe(true);
    expect(satisfiesApi('^0.2.0', '0.2.7')).toBe(true);
    expect(satisfiesApi('^0.2.3', '0.2.1')).toBe(false);
    expect(satisfiesApi('^0.2.0', '0.3.0')).toBe(false);
    expect(satisfiesApi('^0.2.0', '0.1.9')).toBe(false);
  });
  it('caret from 1.0 pins the major', () => {
    expect(satisfiesApi('^1.2.0', '1.3.0')).toBe(true);
    expect(satisfiesApi('^1.2.0', '1.1.9')).toBe(false);
    expect(satisfiesApi('^1.2.0', '2.0.0')).toBe(false);
  });
  it('accepts an exact version and rejects anything it cannot read', () => {
    expect(satisfiesApi('0.2.0', '0.2.0')).toBe(true);
    expect(satisfiesApi('0.2.0', '0.2.1')).toBe(false);
    expect(satisfiesApi('latest', '0.2.0')).toBe(false);
    expect(satisfiesApi('^0.2.0', 'x')).toBe(false);
  });
  it('defaults to the running API version', () => {
    expect(satisfiesApi(`^${API_VERSION}`)).toBe(true);
  });
});

describe('helpers', () => {
  it('emptyScene is a message scene', () => {
    expect(emptyScene('Select a cluster')).toEqual({ rows: 1, cols: 1, panels: [], message: 'Select a cluster' });
  });
  it('colorOf is the selection colour, grey when not selected', () => {
    const sel = { ids: [5], colors: ['#ff0000'] };
    expect(colorOf(sel, 5)).toEqual([1, 0, 0, 1]);
    expect(colorOf(sel, 5, 0.25)).toEqual([1, 0, 0, 0.25]);
    const grey = colorOf(sel, 6); // '#808080' is 128/255, a hair over 0.5
    expect(grey.slice(0, 3).every((v) => Math.abs(v - 0.5) < 0.005)).toBe(true);
    expect(grey[3]).toBe(1);
  });
});
