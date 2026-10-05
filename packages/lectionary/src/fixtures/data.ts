/** Test helpers: small registries, readings and files. */
import { fileURLToPath } from 'node:url';

import { parseRegistry } from '../sources.ts';
import type { BlockFile, EntryKind, LoadedFile, Reading, SourceRegistry } from '../types.ts';

export const SHA = '00f4cf1a799a95a94f9e03b3b2e3e56e481d3118';
export const OTHER_SHA = '1111111111111111111111111111111111111111';

/** The committed data directory, `calendar/lectionary/`. */
export const DATA_ROOT = fileURLToPath(new URL('../../../../calendar/lectionary', import.meta.url));

const base = {
  bibliography: 'b',
  translation: 't',
  versification: 'v',
  psalmNumbering: 'p',
  licence: 'l',
  permission: 'none-needed',
  automatedRetrieval: false,
  physicalCopy: null,
};

export const REGISTRY_JSON = {
  sources: {
    litcal: {
      ...base,
      title: 'LitCal',
      convention: 'nabre',
      automatedRetrieval: true,
      revision: 'required',
      pinned: SHA,
      retrieval: 'https://example.test/litcal/{rev}/roman/',
      locatorPattern: '[A-Za-z_]+(/[A-Za-z_]+)*/[a-z]{2}\\.json#[A-Za-z0-9_]+(\\.[a-z]+)?',
      locatorExample: 'dominicale_et_festivum_A/en.json#OrdSunday25',
    },
    'olm-1981': {
      ...base,
      title: 'OLM',
      convention: 'vulgate',
      revision: 'forbidden',
      locatorPattern: 'p([0-9]+|\\?)#[0-9]+',
      locatorExample: 'p97#133',
    },
    'ke-lect-2020': {
      ...base,
      title: 'Kenya',
      convention: 'rsv',
      permission: 'to-request',
      revision: 'forbidden',
      locatorPattern: 'v[1-3]:p[0-9]+#[0-9]+',
      locatorExample: 'v3:p412#133',
    },
  },
};

export const REGISTRY: SourceRegistry = parseRegistry(REGISTRY_JSON).registry;

export const OLM = 'olm-1981 p97#133';
export const LITCAL = `litcal@${SHA} dominicale_et_festivum_A/en.json#OrdSunday25`;

export function reading(slot: Reading['slot'], ref: string, extra: Partial<Reading> = {}): Reading {
  return { slot, ref, source: OLM, status: 'provisional', ...extra };
}

export function file(kind: EntryKind, entries: BlockFile['entries'], path = `test/${kind}.json`): LoadedFile {
  return { block: path.split('/')[0] as string, path, data: { kind, entries } };
}

/** One-Mass entry. */
export function entry(key: string, readings: Reading[], extra: { common?: string; id?: string; label?: string } = {}) {
  return {
    key,
    ...(extra.common === undefined ? {} : { common: extra.common }),
    masses: [{ id: extra.id ?? 'day', ...(extra.label === undefined ? {} : { label: extra.label }), readings }],
  };
}
