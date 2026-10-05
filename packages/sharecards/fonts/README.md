# Share-card fonts

All fonts are licensed under the SIL Open Font License 1.1; the licence for each family, with its copyright notice
(and, for Source Sans 3, the Reserved Font Name "Source"), is in the `OFL-*.txt` file beside it. The files are the
unmodified per-subset WOFF builds published by [Fontsource](https://fontsource.org) (`@fontsource/*` on npm), which
repackages the Google Fonts releases. Satori reads WOFF and TTF but not WOFF2, and needs static (non-variable) files.

| Family             | Weights / styles   | Subsets          | Licence                     | Upstream                                          |
| ------------------ | ------------------ | ---------------- | --------------------------- | ------------------------------------------------- |
| Cormorant Garamond | 600 normal, italic | latin, latin-ext | `OFL-CormorantGaramond.txt` | https://github.com/CatharsisFonts/Cormorant       |
| Source Sans 3      | 400, 600 normal    | latin, latin-ext | `OFL-SourceSans3.txt`       | https://github.com/adobe-fonts/source-sans        |
| Noto Serif         | 500 normal         | greek, greek-ext | `OFL-NotoSerif.txt`         | https://github.com/notofonts/latin-greek-cyrillic |
| Noto Serif Hebrew  | 500 normal         | hebrew           | `OFL-NotoSerifHebrew.txt`   | https://github.com/notofonts/hebrew               |

Cormorant Garamond has no Greek, so polytonic Greek original phrases are set in Noto Serif. `src/fonts.ts` registers
each subset under its own family name; add a file there when adding one here.
