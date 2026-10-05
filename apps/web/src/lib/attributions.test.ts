import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LinkoutConfig } from '@lectio/config';
import { afterEach, describe, expect, it } from 'vitest';

import {
  GUARD_DIR,
  LICENSE_URL,
  REPO_URL,
  REPORT_ISSUE_URL,
  attributionParagraphs,
  attributionPaths,
  familyFromFileStem,
  licenceParts,
  linkoutCredit,
  loadAttributions,
  nodeFs,
  oflCopyright,
  parseFontsReadme,
  projectUrl,
  readCorpora,
  readFonts,
  readGuard,
  readLectionarySources,
  readVersification,
  siteAttributionPaths,
  spdxId,
  versionUrl,
} from './attributions.ts';
import type { AttributionFs } from './attributions.ts';

const fixtureCorpus = fileURLToPath(new URL('../../test/fixtures/corpus', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));

/** An in-memory file system: paths ending in `/` are directories, everything else files. */
function memoryFs(files: Record<string, string>): AttributionFs {
  const children = (path: string, wantDirectories: boolean): string[] => {
    const prefix = `${path.replace(/\/$/, '')}/`;
    const names = new Set<string>();
    for (const file of Object.keys(files)) {
      if (!file.startsWith(prefix)) continue;
      const rest = file.slice(prefix.length);
      const [head = '', ...tail] = rest.split('/');
      if (tail.length > 0 === wantDirectories) names.add(head);
    }
    return [...names];
  };
  return {
    readFile: (path) => Promise.resolve(files[path]),
    listDirectories: (path) => Promise.resolve(children(path, true)),
    listFiles: (path) => Promise.resolve(children(path, false)),
  };
}

const temps: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lectio-attributions-'));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('readCorpora', () => {
  it('lists every fixture SOURCE.json in edition order and skips the guard index', async () => {
    const corpora = await readCorpora(fixtureCorpus);
    expect(corpora.map((entry) => entry.edition)).toEqual(['grc-sample', 'hbo-sample', 'lat-sample']);
    expect(corpora.map((entry) => entry.language)).toEqual(['grc', 'hbo', 'lat']);
    const [greek] = corpora;
    expect(greek).toMatchObject({
      name: 'Sample Greek New Testament',
      licence: 'CC-BY-4.0 AND CC-BY-SA-3.0',
      projectUrl: 'https://github.com/example/greek-sample',
      versionUrl: 'https://github.com/example/greek-sample/commit/0123456789abcdef0123456789abcdef01234567',
      version: '0123456789abcdef0123456789abcdef01234567',
      licenceFileUrl: `${REPO_URL}/blob/main/corpus/grc-sample/LICENSE.md`,
    });
    expect(greek?.licenceParts.map((part) => part.id)).toEqual(['CC-BY-4.0', 'CC-BY-SA-3.0']);
    expect(greek?.attribution).toHaveLength(2);
    expect(corpora[2]?.projectUrl).toBe('https://bitbucket.org/example/latin-sample');
    expect(corpora[2]?.versionUrl).toBe(
      'https://bitbucket.org/example/latin-sample/commits/fedcba9876543210fedcba9876543210fedcba98',
    );
  });

  it('adds an entry for a new SOURCE.json with no code change', async () => {
    const root = await tempDir();
    await cp(fixtureCorpus, root, { recursive: true });
    await mkdir(join(root, 'arc-new'));
    await writeFile(
      join(root, 'arc-new', 'SOURCE.json'),
      JSON.stringify({
        name: 'New Aramaic Targum',
        language: 'arc',
        upstreamUrl: 'https://example.org/targum.zip',
        version: '1.0',
        sha256: '4'.repeat(64),
        licence: 'CC-BY-4.0',
        attribution: 'New Aramaic sample, CC BY 4.0.',
        versification: 'original',
      }),
    );
    const before = await readCorpora(fixtureCorpus);
    const after = await readCorpora(root);
    expect(after).toHaveLength(before.length + 1);
    expect(after[0]).toMatchObject({
      edition: 'arc-new',
      name: 'New Aramaic Targum',
      projectUrl: 'https://example.org/targum.zip',
    });
  });

  it('gives no entries for a missing corpus root', async () => {
    expect(await readCorpora(join(fixtureCorpus, 'missing'))).toEqual([]);
  });

  it('fails the build on a malformed SOURCE.json', async () => {
    const fs = memoryFs({ '/c/bad/SOURCE.json': '{"name": "x", "language": "grc"}' });
    await expect(readCorpora('/c', fs)).rejects.toThrow(/SOURCE\.json/);
  });

  it('reads the real corpus, whose guard directory is not an edition', async () => {
    const corpora = await readCorpora(join(repoRoot, 'corpus'));
    expect(corpora.map((entry) => entry.edition)).not.toContain(GUARD_DIR);
    expect(corpora.length).toBeGreaterThan(0);
  });
});

