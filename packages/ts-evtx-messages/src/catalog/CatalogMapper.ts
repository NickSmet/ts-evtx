import type { WindowsVersion } from '../types';

export class VelocidexCatalogMapper {
  // Known concrete filenames present in Velocidex/evtx-data repo root
  private static readonly KNOWN = [
    'windows.10.enterprise.10.0.17763.amd64.db',
    'windows.8.1.enterprise.6.3.9600.amd64.db',
    'windows.server.2008.r2.datacenter.sp1.6.1.7601.amd64.db',
    'windows.server.2012.r2.datacenter.6.3.9600.amd64.db',
    'windows.server.2016.datacenter.10.0.14393.amd64.db',
    'windows.server.2019.datacenter.10.0.17763.amd64.db',
    'windows.server.2019.datacenter.10.0.18362.amd64.db',
  ];

  static selectBestCatalogCandidates(version: WindowsVersion): string[] {
    const arch = version.architecture || 'amd64';
    const build = `${version.majorVersion}.${version.minorVersion}.${version.buildNumber}`;
    const isServer = version.productType !== 'workstation';
    const candidates: string[] = [];
    if (isServer) {
      // Exact matches by known server builds
      if (build.startsWith('10.0.17763')) candidates.push('windows.server.2019.datacenter.10.0.17763.amd64.db');
      if (build.startsWith('10.0.18362')) candidates.push('windows.server.2019.datacenter.10.0.18362.amd64.db');
      if (build.startsWith('10.0.14393')) candidates.push('windows.server.2016.datacenter.10.0.14393.amd64.db');
      if (build.startsWith('6.3.9600')) candidates.push('windows.server.2012.r2.datacenter.6.3.9600.amd64.db');
      if (build.startsWith('6.1.7601')) candidates.push('windows.server.2008.r2.datacenter.sp1.6.1.7601.amd64.db');
      // Fallback preference order
      candidates.push(
        'windows.server.2019.datacenter.10.0.17763.amd64.db',
        'windows.server.2016.datacenter.10.0.14393.amd64.db',
        'windows.server.2012.r2.datacenter.6.3.9600.amd64.db'
      );
    } else {
      // Client: prefer Windows 10 enterprise 17763 (available)
      candidates.push('windows.10.enterprise.10.0.17763.amd64.db');
      // Older client: Windows 8.1 enterprise 6.3.9600
      if (build.startsWith('6.3.9600')) candidates.unshift('windows.8.1.enterprise.6.3.9600.amd64.db');
    }
    // Ensure unique and correct arch (only amd64 available currently)
    return Array.from(new Set(candidates.filter(n => n.endsWith(`${arch}.db`))));
  }

  static selectByLabelCandidates(label: string, opts: { architecture?: 'x86'|'amd64' } = {}): string[] {
    const arch = opts.architecture || 'amd64';
    const map: Record<string, string[]> = {
      win10: ['windows.10.enterprise.10.0.17763.amd64.db'],
      win81: ['windows.8.1.enterprise.6.3.9600.amd64.db'],
      server2008r2: ['windows.server.2008.r2.datacenter.sp1.6.1.7601.amd64.db'],
      server2012r2: ['windows.server.2012.r2.datacenter.6.3.9600.amd64.db'],
      server2016: ['windows.server.2016.datacenter.10.0.14393.amd64.db'],
      server2019: [
        'windows.server.2019.datacenter.10.0.17763.amd64.db',
        'windows.server.2019.datacenter.10.0.18362.amd64.db',
      ],
    };
    const list = map[label]?.slice() || map['win10'];
    return list.filter(n => n.endsWith(`${arch}.db`));
  }
}
