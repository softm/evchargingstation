/** Stream-compress immutable region JSON for GitHub Pages without changing API source snapshots. */
import { createReadStream, createWriteStream } from 'node:fs';
import { readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

const RELEASE = /^\d{8}T\d{6}-[a-f0-9]{10}$/;
const FILE = /^[A-Za-z0-9_-]{1,64}\.json$/;
const SHARD = /^releases\/\d{8}T\d{6}-[a-f0-9]{10}\/regions\/[A-Za-z0-9_-]{1,64}\.json(?:\.gz)?$/;

async function entries(directory) {
  try { return await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function compressRegionFiles(dataDirectory, manifest) {
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.regions)) {
    throw new Error('Invalid region manifest.');
  }
  const root = path.resolve(dataDirectory);
  const releases = path.join(root, 'releases');
  const updated = new Map();
  let convertedFiles = 0;

  // Preserve recent releases for clients with an older manifest, but gzip each release.
  for (const release of await entries(releases)) {
    if (!release.isDirectory() || !RELEASE.test(release.name)) continue;
    const regionDir = path.join(releases, release.name, 'regions');
    for (const file of await entries(regionDir)) {
      if (!file.isFile() || !FILE.test(file.name)) continue;
      const source = path.join(regionDir, file.name);
      const relative = path.posix.join('releases', release.name, 'regions', file.name);
      const target = source + '.gz';
      const temp = target + '.building';
      const originalBytes = (await stat(source)).size;
      try {
        await rm(temp, { force: true });
        await pipeline(
          createReadStream(source),
          createGzip({ level: 6 }),
          createWriteStream(temp, { flags: 'wx' }),
        );
        const gzBytes = (await stat(temp)).size;
        if (gzBytes < originalBytes) {
          await rename(temp, target);
          await rm(source);
          updated.set(relative, { path: relative + '.gz', encoding: 'gzip', originalBytes, compressedBytes: gzBytes });
          convertedFiles += 1;
        } else {
          // Tiny JSON files stay uncompressed when gzip adds overhead.
          updated.set(relative, { path: relative, encoding: 'identity', originalBytes, compressedBytes: originalBytes });
        }
      } finally {
        await rm(temp, { force: true });
      }
    }
  }

  let originalBytes = 0;
  let publishedBytes = 0;
  let gzipRegions = 0;
  for (const region of manifest.regions) {
    if (!SHARD.test(region.path || '')) throw new Error('Unsafe or invalid region path.');
    const transformed = updated.get(region.path);
    if (transformed) {
      Object.assign(region, transformed);
    } else {
      // Allow already-compressed snapshots (or old tiny plain JSON shards).
      const size = (await stat(path.join(root, ...region.path.split('/')))).size;
      region.encoding = region.path.endsWith('.json.gz') ? 'gzip' : 'identity';
      region.originalBytes = region.originalBytes || size;
      region.compressedBytes = size;
    }
    originalBytes += region.originalBytes;
    publishedBytes += region.compressedBytes;
    if (region.encoding === 'gzip') gzipRegions += 1;
  }
  if (manifest.regions.length) {
    manifest.regionStorage = {
      encoding: gzipRegions === manifest.regions.length ? 'gzip' : 'mixed',
      originalBytes, publishedBytes, savedBytes: originalBytes - publishedBytes, gzipRegions,
    };
  }
  return { convertedFiles, regions: manifest.regions.length, gzipRegions, originalBytes, publishedBytes, savedBytes: originalBytes - publishedBytes };
}