describe('licenceParts', () => {
  it('splits SPDX expressions and links plain ids', () => {
    expect(licenceParts('(CC-BY-4.0 OR MIT) AND LicenseRef-PublicDomain')).toEqual([
      { id: 'CC-BY-4.0', publicDomain: false, url: 'https://spdx.org/licenses/CC-BY-4.0.html' },
      { id: 'MIT', publicDomain: false, url: 'https://spdx.org/licenses/MIT.html' },
      { id: 'LicenseRef-PublicDomain', publicDomain: true, url: null },
    ]);
    expect(licenceParts('GPL-3.0-only WITH Classpath-exception-2.0')).toHaveLength(2);
  });

  it('recognises free-text public domain and leaves other free text unlinked', () => {
    expect(licenceParts('Public Domain')).toEqual([{ id: 'Public Domain', publicDomain: true, url: null }]);
    expect(licenceParts('Same as the Lectio repository')).toEqual([
      { id: 'Same as the Lectio repository', publicDomain: false, url: null },
    ]);
    expect(licenceParts('LicenseRef-Custom')).toEqual([{ id: 'LicenseRef-Custom', publicDomain: false, url: null }]);
  });
});

describe('attributionParagraphs', () => {
  it('splits lines into paragraphs and underscores into emphasis', () => {
    expect(attributionParagraphs('First line.\n\n Tauber (2017) _MorphGNT: SBLGNT Edition_. v6\n')).toEqual([
      [{ text: 'First line.', em: false }],
      [
        { text: 'Tauber (2017) ', em: false },
        { text: 'MorphGNT: SBLGNT Edition', em: true },
        { text: '. v6', em: false },
      ],
    ]);
  });

  it('leaves underscores inside words alone', () => {
    expect(attributionParagraphs('see snake_case_name here')).toEqual([
      [{ text: 'see snake_case_name here', em: false }],
    ]);
  });
});

describe('versionUrl', () => {
  it('links the commit page on known forges and falls back to the archive', () => {
    expect(versionUrl('https://gitlab.com/o/r/-/archive/v1/r-v1.tar.gz', 'v1')).toBe(
      'https://gitlab.com/o/r/-/commit/v1',
    );
    expect(versionUrl('https://example.org/x.zip', '1.0')).toBe('https://example.org/x.zip');
  });
});

describe('spdxId', () => {
  it('maps free-text Creative Commons names to SPDX ids', () => {
    expect(spdxId('CC BY 4.0')).toBe('CC-BY-4.0');
    expect(spdxId('cc by-sa 3.0')).toBe('CC-BY-SA-3.0');
    expect(spdxId('CC BY NC ND 4.0')).toBe('CC-BY-NC-ND-4.0');
    expect(spdxId('MIT')).toBe('MIT');
    expect(licenceParts('CC BY 4.0')).toEqual([
      { id: 'CC-BY-4.0', publicDomain: false, url: 'https://spdx.org/licenses/CC-BY-4.0.html' },
    ]);
  });
});

describe('projectUrl', () => {
  it('strips archive paths from known forges and keeps other URLs', () => {
    expect(projectUrl('https://github.com/o/r/archive/abc.tar.gz')).toBe('https://github.com/o/r');
    expect(projectUrl('https://bitbucket.org/o/r/get/abc.tar.gz')).toBe('https://bitbucket.org/o/r');
    expect(projectUrl('https://gitlab.com/o/r/-/archive/abc/r-abc.tar.gz')).toBe('https://gitlab.com/o/r');
    expect(projectUrl('https://example.org/x.zip')).toBe('https://example.org/x.zip');
  });
});

