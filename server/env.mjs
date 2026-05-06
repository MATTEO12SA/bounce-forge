import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadDotEnv(root = process.cwd()) {
  const filePath = resolve(root, '.env');

  if (!existsSync(filePath)) {
    return;
  }

  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separator = trimmed.indexOf('=');

    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, '');
    process.env[key] ??= value;
  }
}
