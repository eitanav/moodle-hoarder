// Minimal store-only (no compression) ZIP writer.
// Most course files (PDF/docx/pptx/zip) are already compressed, so store is fine.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d = new Date()) {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

// Replace any non-printable-ASCII codepoint with '_'. Used as a Cp437/ASCII
// fallback for the LFH/CDH filename when the real path contains Hebrew or
// other Unicode. Slashes are preserved (still valid folder separators in ZIP).
function asciiFallback(s) {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    out += (cp >= 0x20 && cp <= 0x7e) ? ch : '_';
  }
  return out;
}

// Info-ZIP Unicode Path Extra Field (0x7075). Convention: the LFH filename
// is the local-codepage (here ASCII) version, and this extra field carries
// the real UTF-8 name plus CRC32 of the LFH filename so extractors can
// validate the pairing.
// Layout: 2B HeaderID | 2B DataSize | 1B Version | 4B NameCRC32 | NB UnicodeName
function makeUnicodePathExtra(lfhCRC, utf8NameBytes) {
  const dataLen = 5 + utf8NameBytes.length;
  const buf = new Uint8Array(4 + dataLen);
  const dv = new DataView(buf.buffer);
  dv.setUint16(0, 0x7075, true);
  dv.setUint16(2, dataLen, true);
  dv.setUint8(4, 1);
  dv.setUint32(5, lfhCRC, true);
  buf.set(utf8NameBytes, 9);
  return buf;
}

// files: Array<{ path: string, blob: Blob }>
async function buildZip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const { time, date } = dosDateTime();

  for (const { path, blob } of files) {
    const data = new Uint8Array(await blob.arrayBuffer());

    // ASCII fallback in the LFH; UTF-8 unicode name only in the extra field.
    // This is what JSZip / Info-ZIP / 7-Zip emit and what Windows Explorer
    // expects. Setting the UTF-8 flag AND adding the extra field made some
    // Windows builds refuse to open the archive.
    const utf8Name = encoder.encode(path);
    const ascii = asciiFallback(path);
    const isAscii = ascii === path;
    const lfhName = isAscii ? utf8Name : encoder.encode(ascii);
    const lfhCRC = isAscii ? 0 : crc32(lfhName);
    const extra = isAscii ? new Uint8Array(0) : makeUnicodePathExtra(lfhCRC, utf8Name);

    const crc = crc32(data);

    const lfh = new Uint8Array(30 + lfhName.length + extra.length);
    const lv = new DataView(lfh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);       // no UTF-8 flag (LFH name is ASCII-only)
    lv.setUint16(8, 0, true);       // method = store
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, lfhName.length, true);
    lv.setUint16(28, extra.length, true);
    lfh.set(lfhName, 30);
    if (extra.length) lfh.set(extra, 30 + lfhName.length);
    chunks.push(lfh, data);

    const cdh = new Uint8Array(46 + lfhName.length + extra.length);
    const cv = new DataView(cdh.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);       // no UTF-8 flag
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, lfhName.length, true);
    cv.setUint16(30, extra.length, true);
    cv.setUint32(42, offset, true);
    cdh.set(lfhName, 46);
    if (extra.length) cdh.set(extra, 46 + lfhName.length);
    central.push(cdh);

    offset += lfh.length + data.length;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) {
    chunks.push(c);
    cdSize += c.length;
  }

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdStart, true);
  chunks.push(eocd);

  return new Blob(chunks, { type: 'application/zip' });
}

self.buildZip = buildZip;
