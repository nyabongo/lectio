import { describe, expect, it } from 'vitest';

import {
  charsetParam,
  contentKind,
  decodeBody,
  htmlToText,
  mediaType,
  metaCharset,
  reportedContentType,
  tidyText,
} from './text.ts';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('content kinds', () => {
  it('reads the media type', () => {
    expect(mediaType('Text/HTML; charset=utf-8')).toBe('text/html');
    expect(mediaType('')).toBe('');
  });

  it('classifies by Content-Type', () => {
    const none = new Uint8Array();
    expect(contentKind('text/html', none)).toBe('html');
    expect(contentKind('application/xhtml+xml', none)).toBe('html');
    expect(contentKind('application/pdf', none)).toBe('pdf');
    expect(contentKind('text/plain', none)).toBe('text');
    expect(contentKind('application/json', none)).toBe('text');
    expect(contentKind('application/atom+xml', none)).toBe('text');
    expect(contentKind('application/zip', none)).toBe('binary');
  });

  it('sniffs the body when there is no Content-Type', () => {
    expect(contentKind('', bytes('%PDF-1.7'))).toBe('pdf');
    expect(contentKind('', bytes('  <!DOCTYPE html><html>'))).toBe('html');
    expect(contentKind('', bytes('plain'))).toBe('text');
  });

  it('reports the header, or a type for the sniffed kind', () => {
    expect(reportedContentType('text/html; charset=utf-8', 'html')).toBe('text/html; charset=utf-8');
    expect(reportedContentType(null, 'html')).toBe('text/html');
    expect(reportedContentType(' ', 'text')).toBe('text/plain');
    expect(reportedContentType(null, 'pdf')).toBe('application/pdf');
    expect(reportedContentType(null, 'binary')).toBe('application/octet-stream');
  });
});

describe('charsets', () => {
  it('reads the charset parameter and a <meta> charset', () => {
    expect(charsetParam('text/html; charset="Shift_JIS"')).toBe('Shift_JIS');
    expect(charsetParam('text/html')).toBeUndefined();
    expect(metaCharset(bytes('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-2">'))).toBe(
      'iso-8859-2',
    );
    expect(metaCharset(bytes('<p>none</p>'))).toBeUndefined();
  });

  it('decodes with BOM, then header, then <meta>, then UTF-8, skipping unknown labels', () => {
    const e9 = Uint8Array.from([0x63, 0x61, 0x66, 0xe9]);
    expect(decodeBody(e9, 'text/plain; charset=latin1', 'text')).toBe('café');
    expect(decodeBody(e9, 'text/plain; charset=nonsense', 'text')).toBe('caf�');
    expect(decodeBody(Uint8Array.from([0xfe, 0xff, 0x00, 0x41]), 'text/plain; charset=latin1', 'text')).toBe('A');
    expect(decodeBody(Uint8Array.from([0xef, 0xbb, 0xbf, 0x41]), 'text/plain', 'text')).toBe('A');
    const meta = Uint8Array.from([...bytes('<meta charset=koi8-r>'), 0xc1]);
    expect(decodeBody(meta, 'text/html', 'html')).toBe('<meta charset=koi8-r>а');
    expect(decodeBody(meta, 'text/plain', 'text')).toBe('<meta charset=koi8-r>�');
  });
});

describe('htmlToText', () => {
  it('prefers <main>, then the longest <article>, then the body', () => {
    expect(htmlToText('<body><p>outside</p><div role="main">inside</div></body>')).toBe('inside');
    expect(htmlToText('<article>short</article><article><p>the longer one</p></article>')).toBe('the longer one');
    expect(htmlToText('<html><head><title>T</title></head><p>no body tag</p></html>')).toBe('no body tag');
  });

  it('drops page furniture and keeps block structure (and <pre> line breaks)', () => {
    const html = `<body><header>Site</header><aside>Ads</aside><form>Search</form>
      <h2>Title</h2><p>One<br>two</p><ul><li>a</li><li>b</li></ul>
      <pre>  keep
   spacing</pre><!-- comment --><table><tr><td>x</td><td>y</td></tr></table></body>`;
    expect(htmlToText(html)).toBe('Title\n\nOne\ntwo\n\na\nb\n\nkeep\nspacing\n\nx\ny');
  });

  it('tidies whitespace', () => {
    expect(tidyText('  a \t b  \n\n\n\n c ')).toBe('a b\n\nc');
  });
});
