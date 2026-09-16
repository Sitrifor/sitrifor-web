#!/usr/bin/env node
/**
 * Upload scraped tattoo-masters xlsx to Yandex Disk.
 *
 * Usage:
 *   node seo/scripts/scrape-tattoo-masters/upload-to-disk.mjs
 *   node seo/scripts/scrape-tattoo-masters/upload-to-disk.mjs --file /path/to.xlsx
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDiskClient, diskPath } from '../yandex-disk/client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEO_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_FILE = path.join(
  SEO_ROOT,
  'data/tattoo-masters/tattoo-masters-rf-sng.xlsx'
);
const REMOTE_DIR = 'Интересные исследования';
const REMOTE_NAME = 'тату-мастера-РФ-СНГ.xlsx';

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function main() {
  const local = path.resolve(argValue('--file') || DEFAULT_FILE);
  if (!fs.existsSync(local)) {
    throw new Error(`Файл не найден: ${local}`);
  }
  const disk = createDiskClient();
  const dir = diskPath(REMOTE_DIR);
  await disk.ensureDir(dir);
  const remote = diskPath(REMOTE_DIR, REMOTE_NAME);
  console.log(`Upload ${local} -> ${remote}`);
  const res = await disk.uploadFile(local, remote, { overwrite: true });
  console.log(JSON.stringify(res, null, 2));
  // public? skip - user can open from disk
  console.log(`OK: ${remote}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
