// Print a few random events from System.evtx with resolved messages
import { evtx } from '../dist/index.js';
// Use local @ts-evtx/messages from the monorepo workspace
import { SmartManagedMessageProvider } from '../packages/ts-evtx-messages/dist/index.js';
import fs from 'node:fs';

const INPUT = './test/fixtures/Application.evtx';

if (!fs.existsSync(INPUT)) {
  console.error(`Input not found: ${INPUT}`);
  process.exit(1);
}

function pickRandom(arr, count) {
  const idxs = new Set();
  while (idxs.size < Math.min(count, arr.length)) {
    idxs.add(Math.floor(Math.random() * arr.length));
  }
  return Array.from(idxs).map(i => arr[i]);
}

// Read a manageable window and sample from it, resolving messages via provider if available
const provider = new SmartManagedMessageProvider({ osHint: 'win10', architecture: 'amd64', preload: true });
const events = await evtx(INPUT, { includeXml: true }).withMessages(provider).last(500).toArray();

let sample = events;
if (sample.length === 0) sample = pickRandom(events, 30);

for (const e of sample) {
  const providerName = e.provider?.name;
  const eventId = e.eventId;
  const msg = e.messageResolved ? e.message : null;
  console.log('—'.repeat(80));
  console.log(`Record: ${e.recordNumber}`);
  console.log(`Time:   ${e.timestamp}`);
  console.log(`Prov:   ${providerName}`);
  console.log(`Event:  ${eventId}`);
  console.log(`Level:  ${e.levelName}`);
  if (msg) {
    console.log('Message:');
    console.log(msg);
  } else {
    console.log('(message not resolved)');
  }
}
