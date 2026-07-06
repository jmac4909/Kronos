import { MergeRequestChangedFile } from '../state/types';
import { arrayFromUnknown, isRecord } from './records';

function normalizeChangedFilePath(value: unknown): string {
  if (typeof value !== 'string') { return ''; }
  return value.trim().replace(/\\/g, '/').replace(/^\.\/+/, '').trim();
}

export function changedFilePaths(file: MergeRequestChangedFile | string | undefined | null): string[] {
  if (!file) { return []; }
  if (typeof file === 'string') {
    const normalized = normalizeChangedFilePath(file);
    return normalized ? [normalized] : [];
  }
  const paths = new Set<string>();
  for (const value of [file.path, file.new_path, file.old_path, file.newPath, file.oldPath, file.file, file.filename]) {
    const normalized = normalizeChangedFilePath(value);
    if (normalized) { paths.add(normalized); }
  }
  return Array.from(paths);
}

export function primaryChangedFilePath(file: MergeRequestChangedFile | string | undefined | null): string {
  return changedFilePaths(file)[0] || '';
}

function normalizeChangedFile(file: unknown): MergeRequestChangedFile | null {
  if (typeof file === 'string') {
    const path = normalizeChangedFilePath(file);
    return path ? { path } : null;
  }
  if (!isRecord(file)) { return null; }

  const normalized: MergeRequestChangedFile = {};
  for (const key of ['path', 'new_path', 'old_path', 'newPath', 'oldPath', 'file', 'filename'] as const) {
    const value = normalizeChangedFilePath(file[key]);
    if (value) {
      normalized[key] = value;
    }
  }
  if (typeof file['diff'] === 'string') {
    normalized.diff = file['diff'];
  }
  if (typeof file['new_file'] === 'boolean') {
    normalized.new_file = file['new_file'];
  }
  if (typeof file['deleted_file'] === 'boolean') {
    normalized.deleted_file = file['deleted_file'];
  }
  if (typeof file['renamed_file'] === 'boolean') {
    normalized.renamed_file = file['renamed_file'];
  }

  return changedFilePaths(normalized).length > 0 || normalized.diff ? normalized : null;
}

export function normalizeChangedFiles(files: unknown): MergeRequestChangedFile[] {
  return arrayFromUnknown(files).map(normalizeChangedFile).filter((file): file is MergeRequestChangedFile => Boolean(file));
}
