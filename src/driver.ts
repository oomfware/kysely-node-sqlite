import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

import {
	CompiledQuery,
	IdentifierNode,
	RawNode,
	createQueryId,
	type DatabaseConnection,
	type Driver,
	type QueryCompiler,
	type QueryResult,
	type TransactionSettings,
} from 'kysely';

import type { NodeSqliteDialectConfig } from './dialect-config.ts';

/**
 * a Kysely driver for `node:sqlite`.
 */
export class NodeSqliteDriver implements Driver {
	readonly #config: NodeSqliteDialectConfig;
	readonly #mutex = new ConnectionMutex();

	#db?: DatabaseSync;
	#connection?: NodeSqliteConnection;

	constructor(config: NodeSqliteDialectConfig) {
		this.#config = Object.freeze({ ...config });
	}

	async init(): Promise<void> {
		this.#db =
			typeof this.#config.database === 'function' ? await this.#config.database() : this.#config.database;

		this.#connection = new NodeSqliteConnection(this.#db);

		if (this.#config.onCreateConnection) {
			await this.#config.onCreateConnection(this.#connection);
		}
	}

	async acquireConnection(): Promise<DatabaseConnection> {
		await this.#mutex.lock();
		return this.#connection!;
	}

	async releaseConnection(): Promise<void> {
		this.#mutex.unlock();
	}

	async beginTransaction(connection: DatabaseConnection, _settings: TransactionSettings): Promise<void> {
		await connection.executeQuery(CompiledQuery.raw('begin'));
	}

	async commitTransaction(connection: DatabaseConnection): Promise<void> {
		await connection.executeQuery(CompiledQuery.raw('commit'));
	}

	async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
		await connection.executeQuery(CompiledQuery.raw('rollback'));
	}

	async savepoint(
		connection: DatabaseConnection,
		savepointName: string,
		compileQuery: QueryCompiler['compileQuery'],
	): Promise<void> {
		await connection.executeQuery(
			compileQuery(savepointCommand('savepoint', savepointName), createQueryId()),
		);
	}

	async rollbackToSavepoint(
		connection: DatabaseConnection,
		savepointName: string,
		compileQuery: QueryCompiler['compileQuery'],
	): Promise<void> {
		await connection.executeQuery(
			compileQuery(savepointCommand('rollback to', savepointName), createQueryId()),
		);
	}

	async releaseSavepoint(
		connection: DatabaseConnection,
		savepointName: string,
		compileQuery: QueryCompiler['compileQuery'],
	): Promise<void> {
		await connection.executeQuery(compileQuery(savepointCommand('release', savepointName), createQueryId()));
	}

	async destroy(): Promise<void> {
		this.#db?.close();
	}
}

function savepointCommand(command: string, savepointName: string): RawNode {
	return RawNode.createWithChildren([
		RawNode.createWithSql(`${command} `),
		IdentifierNode.create(savepointName),
	]);
}

// #region NodeSqliteConnection

/**
 * a Kysely database connection wrapping a `node:sqlite` `DatabaseSync` instance.
 */
export class NodeSqliteConnection implements DatabaseConnection {
	readonly #db: DatabaseSync;

	constructor(db: DatabaseSync) {
		this.#db = db;
	}

	executeQuery<O>(compiledQuery: CompiledQuery): Promise<QueryResult<O>> {
		const { sql, parameters } = compiledQuery;
		const stmt = this.#db.prepare(sql);

		if (stmt.columns().length > 0) {
			return Promise.resolve({
				rows: stmt.all(...(parameters as SQLInputValue[])) as O[],
			});
		}

		const { changes, lastInsertRowid } = stmt.run(...(parameters as SQLInputValue[]));

		return Promise.resolve({
			numAffectedRows: BigInt(changes),
			insertId: BigInt(lastInsertRowid),
			rows: [],
		});
	}

	async *streamQuery<O>(
		compiledQuery: CompiledQuery,
		_chunkSize?: number,
	): AsyncIterableIterator<QueryResult<O>> {
		const { sql, parameters } = compiledQuery;
		const stmt = this.#db.prepare(sql);

		for (const row of stmt.iterate(...(parameters as SQLInputValue[]))) {
			yield { rows: [row as O] };
		}
	}
}

// #endregion

// #region ConnectionMutex

class ConnectionMutex {
	#deferred?: PromiseWithResolvers<void>;

	async lock(): Promise<void> {
		while (this.#deferred) {
			await this.#deferred.promise;
		}

		this.#deferred = Promise.withResolvers<void>();
	}

	unlock(): void {
		const deferred = this.#deferred;
		this.#deferred = undefined;
		deferred?.resolve();
	}
}

// #endregion
