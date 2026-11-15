import { createDatabase, seed } from "./local-db.mjs";
const db = await createDatabase();
await seed(db);
console.log("Existing snack schema + all portal migrations + seed succeeded");
await db.close();
