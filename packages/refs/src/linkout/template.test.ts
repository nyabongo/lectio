import { describe, expect, it } from 'vitest';

import { parseRef } from '../parse.ts';
import { LinkoutError } from './errors.ts';
import { TEMPLATE_TOKENS, compactDate, fillTemplate, templateTokens, templateValues } from './template.ts';

const ALL = TEMPLATE_TOKENS.map((t) => `${t}={${t}}`).join('&');

describe('templateValues', () => {
  it('fills every token from the reference and date', () => {
    expect(templateValues(parseRef('1 Cor 12:31-13:13'), '2026-10-05')).toEqual({
      book: '1COR',
      bookName: '1 Corinthians',
      bookSlug: '1corinthians',
      chapter: '12',
      verse: '31',
      query: '1 Corinthians 12:31–13:13',
      osis: '1Cor',
      usfm: '1CO',
      date: '20261005',
    });
  });

  it('leaves verse empty for a whole chapter and date empty without a date', () => {
    const values = templateValues(parseRef('Ps 23'));
    expect(values.verse).toBe('');
    expect(values.date).toBe('');
    expect(values.query).toBe('Psalm 23');
  });

  it('slugs names with spaces', () => {
    expect(templateValues(parseRef('Sg 2:8')).bookSlug).toBe('songofsongs');
  });
});

describe('templateTokens', () => {
  it('lists the tokens used, once each, in order', () => {
    expect(templateTokens('https://x.org/{date}/{book}/{date}')).toEqual(['date', 'book']);
    expect(templateTokens('https://x.org/')).toEqual([]);
  });

  it('rejects unknown tokens', () => {
    expect(() => templateTokens('https://x.org/{chap}')).toThrow(
      expect.objectContaining({ name: 'LinkoutError', code: 'UNKNOWN_TOKEN' }),
    );
    expect(() => templateTokens('https://x.org/{}')).toThrow(LinkoutError);
  });
});

describe('fillTemplate', () => {
  it('substitutes URL-encoded values for every token', () => {
    const url = fillTemplate(`https://example.org/?${ALL}`, templateValues(parseRef('1 Cor 13:4'), '2026-03-01'));
    expect(url).toBe(
      'https://example.org/?book=1COR&bookName=1%20Corinthians&bookSlug=1corinthians&chapter=13&verse=4' +
        '&query=1%20Corinthians%2013%3A4&osis=1Cor&usfm=1CO&date=20260301',
    );
  });

  it('requires an https:// result', () => {
    const values = templateValues(parseRef('Mt 1:1'));
    expect(() => fillTemplate('http://example.org/{chapter}', values)).toThrow(
      expect.objectContaining({ code: 'INVALID_URL' }),
    );
    expect(() => fillTemplate('{osis}', values)).toThrow(expect.objectContaining({ code: 'INVALID_URL' }));
  });
});

describe('compactDate', () => {
  it('turns YYYY-MM-DD into YYYYMMDD', () => {
    expect(compactDate('2028-02-29')).toBe('20280229');
  });

  it.each(['2026-02-29', '2026-13-01', '05/10/2026', '2026-1-5', ''])('rejects %j', (date) => {
    expect(() => compactDate(date)).toThrow(expect.objectContaining({ code: 'INVALID_DATE' }));
  });
});
