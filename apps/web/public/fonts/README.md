# Web fonts

Self-hosted so the site makes no third-party requests and works offline. All fonts are licensed under the SIL Open
Font License 1.1; the licence for each family, with its copyright notice (and, for Source Sans 3, the Reserved Font
Name "Source"), is in the `OFL-*.txt` file beside it. The files are the unmodified per-subset WOFF2 builds published
by [Fontsource](https://fontsource.org) (`@fontsource/*` 5.3.0 on npm), which repackages the upstream releases.
`src/styles/fonts.css` declares one `@font-face` per file with its `unicode-range`.

| Family             | Use                           | Weights / styles        | Subsets          | Licence                     | Upstream                                    |
| ------------------ | ----------------------------- | ----------------------- | ---------------- | --------------------------- | ------------------------------------------- |
| Cormorant Garamond | display: headings, date title | 600 normal, italic      | latin, latin-ext | `OFL-CormorantGaramond.txt` | https://github.com/CatharsisFonts/Cormorant |
| Source Sans 3      | body and UI                   | 400 normal, italic; 600 | latin, latin-ext | `OFL-SourceSans3.txt`       | https://github.com/adobe-fonts/source-sans  |
| Gentium Plus       | polytonic Greek originals     | 400, 700 normal         | greek, greek-ext | `OFL-GentiumPlus.txt`       | https://software.sil.org/gentium/           |
| Noto Serif Hebrew  | pointed Hebrew originals      | 400 normal              | hebrew           | `OFL-NotoSerifHebrew.txt`   | https://github.com/notofonts/hebrew         |

The share cards (`packages/sharecards/fonts`) use the same display and body families as static WOFF files, because
Satori cannot read WOFF2.
