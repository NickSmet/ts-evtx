# @ts-evtx/messages

Message catalog provider for Windows Event Log (EVTX) files.

Features
- SQLite-based message catalogs
- Simple managed provider with two modes:
  - Use a user-supplied DB file (customDbPath)
  - Or use the packaged universal catalog (no config)
- Chain multiple providers for fallbacks
- Simple CLI to download catalogs

Install
```
npm install ts-evtx @ts-evtx/messages
```

Quick start
```ts
import { evtx } from 'ts-evtx';
import { SmartManagedMessageProvider } from '@ts-evtx/messages';

// Use the packaged universal catalog
const provider = new SmartManagedMessageProvider({ preload: true });
const events = await evtx('./Application.evtx').withMessages(provider).last(50).toArray();
for (const e of events) console.log(e.message);
```

Logging

This package piggybacks on the ts-evtx centralized logger. Configure logging once via ts-evtx and both packages will use the same logger and level.

```ts
import { setLogger, ConsoleLogger, withMinLevel } from 'ts-evtx';

// e.g., only info/warn/error
setLogger(withMinLevel(new ConsoleLogger(), 'info'));
```

For convenience, @ts-evtx/messages re-exports setLogger/getLogger/ConsoleLogger:

```ts
import { setLogger, ConsoleLogger } from '@ts-evtx/messages';
setLogger(new ConsoleLogger());
// Use withMinLevel from ts-evtx if you need filtering
// import { withMinLevel } from 'ts-evtx';
```

Other ways to choose a catalog

- Provide your own local DB file:
```ts
new SmartManagedMessageProvider({ customDbPath: './my-catalog.db' })
```


CLI
```
npx evtx-messages detect-download --system ./System.evtx
npx evtx-messages download-label win10 --arch amd64
npx evtx-messages download windows.11.amd64.db
```

Future: deterministic lookups via canonical keys

- Today, catalogs and Windows internals sometimes require alias fallbacks and best‑fit picks by template; diagnostics help explain which provider/alias was used and why.
- As the catalog evolves to store canonical keys (Provider GUID + EventID + discriminators like opcode/task/version/channel), message resolution becomes a simple lookup with far fewer edge cases. At that point, consumers can treat message resolution as “found or not found” without sifting through attempts.
