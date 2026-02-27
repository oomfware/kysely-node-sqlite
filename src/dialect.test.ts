import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { Kysely, sql } from 'kysely';
import type { Generated } from 'kysely';

import { NodeSqliteDialect } from './dialect.ts';

interface TestDatabase {
	person: { id: Generated<number>; name: string };
}

function createTestDb(): Kysely<TestDatabase> {
	return new Kysely<TestDatabase>({
		dialect: new NodeSqliteDialect({
			database: new DatabaseSync(':memory:'),
		}),
	});
}

function setupSchema(db: Kysely<TestDatabase>): Promise<void> {
	return db.schema
		.createTable('person')
		.addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
		.addColumn('name', 'text', (col) => col.notNull())
		.execute();
}

async function seedData(db: Kysely<TestDatabase>): Promise<void> {
	await db
		.insertInto('person')
		.values([{ name: 'alice' }, { name: 'bob' }, { name: 'charlie' }])
		.execute();
}

describe('NodeSqliteDialect', () => {
	let db: Kysely<TestDatabase>;

	beforeEach(async () => {
		db = createTestDb();
		await setupSchema(db);
		await seedData(db);
	});

	afterEach(async () => {
		await db.destroy();
	});

	// #region CRUD

	describe('CRUD', () => {
		it('should select all rows', async () => {
			const result = await db.selectFrom('person').selectAll().execute();
			assert.equal(result.length, 3);
			assert.equal(result[0].name, 'alice');
			assert.equal(result[1].name, 'bob');
			assert.equal(result[2].name, 'charlie');
		});

		it('should insert without returning', async () => {
			const result = await db.insertInto('person').values({ name: 'dave' }).executeTakeFirstOrThrow();

			assert.equal(result.numInsertedOrUpdatedRows, 1n);
		});

		it('should insert with returning', async () => {
			const result = await db
				.insertInto('person')
				.values({ name: 'dave' })
				.returning(['id', 'name'])
				.executeTakeFirstOrThrow();

			assert.equal(result.name, 'dave');
			assert.equal(typeof result.id, 'number');
		});

		it('should update without returning', async () => {
			const result = await db
				.updateTable('person')
				.set('name', 'alice2')
				.where('name', '=', 'alice')
				.executeTakeFirstOrThrow();

			assert.equal(result.numUpdatedRows, 1n);
		});

		it('should update with returning', async () => {
			const result = await db
				.updateTable('person')
				.set('name', 'alice2')
				.where('name', '=', 'alice')
				.returning('name')
				.executeTakeFirstOrThrow();

			assert.equal(result.name, 'alice2');
		});

		it('should delete without returning', async () => {
			const result = await db.deleteFrom('person').where('name', '=', 'alice').executeTakeFirstOrThrow();

			assert.equal(result.numDeletedRows, 1n);
		});

		it('should delete with returning', async () => {
			const result = await db
				.deleteFrom('person')
				.where('name', '=', 'alice')
				.returning('name')
				.executeTakeFirstOrThrow();

			assert.equal(result.name, 'alice');
		});

		it('should return rows from raw query with returning', async () => {
			const result = await sql`insert into person (name) values ('dave') returning *`.execute(db);

			assert.equal(result.rows.length, 1);
			assert.equal((result.rows[0] as { name: string }).name, 'dave');
		});
	});

	// #endregion

	// #region transactions

	describe('transactions', () => {
		it('should commit persisted changes', async () => {
			await db.transaction().execute(async (trx) => {
				await trx.insertInto('person').values({ name: 'dave' }).execute();
			});

			const rows = await db.selectFrom('person').selectAll().execute();
			assert.equal(rows.length, 4);
		});

		it('should savepoint and release', async () => {
			const trx = await db.startTransaction().execute();

			await trx.insertInto('person').values({ name: 'dave' }).execute();
			const trx2 = await trx.savepoint('sp1').execute();
			await trx2.insertInto('person').values({ name: 'eve' }).execute();
			await trx2.releaseSavepoint('sp1').execute();
			await trx.commit().execute();

			const rows = await db.selectFrom('person').selectAll().execute();
			assert.equal(rows.length, 5);
		});

		it('should rollback to savepoint', async () => {
			const trx = await db.startTransaction().execute();

			await trx.insertInto('person').values({ name: 'dave' }).execute();
			const trx2 = await trx.savepoint('sp1').execute();
			await trx2.insertInto('person').values({ name: 'eve' }).execute();
			await trx2.rollbackToSavepoint('sp1').execute();
			await trx.commit().execute();

			const rows = await db.selectFrom('person').selectAll().execute();
			assert.equal(rows.length, 4);
			assert.equal(rows[3].name, 'dave');
		});

		it('should handle savepoint names with double quotes', async () => {
			const trx = await db.startTransaction().execute();

			await trx.insertInto('person').values({ name: 'dave' }).execute();
			const trx2 = await trx.savepoint('sp"1').execute();
			await trx2.insertInto('person').values({ name: 'eve' }).execute();
			await trx2.rollbackToSavepoint('sp"1').execute();
			await trx.commit().execute();

			const rows = await db.selectFrom('person').selectAll().execute();
			assert.equal(rows.length, 4);
		});

		it('should rollback on error', async () => {
			await assert.rejects(
				db.transaction().execute(async (trx) => {
					await trx.insertInto('person').values({ name: 'dave' }).execute();
					throw new Error('rollback');
				}),
				{ message: 'rollback' },
			);

			const rows = await db.selectFrom('person').selectAll().execute();
			assert.equal(rows.length, 3);
		});
	});

	// #endregion

	// #region streaming

	describe('streaming', () => {
		it('should exhaust the iterator', async () => {
			const items: { id: number; name: string }[] = [];

			for await (const row of db.selectFrom('person').selectAll().stream()) {
				items.push(row);
			}

			assert.equal(items.length, 3);
			assert.equal(items[0].name, 'alice');
		});

		it('should support early break', async () => {
			const items: { id: number; name: string }[] = [];

			for await (const row of db.selectFrom('person').selectAll().stream()) {
				items.push(row);
				break;
			}

			assert.equal(items.length, 1);
		});
	});

	// #endregion

	// #region introspection

	describe('introspection', () => {
		it('should return table metadata', async () => {
			const tables = await db.introspection.getTables();
			const person = tables.find((t) => t.name === 'person');

			assert.ok(person);
			assert.equal(person.name, 'person');

			const idCol = person.columns.find((c) => c.name === 'id');
			const nameCol = person.columns.find((c) => c.name === 'name');

			assert.ok(idCol);
			assert.ok(nameCol);
		});

		it('should return empty schemas', async () => {
			const schemas = await db.introspection.getSchemas();
			assert.deepEqual(schemas, []);
		});
	});

	// #endregion

	// #region onCreateConnection

	describe('onCreateConnection', () => {
		it('should call the hook once', async () => {
			let callCount = 0;

			const testDb = new Kysely<TestDatabase>({
				dialect: new NodeSqliteDialect({
					database: new DatabaseSync(':memory:'),
					onCreateConnection: async () => {
						callCount++;
					},
				}),
			});

			await testDb
				.selectFrom('person')
				.selectAll()
				.execute()
				.catch(() => {
					// table doesn't exist, that's fine
				});

			assert.equal(callCount, 1);
			await testDb.destroy();
		});
	});

	// #endregion

	// #region factory config

	describe('factory config', () => {
		it('should accept database as a function', async () => {
			const testDb = new Kysely<TestDatabase>({
				dialect: new NodeSqliteDialect({
					database: () => new DatabaseSync(':memory:'),
				}),
			});

			// should not throw — the factory produces a valid database
			await testDb.schema
				.createTable('person')
				.addColumn('id', 'integer', (col) => col.primaryKey())
				.addColumn('name', 'text', (col) => col.notNull())
				.execute();

			await testDb.insertInto('person').values({ name: 'test' }).execute();
			const rows = await testDb.selectFrom('person').selectAll().execute();
			assert.equal(rows.length, 1);
			await testDb.destroy();
		});

		it('should accept database as an async function', async () => {
			const testDb = new Kysely<TestDatabase>({
				dialect: new NodeSqliteDialect({
					database: async () => new DatabaseSync(':memory:'),
				}),
			});

			await testDb.schema
				.createTable('person')
				.addColumn('id', 'integer', (col) => col.primaryKey())
				.addColumn('name', 'text', (col) => col.notNull())
				.execute();

			await testDb.insertInto('person').values({ name: 'test' }).execute();
			const rows = await testDb.selectFrom('person').selectAll().execute();
			assert.equal(rows.length, 1);
			await testDb.destroy();
		});
	});

	// #endregion
});
