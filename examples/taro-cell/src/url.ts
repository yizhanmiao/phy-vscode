import { basename } from 'node:path';

export const ORIGIN = 'http://taro-station.usc.edu:8000';
export const BASE_URL = `${ORIGIN}/data-view/cell/`;
// <year>-<month>-<day>-R%03d<shank>, e.g. 2026-05-07-R001A: the folder Kilosort wrote the sorting to
const SESSION = /^\d{4}-\d{2}-\d{2}-R\d{3}[A-Za-z]+$/;

/** Last path component, ignoring trailing separators. */
export const folderName = (datasetDir: string): string => basename(datasetDir.replace(/[\\/]+$/, ''));

/** `…/2026-05-07-R001A` + cluster 12 → `http://taro-station.usc.edu:8000/data-view/cell/2026-05-07-R001A-C0012`. */
export function cellUrl(datasetDir: string, clusterId: number): string | undefined {
  const name = folderName(datasetDir);
  if (!SESSION.test(name) || !Number.isInteger(clusterId) || clusterId < 0) return undefined;
  return `${BASE_URL}${name}-C${String(clusterId).padStart(4, '0')}`;
}
