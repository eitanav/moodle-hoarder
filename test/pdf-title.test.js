// Unit tests for pdf-title.js (ROADMAP #21). Run: node test/pdf-title.test.js
const assert = require('assert');
const { extractPdfTitle, isGenericPdfName, cleanPdfTitle } = require('../pdf-title.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}

// ---- helpers to build minimal PDFs in memory --------------------------------
function bytesFromLatin1(str) {
  const a = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) a[i] = str.charCodeAt(i) & 0xff;
  return a;
}
function concatBytes(parts) {
  let len = 0; for (const p of parts) len += p.length;
  const out = new Uint8Array(len); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
// Info dict with a literal-string /Title
function pdfWithLiteralTitle(title) {
  return bytesFromLatin1(`%PDF-1.4\n1 0 obj\n<< /Title (${title}) /Author (X) >>\nendobj\ntrailer\n<< /Info 1 0 R >>\n%%EOF`);
}
// Info dict with a UTF-16BE hex /Title (how Hebrew is stored)
function pdfWithHexUtf16Title(title) {
  let hex = 'FEFF';
  for (const ch of title) { const c = ch.charCodeAt(0); hex += ((c >> 8) & 0xff).toString(16).padStart(2, '0') + (c & 0xff).toString(16).padStart(2, '0'); }
  return bytesFromLatin1(`%PDF-1.4\n1 0 obj\n<< /Title <${hex}> >>\nendobj\n%%EOF`);
}
// XMP packet (UTF-8) with dc:title
function pdfWithXmpTitle(title) {
  const head = bytesFromLatin1('%PDF-1.5\n2 0 obj\n<< /Type /Metadata /Subtype /XML >>\nstream\n');
  const xmp = new TextEncoder().encode(
    `<?xpacket begin="﻿"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title}</rdf:li></rdf:Alt></dc:title></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`
  );
  const tail = bytesFromLatin1('\nendstream\nendobj\n%%EOF');
  return concatBytes([head, xmp, tail]);
}

console.log('isGenericPdfName:');
test('detects pure numbers', () => assert.strictEqual(isGenericPdfName('1.pdf'), true));
test('detects "unnamed"', () => assert.strictEqual(isGenericPdfName('unnamed.pdf'), true));
test('detects "document.pdf"', () => assert.strictEqual(isGenericPdfName('document.pdf'), true));
test('detects "doc3.pdf"', () => assert.strictEqual(isGenericPdfName('doc3.pdf'), true));
test('detects "scan0001.pdf"', () => assert.strictEqual(isGenericPdfName('scan0001.pdf'), true));
test('detects numeric-with-seps "03 - .pdf"', () => assert.strictEqual(isGenericPdfName('03 - .pdf'), true));
test('detects hash-like name', () => assert.strictEqual(isGenericPdfName('a1b2c3d4e5f60718.pdf'), true));
test('detects Hebrew "מסמך.pdf"', () => assert.strictEqual(isGenericPdfName('מסמך.pdf'), true));
test('detects "ללא שם.pdf"', () => assert.strictEqual(isGenericPdfName('ללא שם.pdf'), true));
test('empty is generic', () => assert.strictEqual(isGenericPdfName(''), true));
test('keeps real English name', () => assert.strictEqual(isGenericPdfName('Lecture 5 - Fluid Properties.pdf'), false));
test('keeps real Hebrew name', () => assert.strictEqual(isGenericPdfName('תרגול 1 - תכונות זורמים ולחץ.pdf'), false));
test('keeps "presentation on fluids" (not anchored)', () => assert.strictEqual(isGenericPdfName('presentation on fluids.pdf'), false));

console.log('cleanPdfTitle:');
test('strips "Microsoft Word - " prefix', () => assert.strictEqual(cleanPdfTitle('Microsoft Word - lecture5.docx'), 'lecture5'));
test('strips trailing .pdf', () => assert.strictEqual(cleanPdfTitle('My Title.pdf'), 'My Title'));
test('collapses whitespace', () => assert.strictEqual(cleanPdfTitle('  A   B \n C '), 'A B C'));
test('null → empty', () => assert.strictEqual(cleanPdfTitle(null), ''));

console.log('extractPdfTitle:');
test('literal-string title', () => assert.strictEqual(extractPdfTitle(pdfWithLiteralTitle('Fluid Mechanics Lecture')), 'Fluid Mechanics Lecture'));
test('literal with escaped parens', () => assert.strictEqual(extractPdfTitle(pdfWithLiteralTitle('Chapter \\(1\\) Intro')), 'Chapter (1) Intro'));
test('UTF-16BE hex Hebrew title', () => assert.strictEqual(extractPdfTitle(pdfWithHexUtf16Title('תכונות זורמים')), 'תכונות זורמים'));
test('XMP dc:title (UTF-8)', () => assert.strictEqual(extractPdfTitle(pdfWithXmpTitle('Thermodynamics Notes')), 'Thermodynamics Notes'));
test('XMP Hebrew dc:title', () => assert.strictEqual(extractPdfTitle(pdfWithXmpTitle('מבוא לתרמודינמיקה')), 'מבוא לתרמודינמיקה'));
test('rejects generic title "untitled"', () => assert.strictEqual(extractPdfTitle(pdfWithLiteralTitle('untitled')), ''));
test('rejects too-short title', () => assert.strictEqual(extractPdfTitle(pdfWithLiteralTitle('AB')), ''));
test('strips Word prefix from extracted title', () => assert.strictEqual(extractPdfTitle(pdfWithLiteralTitle('Microsoft Word - Real Subject')), 'Real Subject'));
test('non-PDF bytes → empty', () => assert.strictEqual(extractPdfTitle(bytesFromLatin1('not a pdf at all')), ''));
test('no metadata → empty', () => assert.strictEqual(extractPdfTitle(bytesFromLatin1('%PDF-1.4\n1 0 obj\n<< /Author (X) >>\nendobj\n%%EOF')), ''));
test('accepts ArrayBuffer input', () => assert.strictEqual(extractPdfTitle(pdfWithLiteralTitle('Buffer Title').buffer), 'Buffer Title'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