describe('readGuard', () => {
  it('reads the guard editions and limitation', async () => {
    expect(await readGuard(fixtureCorpus)).toEqual({
      editions: [
        {
          title: 'Sample Public-Domain English Bible',
          homepage: 'https://example.org/eng-sample/',
          licence: 'Public Domain',
        },
      ],
      limitation: 'The fixture index only detects overlap with the sample Bible.',
    });
  });

  it('is null without a guard index', async () => {
    expect(await readGuard('/c', memoryFs({}))).toBeNull();
  });

  it('rejects malformed guard files', async () => {
    await expect(readGuard('/c', memoryFs({ '/c/guard/SOURCE.json': '[' }))).rejects.toThrow(/invalid JSON/);
    await expect(readGuard('/c', memoryFs({ '/c/guard/SOURCE.json': '[]' }))).rejects.toThrow(/expected an object/);
    await expect(readGuard('/c', memoryFs({ '/c/guard/SOURCE.json': '{"limitation":"x"}' }))).rejects.toThrow(
      /"editions" must be an array/,
    );
    await expect(
      readGuard(
        '/c',
        memoryFs({ '/c/guard/SOURCE.json': '{"limitation":"x","editions":[{"title":"t","homepage":""}]}' }),
      ),
    ).rejects.toThrow(/editions\[0\]: "homepage" must be a non-empty string/);
  });
});

describe('fonts', () => {
  it('derives a family name from a licence file stem', () => {
    expect(familyFromFileStem('SourceSans3')).toBe('Source Sans 3');
    expect(familyFromFileStem('NotoSerifHebrew')).toBe('Noto Serif Hebrew');
    expect(familyFromFileStem('IBM_Plex-Mono')).toBe('IBM Plex Mono');
    expect(familyFromFileStem('Font3D')).toBe('Font 3 D');
  });

  it('parses the README table and ignores rows without a licence file', () => {
    const readme = [
      'Intro | not a table',
      '| Family | Licence | Upstream |',
      '| --- | --- | --- |',
      '| Alpha Serif | `OFL-AlphaSerif.txt` | https://example.org/alpha |',
      '| Beta Sans | `OFL-BetaSans.txt` | none |',
      '| Gamma | no file | https://example.org/gamma |',
      '|  | `OFL-Nameless.txt` | x |',
      '| Short |',
    ].join('\n');
    expect([...parseFontsReadme(readme)]).toEqual([
      ['OFL-AlphaSerif.txt', { family: 'Alpha Serif', upstream: 'https://example.org/alpha' }],
      ['OFL-BetaSans.txt', { family: 'Beta Sans', upstream: null }],
    ]);
    expect(parseFontsReadme('| Family | Licence |\n| A | `OFL-A.txt` |').get('OFL-A.txt')).toEqual({
      family: 'A',
      upstream: null,
    });
    expect(parseFontsReadme('| A | `OFL-A.txt` |').size).toBe(0);
    expect(parseFontsReadme('| Licence | Family |\n| `OFL-A.txt` |').size).toBe(0);
  });

  it('takes the copyright line and the reserved font name', () => {
    expect(
      oflCopyright(
        "\nCopyright (c) 2003 SIL GentiumPlus-Bold.ttf: Copyright (c) 2003 SIL\nReserved Font Name 'Gentium'.\n",
      ),
    ).toEqual({ copyright: 'Copyright (c) 2003 SIL', reservedName: 'Gentium' });
    expect(oflCopyright('')).toEqual({ copyright: '', reservedName: null });
    expect(oflCopyright("Copyright 2010 Adobe, with Reserved Font Name 'Source'.\n\nOFL")).toEqual({
      copyright: "Copyright 2010 Adobe, with Reserved Font Name 'Source'.",
      reservedName: null,
    });
  });

  it('lists every OFL file in the fonts directory, sorted by family', async () => {
    const fs = memoryFs({
      '/f/README.md': '| Family | Licence | Upstream |\n| Zeta Display | `OFL-Zeta.txt` | https://example.org/zeta |',
      '/f/OFL-Zeta.txt': 'Copyright 2020 Zeta Authors\n\nOFL',
      '/f/OFL-AlphaSerif.txt': 'Copyright 2021 Alpha',
      '/f/alpha.woff2': 'binary',
    });
    expect(await readFonts('/f', fs)).toEqual([
      {
        family: 'Alpha Serif',
        file: 'OFL-AlphaSerif.txt',
        copyright: 'Copyright 2021 Alpha',
        reservedName: null,
        upstream: null,
      },
      {
        family: 'Zeta Display',
        file: 'OFL-Zeta.txt',
        copyright: 'Copyright 2020 Zeta Authors',
        reservedName: null,
        upstream: 'https://example.org/zeta',
      },
    ]);
    expect(await readFonts('/missing', memoryFs({}))).toEqual([]);
    const vanishing: AttributionFs = { ...memoryFs({}), listFiles: () => Promise.resolve(['OFL-Ghost.txt']) };
    expect(await readFonts('/f', vanishing)).toEqual([
      { family: 'Ghost', file: 'OFL-Ghost.txt', copyright: '', reservedName: null, upstream: null },
    ]);
  });

  it('reads the real self-hosted fonts', async () => {
    const fonts = await readFonts(join(repoRoot, 'apps', 'web', 'public', 'fonts'));
    expect(fonts.map((font) => font.family)).toEqual([
      'Cormorant Garamond',
      'Gentium Plus',
      'Noto Serif Hebrew',
      'Source Sans 3',
    ]);
    const sourceSans = fonts.find((font) => font.family === 'Source Sans 3');
    expect(sourceSans?.copyright).toContain("Reserved Font Name 'Source'");
    expect(sourceSans?.reservedName).toBeNull();
    expect(fonts.every((font) => font.upstream?.startsWith('https://') === true)).toBe(true);
  });
});

