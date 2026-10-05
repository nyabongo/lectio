import { ProviderError } from '@lectio/providers';
import { describe, expect, it } from 'vitest';

import { assertPublicUrl, isBlockedAddress, systemResolveHost } from './ssrf.ts';

describe('isBlockedAddress', () => {
  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '100.127.255.255',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '192.0.0.8',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:a9fe:a9fe',
    '64:ff9b::a00:1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'fe80::1%eth0',
    'fe80:0:0:0:0:0:0:1',
    'fec0::1',
    'ff02::1',
    '2001:db8::1',
    'not-an-ip',
  ])('blocks %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([
    '93.184.215.14',
    '8.8.8.8',
    '100.128.0.1',
    '172.32.0.1',
    '2606:4700::1111',
    '2606:4700:0:0:0:0:0:1111',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
  ])('allows %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });
});

describe('assertPublicUrl', () => {
  const PUBLIC = async (): Promise<string[]> => ['93.184.215.14'];
  const check = (url: string, resolve = PUBLIC) => assertPublicUrl(new URL(url), resolve);

  it('allows public literals and hostnames that resolve only to public addresses', async () => {
    await expect(check('https://93.184.215.14/')).resolves.toBeUndefined();
    await expect(check('https://[2606:4700::1111]/')).resolves.toBeUndefined();
    await expect(check('https://example.test./a')).resolves.toBeUndefined();
  });

  it('refuses local names and non-public literals without resolving them', async () => {
    const never = async (): Promise<string[]> => {
      throw new Error('should not resolve');
    };
    for (const url of [
      'http://localhost:3000/',
      'http://api.localhost/',
      'http://127.0.0.1/',
      'http://2130706433/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://169.254.169.254/latest/meta-data/',
    ]) {
      const error = await check(url, never).catch((e: unknown) => e);
      expect(error, url).toBeInstanceOf(ProviderError);
      expect(error).toMatchObject({ code: 'invalid-request', retryable: false });
    }
  });

  it('refuses a hostname with any non-public address, or with none', async () => {
    await expect(check('https://mixed.test/', async () => ['93.184.215.14', 'fd00::1'])).rejects.toThrow(
      'refusing to fetch https://mixed.test/: mixed.test resolves to non-public address fd00::1',
    );
    await expect(check('https://empty.test/', async () => [])).rejects.toThrow('empty.test has no addresses');
  });

  it('reports a failed lookup as unavailable and not retryable', async () => {
    const failing = async (): Promise<string[]> => {
      throw new Error('ENOTFOUND');
    };
    await expect(check('https://nowhere.test/', failing)).rejects.toMatchObject({
      code: 'unavailable',
      retryable: false,
      message: 'GET https://nowhere.test/: cannot resolve nowhere.test: ENOTFOUND',
    });
    await expect(check('https://nowhere.test/', () => Promise.reject('down'))).rejects.toThrow(
      'cannot resolve nowhere.test: down',
    );
  });

  it('resolves with the system resolver by default (localhost, from the hosts file)', async () => {
    const addresses = await systemResolveHost('localhost');
    expect(addresses.length).toBeGreaterThan(0);
    expect(addresses.every(isBlockedAddress)).toBe(true);
  });
});
