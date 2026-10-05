// `npm run schema:emit`: writes packages/schema/json/*.schema.json. Logic: ./emit-schemas.ts.
import { emitSchemas } from './emit-schemas.ts';

for (const filePath of await emitSchemas()) console.log(`wrote ${filePath}`);
