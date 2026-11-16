// A from-scratch drop-in for marked 18.1.3 (default options: gfm on,
// breaks off, pedantic off, async off). It returns exactly the HTML
// marked renders for CommonMark 0.31.2 + GFM 0.29, byte for byte.
// Dependency-free: no network, no clock, no state kept between calls.

// Block-level HTML tags (marked's block list) and the preformatted
// tags whose contents stay raw inside a paragraph.
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'base', 'basefont', 'blockquote',
  'body', 'caption', 'center', 'col', 'colgroup', 'dd', 'details',
  'dialog', 'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption',
  'figure', 'footer', 'form', 'frame', 'frameset',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hr', 'html',
  'iframe', 'legend', 'li', 'link', 'main', 'menu', 'menuitem', 'meta',
  'nav', 'noframes', 'ol', 'optgroup', 'option', 'p', 'param', 'search',
  'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
  'title', 'tr', 'track', 'ul',
]);
const PRE_TAGS = new Set(['pre', 'script', 'style', 'textarea']);
const ASCII_PUNCT = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

// Plain ASCII whitespace: space, tab, newline, CR, FF, VT.
function isWs(c) {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';
}

// JavaScript \s as a char-code test (no regex): the ASCII whitespace
// above plus NBSP and the Unicode space separators. Used for emphasis
// flanking, where marked tests with \s.
function isWsAll(c) {
  if (c === undefined) return false;
  const cc = c.charCodeAt(0);
  if (cc <= 0x20) return cc === 0x09 || cc === 0x0A || cc === 0x0B || cc === 0x0C || cc === 0x0D || cc === 0x20;
  return cc === 0xA0 || cc === 0x1680 || (cc >= 0x2000 && cc <= 0x200A) ||
    cc === 0x2028 || cc === 0x2029 || cc === 0x202F || cc === 0x205F ||
    cc === 0x3000 || cc === 0xFEFF;
}

function isAsciiPunct(c) { return c !== undefined && ASCII_PUNCT.indexOf(c) >= 0; }

// Unicode punctuation or symbol: ASCII ranges by hand, anything else
// by the Unicode property test (the ground truth for exotic chars).
const UNICODE_PUNCT = /[\p{P}\p{S}]/u;
function isPunctChar(c) {
  if (c === undefined || c < ' ') return false;
  if ((c >= '!' && c <= '/') || (c >= ':' && c <= '@') ||
      (c >= '[' && c <= '`') || (c >= '{' && c <= '~')) return true;
  return UNICODE_PUNCT.test(c);
}

