import { describe, expect, it } from 'vitest';
import { crc32, pdfBytes, xlsxBytes } from './exporters';

const decode = (b: Uint8Array) => new TextDecoder().decode(b);

/** Reads a zip back through its central directory, the way an unzip tool does. */
function unzip(zip: Uint8Array): Record<string, string> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const start = local + 30 + view.getUint16(local + 26, true);
    const data = zip.subarray(start, start + size);
    expect(crc32(data)).toBe(view.getUint32(at + 16, true));
    files[decode(zip.subarray(at + 46, at + 46 + nameLength))] = decode(data);
    at += 46 + nameLength;
  }
  return files;
}

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('xlsxBytes', () => {
  const files = unzip(
    xlsxBytes('Vendors & Planners', [
      ['Money'],
      ['Collected (INR)', '662000.00'],
      ['Vendor', '=HYPERLINK("x")<b>&'],
      [],
      ['Bookings', 35, null],
    ]),
  );

  it('is a workbook of one sheet whose parts all read back intact', () => {
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    expect(files['xl/workbook.xml']).toContain('name="Vendors &amp; Planners"');
  });

  it('writes money as a number, and text as escaped text that is never a formula', () => {
    const sheet = files['xl/worksheets/sheet1.xml'];
    expect(sheet).toContain('<c r="B2"><v>662000</v></c>');
    expect(sheet).toContain('<c r="B5"><v>35</v></c>');
    expect(sheet).toContain('t="inlineStr"><is><t xml:space="preserve">=HYPERLINK(&quot;x&quot;)&lt;b&gt;&amp;</t>');
    expect(sheet).not.toContain('<f>');
  });

  it('sets a section heading in bold', () => {
    expect(files['xl/worksheets/sheet1.xml']).toContain('<c r="A1" s="1" t="inlineStr">');
  });
});

describe('pdfBytes', () => {
  const pdf = decode(
    pdfBytes('WOW Reports: Overview', 'Period (all time)', [
      ['Money'],
      ['Held in escrow (₹)', '97200.00'],
      ['Provider', 'Dream (Decor) \\ Co – Ltd'],
      ['Script', 'विवाह'],
    ]),
  );

  it('has a cross-reference table whose offsets land on their objects', () => {
    const start = Number(pdf.match(/startxref\n(\d+)/)![1]);
    expect(pdf.slice(start, start + 4)).toBe('xref');
    const offsets = [...pdf.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets.length).toBeGreaterThan(4);
    offsets.forEach((offset, i) => expect(pdf.startsWith(`${i + 1} 0 obj`, offset)).toBe(true));
  });

  it('escapes what would end a string, and replaces what Helvetica cannot draw', () => {
    expect(pdf).toContain('(Dream \\(Decor\\) \\\\ Co - Ltd)');
    expect(pdf).toContain('(Held in escrow \\(Rs\\))');
    // Five code points (va, i, va, aa, ha), none of them in WinAnsi.
    expect(pdf).toContain('(?????)');
    expect(pdf).toContain('(97,200)');
    expect(pdf).toMatch(/^[\x00-\x7f]*$/);
  });

  it('turns a wide table to landscape', () => {
    const wide = decode(pdfBytes('t', 's', [['a', 'b', 'c', 'd', 'e', 'f']]));
    expect(wide).toContain('/MediaBox [0 0 842 595]');
    expect(pdf).toContain('/MediaBox [0 0 595 842]');
  });
});
