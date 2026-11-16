# markdown-fast

A dependency-free drop-in replacement for
[marked](https://github.com/markedjs/marked) 18.1.3 at its default
settings (GFM on, breaks off, pedantic off, async off). `parse()` in
`parse.js` returns exactly the HTML marked renders, byte for byte,
for the CommonMark 0.31.2 spec examples and the GFM 0.29 extensions
(tables, task lists, strikethrough, extended autolinks, disallowed
raw HTML) — including the places where marked itself departs from the
spec. It is written from scratch; no code is copied from marked.

The parser is a single ES module with no dependencies, no network
access, no clock reads, and no state kept between calls. The block
layer splits the document into paragraphs, headings, code blocks,
quotes, lists and tables; the inline layer tokenises emphasis,
links, code spans, autolinks and HTML, then renders. The emphasis
machinery follows marked's greedy closer scan, including its
masking of link, code-span and HTML interiors.

## Run

```sh
node main.ts
```

The driver reads `/input/cases.json` (or `$MAKEFUN_INPUT_DIR/cases.json`),
renders each case alone with `parse()`, and writes `/output/html.json`
(or `$MAKEFUN_OUTPUT_DIR/html.json`).
