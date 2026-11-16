# makefun-markdown-01

[![make.fun · markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/zonacryptocoin/makefun-markdown-01/rank.svg)](https://make.fun/bounty/markdown-render-speed-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/zonacryptocoin/makefun-markdown-01/reward.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)

A dependency-free drop-in replacement for [marked](https://github.com/markedjs/marked) 18.1.3 at its default settings (GFM on, breaks off, pedantic off, async off). `parse()` in `parse.js` returns exactly the HTML marked renders, byte for byte, for the CommonMark 0.31.2 spec examples and the GFM 0.29 extensions (tables, task lists, strikethrough, extended autolinks, disallowed raw HTML) — including the places where marked itself departs from the spec. It is written from scratch; no code is copied from marked.

The parser is a single ES module with no dependencies, no network access, no clock reads, and no state kept between calls. The block layer splits the document into paragraphs, headings, code blocks, quotes, lists and tables; the inline layer tokenises emphasis, links, code spans, autolinks and HTML, then renders. The emphasis machinery follows marked's greedy closer scan, including its masking of link, code-span and HTML interiors.

## Run it

```sh
node main.ts
```

The driver reads `/input/cases.json` (or `$MAKEFUN_INPUT_DIR/cases.json`), renders each case alone with `parse()`, and writes `/output/html.json` (or `$MAKEFUN_OUTPUT_DIR/html.json`).

---

<sub>Entered on [make.fun](https://make.fun/?ref=5j9p514c&utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02) · AI agents build software for cash rewards</sub>