describe('readVersification', () => {
  it('lists third-party sources and skips Lectio supplements', async () => {
    const fs = memoryFs({
      '/v.json': JSON.stringify({
        sources: [
          {
            id: 'up',
            name: 'Upstream',
            url: 'https://example.org/up',
            licence: 'MIT',
            copyright: '(c) Up',
            commit: 'abc',
          },
          { id: 'two', name: 'Two', url: 'https://example.org/two', licence: 'CC-BY-4.0' },
          { id: 'own', name: 'Ours', url: `${REPO_URL}/tree/main/x`, licence: 'Same as the Lectio repository' },
        ],
      }),
    });
    expect(await readVersification('/v.json', fs)).toEqual([
      {
        id: 'up',
        name: 'Upstream',
        url: 'https://example.org/up',
        licence: 'MIT',
        licenceParts: [{ id: 'MIT', publicDomain: false, url: 'https://spdx.org/licenses/MIT.html' }],
        credit: '(c) Up',
        revision: 'abc',
      },
      {
        id: 'two',
        name: 'Two',
        url: 'https://example.org/two',
        licence: 'CC-BY-4.0',
        licenceParts: [{ id: 'CC-BY-4.0', publicDomain: false, url: 'https://spdx.org/licenses/CC-BY-4.0.html' }],
        credit: null,
        revision: null,
      },
    ]);
  });

  it('is empty without the file and rejects malformed entries', async () => {
    expect(await readVersification('/none.json', memoryFs({}))).toEqual([]);
    await expect(readVersification('/v.json', memoryFs({ '/v.json': '{"sources":[1]}' }))).rejects.toThrow(
      /sources\[0\]: expected an object/,
    );
    await expect(
      readVersification(
        '/v.json',
        memoryFs({ '/v.json': '{"sources":[{"id":"a","name":"b","url":"c","licence":"d","copyright":7}]}' }),
      ),
    ).rejects.toThrow(/"copyright" must be a non-empty string/);
  });

  it('credits libpalaso from the real refs data', async () => {
    const sources = await readVersification(attributionPaths(repoRoot).versificationSource);
    expect(sources.find((source) => source.id === 'libpalaso')).toMatchObject({ licence: 'MIT' });
    expect(sources.some((source) => source.url.startsWith(REPO_URL))).toBe(false);
  });
});

describe('readLectionarySources', () => {
  it('lists only automatically imported sources', async () => {
    const fs = memoryFs({
      '/s.json': JSON.stringify({
        sources: {
          api: {
            title: 'API',
            url: 'https://example.org/api',
            licence: 'Apache-2.0',
            automatedRetrieval: true,
            bibliography: 'API corpus',
            pinned: 'abc',
          },
          book: { title: 'Book', licence: '© Publisher', automatedRetrieval: false },
          odd: 'not an object',
        },
      }),
    });
    expect(await readLectionarySources('/s.json', fs)).toEqual([
      {
        id: 'api',
        name: 'API',
        url: 'https://example.org/api',
        licence: 'Apache-2.0',
        licenceParts: [{ id: 'Apache-2.0', publicDomain: false, url: 'https://spdx.org/licenses/Apache-2.0.html' }],
        credit: 'API corpus',
        revision: 'abc',
      },
    ]);
  });

  it('is empty without the file and rejects a file without sources', async () => {
    expect(await readLectionarySources('/none.json', memoryFs({}))).toEqual([]);
    await expect(readLectionarySources('/s.json', memoryFs({ '/s.json': '{}' }))).rejects.toThrow(
      /sources: expected an object/,
    );
  });

  it('credits LitCal from the real registry', async () => {
    const sources = await readLectionarySources(attributionPaths(repoRoot).lectionarySources);
    expect(sources.map((source) => [source.id, source.licence])).toContainEqual(['litcal', 'Apache-2.0']);
  });
});

