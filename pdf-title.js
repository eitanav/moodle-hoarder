// PDF title extraction (ROADMAP #21) — dependency-free, no AI, no pdf.js.
//
// Goal: when a downloaded PDF has a *generic* filename (1.pdf, unnamed.pdf,
// "Microsoft Word - doc.pdf"...), try to recover a human title from the PDF's
// own metadata and rename the file to it. We deliberately avoid bundling the
// heavy pdf.js — for a *title* we only need the document metadata, which lives
// either in the Info dictionary (/Title) or in the XMP packet (dc:title /
// pdf:Title). Both are plain bytes in the vast majority of PDFs produced by
// Office / LaTeX / "print to PDF". If the metadata sits inside a compressed
// object stream we simply find nothing and keep the original name — graceful
// degradation, never a crash.
//
// Pure functions, no DOM, no chrome.*; runs in the popup and under Node (for
// the unit tests in test/pdf-title.test.js).

(function (root) {
  'use strict';

  // Unicode bidi controls + zero-width chars that poison filenames / matching.
  const BIDI_RE = /[​-‏‪-‮⁦-⁩﻿]/g;

  // ---- generic-name detection -------------------------------------------
  // A name is "generic" when it carries no real information and renaming to
  // a recovered title is a clear win. Patterns are anchored to the WHOLE
  // basename so "presentation on fluids" is NOT treated as generic.
  function isGenericPdfName(name) {
    if (!name) return true;
    let base = String(name).replace(BIDI_RE, '').replace(/\.[^.]+$/, '').trim();
    if (!base) return true;
    if (base.length <= 2) return true;
    const low = base.toLowerCase();
    // only digits / separators → "1", "03 - ", "2024_05"
    if (/^[\d\s._()-]+$/.test(base)) return true;
    // hash / uuid-ish blobs of hex
    if (/^[0-9a-f]{16,}$/i.test(base)) return true;
    // common generic stems, optionally trailed by a number or separator run
    const GENERIC = /^(doc|document|documents|file|files|download|downloads|untitled|unnamed|noname|new|copy|copy of .*|scan|scanned|image|images|img|photo|attachment|attach|output|print|printout|presentation|slide|slides|מסמך|קובץ|ללא[\s_-]*שם|מצגת|סריקה|תמונה|הורדה|חדש|העתק)[\s_-]*\d*$/i;
    if (GENERIC.test(low)) return true;
    return false;
  }

  // ---- title cleanup -----------------------------------------------------
  // Strip authoring-tool prefixes ("Microsoft Word - ..."), stray extensions,
  // bidi marks, and collapse whitespace. Office's "Microsoft Word - foo.docx"
  // title is not a real title — drop the prefix and let what's left stand on
  // its own (it may then be rejected as generic by the caller).
  function cleanPdfTitle(title) {
    if (title == null) return '';
    let s = String(title).replace(BIDI_RE, '');
    s = s.replace(/^(Microsoft\s+Word|Microsoft\s+PowerPoint|Microsoft\s+Excel|PowerPoint\s+Presentation)\s*[-–—:]\s*/i, '');
    s = s.replace(/\.(pdf|docx?|pptx?|xlsx?|odt|odp)$/i, '');
    s = s.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
    return s;
  }

  // ---- low-level byte helpers -------------------------------------------
  function toUint8(bytes) {
    if (bytes instanceof Uint8Array) return bytes;
    if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
    if (bytes && bytes.buffer instanceof ArrayBuffer) return new Uint8Array(bytes.buffer, bytes.byteOffset || 0, bytes.byteLength);
    return new Uint8Array(0);
  }

  const LATIN1 = new TextDecoder('latin1');
  const UTF8 = new TextDecoder('utf-8');

  // Decode a PDF text string (Uint8Array) honoring its byte-order/encoding:
  //   FE FF ...      → UTF-16BE   (how Hebrew/Unicode titles are stored)
  //   EF BB BF ...   → UTF-8
  //   otherwise      → PDFDocEncoding ≈ Latin-1 (fine for ASCII titles)
  function decodePdfText(u8) {
    if (!u8 || !u8.length) return '';
    if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) {
      let out = '';
      for (let i = 2; i + 1 < u8.length; i += 2) {
        out += String.fromCharCode((u8[i] << 8) | u8[i + 1]);
      }
      return out;
    }
    if (u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
      return UTF8.decode(u8.subarray(3));
    }
    return LATIN1.decode(u8);
  }

  function isWS(b) { return b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09 || b === 0x0c || b === 0x00; }
  function hexVal(b) {
    if (b >= 0x30 && b <= 0x39) return b - 0x30;
    if (b >= 0x41 && b <= 0x46) return b - 0x41 + 10;
    if (b >= 0x61 && b <= 0x66) return b - 0x61 + 10;
    return -1;
  }

  // Parse a PDF string object starting at byte `i` (which should point at the
  // value, leading whitespace already skipped). Returns the decoded JS string,
  // or null if the bytes at `i` are not a string object.
  function parsePdfStringAt(u8, i) {
    while (i < u8.length && isWS(u8[i])) i++;
    if (i >= u8.length) return null;
    const c = u8[i];
    if (c === 0x28) {
      // literal ( ... ) with escapes and balanced parens
      const bytes = [];
      let depth = 1;
      i++;
      while (i < u8.length && depth > 0) {
        let b = u8[i++];
        if (b === 0x5c) { // backslash escape
          const e = u8[i++];
          switch (e) {
            case 0x6e: bytes.push(0x0a); break; // \n
            case 0x72: bytes.push(0x0d); break; // \r
            case 0x74: bytes.push(0x09); break; // \t
            case 0x62: bytes.push(0x08); break; // \b
            case 0x66: bytes.push(0x0c); break; // \f
            case 0x28: bytes.push(0x28); break; // \(
            case 0x29: bytes.push(0x29); break; // \)
            case 0x5c: bytes.push(0x5c); break; // \\
            case 0x0d: if (u8[i] === 0x0a) i++; break; // line continuation
            case 0x0a: break; // line continuation
            default:
              if (e >= 0x30 && e <= 0x37) { // octal \ddd (1-3 digits)
                let oct = e - 0x30;
                for (let k = 0; k < 2 && u8[i] >= 0x30 && u8[i] <= 0x37; k++) oct = oct * 8 + (u8[i++] - 0x30);
                bytes.push(oct & 0xff);
              } else {
                bytes.push(e);
              }
          }
        } else if (b === 0x28) { depth++; bytes.push(b); }
        else if (b === 0x29) { depth--; if (depth > 0) bytes.push(b); }
        else bytes.push(b);
      }
      return decodePdfText(Uint8Array.from(bytes));
    }
    if (c === 0x3c) {
      // hex < ... > (but not a dictionary "<<")
      if (u8[i + 1] === 0x3c) return null;
      const bytes = [];
      i++;
      let hi = -1;
      while (i < u8.length) {
        const b = u8[i++];
        if (b === 0x3e) break;
        const v = hexVal(b);
        if (v < 0) continue; // skip whitespace inside hex
        if (hi < 0) hi = v; else { bytes.push((hi << 4) | v); hi = -1; }
      }
      if (hi >= 0) bytes.push(hi << 4); // odd digit count → pad low nibble 0
      return decodePdfText(Uint8Array.from(bytes));
    }
    return null;
  }

  // Pull dc:title / pdf:Title out of an XMP packet (UTF-8 XML).
  function titleFromXmp(xml) {
    if (!xml) return '';
    let m = xml.match(/<dc:title>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i);
    if (m) return decodeXmlEntities(m[1]);
    m = xml.match(/<dc:title>\s*([^<]+?)\s*<\/dc:title>/i);
    if (m) return decodeXmlEntities(m[1]);
    m = xml.match(/<pdf:Title>\s*([\s\S]*?)\s*<\/pdf:Title>/i);
    if (m) return decodeXmlEntities(m[1]);
    m = xml.match(/\bpdf:Title\s*=\s*"([^"]*)"/i) || xml.match(/\bdc:title\s*=\s*"([^"]*)"/i);
    if (m) return decodeXmlEntities(m[1]);
    return '';
  }

  function decodeXmlEntities(s) {
    return String(s)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
      .replace(/&amp;/g, '&');
  }

  // Scan one byte window [start,end) (latin1 view) for candidate titles.
  // Returns the raw (uncleaned) title string, or ''.
  function scanWindow(u8, start, end) {
    const view = LATIN1.decode(u8.subarray(start, end));

    // 1) XMP packet — UTF-8, best for non-ASCII (Hebrew) titles.
    const xs = view.indexOf('<x:xmpmeta');
    if (xs >= 0) {
      let xe = view.indexOf('</x:xmpmeta>', xs);
      if (xe < 0) xe = view.indexOf('</rdf:RDF>', xs);
      if (xe > xs) {
        const xml = UTF8.decode(u8.subarray(start + xs, start + xe + 16));
        const t = cleanPdfTitle(titleFromXmp(xml));
        if (t && t.length >= 3 && !isGenericPdfName(t + '.pdf')) return t;
      }
    }

    // 2) Info dictionary /Title — scan every "/Title" whose next byte is a
    //    delimiter/whitespace (so we don't match "/Titlepage" etc.).
    let from = 0;
    for (;;) {
      const idx = view.indexOf('/Title', from);
      if (idx < 0) break;
      from = idx + 6;
      const after = view.charCodeAt(idx + 6);
      // value must start (after optional WS) with '(' or '<'
      if (after === 0x28 || after === 0x3c || isWS(after)) {
        const val = parsePdfStringAt(u8, start + idx + 6);
        const t = cleanPdfTitle(val);
        if (t && t.length >= 3 && !isGenericPdfName(t + '.pdf')) return t;
      }
    }
    return '';
  }

  // Public: extract a clean, non-generic title from PDF bytes, or '' if none.
  function extractPdfTitle(bytes) {
    try {
      const u8 = toUint8(bytes);
      if (u8.length < 8) return '';
      // must look like a PDF ("%PDF")
      if (!(u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46)) return '';

      const MAX = 24 * 1024 * 1024;
      const WIN = 12 * 1024 * 1024;
      let windows;
      if (u8.length <= MAX) windows = [[0, u8.length]];
      else windows = [[0, WIN], [u8.length - WIN, u8.length]]; // head + tail (trailer/Info live at the end)

      for (const [s, e] of windows) {
        const t = scanWindow(u8, s, e);
        if (t) return t;
      }
      return '';
    } catch {
      return '';
    }
  }

  const api = { extractPdfTitle, isGenericPdfName, cleanPdfTitle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
