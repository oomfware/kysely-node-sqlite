import type { DatabaseSync } from 'node:sqlite';

import type { DatabaseConnection } from 'kysely';

/**
 * configuration for {@link NodeSqliteDialect}.
 */
export interface NodeSqliteDialectConfig {
	/**
	 * a `node:sqlite` `DatabaseSync` instance, or a function that returns one.
	 *
	 * if a function is provided, it's called once when the first query is executed.
	 */
	database: DatabaseSync | (() => DatabaseSync) | (() => Promise<DatabaseSync>);

	/**
	 * called once after the connection is created during driver initialization.
	 *
	 * @param connection the created database connection.
	 */
	onCreateConnection?: (connection: DatabaseConnection) => Promise<void>;
}
