declare module 'commander' {
  export class Command {
    [key: string]: any;
  }
}

declare module 'better-sqlite3' {
  const anyDb: any;
  export default anyDb;
}

