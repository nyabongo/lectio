# Fixture: links that resolve

- [a file](sub/page.md) and [a directory](sub)
- [a heading in another file](sub/page.md#second-heading) and [a repeated heading](sub/page.md#notes-1)
- [a heading here](#links-that-resolve-too) and [an HTML anchor](sub/page.md#custom-anchor)
- [an encoded path](sub/page%20two.md) with a [title](sub/page.md 'Title') and [a punctuated heading](#1--schema-gate)
- [external](https://example.com/missing) and [mail](mailto:someone@example.com) are not checked
- `[in a code span](missing.md)` is not a link

```md
[in a fenced block](missing.md)
```

[ref]: sub/page.md#first-heading

## Links that resolve too

## 1 · Schema gate
