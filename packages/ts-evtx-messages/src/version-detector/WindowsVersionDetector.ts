import type { WindowsVersion } from '../types';

export class WindowsVersionDetector {
  static async detectFromSystemLog(systemEvtxPath: string): Promise<WindowsVersion | null> {
    try {
      const mod: any = await import('@ts-evtx/core');
      const file = await mod.EvtxFile.open(systemEvtxPath);
      let scanned = 0;
      for (const rec of file.records()) {
        scanned++;
        let xml = '';
        try { xml = rec.renderXml(); } catch {}
        if (!xml) continue;
        // Provider EventLog, EventID 6009
        const providerMatch = xml.match(/Provider Name=\"([^\"]+)\"/);
        const eventIdMatch = xml.match(/<EventID(?:[^>]*)>(\d+)<\/EventID>/);
        if (providerMatch?.[1] === 'EventLog' && eventIdMatch?.[1] === '6009') {
          const evData = xml.match(/<EventData[^>]*>([\s\S]*?)<\/EventData>/);
          const content = evData ? evData[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
          const parsed = this.parseVersionString(content);
          if (parsed) return parsed;
        }
        if (scanned > 200) break; // usually present early
      }
    } catch {}
    return null;
  }

  static async detectFromAnyLog(evtxPath: string): Promise<WindowsVersion | null> {
    try {
      const mod: any = await import('@ts-evtx/core');
      const file = await mod.EvtxFile.open(evtxPath);
      let scanned = 0;
      for (const rec of file.records()) {
        scanned++;
        let xml = '';
        try { xml = rec.renderXml(); } catch {}
        if (!xml) continue;
        const text = xml.replace(/<[^>]+>/g, ' ');
        const parsed = this.parseVersionString(text);
        if (parsed) return parsed;
        if (scanned > 300) break;
      }
    } catch {}
    return null;
  }

  static parseVersionString(s: string): WindowsVersion | null {
    // Examples:
    // "Microsoft (R) Windows (R) 5.02. 3790 Service Pack 2 Multiprocessor Free"
    // "Microsoft Windows NT 10.0.22000 Build 22000"
    // "Microsoft Windows 10.0.19041 Build 19041"
    const versionMatch = s.match(/Windows(?: NT)?\s+(\d+)\.(\d+)(?:\.(\d+))?/i);
    const buildMatch = s.match(/Build\s+(\d+)/i);
    const archMatch = s.match(/(x86|x64|amd64)/i);
    const spMatch = s.match(/Service Pack\s+([\w\s]+)/i);
    const typeMatch = s.match(/(Domain Controller|Server|Workstation)/i);

    if (!versionMatch) return null;
    const major = parseInt(versionMatch[1], 10);
    const minor = parseInt(versionMatch[2], 10);
    const build = buildMatch ? parseInt(buildMatch[1], 10) : (versionMatch[3] ? parseInt(versionMatch[3], 10) : 0);
    const architecture = archMatch ? (archMatch[1].toLowerCase() === 'x86' ? 'x86' : 'amd64') : undefined;
    const servicepack = spMatch ? spMatch[1].trim() : undefined;
    let productType: WindowsVersion['productType'] = 'workstation';
    if (typeMatch) {
      const t = typeMatch[1].toLowerCase();
      if (t.includes('domain')) productType = 'domainController';
      else if (t.includes('server')) productType = 'server';
    } else if (major >= 10) {
      // Heuristic: default to workstation if unknown
      productType = 'workstation';
    }

    return {
      majorVersion: major,
      minorVersion: minor,
      buildNumber: build,
      productType,
      architecture,
      servicepack,
    };
  }
}
