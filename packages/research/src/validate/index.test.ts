import { describe, expect, it } from 'vitest';

import * as validate from './index.ts';

describe('validate barrel', () => {
  it('exports the pre-validation API', () => {
    expect(Object.keys(validate).sort()).toEqual([
      'DEFAULT_REPAIR_MAX_TOKENS',
      'DEFAULT_REPAIR_TOOLS',
      'PRE_VALIDATION_GATE_IDS',
      'REPAIR_PROMPT_VERSION',
      'applyDrops',
      'buildRepairRequest',
      'contentPrefix',
      'draftFromResult',
      'draftPath',
      'formatValidationReport',
      'outputOfPassage',
      'planDrops',
      'preValidate',
      'preValidateRun',
      'preValidationGates',
      'repairSystemPrompt',
      'repairUserMessage',
      'runDraftGates',
      'stripClaims',
    ]);
  });
});
