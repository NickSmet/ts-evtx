import { EvtxFile } from "./src/evtx/EvtxFile";
import { FileHeader } from "./src/evtx/FileHeader";
import { ChunkHeader } from "./src/evtx/ChunkHeader";
import { Record, InvalidRecordException } from "./src/evtx/Record";
import { Block, memoize } from "./src/evtx/Block";
import { BinaryReader, align, filetimeToDate, crc32Checksum } from "./src/binary/BinaryReader";
import { BXmlNode } from "./src/evtx/BXmlNode";
import { VariantValue } from "./src/evtx/VariantValue";
// import { OpenStartElementNode } from "./src/evtx/node-specialisations";
// import { AttributeNode } from "./src/evtx/node-specialisations";
// import { ValueNode } from "./src/evtx/node-specialisations";
// import { TemplateInstanceNode } from "./src/evtx/node-specialisations";
// import { TemplateNode } from "./src/evtx/node-specialisations";
// import { NameStringNode } from "./src/evtx/node-specialisations";
import { SystemToken } from "./src/evtx/enums";
import { VariantType } from "./src/evtx/enums";

export { EvtxFile };
export { FileHeader };
export { ChunkHeader };
export { Record, InvalidRecordException };
export { Block, memoize };
export { BinaryReader, align, filetimeToDate, crc32Checksum };
export { BXmlNode };
export { VariantValue };
// export { OpenStartElementNode, AttributeNode, ValueNode, TemplateInstanceNode, TemplateNode, NameStringNode };
export { SystemToken, VariantType };

// Export drop-in replacement functions
// Intentionally do not re-export src/api helpers to keep the public API minimal.

export type { MessageProvider, EvtxParseOptions } from './src/types/MessageProvider';
export { evtx } from './src/query';
export type { EvtxQuery } from './src/query';

// Logging API (silent by default; consumer-configurable)
export { setLogger, getLogger, ConsoleLogger, withMinLevel } from './src/logging/logger';

// Export original parseEvtxFile as parseEvtxFileAdvanced to avoid conflicts
export async function parseEvtxFileAdvanced(filePath: string) {
  const evtxFile = await EvtxFile.open(filePath);
  return {
    file: evtxFile,
    stats: evtxFile.getStats(),
    records: evtxFile.records(),
    chunks: evtxFile.chunks(),
    getRecord: (num: bigint) => evtxFile.getRecord(num),
  };
}
