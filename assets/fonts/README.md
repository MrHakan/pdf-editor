# Fonts

Not covered by the project's CC0 dedication. Every face here is licensed under
the [SIL Open Font License 1.1](https://openfontlicense.org/), which asks that
the licence travel with the files — the `LICENSE-*` files in each directory are
that copy.

## `ui/` — the interface

| Face | Project | Used for |
| --- | --- | --- |
| Archivo (variable, `wght` + `wdth`) | [Omnibus-Type](https://github.com/Omnibus-Type/Archivo) | Everything the page says in prose. The width axis separates headings from body text. |
| IBM Plex Mono 400 / 600 | [IBM](https://github.com/IBM/plex) | Labels, counters and anything that reads like a job ticket. |

Latin and Latin Extended subsets only, split by `unicode-range` so a page of
English never downloads the accented glyphs.

## `embed/` — written into your PDFs

| Face | Project |
| --- | --- |
| Noto Sans (Regular, Bold, Italic) | [Noto](https://github.com/notofonts/latin-greek-cyrillic) |
| Noto Serif (Regular, Bold) | Noto |
| Noto Sans Mono (Regular) | Noto |

These are static TTFs rather than web fonts because fontkit has to read the
outlines to subset them. They are fetched only when a tool actually embeds text
that the three built-in PDF families cannot draw — which is anything outside
Latin-1, including Turkish, Polish, Greek and Cyrillic.

Only the glyphs used end up in the output file, so embedding a Turkish footer
costs a few kilobytes rather than the 600 kB the face weighs here.
