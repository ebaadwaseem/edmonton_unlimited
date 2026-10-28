// Narrow declaration for the pg APIs used here. Runtime behavior comes from pg.
// Keep this boundary local: the prototype has no @types/pg installed, and does not
// need registry access to build. Query result types can be supplied at call sites.
declare module "pg" {
  export interface QueryResult<Row = Record<string, any>> {
    rows: Row[];
    rowCount: number | null;
  }
  export interface ConnectionOptions {
    host?: string; port?: number; database?: string; user?: string; password?: string;
    connectionTimeoutMillis?: number;
  }
  export class Client {
    constructor(options?: ConnectionOptions);
    connect(): Promise<void>;
    query<Row = Record<string, any>>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
    end(): Promise<void>;
  }
  export interface PoolClient {
    query<Row = Record<string, any>>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
    release(destroy?: boolean): void;
  }
  export class Pool {
    constructor(options?: ConnectionOptions);
    query<Row = Record<string, any>>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
    on(event: "error", listener: (error: Error) => void): this;
  }
}
