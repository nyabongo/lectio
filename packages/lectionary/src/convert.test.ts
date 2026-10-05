import { parseRef, toKey } from '@lectio/refs';
import { describe, expect, it } from 'vitest';

import { ConversionError, toCanonical } from './convert.ts';
import type { Convention } from './types.ts';

const key = (ref: string, convention: Convention): string => toKey(toCanonical(parseRef(ref), convention));

describe('toCanonical', () => {
  it('only drops letters for NABRE sources', () => {
    expect(key('Phil 1:20c-24, 27a', 'nabre')).toBe('PHIL.1.20-24_1.27');
    expect(key('Ps 144:1-2', 'nabre')).toBe('PS.144.1-2');
  });

  it.each([
    ['Ps 1:1-2', 'PS.1.1-2'],
    ['Ps 8:2', 'PS.8.2'],
    ['Ps 9:2-3', 'PS.9.2-3'],
    ['Ps 9:22-23', 'PS.10.1-2'],
    ['Ps 9:20-23', 'PS.9.20-10.2'],
    ['Ps 9', 'PS.9-10'],
    ['Ps 24:4bc-5, 6-7, 8-9', 'PS.25.4-5_25.6-7_25.8-9'],
    ['Ps 112:1-2', 'PS.113.1-2'],
    ['Ps 113:1-2', 'PS.114.1-2'],
    ['Ps 113:9-10', 'PS.115.1-2'],
    ['Ps 113', 'PS.114-115'],
    ['Ps 114:1-3', 'PS.116.1-3'],
    ['Ps 114', 'PS.116.1-9'],
    ['Ps 115:10-11', 'PS.116.10-11'],
    ['Ps 115:12-13, 15-16bc, 17-18', 'PS.116.12-13_116.15-16_116.17-18'],
    ['Ps 115', 'PS.116.10-19'],
    ['Ps 144:2-3, 8-9, 17-18', 'PS.145.2-3_145.8-9_145.17-18'],
    ['Ps 145:1', 'PS.146.1'],
    ['Ps 145:7, 8-9, 9-10', 'PS.146.7_146.8-9_146.9-10'],
    ['Ps 15:1-2, 5, 7-8, 9-10, 11', 'PS.16.1-2_16.5_16.7-8_16.9-10_16.11'],
    ['Ps 15', 'PS.16'],
    ['Ps 50:3-4', 'PS.51.3-4'],
    ['Ps 8:2-9:3', 'PS.8.2-9.3'],
    ['Ps 146:1-2', 'PS.147.1-2'],
    ['Ps 146', 'PS.147.1-11'],
    ['Ps 147:12-13, 14-15, 19-20', 'PS.147.12-13_147.14-15_147.19-20'],
    ['Ps 147', 'PS.147.12-20'],
    ['Ps 148:1', 'PS.148.1'],
    ['Ps 22-23', 'PS.23-24'],
    ['Jl 3:1-5', 'JL.3.1-5'],
    ['Mal 3:19-20', 'MAL.3.19-20'],
    ['Hos 14:2-10', 'HOS.14.2-10'],
    ['1 Kgs 5:1-2', '1KGS.5.1-2'],
  ])('converts Vulgate (Nova Vulgata) %s to %s', (ref, expected) => {
    expect(key(ref, 'vulgate')).toBe(expected);
  });

  it('refuses psalm verses the Nova Vulgata numbering does not have', () => {
    expect(() => key('Ps 115:1-2', 'vulgate')).toThrow(ConversionError);
    expect(() => key('Ps 147:1-2', 'vulgate')).toThrow(/does not exist in the vulgate scheme/);
    expect(() => key('Ps 151:1', 'vulgate')).toThrow(ConversionError);
  });

  it.each([
    ['Jl 2:28-32', 'JL.3.1-5'],
    ['Jl 2:23-32', 'JL.2.23-3.5'],
    ['Jl 3:1-2', 'JL.4.1-2'],
    ['Jl 3', 'JL.4'],
    ['Jl 2:12-18', 'JL.2.12-18'],
    ['Mal 4:1-2', 'MAL.3.19-20'],
    ['Mal 4', 'MAL.3.19-24'],
    ['Mal 3:1-4', 'MAL.3.1-4'],
    ['Ps 51:1-2', 'PS.51.3-4'],
    ['Ps 23', 'PS.23'],
    ['Mt 20:1-16a', 'MT.20.1-16'],
    ['Mt 20', 'MT.20'],
  ])('converts RSV %s to %s', (ref, expected) => {
    expect(key(ref, 'rsv')).toBe(expected);
  });

  it('refuses an RSV verse that does not exist', () => {
    expect(() => key('Mt 20:40', 'rsv')).toThrow(ConversionError);
  });

  it('leaves Esther, Sirach and Tobit to a hand conversion', () => {
    for (const ref of ['Sir 3:2-6', 'Tb 3:1-2', 'Est 4:1-2']) {
      expect(() => key(ref, 'vulgate')).toThrow(/entry by entry/);
      expect(() => key(ref, 'rsv')).toThrow(ConversionError);
      expect(() => key(ref, 'nabre')).not.toThrow();
    }
  });
});
