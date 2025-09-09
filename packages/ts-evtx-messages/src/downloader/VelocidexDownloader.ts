import { mkdir, stat, writeFile } from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';

export class VelocidexDownloader {
  static readonly RELEASES_URL = 'https://github.com/Velocidex/evtx-data/releases/latest/download';
  static readonly RAW_URL = 'https://raw.githubusercontent.com/Velocidex/evtx-data/master';
  static readonly DEFAULT_CACHE = path.join(process.env.HOME || process.cwd(), '.evtx-messages');

  static async ensureCache(dir?: string) {
    await mkdir(dir || this.DEFAULT_CACHE, { recursive: true });
    return dir || this.DEFAULT_CACHE;
  }

  static async downloadCatalog(fileName: string, options?: { cacheDir?: string; ttlDays?: number }): Promise<string> {
    const cacheDir = await this.ensureCache(options?.cacheDir);
    const outPath = path.join(cacheDir, fileName);

    try {
      const st = await stat(outPath);
      const days = (Date.now() - st.mtime.getTime()) / (1000 * 60 * 60 * 24);
      const ttl = options?.ttlDays ?? 30;
      if (days < ttl) return outPath; // cached
    } catch {}

    // Try raw repo path first (files live at repo root), then releases as fallback
    const candidates = [
      `${this.RAW_URL}/${encodeURIComponent(fileName)}`,
      `${this.RELEASES_URL}/${encodeURIComponent(fileName)}`,
    ];
    let res: any = null;
    let lastErr: any = null;
    for (const url of candidates) {
      try {
        const fetchFn: typeof fetch | undefined = (globalThis as any).fetch;
        if (!fetchFn) throw new Error('Global fetch is not available. Use Node.js >= 18 or provide a fetch polyfill.');
        const r = await fetchFn(url);
        if (r.ok && r.body) { res = r; break; }
        lastErr = new Error(`HTTP ${r.status} ${r.statusText} for ${url}`);
      } catch (e) {
        lastErr = e;
      }
    }
    if (!res) throw new Error(`Failed to download ${fileName}: ${lastErr}`);

    // Node 18+ global fetch provides Web ReadableStream; use arrayBuffer for simplicity
    const data = new Uint8Array(await res.arrayBuffer());
    await writeFile(outPath, data);

    return outPath;
  }

  static async downloadAny(fileNames: string[], options?: { cacheDir?: string; ttlDays?: number }): Promise<string> {
    let lastErr: any;
    for (const name of fileNames) {
      try {
        return await this.downloadCatalog(name, options);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr ?? new Error('No candidate catalog succeeded');
  }
}