// Unicode letter or number, same split as above.
const UNICODE_ALNUM = /[\p{L}\p{N}]/u;
function isAlnumChar(c) {
  if (c === undefined) return false;
  if ((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) return true;
  return UNICODE_ALNUM.test(c);
}

// Escape &, <, >, ", ' fully (code spans, autolink text, ...). The
// native replace scans the string; the callback only runs where a
// special character actually sits.
const ESCAPE_ONE_RE = /[&<>"']/g;
const ESCAPE_ONE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escEncode(s) {
  if (s.indexOf('&') < 0 && s.indexOf('<') < 0 && s.indexOf('>') < 0 && s.indexOf('"') < 0 && s.indexOf("'") < 0) return s;
  return s.replace(ESCAPE_ONE_RE, (c) => ESCAPE_ONE[c]);
}

// Decode numeric character references and escape stray &, <, >, ", ',
// leaving valid named entities (e.g. &copy;) untouched. This mirrors
// marked's unescape + escape(noEncode) pipeline for inline text.
// One native scan: a numeric ref (&#123; / &#x7B;), a named ref
// (&word;), a bare &, or one of <>"'. The callback decides per match.
const ESC_TEXT_RE = /&(?:#(\d{1,7})|#[Xx]([0-9A-Fa-f]{1,6})|(\w+));|&|[<>"']/g;
function escText(s) {
  if (s.indexOf('&') < 0 && s.indexOf('<') < 0 && s.indexOf('>') < 0 && s.indexOf('"') < 0 && s.indexOf("'") < 0) return s;
  return s.replace(ESC_TEXT_RE, (m, dec, hex, word) => {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    if (m === '"') return '&quot;';
    if (m === "'") return '&#39;';
    if (word !== undefined) return m;
    const cp = dec !== undefined ? parseInt(dec, 10) : parseInt(hex, 16);
    if (cp === 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return '\uFFFD';
    if (cp === 38) return '&amp;';
    if (cp === 34) return '&quot;';
    if (cp === 39) return '&#39;';
    if (cp === 60) return '&lt;';
    if (cp === 62) return '&gt;';
    return String.fromCodePoint(cp);
  });
}

// marked's unescape step alone (numeric refs + stray &), used for alt
// text. Unlike escText it does NOT re-escape <>"' from numeric refs.
const IE_DECODE_RE = /&(?:#(\d{1,7})|#[Xx]([0-9A-Fa-f]{1,6})|(\w+));|&/g;
function ieDecode(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(IE_DECODE_RE, (m, dec, hex, word) => {
    if (m === '&') return '&amp;';
    if (word !== undefined) return m;
    const cp = dec !== undefined ? parseInt(dec, 10) : parseInt(hex, 16);
    if (cp === 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return '\uFFFD';
    if (cp === 38) return '&amp;';
    return String.fromCodePoint(cp);
  });
}

// cleanUrl: encodeURI, keep % as-is, null on failure (lone surrogates).
function cleanUrl(href) {
  try {
    return encodeURI(href).replace(/%25/g, '%');
  } catch {
    return null;
  }
}

// Normalise a link label: trim, collapse whitespace, case-fold.
// The double case conversion folds characters whose lowercase and
// uppercase forms differ (e.g. the Kelvin sign K).
// Fast path: an ASCII label that is already trimmed, single-spaced
// and lowercase is its own normal form — no case conversion needed.
function normLabel(s) {
  for (let i = 0; i < s.length; i++) {
    const cc = s.charCodeAt(i);
    if (cc >= 128 || (cc >= 65 && cc <= 90)) return normLabelSlow(s);
    if (cc <= 32 && (cc !== 32 || i === 0 || i === s.length - 1 || s.charCodeAt(i - 1) === 32)) return normLabelSlow(s);
  }
  return s;
}
function normLabelSlow(s) {
  return s.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase().toLowerCase();
}

// Remove backslash escapes before ASCII punctuation.
const UNESCAPE_PUNCT_RE = /\\([!"#$%&'()*+,\-./:;<=>?@\[\\\]^_`{|}~])/g;
function unescapePunct(s) {
  return s.indexOf('\\') < 0 ? s : s.replace(UNESCAPE_PUNCT_RE, '$1');
}

// Split a table row on unescaped pipes, drop empty edge cells, trim.
// A backslash-pipe becomes a literal pipe in the cell; a double
// backslash stays doubled (the later \| pass only touches single ones).
function splitCells(row, count) {
  const cells = [];
  let cur = '';
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (c === '\\' && i + 1 < row.length && row[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '\\' && i + 1 < row.length && row[i + 1] === '\\') { cur += '\\\\'; i++; continue; }
    if (c === '|') { cells.push(cur); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur);
  if (cells.length > 0 && cells[0].trim() === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop();
  if (count !== undefined) {
    if (cells.length > count) cells.length = count;
    while (cells.length < count) cells.push('');
  }
  for (let i = 0; i < cells.length; i++) cells[i] = cells[i].trim().replace(/\\\|/g, '|');
  return cells;
}

// ---------- inline parsing ----------

// Characters that may appear in an email local part (used to tell
// whether an email starts at a word boundary).
const EMAIL_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.!#$%&'*+/=?_`{|}~-";

// Extended-autolink and tag patterns, each written once as an anchored
// regex; the sticky twin (no ^, y flag) is derived from it for the
// inline scanner, which execs at an offset with no substring copy.
function stickyTwin(re) { return new RegExp(re.source.slice(1), 'y'); }
const SCHEME_RE = /^(?:[hH][tT][tT][pP][sS]?|[fF][tT][pP]):\/\/[^\s<]*/;
const SCHEME_RE_Y = stickyTwin(SCHEME_RE);
const MAILTO_RE = /^mailto:[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/;
const MAILTO_RE_Y = stickyTwin(MAILTO_RE);
const XMPP_RE = /^xmpp:[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])(?:\/[A-Za-z0-9@.]+)?/;
const XMPP_RE_Y = stickyTwin(XMPP_RE);
const WWW_RE = /^www\.(?:[A-Za-z0-9-]+\.?)+[^\s<]*/;
const WWW_RE_Y = stickyTwin(WWW_RE);
const EMAIL_RE = /^[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/;
const EMAIL_RE_Y = stickyTwin(EMAIL_RE);
// Same patterns without the trailing (?![\w-]) lookahead: used to
// recover the full domain when the lookahead cut the match short only
// because the next character is an emphasis-closing delimiter run.
const MAILTO_RE_NL = /^mailto:[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+/;
const MAILTO_RE_NL_Y = stickyTwin(MAILTO_RE_NL);
const XMPP_RE_NL = /^xmpp:[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?:\/[A-Za-z0-9@.]+)?/;
const XMPP_RE_NL_Y = stickyTwin(XMPP_RE_NL);
const EMAIL_RE_NL = /^[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+/;
const EMAIL_RE_NL_Y = stickyTwin(EMAIL_RE_NL);
const START_A_TAG = /^<a /i;
const END_A_TAG = /^<\/a>/i;
const START_RAW_TAG = /^<(pre|code|kbd|script)(\s|>)/i;
const END_RAW_TAG = /^<\/(pre|code|kbd|script)(\s|>)/i;
// Persistent inline state across a whole parse() call (marked's Lexer
// state): an unclosed <a ...> tag disables extended autolinks until a
// </a> appears, and a <pre>/<code>/<kbd>/<script> tag makes following
// text raw until its closer. Reset at the start of every parse().
const inlineState = { inLink: false, inRawBlock: false };
const TAG_OPEN_RE = /^<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^>\s"'=<>`]+))?)*\s*\/?>/;
const TAG_CLOSE_RE = /^<\/[A-Za-z][A-Za-z0-9-]*\s*>/;
const AUTOLINK_SCHEME_RE = /^<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*)>/;
const AUTOLINK_EMAIL_RE = /^<([A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*)>/;
// Sticky copies for the inline scanner: exec directly on the source at
// an offset, no substring copy. The leading ^ is dropped — with the y
// flag, ^ would only match at position 0, not at lastIndex. (The
// ^-anchored originals above stay for the call sites that pass a
// sliced string.)
const TAG_OPEN_RE_Y = new RegExp(TAG_OPEN_RE.source.slice(1), 'y');
const TAG_CLOSE_RE_Y = new RegExp(TAG_CLOSE_RE.source.slice(1), 'y');
const AUTOLINK_SCHEME_RE_Y = new RegExp(AUTOLINK_SCHEME_RE.source.slice(1), 'y');
const AUTOLINK_EMAIL_RE_Y = new RegExp(AUTOLINK_EMAIL_RE.source.slice(1), 'y');

// Extended-autolink backpedal (marked's _backpedal shape, derived from
// probing): a run of ordinary chars, a balanced (...) group, an '&' that is
// not the start of a trailing &word; entity, or trailing-punctuation chars
// that are not at the very end. A lone '(' matches none of these, so the
// URL stops just before it; a trailing ')' is dropped unless it closes a
// balanced group. Applied until the result stops changing.
const BACKPEDAL_RE = /(?:[^?!.,:;*_'\"~()&]+|\([^)]*\)|&(?![A-Za-z0-9]+;$)|[?!.,:;*_'\"~)]+(?!$))+/;
function backpedal(s) {
  let prev = '';
  let cur = s;
  while (cur !== prev) {
    prev = cur;
    cur = BACKPEDAL_RE.exec(cur)?.[0] ?? '';
  }
  return cur;
}

// If a url/email match was cut short only because the character after
// its full domain is a '_'/'*' delimiter run that closes an emphasis
// opened earlier in this inline run, return the full (longer) match
// length; otherwise return shortLen. marked forms the em/strong node
// first and tokenises the email inside it, where the closer is absent,
// so the full email is linkified there — while a plain lookahead match
// on the whole run would truncate it at the delimiter.
function extendForDelim(src, i, shortLen, noLookReY, nodes) {
  noLookReY.lastIndex = i;
  const m = noLookReY.exec(src);
  if (!m || m[0].length <= shortLen) return shortLen;
  const longLen = m[0].length;
  const j = i + longLen;
  const ch = src[j];
  if (ch !== '_' && ch !== '*') return shortLen;
  let k = j;
  while (k < src.length && src[k] === ch) k++;
  const runLen = k - j;
  // flanking of the trailing run (same rules as a delimiter run)
  const prev = src[j - 1];
  const next = k < src.length ? src[k] : undefined;
  const prevWs = isWsAll(prev);
  const nextWs = next === undefined || isWsAll(next);
  const prevPunct = isPunctChar(prev);
  const nextPunct = next !== undefined && isPunctChar(next);
  const leftFlank = !nextWs && (!nextPunct || prevWs || prevPunct);
  const rightFlank = !prevWs && (!prevPunct || nextWs || nextPunct);
  let canOpen, canClose;
  if (ch === '*') { canOpen = leftFlank; canClose = rightFlank; }
  else { canOpen = leftFlank && (!rightFlank || prevPunct); canClose = rightFlank && (!leftFlank || nextPunct); }
  if (!canClose) return shortLen;
  // is there an open delimiter of this char that the run would close?
  for (let d = nodes.length - 1; d >= 0; d--) {
    const nd = nodes[d];
    if (nd.t !== 'd' || nd.ch !== ch || !nd.canOpen) continue;
    if ((nd.canOpen && nd.canClose) || (canOpen && canClose)) {
      if ((nd.len + runLen) % 3 === 0 && !((nd.len % 3 === 0) && (runLen % 3 === 0))) continue;
    }
    return longLen;
  }
  return shortLen;
}

// Update the persistent inline state for an HTML tag token (marked's
// tag tokenizer): an opening <a ...> sets inLink, a </a> clears it;
// <pre>/<code>/<kbd>/<script> set inRawBlock, their closers clear it.
// (No tag matches both an opener and a closer, so the guards on the
// old value are unnecessary: setting the state is idempotent.)
function updateInlineState(tagText) {
  if (START_A_TAG.test(tagText)) inlineState.inLink = true;
  else if (END_A_TAG.test(tagText)) inlineState.inLink = false;
  if (START_RAW_TAG.test(tagText)) inlineState.inRawBlock = true;
  else if (END_RAW_TAG.test(tagText)) inlineState.inRawBlock = false;
}

// Parse link text inline, with the inLink state set (as marked's link
// tokenizer does) and restored afterwards, so a tag inside link text
// cannot leak the persistent state.
function inlineNodesLinkText(text, links) {
  const saved = inlineState.inLink;
  inlineState.inLink = true;
  try {
    return inlineNodes(text, links, true);
  } finally {
    inlineState.inLink = saved;
  }
}

// Find the matching ']' for a '[' at pos (escapes and code spans respected).
// Returns index of ']' or -1. A backtick run in link text follows marked's
// Lt pattern: it must open a code span (a closing run of any length, with
// only non-backtick content between — the ']' inside such a span does not
// close the link), or be a run of 2+ backticks immediately before ']'
// (the ``+(?=]) case). Any other unmatched run means the link text cannot
// match: no link. The closing-run search never runs past a ']' that could
// close the link (one followed by '(' or '['), so a later code span cannot
// swallow this link's closing bracket.
const CLOSE_SCAN_RE = /[[\]`]/g;
function findCloseBracket(src, pos) {
  let depth = 0;
  for (let i = pos; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { i++; continue; }
    if (c === '`') {
      let j = i;
      while (j < src.length && src[j] === '`') j++;
      const runLen = j - i;
      // Look for the code span's closer: the first later backtick,
      // unless a ']' that could close the link comes first (with
      // bracket-depth tracking, so a nested ']' does not stop it).
      let found = -1;
      let d2 = depth;
      CLOSE_SCAN_RE.lastIndex = j;
      let m;
      while ((m = CLOSE_SCAN_RE.exec(src)) !== null) {
        const k = m.index;
        const ch = m[0];
        if (ch === '[') { d2++; continue; }
        if (ch === ']') {
          if (d2 === 1 && (src[k + 1] === '(' || src[k + 1] === '[')) break;
          if (d2 > 1) { d2--; continue; }
          continue;
        }
        found = k;
        break;
      }
      if (found >= 0) {
        let e = found;
        while (e < src.length && src[e] === '`') e++;
        i = e - 1;
        continue;
      }
      if (runLen >= 2 && src[j] === ']') { i = j - 1; continue; }
      return -1;
    }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// Skip spaces/tabs/newlines from p. Returns the new position.
function skipInlineWs(src, p) {
  while (p < src.length && (src[p] === ' ' || src[p] === '\t' || src[p] === '\n')) p++;
  return p;
}

// Scan a title starting at the quote char at p (", ' or (). Returns
// the index just past the closing quote, or -1 when the title never
// closes: a single-quoted title also fails on a blank line, a paren
// title fails on a nested '('.
function scanTitle(src, p) {
  const q = src[p];
  const close = q === '(' ? ')' : q;
  let j = p + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\' && j + 1 < src.length && isAsciiPunct(src[j + 1])) { j += 2; continue; }
    if (c === close) return j + 1;
    if (q === "'" && c === '\n' && src[j + 1] === '\n') return -1;
    if (q === '(' && c === '(') return -1;
    j++;
  }
  return -1;
}

// Parse a link destination + optional title starting at pos (just after '(').
// Returns {href, title, end} (end = index just past ')') or null.
function parseLinkDest(src, pos) {
  const n = src.length;
  let i = skipInlineWs(src, pos);
  if (i >= n) return null;
  if (src[i] === ')') return { href: '', title: null, end: i + 1 };
  let href;
  if (src[i] === '<') {
    let j = i + 1;
    while (j < n && src[j] !== '>' && src[j] !== '\n' && src[j] !== '<') {
      if (src[j] === '\\') { j += 2; continue; }
      j++;
    }
    if (j >= n || src[j] !== '>') return null;
    href = src.slice(i + 1, j);
    i = j + 1;
  } else {
    // bare destination: balanced parens, backslash escapes, no spaces/controls
    let depth = 0;
    const start = i;
    while (i < n) {
      const c = src[i];
      if (c === ' ' || c === '\t' || c === '\n' || c.charCodeAt(0) < 32) break;
      if (c === '\\') { i += 2; continue; }
      if (c === '(') { depth++; i++; continue; }
      if (c === ')') {
        if (depth === 0) break;
        depth--; i++; continue;
      }
      i++;
    }
    if (i === start) return null;
    href = src.slice(start, i);
  }
  // optional title (the no-title form resumes from here when the
  // title scan fails: the char at `save` is whitespace or a quote,
  // never ')', so the final check below rejects the link then)
  const save = i;
  i = skipInlineWs(src, i);
  let title = null;
  if (i < n && (src[i] === '"' || src[i] === "'" || src[i] === '(')) {
    const end = scanTitle(src, i);
    if (end >= 0) {
      title = src.slice(i + 1, end - 1);
      i = skipInlineWs(src, end);
    } else {
      i = save;
    }
  }
  if (i >= n || src[i] !== ')') return null;
  return { href: unescapePunct(href), title: title === null ? null : unescapePunct(title), end: i + 1 };
}

// Parse a link label starting at '[' (pos points at '['). Labels may
// not contain unescaped '[' or ']' (no nested brackets, no code-span
// skipping) and may not span a blank line. Returns {label, end} or null.
const LABEL_SCAN_RE = /[\\[\]\n]/g;
function parseLabel(src, pos) {
  if (src[pos] !== '[') return null;
  LABEL_SCAN_RE.lastIndex = pos + 1;
  let m;
  while ((m = LABEL_SCAN_RE.exec(src)) !== null) {
    const i = m.index;
    const c = m[0];
    if (c === '\\') { LABEL_SCAN_RE.lastIndex = i + 2; continue; }
    if (c === '[') return null;
    if (c === ']') {
      const label = src.slice(pos + 1, i);
      if (label.length === 0 || label.length > 999) return null;
      if (!/\S/.test(label)) return null; // a label must contain a non-space char
      return { label, end: i + 1 };
    }
    // newline: a blank line after it ends the label
    let j = i + 1;
    while (src[j] === ' ' || src[j] === '\t') j++;
    if (src[j] === '\n') return null;
  }
  return null;
}

// Special inline-HTML forms: [prefix, closer, search-from]. A comment's
// '<!--->' and '<!-->' are complete in themselves (6 / 5 chars).
const SPECIAL_TAGS = [
  ['<![CDATA[', ']]>', 9],
  ['<!--', '-->', 4],
  ['<?', '?>', 2],
];

// Length of the inline HTML tag / autolink starting at rest[0], or 0.
// Covers comments, processing instructions, declarations, CDATA,
// open tags, close tags and <...> autolinks.
function matchInlineTag(rest) {
  if (rest.startsWith('<!--->')) return 6;
  if (rest.startsWith('<!-->')) return 5;
  for (const [prefix, closer, skip] of SPECIAL_TAGS) {
    if (rest.startsWith(prefix)) {
      const end = rest.indexOf(closer, skip);
      return end >= 0 ? end + closer.length : 0;
    }
  }
  if (rest.startsWith('<!')) {
    const end = rest.indexOf('>', 2);
    const ch2 = rest[2];
    if (end >= 0 && ch2 !== undefined && ((ch2 >= 'A' && ch2 <= 'Z') || (ch2 >= 'a' && ch2 <= 'z') || ch2 === '!')) return end + 1;
    return 0;
  }
  const m = TAG_OPEN_RE.exec(rest) || TAG_CLOSE_RE.exec(rest);
  if (m) return m[0].length;
  const a = AUTOLINK_SCHEME_RE.exec(rest) || AUTOLINK_EMAIL_RE.exec(rest);
  if (a) return a[0].length;
  return 0;
}

// Does the link text contain a '<' that starts an HTML tag or
// autolink which is not closed within the text? (marked's Be check:
// such a link is rejected outright, so the '<' can start an autolink
// or stay literal instead.)
function linkTextHasUnclosedTag(src, open, rawText) {
  if (rawText.indexOf('<') < 0) return false;
  for (let s = 0; s < rawText.length; s++) {
    const c = rawText[s];
    if (c === '\\') { s++; continue; }
    if (c === '`') {
      let j = s;
      while (j < rawText.length && rawText[j] === '`') j++;
      const run = j - s;
      const close = nextBtRun(rawText, j, run);
      if (close >= 0) { s = close + run - 1; continue; }
      continue;
    }
    if (c !== '<') continue;
    const len = matchInlineTag(src.slice(open + 1 + s));
    if (len > 0) {
      if (len > rawText.length - s) return true;
      s += len - 1;
    }
  }
  return false;
}

// Build the link/image node for raw link text `rawText` with
// destination href/title, or null when the text is rejected (an
// unclosed '<' tag inside it, or a nested markdown link inside link
// text). The text's bracket escapes are undone before tokenising it.
function buildLink(src, open, isImage, rawText, href, title, end, links) {
  if (linkTextHasUnclosedTag(src, open, rawText)) return null;
  const text = rawText.replace(/\\([\[\]])/g, '$1');
  const children = inlineNodesLinkText(text, links);
  if (!isImage && hasLinkNode(children)) return null;
  if (isImage) return { node: { t: 'image', href, title, children, text }, end };
  return { node: { t: 'link', href, title, children, autolink: false }, end };
}

// Try to parse a link/image starting at i (src[i] is '[' or '![').
// Returns {node, end} or null.
// The link TEXT allows balanced nested brackets and code spans (the
// Lt pattern); only the reference LABEL uses the strict rule (no
// nested brackets). A text containing an unclosed '<' tag is rejected.
function tryLink(src, i, links, inLink) {
  const isImage = src[i] === '!';
  const open = isImage ? i + 1 : i;
  if (src[open] !== '[') return null;
  const close = findCloseBracket(src, open);
  // 1) inline link: text, then '(' + destination
  if (close >= 0 && src[close + 1] === '(') {
    const d = parseLinkDest(src, close + 2);
    if (d) return buildLink(src, open, isImage, src.slice(open + 1, close), d.href, d.title, d.end, links);
  }
  // 2) full reference link: text, then '[' + label + ']'
  if (close >= 0 && src[close + 1] === '[') {
    const lab2 = parseLabel(src, close + 1);
    if (lab2) {
      const ref = links[normLabel(lab2.label)];
      if (!ref) return null; // label parsed but undefined: the whole thing is literal
      return buildLink(src, open, isImage, src.slice(open + 1, close), ref.href, ref.title, lab2.end, links);
    }
    // label did not parse: fall through to the shortcut form
  }
  // 3) collapsed '[text][]' or shortcut '[text]': strict label text
  const lab = parseLabel(src, open);
  if (!lab) return null;
  const rawText = src.slice(open + 1, lab.end - 1);
  let after = lab.end;
  const ref = links[normLabel(rawText)];
  if (!ref) return null;
  if (src[after] === '[' && src[after + 1] === ']') after += 2;
  return buildLink(src, open, isImage, rawText, ref.href, ref.title, after, links);
}

function hasLinkNode(nodes) {
  // marked rejects a link only when its text contains a nested *markdown*
  // link (linkEmitted is set by the link/reflink/nolink handler, never
  // by an autolink or an extended autolink, and never through an image's
  // alt text)
  for (const nd of nodes) {
    if (nd.t === 'link' && !nd.autolink) return true;
    if (nd.t === 'image') continue;
    if (nd.children && hasLinkNode(nd.children)) return true;
  }
  return false;
}

// Greedy closer accounting for one (opener, closer) pair, following
// marked's emStrong scan: starting from the opener's length, every
// delimiter run between the two (in the masked text) adds its length
// if it can only open, subtracts it if it can only close, and an
// ambiguous run is skipped (counted in f) when the rule of three
// blocks it against the opener, else subtracted. Runs inside a
// masked interval do not exist in the masked text and are skipped.
// `runs` is the original delimiter list for this inline source, in
// order of position, so the scan stops at the closer's position.
// Returns {m, f}: m is the running total just before the closer, f
// the rule-of-three-skipped total. The closer run itself is not
// included: the scan consumes b' = min(closerLen, m + f) of it, of
// which `use` chars are the wrapper's delimiters and any extra
// (b' - use) stay inside the wrapper as literal text.
function scanTotals(opener, closer, runs) {
  // y is the ORIGINAL run length of the opener: a leftover opener
  // emulates the outer scan from the run it came from, whose total
  // started at the full run length (e.g. '__foo_ bar_': the leftover
  // '_' still scans from 2, so the inner '_' brings the total to 1
  // and the trailing '_' closes it).
  const y = opener.origLen;
  let m = y;
  let f = 0;
  // R: the opener run can itself close. pm is the char before the
  // opener in the masked text; nx the char after the run.
  const pm = opener.pm;
  const R = pm !== undefined && !isWsAll(pm) &&
    (isPunctChar(opener.nx) || (opener.ch === '*' && pm !== '*' && pm !== '_' && !isPunctChar(pm)));
  for (const r of runs) {
    if (r.origPos <= opener.origPos) continue;
    if (r.origPos >= closer.origPos) break;
    if (r.masked || r.ch !== opener.ch) continue;
    // The scan only ever sees runs of the opener's own delimiter
    // character (marked's rDelim regex matches one char at a time).
    const b = r.len;
    if (r.canOpen && !r.canClose) { m += b; continue; }
    if (!r.canOpen && !r.canClose) continue;
    if ((r.canOpen && r.canClose) || R) {
      if (y % 3 !== 0 && (y + b) % 3 === 0) { f += b; continue; }
    }
    m -= b;
  }
  return { m, f };
}

// Find the opener a closer can pair with: scan the opener stack from
// the top. `openers` holds indices into `nodes`. Returns the position
// in `openers`, or -1.
function findOpener(nodes, openers, closer, closerIdx, maxNodeIdx, runs) {
  for (let j = openers.length - 1; j >= 0; j--) {
    const oi = openers[j];
    if (maxNodeIdx !== undefined && oi >= maxNodeIdx) continue;
    const o = nodes[oi];
    if (o.ch !== closer.ch || !o.canOpen) continue;
    if (o.ch === '~') {
      if (o.len > 2 || closer.len !== o.len) continue;
    } else if ((o.canOpen && o.canClose) || (closer.canOpen && closer.canClose)) {
      // rule of three: applies only when one of the two delimiters
      // can both open and close emphasis
      if ((o.len + closer.len) % 3 === 0 && !((o.len % 3 === 0) && (closer.len % 3 === 0))) continue;
    }
    // A single '*'/'_' closer must not steal the one char a '**'/
    // '__' opener needs for a later strong: if the opener is
    // exactly 2 long, using 1 for an em would leave only 1, so a
    // later '**' closer could no longer close a strong (marked's
    // greedy scan keeps the run whole; e.g. '**a *b*c* d**' leaves
    // the middle '*' literal). A longer opener (e.g. '***' in
    // cm-430) can spare one char and still form the strong. Only
    // skip when that later closer can actually close a strong with
    // this opener: the greedy scan must consume at least 2 of its
    // chars (b' >= 2). When an unmatched '*' between them already
    // ate one char of the running total ('**a b* c**'), the strong
    // cannot form and this closer may take one char of the opener
    // for an em instead.
    if (o.len === 2 && closer.len === 1) {
      let laterStrong = false;
      for (let q = closerIdx + 1; q < nodes.length; q++) {
        const nd = nodes[q];
        if (nd.t === 'd' && nd.ch === o.ch && nd.len >= 2 && nd.canClose) {
          if (!runs) { laterStrong = true; break; }
          const { m, f } = scanTotals(o, nd, runs);
          const bPrime = Math.min(nd.len, m + f - (nd.origLen - nd.len));
          if (bPrime >= 2) laterStrong = true;
          break;
        }
      }
      if (laterStrong) continue;
    }
    // Group-A rule (in the search loop, so a blocked opener is
    // skipped and an earlier opener can still match): an em whose
    // children contain a strong (of the SAME delimiter char)
    // whose closing '**' is immediately followed by a
    // non-whitespace, non-punctuation char must not form —
    // marked's greedy scan blocks that inner closer (rule of
    // three) and the outer closer cannot consume the running
    // total (e.g. '*a **b**c*' stays literal outside the strong,
    // while '*a **b** c*' forms the em). A strong of a different
    // char ('_large **data**not_') is invisible to the em's
    // greedy scan and never blocks it. Only when the strong's
    // opening '**' was itself a proper opener (preceded by
    // whitespace/punctuation, or first in the range): if it was
    // preceded by a letter ('*foo**bar**baz*', cm-411) it is a
    // middle run that never added to the greedy total, so the
    // outer em still forms.
    if (o.ch !== '~' && o.len === 1) {
      const cPre = nodes.slice(oi + 1, closerIdx);
      let blocked = false;
      for (let q = 0; q + 1 < cPre.length; q++) {
        const cd = cPre[q];
        if (cd.t === 'strong' && cd.ch === o.ch) {
          const nx = cPre[q + 1];
          if (nx && nx.t === 'text' && nx.s.length > 0) {
            const ch0 = nx.s[0];
            if (isWsAll(ch0) || isPunctChar(ch0)) continue;
            const pv = q > 0 ? cPre[q - 1] : null;
            let properOpener = false;
            if (!pv) properOpener = true;
            else if (pv.t === 'text' && pv.s.length > 0) {
              const pc = pv.s[pv.s.length - 1];
              if (isWsAll(pc) || isPunctChar(pc)) properOpener = true;
            } else if (pv.t === 'et' || pv.t === 'code' || pv.t === 'html' || pv.t === 'br') properOpener = true;
            if (properOpener) { blocked = true; break; }
          }
        }
      }
      if (blocked) continue;
    }
    return j;
  }
  return -1;
}
// Process emphasis / strikethrough delimiters in a node list (in place).
// `openers` holds indices into `nodes`, not node references, so a pair
// never needs a linear indexOf: after the splice that replaces
// nodes[oi..ci] with `repl`, openers inside the range are dropped and
// the ones after it shift by repl.length - (ci - oi + 1).
function processDelims(nodes, runs) {
  const openers = [];
  for (let idx = 0; idx < nodes.length; idx++) {
    const node = nodes[idx];
    if (node.t !== 'd') continue;
    if (node.canClose) {
      const found = findOpener(nodes, openers, node, idx, undefined, runs);
      if (found >= 0) {
        const oi = openers[found];
        const opener = nodes[oi];
        const ci = idx;
        // content checks for ~
        if (opener.ch === '~') {
          const inner = nodes.slice(oi + 1, ci);
          if (inner.length === 0) { openers.push(idx); continue; }
          // the first/last content char may not be whitespace or an
          // unescaped '~'; an escaped char (et node) is a literal, so a
          // '~' from one is allowed (marked's del regex ends its
          // content with (?:\\[\s\S]|[^\s~\\]))
          const firstCh = edgeCharInfo(inner, false);
          const lastCh = edgeCharInfo(inner, true);
          if ((firstCh.ch === ' ' || firstCh.ch === '\t' || firstCh.ch === '\n' || (firstCh.ch === '~' && !firstCh.esc)) ||
              (lastCh.ch === ' ' || lastCh.ch === '\t' || lastCh.ch === '\n' || (lastCh.ch === '~' && !lastCh.esc))) { openers.push(idx); continue; }
        }
        // A single '*'/'_' closer cannot close an em with a '**'/
        // '__' opener when an em/strong already formed inside the
        // range: marked's greedy scan counts the inner opener into
        // its running total, so the one closer cannot bring it to
        // zero (e.g. '**a *b*c*' leaves the trailing '*' literal).
        // But a leftover closer from a '**' run (origLen >= 2) may
        // still pair: the run's chars were split between the inner
        // wrapper and this outer em (marked's greedy scan consumes
        // the run one char at a time — e.g. '**a *b c**' forms the
        // outer em from the second '*' of the opener and the second
        // '*' of the closer). A standalone '*' run (origLen 1)
        // stays blocked.
        const childrenPre = nodes.slice(oi + 1, ci);
        if (opener.len === 2 && node.len === 1 && opener.ch !== '~' && node.origLen === 1) {
          let hasInnerEm = false;
          for (const cd of childrenPre) if (cd.t === 'em' || cd.t === 'strong') { hasInnerEm = true; break; }
          if (hasInnerEm) { openers.push(idx); continue; }
        }
        const use = opener.ch === '~' ? opener.len : (opener.len >= 2 && node.len >= 2 ? 2 : 1);
        const kind = opener.ch === '~' ? 'del' : (use === 2 ? 'strong' : 'em');
        const children = nodes.slice(oi + 1, ci);
        // Split the closer run's leftover between inside and outside
        // the wrapper, per the greedy scan: the scan consumes b' of
        // the closer run; `use` of those are the wrapper's own
        // delimiters and the rest stay inside as literal text, while
        // any chars beyond b' stay outside after the wrapper.
        let insideLeft = 0;
        let outsideLeft = node.len - use;
        if (opener.ch !== '~' && runs) {
          const { m, f } = scanTotals(opener, node, runs);
          // The closer run may already have lost chars to inner
          // wrappers (e.g. '******bar*********': the inner strongs
          // took 4 of the 9 closer chars before the outer strong's
          // scan). Those chars are part of the scan total but not of
          // the remaining run, so subtract them: b' is the number of
          // the REMAINING run's chars the scan consumes.
          const bPrime = Math.min(node.len, m + f - (node.origLen - node.len));
          // The closer excess (b' - use chars) stays inside the
          // wrapper only when there is no opener leftover for it to
          // pair with outside (the opener leftover and the closer
          // excess pair up around the wrapper, emulating marked's
          // re-tokenisation of the wrapper's text — e.g. '***foo***')
          // AND it would not pair with an earlier opener outside
          // (e.g. '*it **support *output****': the excess pairs with
          // the outer '*' to form the outer em, so it goes outside).
          if (opener.len - use === 0 && bPrime > use) {
            const excess = { t: 'd', ch: node.ch, len: bPrime - use, canOpen: node.canOpen, canClose: node.canClose, origPos: node.origPos, origLen: node.origLen, masked: node.masked, pm: node.ch, nx: node.nx };
            if (findOpener(nodes, openers, excess, ci, oi, runs) < 0) {
              insideLeft = bPrime - use;
              outsideLeft = node.len - bPrime;
            }
          }
        }
        if (insideLeft > 0) {
          children.push({ t: 'd', ch: node.ch, len: insideLeft, canOpen: node.canOpen, canClose: node.canClose, origPos: node.origPos, origLen: node.origLen, masked: node.masked, pm: node.ch, nx: outsideLeft > 0 ? node.ch : node.nx });
          // The text inside the wrapper is re-tokenised in marked,
          // so the leftover may still close an opener left inside it.
          processDelims(children, runs);
        }
        const wrap = { t: kind, ch: opener.ch, children };
        const repl = [];
        if (opener.len - use > 0) repl.push({ t: 'd', ch: opener.ch, len: opener.len - use, canOpen: opener.canOpen, canClose: opener.canClose, origPos: opener.origPos, origLen: opener.origLen, masked: opener.masked, pm: opener.pm, nx: opener.ch });
        repl.push(wrap);
        if (outsideLeft > 0) repl.push({ t: 'd', ch: node.ch, len: outsideLeft, canOpen: node.canOpen, canClose: node.canClose, origPos: node.origPos, origLen: node.origLen, masked: node.masked, pm: node.ch, nx: node.nx });
        // Drop openers that were inside the wrapped range; shift the
        // ones after it by the splice's net size change.
        const delta = repl.length - (ci - oi + 1);
        for (let j = openers.length - 1; j > found; j--) {
          if (openers[j] > oi && openers[j] < ci) openers.splice(j, 1);
          else if (openers[j] > ci) openers[j] += delta;
        }
        openers.splice(found, 1);
        nodes.splice(oi, ci - oi + 1, ...repl);
        // A leftover opener may open later; a leftover closer must be
        // re-processed as a closer (it can still close an earlier
        // opener, e.g. the second '*' of '***' closing an outer em).
        const leftOpen = repl[0];
        if (leftOpen && leftOpen.t === 'd' && leftOpen.canOpen) openers.push(oi);
        const leftCloser = repl[repl.length - 1];
        if (leftCloser && leftCloser.t === 'd' && leftCloser !== leftOpen && leftCloser.canClose) {
          idx = oi + repl.length - 2; // next iteration processes it
          continue;
        }
        idx = oi + repl.length - 1;
        const left = repl[repl.length - 1];
        if (left && left.t === 'd' && left.canOpen && left !== leftOpen) openers.push(oi + repl.length - 1);
        continue;
      }
    }
    if (node.canOpen) openers.push(idx);
  }
  // leftover delimiters are literal text (recursively, so a
  // delimiter left inside an em/strong/del wrapper still renders)
  convertLeftovers(nodes);
}

// Leftover delimiters are literal text (recursively, so a delimiter
// left inside an em/strong/del wrapper still renders).
function convertLeftovers(nodes) {
  for (let i = 0; i < nodes.length; i++) {
    const nd = nodes[i];
    if (nd.t === 'd') nodes[i] = { t: 'text', s: nd.ch.repeat(nd.len) };
    else if (nd.children) convertLeftovers(nd.children);
  }
}

// First/last meaningful character of a node list, for the ~ content
// checks: which character it starts/ends with, and whether that char
// came from an escape (an escaped '~' is a literal and may end a del).
function edgeCharInfo(nodes, fromEnd) {
  const step = fromEnd ? -1 : 1;
  for (let k = fromEnd ? nodes.length - 1 : 0; fromEnd ? k >= 0 : k < nodes.length; k += step) {
    const nd = nodes[k];
    if (nd.t === 'text' || nd.t === 'et' || nd.t === 'html' || nd.t === 'code') {
      const s = nd.s;
      return { ch: fromEnd ? s[s.length - 1] : s[0], esc: nd.t === 'et' };
    }
    if (nd.t === 'br') return { ch: '\n', esc: false };
    if (nd.t === 'd') return { ch: nd.ch, esc: false };
    if (nd.children) {
      const c = edgeCharInfo(nd.children, fromEnd);
      if (c.ch !== undefined) return c;
    }
  }
  return { ch: undefined, esc: false };
}

// Render inline nodes to HTML. The parts accumulate in one array and
// are joined once, so nested em/strong/del wrappers never build
// throwaway intermediate strings.
function renderNodesInto(nodes, parts) {
  for (const nd of nodes) {
    switch (nd.t) {
      case 'text': parts.push(nd.raw ? nd.s : escText(nd.s)); break;
      case 'et': parts.push(escEncode(nd.s)); break;
      case 'code': parts.push('<code>', escEncode(nd.s), '</code>'); break;
      case 'br': parts.push('<br>'); break;
      case 'html': parts.push(nd.s); break;
      case 'em': parts.push('<em>'); renderNodesInto(nd.children, parts); parts.push('</em>'); break;
      case 'strong': parts.push('<strong>'); renderNodesInto(nd.children, parts); parts.push('</strong>'); break;
      case 'del': parts.push('<del>'); renderNodesInto(nd.children, parts); parts.push('</del>'); break;
      case 'link': {
        const clean = cleanUrl(nd.href);
        if (clean === null) { renderNodesInto(nd.children, parts); break; }
        const href = nd.autolink ? escEncode(clean) : escText(clean);
        parts.push('<a href="', href, '"');
        if (nd.title) parts.push(' title="', escText(nd.title), '"');
        parts.push('>');
        if (nd.autolink) parts.push(escEncode(nd.text));
        else renderNodesInto(nd.children, parts);
        parts.push('</a>');
        break;
      }
      case 'image': {
        const alt = escText(plainNodes(nd.children));
        const clean = cleanUrl(nd.href);
        if (clean === null) { parts.push(alt); break; }
        parts.push('<img src="', escText(clean), '" alt="', alt, '"');
        if (nd.title) parts.push(' title="', escText(nd.title), '"');
        parts.push('>');
        break;
      }
    }
  }
}
function renderNodes(nodes) {
  const parts = [];
  renderNodesInto(nodes, parts);
  return parts.join('');
}

// Plain-text rendering of inline nodes (for image alt text).
function plainNodesInto(nodes, parts) {
  for (const nd of nodes) {
    switch (nd.t) {
      case 'text': parts.push(nd.raw ? nd.s : ieDecode(nd.s)); break;
      case 'et': case 'code': case 'html': parts.push(nd.s); break;
      case 'br': break;
      case 'em': case 'strong': case 'del': case 'link': case 'image':
        plainNodesInto(nd.children, parts);
        break;
      case 'd': parts.push(nd.ch.repeat(nd.len)); break;
    }
  }
}
function plainNodes(nodes) {
  const parts = [];
  plainNodesInto(nodes, parts);
  return parts.join('');
}

// ---------- emphasis masking ----------
// marked searches for emphasis/del closers in a *masked* copy of the
// inline source: link-like spans, code spans and HTML tags have their
// interiors blanked out, so a delimiter inside one can never close an
// emphasis. The mask is built in three length-preserving passes:
//   (1) reference-link spans whose label names a defined link,
//   (2) a normalisation pass: inside a code span, stray backticks
//       become '+', and an escaped punctuation char becomes '++'
//       (so pass (3) can then match spans holding unbalanced
//       backtick runs — e.g. a phantom code span reaching from a
//       backtick inside a link's text to a backtick much later),
//   (3) link / code-span / HTML spans.
// The result is a list of [start, end) intervals in source
// coordinates. A delimiter run overlapping a masked interval can
// open but never close (its characters are 'a's in the masked text).

// End of the link-like span starting at w[i] === '[', or -1.
// The label holds no unescaped '[' or ']' and no backtick outside a
// backtick chunk (a run, 1+ non-backticks, the same run not followed
// by a backtick); the destination is balanced to one nested level
// and may hold spaces. Note the label has no escape rule here: a
// backslash is an ordinary char, so '\[' still breaks the label.
// Both scans jump between interesting characters with a native regex.
const MASK_LABEL_RE = /[\\[\]`]/g;
const MASK_DEST_RE = /[\\()]/g;
function maskLinkEnd(w, i) {
  const n = w.length;
  let closed = -1;
  MASK_LABEL_RE.lastIndex = i + 1;
  let m;
  while ((m = MASK_LABEL_RE.exec(w)) !== null) {
    const p = m.index;
    const c = m[0];
    // An escaped punctuation char is two ordinary chars in the
    // masked text, so it neither breaks the label nor opens a
    // backtick chunk.
    if (c === '\\') {
      if (p + 1 < n && isPunctChar(w[p + 1])) MASK_LABEL_RE.lastIndex = p + 2;
      continue;
    }
    if (c === '[') return -1;
    if (c === ']') { closed = p; break; }
    // Backtick chunk: the closer is the first later run of exactly
    // this length; shorter/longer runs inside the chunk are content,
    // not the closer (marked's normalisation pass turns them into
    // '+' first; the same closer is found by skipping them here).
    let k = p;
    while (k < n && w[k] === '`') k++;
    const run = k - p;
    const close = nextBtRun(w, k, run);
    if (close < 0) return -1;
    MASK_LABEL_RE.lastIndex = close + run;
  }
  if (closed < 0 || w[closed + 1] !== '(') return -1;
  let depth = 0;
  MASK_DEST_RE.lastIndex = closed + 2;
  while ((m = MASK_DEST_RE.exec(w)) !== null) {
    const p = m.index;
    const c = m[0];
    if (c === '\\') { MASK_DEST_RE.lastIndex = p + 2; continue; }
    if (c === '(') { depth++; continue; }
    if (depth === 0) return p + 1;
    depth--;
  }
  return -1;
}

// Pass (3): intervals of link-like, code-span and HTML spans in w.
// A code span here needs a first later run of exactly the opener
// length (its content holds no backticks, unlike pass (2)).
// The scan jumps from one interesting character to the next with a
// native regex instead of stepping through every plain character.
const MASK_SPECIAL_RE = /[\\\[`<]/g;
const BT_RUN_RE = /`+/g;
// First backtick run of exactly `len` at or after `from`, or -1.
function nextBtRun(w, from, len) {
  BT_RUN_RE.lastIndex = from;
  let m;
  while ((m = BT_RUN_RE.exec(w)) !== null) {
    if (m[0].length === len) return m.index;
  }
  return -1;
}
function maskBlockSkip(w) {
  const n = w.length;
  const intervals = [];
  MASK_SPECIAL_RE.lastIndex = 0;
  let m;
  while ((m = MASK_SPECIAL_RE.exec(w)) !== null) {
    const i = m.index;
    const c = m[0];
    // An escaped punctuation char (\X) is two ordinary chars in
    // the masked text (marked's normalisation turns it into '++'),
    // so it can neither open a link/code span nor break one.
    if (c === '\\') {
      if (i + 1 < n && isPunctChar(w[i + 1])) MASK_SPECIAL_RE.lastIndex = i + 2;
      continue;
    }
    if (c === '[') {
      const end = maskLinkEnd(w, i);
      if (end >= 0) { intervals.push([i, end]); MASK_SPECIAL_RE.lastIndex = end; }
      continue;
    }
    if (c === '`') {
      let j = i;
      while (j < n && w[j] === '`') j++;
      const run = j - i;
      // the closer is the first later backtick run of exactly this
      // length; shorter/longer runs inside the content are skipped
      // (marked's normalisation pass turns them into '+' first, but
      // the same closer is found by skipping them here)
      const close = nextBtRun(w, j, run);
      if (close >= 0) {
        const end = close + run;
        intervals.push([i, end]);
        MASK_SPECIAL_RE.lastIndex = end;
      } else {
        MASK_SPECIAL_RE.lastIndex = j;
      }
      continue;
    }
    // '<': an HTML span runs to the next '>' with no '<' inside.
    if (w[i + 1] !== undefined && w[i + 1] !== ' ') {
      const end = w.indexOf('>', i + 1);
      if (end >= 0) {
        const lt = w.indexOf('<', i + 1);
        if (lt < 0 || lt >= end) { intervals.push([i, end + 1]); MASK_SPECIAL_RE.lastIndex = end + 1; }
      }
    }
  }
  return intervals;
}

// Does text hold a link (a blockSkip link span, or a reference
// link whose label is defined)? Used by the reference-link mask.
function linkInText(text, links) {
  if (text.indexOf('[') < 0) return false;
  if (maskBlockSkip(text).length > 0) return true;
  return maskReflinks(text, links).length > 0;
}

// Pass (1): intervals of reference-link spans whose label names a
// defined link. A span '[text][ref]' whose text itself holds a link
// masks only the '[ref]' part (and, recursively, the text's own
// reference spans); any other defined span masks whole. The scan
// jumps to the next '[' instead of stepping through plain text.
function maskReflinks(w, links) {
  const intervals = [];
  const n = w.length;
  let i = w.indexOf('[');
  while (i >= 0 && i < n) {
    const bang = i > 0 && w[i - 1] === '!';
    const start = bang ? i - 1 : i;
    const lab = parseLabel(w, i);
    if (!lab) { i = w.indexOf('[', i + 1); continue; }
    if (w[lab.end] === '[') {
      const lab2 = parseLabel(w, lab.end);
      if (lab2 && links[normLabel(lab2.label)]) {
        if (!bang && lab.end > i + 1 && linkInText(w.slice(i + 1, lab.end - 1), links)) {
          const inner = maskReflinks(w.slice(i + 1, lab.end - 1), links);
          for (const [a, b] of inner) intervals.push([i + 1 + a, i + 1 + b]);
          intervals.push([lab.end, lab2.end]);
        } else {
          intervals.push([start, lab2.end]);
        }
        i = w.indexOf('[', lab2.end);
        continue;
      }
      // second bracket did not name a defined link: fall through to
      // the shortcut form below (the first label may still qualify)
    }
    let end = lab.end;
    if (w[end] === '[' && w[end + 1] === ']') end += 2;
    if (w[end] !== '(' && links[normLabel(lab.label)]) {
      intervals.push([start, end]);
      i = w.indexOf('[', end);
      continue;
    }
    i = w.indexOf('[', i + 1);
  }
  return intervals;
}

// Blank out each [a, b) interval with '[' + 'a's + ']' (same length).
function applyMask(w, intervals) {
  const parts = [];
  let last = 0;
  for (const [a, b] of intervals) {
    parts.push(w.slice(last, a), '[', 'a'.repeat(Math.max(0, b - a - 2)), ']');
    last = b;
  }
  parts.push(w.slice(last));
  return parts.join('');
}

// The full mask for an inline source: pass (1) reference links,
// then pass (2) normalisation, then pass (3) link/code/html spans.
// Returns sorted [start, end) intervals in source coordinates.
function computeMask(src, links) {
  // No link, code-span or HTML span can exist without one of these
  // three characters, so the mask is empty (most plain paragraphs).
  if (src.indexOf('[') < 0 && src.indexOf('`') < 0 && src.indexOf('<') < 0) return [];
  const intervals = [];
  let w = src;
  if (src.indexOf('[') >= 0) {
    const iv = maskReflinks(w, links);
    if (iv.length) {
      intervals.push(...iv);
      w = applyMask(w, iv);
    }
  }
  intervals.push(...maskBlockSkip(w));
  intervals.sort((x, y) => x[0] - y[0]);
  return intervals;
}

function inlineHtml(src, links, inLink) {
  return renderNodes(inlineNodes(src, links, inLink));
}

// Tokenise one inline run into nodes, then resolve emphasis in them.
// Plain text is never copied char by char: the pending run is the
// slice src[bs..i), materialised once when a token interrupts it.
// That keeps long doc paragraphs to one slice per text run instead of
// one rope link per character.
function inlineNodes(src, links, inLink) {
  const nodes = [];
  const n = src.length;
  let i = 0;
  let bs = 0;
  const flush = () => {
    if (bs < i) nodes.push({ t: 'text', s: src.slice(bs, i), raw: inlineState.inRawBlock });
    bs = i;
  };
  // Masked intervals for this inline source (computed lazily, on the
  // first delimiter run: with no delimiters the mask cannot matter).
  // `runs` keeps every delimiter node in order, for the closer scan.
  let mask = null;
  let maskPos = 0;
  let mcPos = 0;
  const runs = [];
  const ensureMask = () => { if (mask === null) mask = computeMask(src, links); };
  function runMasked(pos, len) {
    ensureMask();
    while (maskPos < mask.length && mask[maskPos][1] <= pos) maskPos++;
    return maskPos < mask.length && mask[maskPos][0] < pos + len;
  }
  // The character of the masked text at position p: '[' / ']' at a
  // masked interval's edges, 'a' inside one, the source char outside.
  // p only moves forward (one call per delimiter run, in order), so a
  // moving pointer replaces a scan from the start each time.
  function maskedCharAt(p) {
    ensureMask();
    if (p < 0 || p >= n) return undefined;
    while (mcPos < mask.length && mask[mcPos][1] <= p) mcPos++;
    if (mcPos < mask.length && mask[mcPos][0] <= p) {
      const a = mask[mcPos][0], b = mask[mcPos][1];
      return p === a ? '[' : (p === b - 1 ? ']' : 'a');
    }
    return src[p];
  }
  while (i < n) {
    const c = src[i];
    if (c === '\\') {
      const nx = src[i + 1];
      if (nx === '\n') {
        flush();
        nodes.push({ t: 'br' });
        i += 2;
        while (i < n && (src[i] === ' ' || src[i] === '\t')) i++;
        bs = i;
        continue;
      }
      if (nx !== undefined && isAsciiPunct(nx)) {
        flush();
        nodes.push({ t: 'et', s: nx });
        i += 2;
        bs = i;
        continue;
      }
      i++;
      continue;
    }
    if (c === '`') {
      let j = i;
      while (j < n && src[j] === '`') j++;
      const run = j - i;
      // find a closing run of exactly `run` backticks
      let k = j;
      let closeIdx = -1;
      while (k < n) {
        if (src[k] === '`') {
          let m = k;
          while (m < n && src[m] === '`') m++;
          if (m - k === run) { closeIdx = k; break; }
          k = m;
        } else k++;
      }
      if (closeIdx >= 0) {
        let content = src.slice(j, closeIdx).replace(/\n/g, ' ');
        if (content.length > 0 && content[0] === ' ' && content[content.length - 1] === ' ' && /[^ ]/.test(content)) content = content.slice(1, -1);
        flush();
        nodes.push({ t: 'code', s: content });
        i = closeIdx + run;
        bs = i;
        continue;
      }
      i += run;
      continue;
    }
    if (c === '<') {
      // No src.slice(i) here: startsWith/indexOf with an offset and
      // sticky regexes, so a '<' never copies the rest of the
      // paragraph (the docs hold many '<' from HTML/autolinks).
      let m = null;
      AUTOLINK_SCHEME_RE_Y.lastIndex = i;
      m = AUTOLINK_SCHEME_RE_Y.exec(src);
      if (!m) { AUTOLINK_EMAIL_RE_Y.lastIndex = i; m = AUTOLINK_EMAIL_RE_Y.exec(src); }
      if (m) {
        flush();
        const disp = m[1];
        const href = disp.indexOf('@') > 0 && disp.indexOf(':') < 0 ? 'mailto:' + disp : disp;
        nodes.push({ t: 'link', href, title: null, children: [{ t: 'text', s: disp }], text: disp, autolink: true });
        i += m[0].length;
        bs = i;
        continue;
      }
      if (src.startsWith('<![CDATA[', i)) {
        const end = src.indexOf(']]>', i + 9);
        if (end >= 0) { flush(); nodes.push({ t: 'html', s: src.slice(i, end + 3) }); i = end + 3; bs = i; continue; }
      } else if (src.startsWith('<!--', i)) {
        // '<!--->' is a complete comment (6 chars); '<!-->' runs to the
        // next '-->' (or is just itself); otherwise the comment runs to
        // the next '-->' and is not a tag at all without one
        let clen = -1;
        if (src.startsWith('<!--->', i)) clen = 6;
        else if (src.startsWith('<!-->', i)) clen = 5;
        else {
          const end = src.indexOf('-->', i + 4);
          if (end >= 0) clen = end + 3 - i;
        }
        if (clen >= 0) { flush(); nodes.push({ t: 'html', s: src.slice(i, i + clen) }); i += clen; bs = i; continue; }
      } else if (src.startsWith('<?', i)) {
        const end = src.indexOf('?>', i + 2);
        if (end >= 0) { flush(); nodes.push({ t: 'html', s: src.slice(i, end + 2) }); i = end + 2; bs = i; continue; }
      } else if (src.startsWith('<!', i)) {
        const end = src.indexOf('>', i + 2);
        const ch2 = src[i + 2];
        if (end >= 0 && ch2 !== undefined && ((ch2 >= 'A' && ch2 <= 'Z') || (ch2 >= 'a' && ch2 <= 'z') || ch2 === '!')) {
          flush();
          nodes.push({ t: 'html', s: src.slice(i, end + 1) });
          i = end + 1;
          bs = i;
          continue;
        }
      }
      TAG_OPEN_RE_Y.lastIndex = i;
      m = TAG_OPEN_RE_Y.exec(src);
      if (!m) { TAG_CLOSE_RE_Y.lastIndex = i; m = TAG_CLOSE_RE_Y.exec(src); }
      if (m) {
        flush();
        nodes.push({ t: 'html', s: m[0] });
        updateInlineState(m[0]);
        i += m[0].length;
        bs = i;
        continue;
      }
      i++;
      continue;
    }
    if (c === '[' || (c === '!' && src[i + 1] === '[')) {
      const r = tryLink(src, i, links, inLink);
      if (r) { flush(); nodes.push(r.node); i = r.end; bs = i; continue; }
      i++;
      continue;
    }
    if (c === '*' || c === '_' || c === '~') {
      let j = i;
      while (j < n && src[j] === c) j++;
      const len = j - i;
      const prev = i > 0 ? src[i - 1] : undefined;
      const next = j < n ? src[j] : undefined;
      // marked uses JS \s (which includes NBSP) for flanking checks
      const prevWs = prev === undefined || isWsAll(prev);
      const nextWs = next === undefined || isWsAll(next);
      const prevPunct = isPunctChar(prev);
      const nextPunct = isPunctChar(next);
      const leftFlank = !nextWs && (!nextPunct || prevWs || prevPunct);
      const rightFlank = !prevWs && (!prevPunct || nextWs || nextPunct);
      let canOpen, canClose;
      if (c === '*') { canOpen = leftFlank; canClose = rightFlank; }
      else if (c === '_') { canOpen = leftFlank && (!rightFlank || prevPunct); canClose = rightFlank && (!leftFlank || nextPunct); }
      else { canOpen = !nextWs; canClose = !prevWs; }
      // A delimiter run starting inside a masked interval can open
      // but never close: in the masked text its characters are 'a's.
      const masked = runMasked(i, len);
      if (masked) canClose = false;
      flush();
      // pm: the char before the run in the masked text (for the
      // greedy closer scan's R flag); nx: the char after the run.
      // origPos: the start of the maximal run this node came from
      // (a leftover keeps its original run's start, so the scan
      // never counts that run as an inner run).
      const dnode = { t: 'd', ch: c, len, canOpen, canClose, origPos: i, origLen: len, masked, pm: maskedCharAt(i - 1), nx: next };
      nodes.push(dnode);
      runs.push(dnode);
      i = j;
      bs = i;
      continue;
    }
    if (c === '\n') {
      // Hard break: two or more spaces before the newline; leading
      // spaces/tabs of the next line are stripped after a hard break.
      // The trailing spaces sit at the end of the pending run.
      let sp = 0;
      while (sp < i - bs && src[i - 1 - sp] === ' ') sp++;
      if (sp >= 2) {
        if (bs < i - sp) nodes.push({ t: 'text', s: src.slice(bs, i - sp), raw: inlineState.inRawBlock });
        nodes.push({ t: 'br' });
        i++;
        while (i < n && (src[i] === ' ' || src[i] === '\t')) i++;
        bs = i;
      } else {
        i++;
      }
      continue;
    }
    if (!inLink && !inlineState.inLink) {
      // Extended autolinks: mailto:/xmpp: (prev char not alphanumeric),
      // scheme:// anywhere, www. after a separator, email at a word start
      // (also suppressed while an unclosed <a ...> tag is in scope).
      // Each regex is tried only when the current char can start it,
      // and via a sticky exec — no src.slice(i) per character (the
      // docs' long paragraphs made that O(n^2)).
      const prev0 = i > 0 ? src[i - 1] : undefined;
      const prev0Alnum = prev0 !== undefined &&
        ((prev0 >= '0' && prev0 <= '9') || (prev0 >= 'a' && prev0 <= 'z') || (prev0 >= 'A' && prev0 <= 'Z'));
      if (!prev0Alnum && (c === 'm' || c === 'x')) {
        const mmRe = c === 'm' ? MAILTO_RE_Y : XMPP_RE_Y;
        mmRe.lastIndex = i;
        const mm = mmRe.exec(src);
        const nlRe = c === 'x' ? XMPP_RE_NL_Y : MAILTO_RE_NL_Y;
        const len = extendForDelim(src, i, mm ? mm[0].length : 0, nlRe, nodes);
        if (len > 0) {
          const url = backpedal(src.slice(i, i + len));
          if (url.length > 0) {
            flush();
            nodes.push({ t: 'link', href: url, title: null, children: [{ t: 'text', s: url }], text: url, autolink: true });
            i += url.length;
            bs = i;
            continue;
          }
        }
      }
      if (c === 'h' || c === 'H' || c === 'f' || c === 'F') {
        SCHEME_RE_Y.lastIndex = i;
        const sm = SCHEME_RE_Y.exec(src);
        if (sm) {
          const url = backpedal(sm[0]);
          if (url.length > 0) {
            flush();
            nodes.push({ t: 'link', href: url, title: null, children: [{ t: 'text', s: url }], text: url, autolink: true });
            i += url.length;
            bs = i;
            continue;
          }
        }
      }
      const prev = i > 0 ? src[i - 1] : undefined;
      if (c === 'w' && (prev === undefined || prev === ' ' || prev === '\t' || prev === '\n' || prev === '*' || prev === '_' || prev === '~' || prev === '(' || prev === '[')) {
        WWW_RE_Y.lastIndex = i;
        const wm = WWW_RE_Y.exec(src);
        if (wm) {
          const url = backpedal(wm[0]);
          if (url.length > 4) {
            flush();
            nodes.push({ t: 'link', href: 'http://' + url, title: null, children: [{ t: 'text', s: url }], text: url, autolink: true });
            i += url.length;
            bs = i;
            continue;
          }
        }
      }
      if ((prev === undefined || EMAIL_CHARS.indexOf(prev) < 0 || (bs === i && nodes.length > 0 && nodes[nodes.length - 1].t === 'd' && nodes[nodes.length - 1].ch === prev)) && ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '.' || c === '_' || c === '+' || c === '-')) {
        EMAIL_RE_Y.lastIndex = i;
        const em = EMAIL_RE_Y.exec(src);
        const len = extendForDelim(src, i, em ? em[0].length : 0, EMAIL_RE_NL_Y, nodes);
        if (len > 0) {
          const addr = src.slice(i, i + len);
          flush();
          nodes.push({ t: 'link', href: 'mailto:' + addr, title: null, children: [{ t: 'text', s: addr }], text: addr, autolink: true });
          i += len;
          bs = i;
          continue;
        }
      }
    }
    i++;
  }
  flush();
  processDelims(nodes, runs);
  return nodes;
}

// ---------- block parsing ----------

// Index of the first character that is not whitespace, or -1.
// (Lines never hold \n or \r: parse() normalises them away first.)
// This is line.search(/\S/) as a char loop.
function firstNonWs(line) {
  for (let i = 0; i < line.length; i++) {
    if (!isWsAll(line[i])) return i;
  }
  return -1;
}

// Expand the leading whitespace run of `s` (spaces/tabs) to spaces,
// assuming it starts at column `startCol` (a tab jumps to the next
// multiple of 4 columns).
function expandTabsPrefix(s, startCol) {
  let col = startCol;
  let i = 0;
  const parts = [];
  while (i < s.length) {
    const c = s[i];
    if (c === ' ') { parts.push(' '); col++; i++; }
    else if (c === '\t') {
      const w = 4 - (col % 4);
      parts.push(' '.repeat(w));
      col += w;
      i++;
    } else break;
  }
  parts.push(s.slice(i));
  return parts.join('');
}

function isBlank(line) {
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== ' ' && line[i] !== '\t') return false;
  }
  return true;
}

// marked's trailing-blank-line trim for code/html raw text: drop the
// trailing blank lines only when there are two or more of them.
function geText(raw) {
  const parts = raw.split('\n');
  let t = parts.length - 1;
  while (t >= 0 && isBlank(parts[t])) t--;
  if (parts.length - t <= 2) return raw;
  return parts.slice(0, t + 1).join('\n');
}

function indentOf(line) {
  let width = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === ' ') width++;
    else if (c === '\t') width += 4 - (width % 4);
    else break;
  }
  return width;
}

// Remove `cols` columns of indentation from the front of a line.
// A tab crossing the boundary is replaced by the spaces it spans.
function stripCols(line, cols) {
  let col = 0;
  let i = 0;
  while (i < line.length && col < cols) {
    const c = line[i];
    if (c === ' ') { col++; i++; }
    else if (c === '\t') {
      const next = col + (4 - (col % 4));
      if (next > cols) return ' '.repeat(next - cols) + line.slice(i + 1);
      col = next; i++;
    } else break;
  }
  return line.slice(i);
}

function isHr(line) {
  if (indentOf(line) > 3) return false;
  const start = firstNonWs(line);
  if (start < 0) return false;
  let end = line.length;
  while (end > start && isWsAll(line[end - 1])) end--;
  if (end - start < 3) return false;
  const ch = line[start];
  if (ch !== '-' && ch !== '_' && ch !== '*') return false;
  let count = 0;
  for (let i = start; i < end; i++) {
    const c = line[i];
    if (c === ch) count++;
    else if (c !== ' ' && c !== '\t') return false;
  }
  return count >= 3;
}

function fenceStart(line) {
  if (indentOf(line) > 3) return null;
  const s = line.slice(firstNonWs(line));
  if (!s.startsWith('```') && !s.startsWith('~~~')) return null;
  const ch = s[0];
  let k = 0;
  while (k < s.length && s[k] === ch) k++;
  const info = s.slice(k);
  if (ch === '`' && info.indexOf('`') >= 0) return null;
  return { ch, len: k, info };
}

function atxHeading(line) {
  if (indentOf(line) > 3) return null;
  const s = line.slice(firstNonWs(line));
  if (s[0] !== '#') return null;
  let k = 0;
  while (k < s.length && s[k] === '#') k++;
  if (k > 6) return null;
  if (k < s.length && s[k] !== ' ' && s[k] !== '\t') return null;
  let text = s.slice(k).trim();
  if (text.endsWith('#')) {
    let e = text.length;
    while (e > 0 && text[e - 1] === '#') e--;
    const stripped = text.slice(0, e);
    if (stripped === '' || stripped.endsWith(' ') || stripped.endsWith('\t')) text = stripped.trim();
  }
  return { depth: k, text };
}

function htmlBlockType(line) {
  if (indentOf(line) > 3) return 0;
  const s = line.slice(firstNonWs(line));
  if (/^<(script|pre|style|textarea)([\s>]|$)/i.test(s)) return 1;
  if (s.startsWith('<!--')) return 2;
  if (s.startsWith('<?')) return 3;
  if (/^<![A-Za-z]/.test(s)) return 4;
  if (s.startsWith('<![CDATA[')) return 5;
  const m = /^<\/?([A-Za-z][A-Za-z0-9-]*)(\s|\/?>|$)/.exec(s);
  if (m) {
    if (BLOCK_TAGS.has(m[1].toLowerCase())) return 6;
    // type 7: a complete tag (open or close) and nothing else on the line,
    // with well-formed attributes
    if (/^<[A-Za-z][A-Za-z0-9-]*(?: +[A-Za-z_:][A-Za-z0-9_.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?)* *\/?>[ \t]*$/.test(s)) return 7;
    if (/^<\/[A-Za-z][A-Za-z0-9-]*\s*>[ \t]*$/.test(s)) return 7;
  }
  return 0;
}

// HTML block types that can interrupt a paragraph (types 1-6; a type 7
// tag alone on a line cannot interrupt one).
function htmlInterrupt(line) {
  const t = htmlBlockType(line);
  return t === 7 ? 0 : t;
}

function isBlockquoteStart(line) {
  if (indentOf(line) > 3) return false;
  let spaces = 0;
  while (spaces < line.length && line[spaces] === ' ') spaces++;
  return spaces <= 3 && line[spaces] === '>';
}

// List marker at line start (indent <= 3). Returns null or
// {ordered, start, bullet, markerLen, indent}.
function listMarker(line) {
  const ind = indentOf(line);
  if (ind > 3) return null;
  const s = line.slice(ind);
  const c0 = s[0];
  if (c0 === '*' || c0 === '+' || c0 === '-') {
    if (s.length === 1 || s[1] === ' ' || s[1] === '\t') {
      return { ordered: false, start: null, bullet: c0, markerLen: 1, indent: ind };
    }
    return null;
  }
  let d = 0;
  while (d < s.length && d < 9 && s[d] >= '0' && s[d] <= '9') d++;
  if (d >= 1 && d < s.length && (s[d] === '.' || s[d] === ')') &&
      (d + 1 >= s.length || s[d + 1] === ' ' || s[d + 1] === '\t')) {
    return { ordered: true, start: parseInt(s.slice(0, d), 10), bullet: s[d], markerLen: d + 1, indent: ind };
  }
  return null;
}

// Skip spaces/tabs and at most one newline from p.
// Returns [new position, whether any whitespace was skipped].
function skipWsNl(src, p) {
  let hadWs = false;
  let nl = false;
  while (p < src.length) {
    const c = src[p];
    if (c === ' ' || c === '\t') { hadWs = true; p++; continue; }
    if (c === '\n' && !nl) { hadWs = true; nl = true; p++; continue; }
    break;
  }
  return [p, hadWs];
}

// Scan an angle-bracket destination '<...>' starting at p.
// Returns [href, end] (end = just past '>') or null.
function scanAngleDest(src, p) {
  let j = p + 1;
  while (j < src.length && src[j] !== '>' && src[j] !== '\n' && src[j] !== '<') {
    if (src[j] === '\\') { j += 2; continue; }
    j++;
  }
  if (j >= src.length || src[j] !== '>') return null;
  return [src.slice(p + 1, j), j + 1];
}

// Try to parse a link reference definition starting at pos (a line
// start). Scans the raw source directly (no line cap): the label, ':',
// the destination (which may be on the next line), and an optional
// title (which may span several lines, and must be preceded by at
// least one whitespace character). Returns {end, label, href, title}
// or null. If a parsed title is followed by junk on its line, falls
// back to the no-title form.
function tryDef(src, pos, getLine) {
  const [line] = getLine(pos);
  const ind = indentOf(line);
  if (ind > 3 || line[ind] !== '[') return null;
  const lab = parseLabel(src, pos + ind);
  if (!lab) return null;
  let i = lab.end;
  while (i < src.length && (src[i] === ' ' || src[i] === '\t')) i++;
  if (src[i] !== ':') return null;
  i++;
  // skip spaces/tabs and at most one newline before the destination
  i = skipWsNl(src, i)[0];
  if (i >= src.length) return null;
  let href = '';
  if (src[i] === '<') {
    const dest = scanAngleDest(src, i);
    if (!dest) return null;
    href = dest[0];
    i = dest[1];
  } else {
    const start = i;
    while (i < src.length && src[i] !== ' ' && src[i] !== '\t' && src[i] !== '\n' && src[i].charCodeAt(0) >= 32) i++;
    if (i === start) return null;
    href = src.slice(start, i);
  }
  // optional title, preceded by at least one whitespace char
  // (spaces/tabs and at most one newline)
  const save = i;
  const [afterWs, hadWs] = skipWsNl(src, i);
  i = afterWs;
  let title = null;
  if (hadWs && i < src.length && (src[i] === '"' || src[i] === "'" || src[i] === '(')) {
    const end = scanTitle(src, i);
    if (end >= 0) {
      let k = end;
      while (k < src.length && (src[k] === ' ' || src[k] === '\t')) k++;
      if (k >= src.length || src[k] === '\n') {
        title = src.slice(i + 1, end - 1);
        i = k;
      } else {
        i = save; // junk after the title: fall back to no-title form
      }
    } else {
      i = save;
    }
  } else {
    i = save;
  }
  // must be at end of line (or end of source) now
  if (i < src.length && src[i] !== '\n') return null;
  let end = i < src.length ? i + 1 : src.length;
  // the definition swallows following empty lines
  while (end < src.length && src[end] === '\n') end++;
  return { end, label: lab.label, href: unescapePunct(href), title: title === null ? null : unescapePunct(title) };
}

// A line that can be a lazy paragraph continuation inside a blockquote
// or list item: a plain text line, not a block start. A line that starts
// a list item (any marker, with content) is never a lazy line: it would
// start a new list instead.
function isPlainLine(line) {
  if (isBlank(line)) return false;
  if (indentOf(line) > 3) return true; // indented continuation text
  const s = line.slice(firstNonWs(line));
  if (s[0] === '#') {
    let k = 0;
    while (k < s.length && s[k] === '#') k++;
    if (k >= 1 && k <= 6 && (k >= s.length || s[k] === ' ' || s[k] === '\t')) return false;
  }
  if (fenceStart(line)) return false;
  if (isHr(line)) return false;
  if (s.startsWith('>')) return false;
  if (htmlInterrupt(line) > 0) return false;
  if (listMarker(line)) return false; // a list marker line starts a list, not a lazy line
  return true;
}

// Strip one blockquote marker ("  >" plus one optional space) from the
// front of a line. Returns the rest, or null when the line has none.
function stripQuoteMark(ln) {
  const m = /^ {0,3}> ?/.exec(ln);
  return m ? ln.slice(m[0].length) : null;
}

// Does a sequence of collected lines end with an open paragraph?
// A line with indent >= 4 only continues a paragraph when one is open;
// a block-start line closes it; a setext underline or table delimiter
// line ends the paragraph as a heading/table. Lines inside an unclosed
// fenced code block are fence content, not paragraph text, so a lazy
// line after them is not a continuation (the fence swallows it).
// With deep=true, blockquote markers are stripped recursively before
// classifying (for the innermost blockquote's paragraph state).
function endsWithParagraph(collected, deep) {
  let paraOpen = false;
  let fenceChar = null, fenceRun = 0, fenceQuote = 0;
  for (const line of collected) {
    let text = line;
    let quoteDepth = 0;
    if (deep) {
      while (true) {
        const rest = stripQuoteMark(text);
        if (rest === null) break;
        text = rest;
        quoteDepth++;
      }
      if (text !== line && text.trim() === '') { paraOpen = false; continue; }
    }
    if (isBlank(text)) { paraOpen = false; continue; }
    if (deep && fenceChar) {
      // inside a fenced code block (blockquote context only): only a
      // line that reaches the fence's nesting depth is fence content;
      // a line with fewer '>' markers has left the inner quote (and
      // the fence) — e.g. '> request' after a '> > ```rust' fence.
      if (quoteDepth < fenceQuote) { fenceChar = null; }
      else {
        if (indentOf(text) <= 3) {
          const s = text.slice(firstNonWs(text));
          let k = 0;
          while (k < s.length && s[k] === fenceChar) k++;
          if (k >= fenceRun && isBlank(s.slice(k))) fenceChar = null;
        }
        continue;
      }
    }
    if (indentOf(text) >= 4) continue; // code line, or a paragraph continuation
    if (deep) {
      const fence = fenceStart(text);
      if (fence) { fenceChar = fence.ch; fenceRun = fence.len; fenceQuote = quoteDepth; paraOpen = false; continue; }
    }
    if (isSetextUnderline(text)) { paraOpen = false; continue; }
    if (paraOpen && tableDelimiter(text)) { paraOpen = false; continue; }
    if (isPlainLine(text)) { paraOpen = true; continue; }
    // a list item or blockquote line: the paragraph is open if its
    // first content is a paragraph (recursively, e.g. '1. > foo')
    if (lineFirstContentOpen(text)) { paraOpen = true; continue; }
    paraOpen = false;
  }
  return paraOpen;
}

// Is the first block started by this line a paragraph? Follows list
// markers and blockquote markers recursively to the innermost content.
function lineFirstContentOpen(ln) {
  const s = ln.slice(firstNonWs(ln));
  const lm = listMarker(ln);
  if (lm) {
    const after = s.slice(lm.markerLen);
    if (after === '' || (after[0] !== ' ' && after[0] !== '\t')) return false;
    const rest = after.replace(/^[ \t]+/, '');
    if (rest === '') return false;
    return lineFirstContentOpen(rest);
  }
  if (s.startsWith('>')) {
    let rest = s.slice(1);
    if (rest.startsWith(' ')) rest = rest.slice(1);
    if (rest === '') return false;
    return lineFirstContentOpen(rest);
  }
  return isPlainLine(ln);
}

function isSetextUnderline(line) {
  if (indentOf(line) > 3) return false;
  const s = line.slice(firstNonWs(line));
  if (s.length === 0) return false;
  const ch = s[0];
  if (ch !== '=' && ch !== '-') return false;
  let i = 0;
  while (i < s.length && s[i] === ch) i++;
  while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++;
  return i === s.length;
}

// Table delimiter row? Returns align array or null.
function tableDelimiter(line) {
  if (indentOf(line) > 3) return null;
  const t = line.trim();
  if (t.indexOf(':') < 0 && t.indexOf('|') < 0) return null;
  const parts = t.split('|');
  if (parts[0].trim() === '') parts.shift();
  if (parts.length > 0 && parts[parts.length - 1].trim() === '') parts.pop();
  if (parts.length === 0) return null;
  const aligns = [];
  for (const p of parts) {
    const c = p.trim();
    // a delimiter cell is :--, --:, :--: or --- (at least one dash,
    // with an optional colon on either side)
    let a = 0;
    let b = c.length;
    let left = false, right = false;
    if (c[0] === ':') { left = true; a = 1; }
    if (c.length > 0 && c[c.length - 1] === ':') { right = true; b = c.length - 1; }
    if (b - a < 1) return null;
    for (let k = a; k < b; k++) if (c[k] !== '-') return null;
    aligns.push(left && right ? 'center' : right ? 'right' : left ? 'left' : null);
  }
  return aligns;
}

// Collect an indented code block starting at pos (the first line is
// already known to be indented >= 4). Blank lines between code lines
// are kept; trailing blanks are consumed but not kept. Returns
// {text, end}; text is null when there is no content at all.
function collectIndentedCode(src, pos, getLine) {
  const n = src.length;
  const lines = [];
  let p = pos;
  let blanks = [];
  while (p < n) {
    const [ln, next] = getLine(p);
    if (isBlank(ln)) { blanks.push(ln); p = next; continue; }
    if (indentOf(ln) >= 4) {
      for (const b of blanks) lines.push(b);
      blanks = [];
      lines.push(ln);
      p = next;
      continue;
    }
    break;
  }
  while (lines.length > 0 && isBlank(lines[lines.length - 1])) lines.pop();
  if (lines.length === 0) return { text: null, end: p };
  return { text: lines.map((l) => stripCols(l, 4)).join('\n') + '\n', end: p };
}

// Collect the lines of a blockquote starting at pos: marked lines have
// their '>' stripped (tabs expanded first), lazy continuation lines
// are recorded with their offsets in the inner source. Returns the
// inner source, the lazy sets, and the position after the quote.
function collectQuote(src, pos, getLine) {
  const n = src.length;
  const lines = [];
  const lazy = new Set();
  const lazyChunkStart = new Set();
  let len = 0;
  let marked = false;
  let p = pos;
  while (p < n) {
    const [ln, next] = getLine(p);
    if (isBlockquoteStart(ln)) {
      const ind = indentOf(ln);
      let rest = expandTabsPrefix(ln.slice(ind + 1), ind + 1);
      if (rest.startsWith(' ')) rest = rest.slice(1);
      lines.push(rest);
      len += rest.length + 1;
      marked = true;
      p = next;
      continue;
    }
    if (isBlank(ln)) break;
    if (lines.length > 0 && endsWithParagraph(lines, true) && isPlainLine(ln)) {
      // a lazy continuation line: record its offset in the inner
      // source. A lazy line that follows a marked line starts a
      // new chunk (a setext line there is plain text, not demoted).
      if (marked) lazyChunkStart.add(len);
      lazy.add(len);
      lines.push(ln);
      len += ln.length + 1;
      marked = false;
      p = next;
      continue;
    }
    break;
  }
  return { innerSrc: lines.join('\n'), lazy, lazyChunkStart, end: p };
}

function blocksHtml(src, links, paraText, lazySet, lazyChunkStart, top) {
  if (top === undefined) top = true; // list-item content parses with top=false
  const blocks = [];
  let loose = false; // a blank line separated two blocks at this level
  let pos = 0;
  const n = src.length;
  const getLine = (p) => {
    if (p >= n) return ['', n];
    const e = src.indexOf('\n', p);
    if (e < 0) return [src.slice(p), n];
    return [src.slice(p, e), e + 1];
  };

  while (pos < n) {
    const [line, np] = getLine(pos);
    if (isBlank(line)) { if (blocks.length > 0) loose = true; pos = np; continue; }

    // link reference definition
    const def = tryDef(src, pos, getLine);
    if (def) {
      if (!links[normLabel(def.label)]) links[normLabel(def.label)] = { href: def.href, title: def.title };
      pos = def.end;
      continue;
    }

    const ind = indentOf(line);

    // indented code block
    if (ind >= 4) {
      const code = collectIndentedCode(src, pos, getLine);
      if (code.text !== null) blocks.push({ k: 'code', text: code.text, lang: null });
      pos = code.end;
      continue;
    }

    // fenced code
    const fence = fenceStart(line);
    if (fence) {
      const fenceIndent = line.slice(0, firstNonWs(line));
      const content = [];
      let p = np;
      while (p < n) {
        const [ln, nnp] = getLine(p);
        if (indentOf(ln) <= 3) {
          const s = ln.slice(firstNonWs(ln));
          let k = 0;
          while (k < s.length && s[k] === fence.ch) k++;
          if (k >= fence.len && isBlank(s.slice(k))) { p = nnp; break; }
        }
        // indent compensation: strip up to the fence indent's length
        // of leading whitespace from each content line — but only for
        // backtick fences; marked's indentCodeCompensation regex only
        // matches ```, so a ~~~ fence leaves its content untouched
        let cl = ln;
        if (fence.ch === '`' && fenceIndent.length > 0) {
          let cut = 0;
          while (cut < cl.length && cut < fenceIndent.length && (cl[cut] === ' ' || cl[cut] === '\t')) cut++;
          cl = cl.slice(cut);
        }
        content.push(cl);
        p = nnp;
      }
      const raw = content.join('\n');
      const infoTrim = fence.info.trim();
      let lang = '';
      if (infoTrim) {
        const unesc = unescapePunct(infoTrim);
        let e = 0;
        while (e < unesc.length && !isWsAll(unesc[e])) e++;
        lang = unesc.slice(0, e);
      }
      blocks.push({ k: 'code', text: raw, lang: lang || null });
      pos = p;
      continue;
    }

    // ATX heading
    const atx = atxHeading(line);
    if (atx) {
      blocks.push({ k: 'heading', depth: atx.depth, text: atx.text });
      pos = np;
      continue;
    }

    // thematic break
    if (isHr(line)) {
      blocks.push({ k: 'hr' });
      pos = np;
      continue;
    }

    // blockquote
    if (isBlockquoteStart(line)) {
      const q = collectQuote(src, pos, getLine);
      blocks.push({ k: 'quote', blocks: blocksHtml(q.innerSrc, links, false, q.lazy, q.lazyChunkStart, true).blocks });
      pos = q.end;
      continue;
    }

    // list
    if (listMarker(line)) {
      const res = parseList(src, pos, getLine, links);
      blocks.push(...res.blocks);
      pos = res.end;
      continue;
    }

    // HTML block
    const htype = htmlBlockType(line);
    if (htype > 0) {
      let p = np;
      const parts = [line, '\n'];
      let endedAtBlank = false;
      const ender = htype === 1 ? new RegExp('</(script|pre|style|textarea)', 'i')
        : htype === 2 ? /-->/ : htype === 3 ? /\?>/ : htype === 4 ? />/ : htype === 5 ? /\]\]>/ : null;
      if (ender) {
        if (!ender.test(line)) {
          while (p < n) {
            const [ln, nnp] = getLine(p);
            parts.push(ln, '\n');
            p = nnp;
            if (ender.test(ln)) break;
          }
        }
        // the block swallows following empty lines (the regex's
        // (\n+|$) / \n* after the ender); ge() then drops them
        while (p < n) {
          const [ln, nnp] = getLine(p);
          if (ln !== '') break;
          parts.push('\n');
          p = nnp;
        }
      } else {
        while (p < n) {
          const [ln, nnp] = getLine(p);
          if (isBlank(ln)) { endedAtBlank = true; break; }
          parts.push(ln, '\n');
          p = nnp;
        }
      }
      let text = parts.join('');
      // drop the trailing newline if the block is the last line without one
      if (p >= n && !src.endsWith('\n') && text.endsWith('\n')) text = text.slice(0, -1);
      if (endedAtBlank) text += '\n';
      blocks.push({ k: 'html', text: geText(text) });
      pos = p;
      continue;
    }

    // paragraph (with table / setext lookahead)
    const paraLines = [line];
    let p = np;
    const table = tryTable(src, line, p, getLine);
    if (table) {
      blocks.push(table.block);
      pos = table.end;
      continue;
    }
    let isSetext = false;
    let depth = 0;
    while (p < n) {
      const [ln, nnp] = getLine(p);
      if (isBlank(ln)) {
        // a whitespace-only line that is the last line of the source
        // with no trailing newline is paragraph text, not a blank line
        if (nnp >= n && !src.endsWith('\n')) { paraLines.push(ln); p = nnp; }
        break;
      }
      // a lazy continuation line: a setext underline is demoted to
      // indented text (unless it starts a new chunk, after a marked
      // line — then it stays plain text); an indented line is
      // code-merged (strip 4 columns); anything else stays as-is.
      // All of these bypass the setext / block-interrupt checks.
      if (lazySet && lazySet.has(p)) {
        if (isSetextUnderline(ln)) {
          if (lazyChunkStart && lazyChunkStart.has(p)) paraLines.push(ln);
          else paraLines.push('    ' + ln.slice(firstNonWs(ln)));
        } else if (indentOf(ln) >= 4) {
          paraLines.push(stripCols(ln, 4));
        } else {
          paraLines.push(ln);
        }
        p = nnp;
        continue;
      }
      if (isSetextUnderline(ln)) {
        isSetext = true;
        depth = ln[firstNonWs(ln)] === '=' ? 1 : 2;
        p = nnp;
        break;
      }
      if (interruptsParagraph(ln, top)) break;
      paraLines.push(ln);
      p = nnp;
    }
    const text = paraLines.join('\n');
    if (isSetext) {
      blocks.push({ k: 'heading', depth, text: text.trim() });
    } else if (paraText) {
      blocks.push({ k: 'text', text });
    } else {
      blocks.push({ k: 'para', text });
    }
    pos = p;
  }
  return { blocks, loose };
}

// A line of spaces only (no tabs): the one blank line that ends a table.
function isSpacesOnly(line) {
  for (let i = 0; i < line.length; i++) if (line[i] !== ' ') return false;
  return true;
}

// Try to parse a table whose header is `firstLine` and whose delimiter
// row starts at p. Returns {block, end} or null.
function tryTable(src, firstLine, p, getLine) {
  const n = src.length;
  const [line2, np2] = getLine(p);
  const aligns = tableDelimiter(line2);
  if (!aligns) return null;
  const header = splitCells(firstLine);
  if (header.length !== aligns.length) return null;
  const rows = [];
  let rp = np2;
  while (rp < n) {
    const [rl, rnp] = getLine(rp);
    // marked's table rows stop only at a spaces-only blank line
    // (a tab-only line is a row of empty cells), or at an
    // hr/heading/blockquote/fence/list/html/code-start line
    if (isSpacesOnly(rl)) break;
    if (isHr(rl) || atxHeading(rl) || fenceStart(rl) || isBlockquoteStart(rl) || (indentOf(rl) >= 4 && !isBlank(rl)) || htmlBlockType(rl) > 0) break;
    const lmR = listMarker(rl);
    // a list marker ends the table only when followed by a
    // space/tab (marked's row pattern requires [ \t])
    if (lmR && (!lmR.ordered || lmR.start === 1) && (rl[lmR.indent + lmR.markerLen] === ' ' || rl[lmR.indent + lmR.markerLen] === '\t')) break;
    rows.push(rl);
    rp = rnp;
  }
  return {
    block: {
      k: 'table',
      header: header.map((h, ci) => ({ text: h, align: aligns[ci] })),
      rows: rows.map((rl) => splitCells(rl, header.length).map((c, ci) => ({ text: c, align: aligns[ci] }))),
    },
    end: rp,
  };
}

function interruptsParagraph(line, top) {
  if (indentOf(line) > 3) return false;
  if (atxHeading(line) || fenceStart(line) || isHr(line) || isBlockquoteStart(line)) return true;
  if (htmlInterrupt(line) > 0) return true;
  const lm = listMarker(line);
  if (lm) {
    const s = line.slice(firstNonWs(line));
    const after = s.slice(lm.markerLen);
    if (after !== '' && (after[0] === ' ' || after[0] === '\t')) {
      if (!lm.ordered) return true;
      // at the top level only a list starting with 1 interrupts a
      // paragraph; inside a list item (top=false) any ordered marker
      // starts a nested list instead of continuing the paragraph
      if (top === false || lm.start === 1) return true;
    }
  }
  return false;
}

// Parse a list starting at pos. Returns {blocks, end}.
function parseList(src, pos, getLine, links) {
  const n = src.length;
  const [firstLine] = getLine(pos);
  const lm0 = listMarker(firstLine);
  const ordered = lm0.ordered;
  const bullet = lm0.bullet;
  const startNum = lm0.start;
  const items = [];
  let p = pos;
  let loose = false;

  while (p < n) {
    const [line, np] = getLine(p);
    const lm = listMarker(line);
    if (!lm || lm.ordered !== ordered || lm.bullet !== bullet) break;
    // content indent for this item
    const ind = lm.indent;
    const afterMarker = expandTabsPrefix(line.slice(ind + lm.markerLen), ind + lm.markerLen);
    let col = ind + lm.markerLen;
    let k = 0;
    while (k < afterMarker.length && afterMarker[k] === ' ') { col++; k++; }
    const spacesCols = col - (ind + lm.markerLen);
    let contentIndent, firstContent;
    if (k >= afterMarker.length) {
      contentIndent = ind + lm.markerLen + 1;
      firstContent = '';
    } else if (spacesCols >= 5) {
      contentIndent = ind + lm.markerLen + 1;
      firstContent = afterMarker.slice(1);
    } else {
      contentIndent = col;
      firstContent = afterMarker.slice(k);
    }
    const lines = [firstContent];
    const lazy = new Set();
    let len = firstContent.length + 1;
    let cursor = np;
    let blanks = 0;
    let blankPos = -1;
    while (cursor < n) {
      const [text, next] = getLine(cursor);
      if (isBlank(text)) {
        // an empty item followed by a blank line ends the item here
        if (lines.length === 1 && lines[0] === '') break;
        if (blanks === 0) blankPos = cursor;
        blanks++; cursor = next; continue;
      }
      const textIndent = indentOf(text);
      const expandedLine = expandTabsPrefix(text, 0);
      if (indentOf(expandedLine) >= contentIndent) {
        for (let b = 0; b < blanks; b++) { lines.push(''); len += 1; }
        blanks = 0;
        lines.push(expandedLine.slice(contentIndent));
        len += expandedLine.slice(contentIndent).length + 1;
        cursor = next;
        continue;
      }
      // an hr line ends the list (checked before a new item starts)
      if (isHr(text)) {
        // leave any pending blank lines for the caller (they may
        // belong to the enclosing item and make it loose)
        if (blanks > 0) cursor = blankPos;
        break;
      }
      const marker2 = listMarker(text);
      if (marker2 && marker2.ordered === ordered && marker2.bullet === bullet && textIndent <= 3) {
        if (blanks > 0) loose = true;
        break;
      }
      if (blanks === 0 && lines.length > 0 && endsWithParagraph(lines) && isPlainLine(text)) {
        lazy.add(len);
        lines.push(text);
        len += text.length + 1;
        cursor = next;
        continue;
      }
      // the item ends here: leave any pending blank lines for the
      // caller, so a blank after a nested list is visible to the
      // enclosing item's parse (cm-325)
      if (blanks > 0) cursor = blankPos;
      break;
    }
    // drop trailing blank lines from the item content
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    items.push({ lines, contentIndent, lazy });
    p = cursor;
    if (p >= n) break;
    // Peek past blank lines after the item. Only consume them (and
    // mark the list loose) when the next non-blank line starts another
    // item of this list; otherwise leave them for the caller — a blank
    // line after a nested list may belong to the enclosing item and
    // make it loose (cm-325).
    let pp = p;
    let skippedBlanks = 0;
    while (pp < n) {
      const [bl, nbp] = getLine(pp);
      if (!isBlank(bl)) break;
      skippedBlanks++;
      pp = nbp;
    }
    if (pp >= n) { p = pp; break; }
    const [nl2] = getLine(pp);
    if (isHr(nl2)) break;
    const lmN = listMarker(nl2);
    if (lmN && lmN.ordered === ordered && lmN.bullet === bullet) {
      if (skippedBlanks > 0) loose = true;
      p = pp;
    } else {
      break; // p stays at the first blank line (or the current line)
    }
  }

  // parse each item's content into blocks; in a tight list the
  // top-level paragraphs render as bare inline text. A list is loose
  // when an item's own blocks are separated by a blank line (the
  // sub-parse's space flag) — blank lines inside a nested list do
  // not loosen the outer list.
  const parsedItems = [];
  for (const item of items) {
    let content = item.lines.join('\n');
    let task = false;
    let checked = false;
    // a task item starts with [ ], [x] or [X], then spaces/tabs,
    // then a non-whitespace character
    if (content[0] === '[' && (content[1] === ' ' || content[1] === 'x' || content[1] === 'X') && content[2] === ']') {
      let t = 3;
      while (t < content.length && (content[t] === ' ' || content[t] === '\t')) t++;
      if (t > 3 && t < content.length && !isWsAll(content[t])) {
        task = true;
        checked = content[1] !== ' ';
        content = content.slice(t);
      }
    }
    const sub = blocksHtml(content, links, false, item.lazy, item.lazy, false);
    if (sub.loose) loose = true;
    parsedItems.push({ blocks: sub.blocks, task, checked });
  }
  // looseness is a property of the whole list: once any item is loose,
  // every item's top-level paragraphs render as <p>
  if (!loose) {
    for (const item of parsedItems) {
      for (const bl of item.blocks) if (bl.k === 'para') bl.k = 'text';
    }
  }
  return { blocks: [{ k: 'list', ordered, start: startNum, items: parsedItems }], end: p };
}

// Render block nodes to HTML (inline parsing happens here, after every
// link reference definition in the document has been collected).
function renderBlocks(blocks, links) {
  const parts = [];
  for (const b of blocks) {
    switch (b.k) {
      case 'para':
        parts.push('<p>', inlineHtml(b.text, links, false), '</p>\n');
        break;
      case 'text':
        parts.push(inlineHtml(b.text, links, false));
        break;
      case 'heading':
        parts.push('<h', String(b.depth), '>', inlineHtml(b.text, links, false), '</h', String(b.depth), '>\n');
        break;
      case 'code': {
        const r = b.text ? (b.text.endsWith('\n') ? b.text : b.text + '\n') : '';
        if (b.lang) parts.push('<pre><code class="language-', escText(b.lang), '">', escEncode(r), '</code></pre>\n');
        else parts.push('<pre><code>', escEncode(r), '</code></pre>\n');
        break;
      }
      case 'hr':
        parts.push('<hr>\n');
        break;
      case 'html':
        parts.push(b.text);
        break;
      case 'quote':
        parts.push('<blockquote>\n', renderBlocks(b.blocks, links), '</blockquote>\n');
        break;
      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul';
        const startAttr = b.ordered && b.start !== 1 ? ' start="' + b.start + '"' : '';
        parts.push('<', tag, startAttr, '>\n');
        for (const item of b.items) {
          let itemHtml = renderBlocks(item.blocks, links);
          if (item.task) {
            const cb = '<input ' + (item.checked ? 'checked="" ' : '') + 'disabled="" type="checkbox"> ';
            const fk = item.blocks.length ? item.blocks[0].k : null;
            if (fk === 'para' && itemHtml.startsWith('<p>')) itemHtml = '<p>' + cb + itemHtml.slice(3);
            else if (fk === 'text') itemHtml = cb + itemHtml;
            else if (itemHtml === '') itemHtml = cb;
            else itemHtml = '<p>' + cb + '</p>\n' + itemHtml;
          }
          parts.push('<li>', itemHtml, '</li>\n');
        }
        parts.push('</', tag, '>\n');
        break;
      }
      case 'table': {
        parts.push('<table>\n<thead>\n<tr>\n');
        for (const cell of b.header) {
          parts.push(cell.align ? '<th align="' + cell.align + '">' : '<th>', inlineHtml(cell.text, links, false), '</th>\n');
        }
        parts.push('</tr>\n</thead>\n');
        if (b.rows.length > 0) {
          parts.push('<tbody>');
          for (const row of b.rows) {
            parts.push('<tr>\n');
            for (const cell of row) {
              parts.push(cell.align ? '<td align="' + cell.align + '">' : '<td>', inlineHtml(cell.text, links, false), '</td>\n');
            }
            parts.push('</tr>\n');
          }
          parts.push('</tbody>');
        }
        parts.push('</table>\n');
        break;
      }
    }
  }
  return parts.join('');
}

export function parse(markdown) {
  let src = String(markdown);
  // Most documents hold no CR at all; only then copy the string.
  if (src.indexOf('\r') >= 0) src = src.replace(/\r\n?/g, '\n');
  if (src === '') return '';
  const links = Object.create(null);
  inlineState.inLink = false;
  inlineState.inRawBlock = false;
  return renderBlocks(blocksHtml(src, links, false).blocks, links);
}
