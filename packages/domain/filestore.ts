import {createHash, randomUUID} from 'node:crypto';
import {open, rename, stat, unlink, readdir, mkdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {join, resolve, normalize} from 'node:path';

const OBJECT_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(docx|pdf|txt|md)$/;
const QUARANTINE_KEY_PATTERN = /^quarantine-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MiB

export type FileStat = {
  key: string;
  size: number;
  hash: string;
  createdAt: Date;
};

export class FileStore {
  private baseDir: string;
  private quarantineDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ? resolve(baseDir) : join(process.cwd(), '.local', 'objects');
    this.quarantineDir = join(this.baseDir, 'quarantine');
  }

  async init(): Promise<void> {
    await mkdir(this.baseDir, {recursive: true});
    await mkdir(this.quarantineDir, {recursive: true});
  }

  private validateKey(key: string, allowQuarantine = false): void {
    if (!key || typeof key !== 'string') {
      throw Object.assign(Error('Invalid object key'), {status: 400});
    }
    if (key.includes('..') || key.includes('/') || key.includes('\\')) {
      throw Object.assign(Error('Key path traversal rejected'), {status: 400});
    }
    const isStandard = OBJECT_KEY_PATTERN.test(key);
    const isQuarantine = allowQuarantine && QUARANTINE_KEY_PATTERN.test(key);
    if (!isStandard && !isQuarantine) {
      throw Object.assign(Error(`Invalid object key format: ${key}`), {status: 400});
    }
  }

  private resolvePath(key: string, isQuarantine = false): string {
    const dir = isQuarantine ? this.quarantineDir : this.baseDir;
    const fullPath = normalize(join(dir, key));
    if (!fullPath.startsWith(dir)) {
      throw Object.assign(Error('Object path traversal detected'), {status: 400});
    }
    return fullPath;
  }

  /**
   * Put an immutable file through the quarantine -> verify -> atomic rename pipeline (TR08).
   */
  async putImmutable(
    finalKey: string,
    data: Buffer,
    expectedHash?: string
  ): Promise<{key: string; hash: string; size: number}> {
    this.validateKey(finalKey);
    if (data.length > MAX_FILE_SIZE) {
      throw Object.assign(Error('File exceeds 10 MiB limit'), {status: 413});
    }

    await this.init();

    const finalPath = this.resolvePath(finalKey);
    const quarantineKey = `quarantine-${randomUUID()}.tmp`;
    const quarantinePath = this.resolvePath(quarantineKey, true);

    const actualHash = createHash('sha256').update(data).digest('hex');
    if (expectedHash && expectedHash !== actualHash) {
      throw Object.assign(Error('Content SHA-256 hash mismatch'), {status: 400});
    }

    // Step 1: Write to quarantine file exclusively with fsync
    const handle = await open(quarantinePath, 'wx');
    try {
      await handle.writeFile(data);
      await handle.sync(); // fsync durability
    } finally {
      await handle.close();
    }

    // Step 2: Atomically rename from quarantine to final immutable location
    try {
      // Check if destination already exists to maintain immutability
      try {
        await stat(finalPath);
        throw Object.assign(Error('Object already exists and cannot be overwritten'), {status: 409});
      } catch (e: any) {
        if (e.code !== 'ENOENT') throw e;
      }

      await rename(quarantinePath, finalPath);
    } catch (err) {
      await unlink(quarantinePath).catch(() => {});
      throw err;
    }

    return {
      key: finalKey,
      hash: actualHash,
      size: data.length
    };
  }

  async read(key: string): Promise<Buffer> {
    this.validateKey(key);
    const fullPath = this.resolvePath(key);
    const handle = await open(fullPath, 'r');
    try {
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  }

  async stat(key: string): Promise<FileStat> {
    this.validateKey(key);
    const fullPath = this.resolvePath(key);
    const s = await stat(fullPath);
    const data = await this.read(key);
    const hash = createHash('sha256').update(data).digest('hex');
    return {
      key,
      size: s.size,
      hash,
      createdAt: s.birthtime
    };
  }

  async delete(key: string): Promise<boolean> {
    this.validateKey(key);
    const fullPath = this.resolvePath(key);
    try {
      await unlink(fullPath);
      return true;
    } catch (e: any) {
      if (e.code === 'ENOENT') return false;
      throw e;
    }
  }

  /**
   * List all stored files for orphan reconciliation (TR08).
   */
  async listForReconciliation(): Promise<Array<{key: string; size: number}>> {
    await this.init();
    const entries = await readdir(this.baseDir, {withFileTypes: true});
    const results: Array<{key: string; size: number}> = [];
    for (const entry of entries) {
      if (entry.isFile() && OBJECT_KEY_PATTERN.test(entry.name)) {
        const s = await stat(join(this.baseDir, entry.name));
        results.push({key: entry.name, size: s.size});
      }
    }
    return results;
  }
}

export const defaultFileStore = new FileStore();

