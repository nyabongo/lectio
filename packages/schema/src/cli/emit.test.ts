// emit.ts is wiring only: it calls emitSchemas with its default directory and logs each path (logic and
// tests: ./emit-schemas.test.ts). emit-schemas.ts is mocked once for the file, so importing the entry
// point never loads the schemas or writes json/*.schema.json.
import { afterEach, describe, expect, it, vi } from 'vitest';

const { emitSchemas } = vi.hoisted(() => ({ emitSchemas: vi.fn<(...args: unknown[]) => Promise<string[]>>() }));
vi.mock('./emit-schemas.ts', () => ({ emitSchemas }));

describe('schema:emit entry point', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    emitSchemas.mockReset();
    vi.resetModules();
  });

  it('emits into the default directory and logs each path', async () => {
    emitSchemas.mockResolvedValue(['/x/a.schema.json', '/x/b.schema.json']);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await import('./emit.ts');
    expect(emitSchemas).toHaveBeenCalledWith();
    expect(log.mock.calls).toEqual([['wrote /x/a.schema.json'], ['wrote /x/b.schema.json']]);
  });
});
