import { describe, expect, it } from 'vitest';

import { USER_AGENT } from './http.ts';
import { ALLOW_ALL, DISALLOW_ALL, parseRobots, productToken } from './robots.ts';

describe('productToken', () => {
  it('is the User-Agent up to the first space or slash, lower case', () => {
    expect(productToken(USER_AGENT)).toBe('lectiobot');
    expect(productToken('Other/2.0 (x)')).toBe('other');
  });
});

describe('parseRobots', () => {
  it('uses the LectioBot group over the * group', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: lectiobot\nDisallow: /tmp\n', USER_AGENT);
    expect(rules.allows('/page')).toBe(true);
    expect(rules.allows('/tmp/x')).toBe(false);
  });

  it('falls back to the * group, and allows everything without one', () => {
    expect(parseRobots('User-agent: other\nDisallow: /\n', USER_AGENT).allows('/a')).toBe(true);
    expect(parseRobots('User-agent: *\nDisallow: /a\n', USER_AGENT).allows('/a')).toBe(false);
    expect(parseRobots('', USER_AGENT).allows('/a')).toBe(true);
  });

  it('lets consecutive User-agent lines share a group, and merges repeated groups', () => {
    const text = 'User-agent: foo\nUser-Agent: LectioBot\nDisallow: /a\n\nuser-agent: lectiobot\ndisallow: /b\n';
    const rules = parseRobots(text, USER_AGENT);
    expect(rules.allows('/a')).toBe(false);
    expect(rules.allows('/b')).toBe(false);
    expect(rules.allows('/c')).toBe(true);
  });

  it('prefers the longest match, Allow on a tie, and ignores an empty Disallow', () => {
    const text = [
      'User-agent: *',
      'Disallow: /docs/',
      'Allow: /docs/public/',
      'Disallow: /same',
      'Allow: /same',
      'Disallow:',
      'Sitemap: https://x.test/sitemap.xml',
      'Disallow: /x # trailing comment',
      'no colon here',
    ].join('\r\n');
    const rules = parseRobots(text, USER_AGENT);
    expect(rules.allows('/docs/secret')).toBe(false);
    expect(rules.allows('/docs/public/page')).toBe(true);
    expect(rules.allows('/same')).toBe(true);
    expect(rules.allows('/x')).toBe(false);
    expect(rules.allows('/y')).toBe(true);
  });

  it('supports * wildcards, the $ anchor, and query strings; robots.txt itself is always allowed', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /*.pdf$\nDisallow: /search?q=\nDisallow: /\n', USER_AGENT);
    expect(rules.allows('/robots.txt')).toBe(true);
    const pdf = parseRobots('User-agent: *\nDisallow: /*.pdf$\nDisallow: /search?q=\n', USER_AGENT);
    expect(pdf.allows('/files/a.pdf')).toBe(false);
    expect(pdf.allows('/files/a.pdf?x=1')).toBe(true);
    expect(pdf.allows('/search?q=codex')).toBe(false);
    expect(pdf.allows('/search')).toBe(true);
  });

  it('ignores rules before any User-agent line', () => {
    expect(parseRobots('Disallow: /\nUser-agent: *\nAllow: /\n', USER_AGENT).allows('/a')).toBe(true);
  });
});

describe('ALLOW_ALL and DISALLOW_ALL', () => {
  it('allow everything, or nothing but robots.txt', () => {
    expect(ALLOW_ALL.allows('/a')).toBe(true);
    expect(DISALLOW_ALL.allows('/a')).toBe(false);
    expect(DISALLOW_ALL.allows('/robots.txt')).toBe(true);
  });
});
