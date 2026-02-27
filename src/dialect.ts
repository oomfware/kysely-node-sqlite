import {
	SqliteAdapter,
	SqliteIntrospector,
	SqliteQueryCompiler,
	type DatabaseIntrospector,
	type Dialect,
	type DialectAdapter,
	type Driver,
	type Kysely,
	type QueryCompiler,
} from 'kysely';

import type { NodeSqliteDialectConfig } from './dialect-config.ts';
import { NodeSqliteDriver } from './driver.ts';

/**
 * a Kysely dialect for `node:sqlite` (`DatabaseSync`).
 *
 * @example
 * ```ts
 * import { DatabaseSync } from 'node:sqlite';
 * import { Kysely } from 'kysely';
 * import { NodeSqliteDialect } from '@oomfware/kysely-node-sqlite';
 *
 * const db = new Kysely({
 *   dialect: new NodeSqliteDialect({
 *     database: new DatabaseSync(':memory:'),
 *   }),
 * });
 * ```
 */
export class NodeSqliteDialect implements Dialect {
	readonly #config: NodeSqliteDialectConfig;

	constructor(config: NodeSqliteDialectConfig) {
		this.#config = config;
	}

	createDriver(): Driver {
		return new NodeSqliteDriver(this.#config);
	}

	createQueryCompiler(): QueryCompiler {
		return new SqliteQueryCompiler();
	}

	createAdapter(): DialectAdapter {
		return new SqliteAdapter();
	}

	createIntrospector(db: Kysely<unknown>): DatabaseIntrospector {
		return new SqliteIntrospector(db);
	}
}
