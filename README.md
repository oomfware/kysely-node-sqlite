# @oomfware/kysely-node-sqlite

[Kysely](https://kysely.dev/) dialect for Node.js built-in
[`node:sqlite`](https://nodejs.org/api/sqlite.html).

```sh
npm install @oomfware/kysely-node-sqlite
```

## usage

```ts
import { DatabaseSync } from 'node:sqlite';
import { Kysely } from 'kysely';
import { NodeSqliteDialect } from '@oomfware/kysely-node-sqlite';

interface Database {
	person: { id: number; name: string };
}

const db = new Kysely<Database>({
	dialect: new NodeSqliteDialect({
		database: new DatabaseSync('app.db'),
	}),
});

const people = await db.selectFrom('person').selectAll().execute();
```

### deferred initialization

the `database` option also accepts a function, which is called once when the first query is
executed:

```ts
const db = new Kysely<Database>({
	dialect: new NodeSqliteDialect({
		database: () => new DatabaseSync('app.db'),
	}),
});
```

this can be async if needed:

```ts
const db = new Kysely<Database>({
	dialect: new NodeSqliteDialect({
		database: async () => {
			const dbPath = await resolveDbPath();
			return new DatabaseSync(dbPath);
		},
	}),
});
```

### connection hook

use `onCreateConnection` to run setup logic after the connection is created, such as enabling WAL
mode or loading extensions:

```ts
const db = new Kysely<Database>({
	dialect: new NodeSqliteDialect({
		database: new DatabaseSync('app.db'),
		onCreateConnection: async (connection) => {
			await connection.executeQuery(CompiledQuery.raw('pragma journal_mode = WAL'));
			await connection.executeQuery(CompiledQuery.raw('pragma foreign_keys = ON'));
		},
	}),
});
```

### streaming

query results can be streamed row by row using Kysely's `.stream()`:

```ts
for await (const person of db.selectFrom('person').selectAll().stream()) {
	console.log(person.name);
}
```
