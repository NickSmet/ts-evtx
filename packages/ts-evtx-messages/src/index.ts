export { SqliteMessageProvider } from './providers/SqliteProvider';
export { ChainMessageProvider } from './providers/ChainProvider';
export { SmartManagedMessageProvider } from './providers/SmartManagedProvider';
export { VelocidexDownloader } from './downloader/VelocidexDownloader';
export { WindowsVersionDetector } from './version-detector/WindowsVersionDetector';
export { VelocidexCatalogMapper } from './catalog/CatalogMapper';
export type { WindowsVersion, MessageProvider } from './types';
// Re-export ts-evtx logging helpers for convenience. Both packages share the same global logger.
export { setLogger, getLogger, ConsoleLogger } from 'ts-evtx';
