import { describe, expect, it } from 'vitest';
import { BASE_URL, cellUrl, folderName } from '../../../examples/taro-cell/src/url';

describe('cellUrl', () => {
  it('is the dataset folder name plus the zero-padded cluster id', () => {
    expect(cellUrl('/data/ks4-x/2026-05-07-R001A', 12)).toBe(`${BASE_URL}2026-05-07-R001A-C0012`);
    expect(cellUrl('/data/ks4-x/2026-05-07-R001A/', 0)).toBe(`${BASE_URL}2026-05-07-R001A-C0000`);
    expect(cellUrl('2026-12-31-R123B', 9999)).toBe(`${BASE_URL}2026-12-31-R123B-C9999`);
  });
  it('lets a wider id through, like printf %04d', () => {
    expect(cellUrl('/d/2026-05-07-R001A', 12345)).toBe(`${BASE_URL}2026-05-07-R001A-C12345`);
  });
  it('is undefined when the folder is not <year>-<month>-<day>-R<run><shank>', () => {
    for (const dir of ['/d/ks4-019e7fd7', '/d/2026-05-07-R01A', '/d/2026-05-07-R001', '/d/2026-5-7-R001A', '/d/2026-05-07-R001A-extra', '/d/x2026-05-07-R001A']) {
      expect(cellUrl(dir, 1), dir).toBeUndefined();
    }
  });
  it('is undefined for an id that is not a non-negative integer', () => {
    for (const id of [-1, 1.5, NaN, Infinity]) expect(cellUrl('/d/2026-05-07-R001A', id), String(id)).toBeUndefined();
  });
  it('folderName ignores trailing separators', () => {
    expect(folderName('/a/b/2026-05-07-R001A//')).toBe('2026-05-07-R001A');
  });
});