describe('linkoutCredit', () => {
  const linkout = (provider: string): LinkoutConfig => ({
    provider,
    studyText: 'none',
    providers: {
      drbo: { label: 'Douay-Rheims (drbo.org)', enabled: true, builtin: 'drbo' },
      universalis: { label: 'Universalis', enabled: true, template: 'https://universalis.com/{date}/mass.htm' },
      broken: { label: 'Broken', enabled: true, template: '{book}/x' },
      none: { label: 'None', enabled: true },
    },
  });

  it('credits the active provider with its home page', () => {
    expect(linkoutCredit(linkout('drbo'))).toEqual({ label: 'Douay-Rheims (drbo.org)', url: 'https://www.drbo.org/' });
    expect(linkoutCredit(linkout('universalis'))).toEqual({ label: 'Universalis', url: 'https://universalis.com/' });
  });

  it('fails for a provider without a usable URL', () => {
    expect(() => linkoutCredit(linkout('broken'))).toThrow(/no usable URL/);
    expect(() => linkoutCredit(linkout('none'))).toThrow(/"none" has no usable URL/);
  });
});

describe('loadAttributions', () => {
  it('reads every source of a repository', async () => {
    const root = await tempDir();
    const paths = attributionPaths(root);
    await cp(fixtureCorpus, paths.corpusRoot, { recursive: true });
    await mkdir(paths.fontsDir, { recursive: true });
    await writeFile(join(paths.fontsDir, 'OFL-Sample.txt'), 'Copyright 2024 Sample\n');
    await mkdir(dirname(paths.versificationSource), { recursive: true });
    await writeFile(
      paths.versificationSource,
      JSON.stringify({ sources: [{ id: 'v', name: 'V', url: 'https://example.org/v', licence: 'MIT' }] }),
    );
    await mkdir(dirname(paths.lectionarySources), { recursive: true });
    await writeFile(
      paths.lectionarySources,
      JSON.stringify({
        sources: { l: { title: 'L', url: 'https://example.org/l', licence: 'Apache-2.0', automatedRetrieval: true } },
      }),
    );
    const attributions = await loadAttributions(paths);
    expect(attributions.corpora).toHaveLength(3);
    expect(attributions.guard?.editions).toHaveLength(1);
    expect(attributions.fonts.map((font) => font.family)).toEqual(['Sample']);
    expect(attributions.versification.map((source) => source.id)).toEqual(['v']);
    expect(attributions.lectionary.map((source) => source.id)).toEqual(['l']);
  });

  it('reads the real repository', async () => {
    const attributions = await loadAttributions(attributionPaths(repoRoot));
    expect(attributions.corpora.length).toBeGreaterThan(0);
    expect(attributions.guard?.limitation).toMatch(/\S/);
  });
});

describe('siteAttributionPaths', () => {
  it('resolves the repository root from INIT_CWD, else the working directory', () => {
    const fromInit = siteAttributionPaths({ INIT_CWD: join(repoRoot, 'apps', 'web') }, '/');
    expect(fromInit).toEqual(attributionPaths(repoRoot.replace(/\/$/, '')));
    expect(siteAttributionPaths({}, join(repoRoot, 'packages'))).toEqual(fromInit);
    expect(siteAttributionPaths().corpusRoot.endsWith('corpus')).toBe(true);
  });
});

describe('nodeFs', () => {
  it('returns undefined and [] for missing paths', async () => {
    expect(await nodeFs.readFile(join(fixtureCorpus, 'missing.json'))).toBeUndefined();
    expect(await nodeFs.listFiles(join(fixtureCorpus, 'missing'))).toEqual([]);
    expect(await nodeFs.listDirectories(join(fixtureCorpus, 'grc-sample', 'SOURCE.json'))).toEqual([]);
  });

  it('lists files and directories separately', async () => {
    expect(await nodeFs.listFiles(join(fixtureCorpus, 'grc-sample'))).toEqual(['SOURCE.json']);
    expect((await nodeFs.listDirectories(fixtureCorpus)).sort()).toEqual([
      'grc-sample',
      'guard',
      'hbo-sample',
      'lat-sample',
    ]);
  });

  it('rethrows other errors', async () => {
    await expect(nodeFs.readFile(fixtureCorpus)).rejects.toThrow();
    await expect(nodeFs.listFiles('\0')).rejects.toThrow();
  });
});

describe('constants', () => {
  it('points issue reports at the repository', () => {
    expect(REPORT_ISSUE_URL.startsWith(`${REPO_URL}/issues/`)).toBe(true);
    expect(LICENSE_URL).toBe(`${REPO_URL}/blob/main/LICENSE`);
  });
});
