#!/usr/bin/env node
import { Command } from 'commander';
import { VelocidexDownloader } from './downloader/VelocidexDownloader';
import { WindowsVersionDetector } from './version-detector/WindowsVersionDetector';
import { VelocidexCatalogMapper } from './catalog/CatalogMapper';
import { readdirSync, statSync, rmSync } from 'fs';
import path from 'path';

const program = new Command();

program
  .name('evtx-messages')
  .description('EVTX message catalog management and utilities');

program
  .command('download')
  .description('Download a specific catalog asset by file name')
  .argument('<file>', 'Catalog file name (e.g., windows.11.datacenter.amd64.db)')
  .option('-c, --cache-dir <dir>', 'Cache directory')
  .action(async (file: string, opts: any) => {
    const p = await VelocidexDownloader.downloadCatalog(file, { cacheDir: opts.cacheDir });
    console.log(p);
  });

program
  .command('download-label')
  .description('Download by OS label (win10, win11, win81, server2016, …)')
  .argument('<label>', 'OS label')
  .option('--arch <arch>', 'x86 or amd64', 'amd64')
  .option('-c, --cache-dir <dir>', 'Cache directory')
  .action(async (label: string, opts: any) => {
    const names = VelocidexCatalogMapper.selectByLabelCandidates(label, { architecture: opts.arch });
    const p = await VelocidexDownloader.downloadAny(names, { cacheDir: opts.cacheDir });
    console.log(p);
  });

program
  .command('detect-download')
  .description('Detect Windows version from System.evtx and download best catalog')
  .requiredOption('-s, --system <path>', 'Path to System.evtx')
  .option('-c, --cache-dir <dir>', 'Cache directory')
  .action(async (opts: any) => {
    const v = await WindowsVersionDetector.detectFromSystemLog(opts.system);
    if (!v) {
      console.error('Could not detect Windows version');
      process.exitCode = 1;
      return;
    }
    const names = VelocidexCatalogMapper.selectBestCatalogCandidates(v);
    const p = await VelocidexDownloader.downloadAny(names, { cacheDir: opts.cacheDir });
    console.log(p);
  });

program
  .command('cache-status')
  .description('Show cached catalogs')
  .option('-c, --cache-dir <dir>', 'Cache directory')
  .action(async (opts: any) => {
    const dir = opts.cacheDir || VelocidexDownloader.DEFAULT_CACHE;
    try {
      const items = readdirSync(dir);
      for (const f of items) {
        const p = path.join(dir, f);
        const st = statSync(p);
        console.log(`${f}\t${st.size} bytes\tmodified ${st.mtime.toISOString()}`);
      }
    } catch {
      console.log('No cache found');
    }
  });

program
  .command('cache-clear')
  .description('Clear cached catalogs')
  .option('-c, --cache-dir <dir>', 'Cache directory')
  .action(async (opts: any) => {
    const dir = opts.cacheDir || VelocidexDownloader.DEFAULT_CACHE;
    try {
      const items = readdirSync(dir);
      for (const f of items) {
        rmSync(path.join(dir, f));
      }
      console.log('Cache cleared');
    } catch {
      console.log('No cache found');
    }
  });

program
  .command('extract-providers')
  .description('List distinct providers present in an EVTX file')
  .argument('<evtx>', 'EVTX file path')
  .action(async (file: string) => {
    const mod: any = await import('@ts-evtx/core');
    const ev = await mod.EvtxFile.open(file);
    const set = new Set<string>();
    for (const rec of ev.records()) {
      let xml = '';
      try { xml = rec.renderXml(); } catch {}
      const m = xml.match(/Provider Name=\"([^\"]+)\"/);
      if (m) set.add(m[1]);
    }
    console.log(Array.from(set).sort().join('\n'));
  });

program.parse();
