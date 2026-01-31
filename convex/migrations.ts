import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api";
import { DataModel } from "./_generated/dataModel";

const migrations = new Migrations<DataModel>(components.migrations);


// General-purpose runner - can run any migration by name
// Usage: npx convex run migrations:run '{"fn": "migrations:migrateTaskStatusDoneToClosed"}'
export const run = migrations.runner();

// Run all migrations in series
// Usage: npx convex run migrations:runAll
export const runAll = migrations.runner([
]);
