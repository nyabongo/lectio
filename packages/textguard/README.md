# @lectio/textguard

A hash-only shingle index of public-domain English Bibles, and the longest-verbatim-run check that the licence guard
(gate 3, L-026) runs on every passage note. No reading text is stored anywhere in the repository
([ADR 0003](../../docs/adr/0003-never-store-reading-text.md)): the index holds only a sorted set of 40-bit hashes of
every 8-word shingle.

## API

```ts
import { readFileSync } from 'node:fs';
import { loadIndex, longestRun } from '@lectio/textguard';

const index = loadIndex(new Uint8Array(readFileSync('corpus/guard/en-pd-8.bin')));
const run = longestRun(noteText, index); // { words, start, end }: UTF-16 offsets into noteText, end exclusive
```

| Export                                       | What it does                                                                                                                                                                                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tokenise(text)`, `normaliseWord(w)`         | English normaliser: NFKD, strip marks, lower-case, drop apostrophes, ligatures, split on the rest (combining marks stay inside their word, so pointed Hebrew and NFD Greek count one word per word); number-only tokens (inline verse numbers) are dropped, so runs pass through them |
| `wordHash`, `shingleKeys(words,n)`           | FNV-1a 64 per word; 64-bit polynomial rolling hash per `n`-word window, splitmix64-finalised, top 40 bits kept                                                                                                                                                                        |
| `buildIndex(texts, { shingleSize })`         | Index file bytes for a set of texts (shingles never span two texts); default `n` = 8                                                                                                                                                                                                  |
| `loadIndex(bytes)`                           | Parses and validates a file; `has(key)` is a binary search                                                                                                                                                                                                                            |
| `longestRun(text, index)`                    | Longest stretch whose every shingle is indexed: 0 words, or at least `n`                                                                                                                                                                                                              |
| `longestRunOfKeys`, `longestRunOfWordHashes` | The same over shingle keys or word hashes (the builder's self-check and the tests use keys)                                                                                                                                                                                           |
| `runGuardBuild`, `parseBuildArgs`            | The `npm run guard:build` pipeline, with an injected `Downloader` (fake in tests)                                                                                                                                                                                                     |

The shingle size comes from the caller (the `licenceGuard` configuration); the index records its own `n`, and a
caller should refuse an index whose `shingleSize` or `normaliserVersion` it does not expect.

## The index file

`corpus/guard/en-pd-8.bin`: a 20-byte header (magic `LSHI`, format version 2, shingle size, key count, normaliser
version, key bits, Rice parameter), then a Golomb-Rice-coded set: the 40-bit keys in ascending order, each gap coded
as a unary quotient and a `k`-bit remainder. That costs about 21 bits per key, so the 1.7M-key index is about 4.5 MB.
The body is a dense bit stream of hash gaps; a unit test scans the committed file for printable ASCII runs longer
than 20 bytes (the longest is 14).

**False positives.** Keys are truncated to 40 bits, so a shingle that is in neither source matches by accident with
probability N / 2^40, about 1.6e-6 per lookup for N ≈ 1.7M (`SOURCE.json` records the exact `falsePositiveRate`).
One accidental match reports a run of 8 words; a run of 12 (5 consecutive shingles, L-026's threshold) by accident
needs five independent false matches in a row, about 1e-29.

`corpus/guard/SOURCE.json` records the editions, URLs, licences, the SHA-256 of each download and of the index, and
the builder's self-check samples. A sample is stored only as its consecutive shingle keys: the same keys the index
already holds, which answer "is this 8-word window in the index?" and cannot be turned back into words without
guessing whole 8-word windows. No word, per-word hash or text is recorded anywhere.

## Rebuilding

```sh
npm run guard:build              # or: npm run guard:build -- --n 8 --out corpus/guard
```

The builder downloads the World English Bible and the Douay-Rheims Bible (1899 American Edition, Challoner revision),
both public domain, from eBible.org's plain-text "readaloud" archives into a temporary directory, hashes every
chapter, deletes the temporary directory and writes only the `.bin` file and `SOURCE.json`. Before writing it checks
that a 15-word verse from each of several WEB chapters is found as a run of at least 15 words. Commit both files
together; the tests compare them.

## Limitation

The index only detects overlap with World English Bible and Douay-Rheims wording. Copyrighted modern translations
(NABRE, RSV-2CE, Jerusalem Bible) are caught only where they share runs with those texts; the quoted-run rule, the
research prompt rules and human review are the remaining safeguards.
