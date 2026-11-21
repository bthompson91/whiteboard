// Minimal .docx writer: builds a Word document as a zip of XML parts,
// with no dependencies. Entries are stored, not compressed — the files
// are tiny, and stored entries keep the XML readable in the bytes,
// which is what the tests assert on. Word and LibreOffice both open
// stored entries without complaint.
//
// The shape follows a real Word file: [Content_Types].xml, the package
// and document relationships, document.xml with an A4 section, styles
// (Calibri default, Table Grid), a font table, a header, a footer, and
// core/app properties.

export interface DocxRun {
  text?: string;
  field?: 'PAGE' | 'NUMPAGES';
  bold?: boolean;
  size?: number; // half-points, e.g. 28 = 14pt
  font?: string;
}

export interface DocxParagraph {
  runs: DocxRun[];
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
  size?: number; // half-points; the default for every run in the paragraph
}

export interface DocxCell {
  paragraphs: DocxParagraph[];
  gridSpan?: number;
  width?: number; // twips
}

export interface DocxTable {
  widths: number[]; // twips, one per grid column
  rows: DocxCell[][];
}

export type DocxBlock = { type: 'paragraph'; paragraph: DocxParagraph } | { type: 'table'; table: DocxTable };

export interface DocxDocument {
  title: string;
  header: DocxParagraph[];
  footer: DocxParagraph[];
  body: DocxBlock[];
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const xmlAttr = (s: string) => xmlEscape(s).replace(/"/g, '&quot;');

const runProps = (run: DocxRun, paragraph: DocxParagraph) => {
  const bold = run.bold ?? paragraph.bold;
  const size = run.size ?? paragraph.size;
  const font = run.font ?? 'Calibri';
  return `<w:rPr><w:rFonts w:ascii="${xmlAttr(font)}" w:hAnsi="${xmlAttr(font)}"/>${bold ? '<w:b/>' : ''}${size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : ''}</w:rPr>`;
};

function runXml(run: DocxRun, paragraph: DocxParagraph): string {
  const props = runProps(run, paragraph);
  if (run.field) {
    return `<w:r>${props}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${props}<w:instrText xml:space="preserve"> ${run.field} </w:instrText></w:r><w:r>${props}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${props}<w:t>1</w:t></w:r><w:r>${props}<w:fldChar w:fldCharType="end"/></w:r>`;
  }
  return `<w:r>${props}<w:t xml:space="preserve">${xmlEscape(run.text ?? '')}</w:t></w:r>`;
}

function paragraphXml(p: DocxParagraph): string {
  const align = p.align && p.align !== 'left' ? `<w:jc w:val="${p.align}"/>` : '';
  const markProps = p.bold || p.size ? `<w:rPr>${p.bold ? '<w:b/>' : ''}${p.size ? `<w:sz w:val="${p.size}"/><w:szCs w:val="${p.size}"/>` : ''}</w:rPr>` : '';
  return `<w:p><w:pPr>${align}${markProps}</w:pPr>${p.runs.map(r => runXml(r, p)).join('')}</w:p>`;
}

const cellBorders = '<w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tcBorders>';

function tableXml(t: DocxTable): string {
  const borders = '<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders>';
  const total = t.widths.reduce((a, b) => a + b, 0);
  const rows = t.rows
    .map(
      row =>
        `<w:tr>${row
          .map(cell => {
            const width = cell.width ?? 0;
            const span = cell.gridSpan && cell.gridSpan > 1 ? `<w:gridSpan w:val="${cell.gridSpan}"/>` : '';
            return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${span}${cellBorders}</w:tcPr>${cell.paragraphs.map(paragraphXml).join('')}</w:tc>`;
          })
          .join('')}</w:tr>`
    )
    .join('');
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${total}" w:type="dxa"/>${borders}<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${t.widths.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows}</w:tbl>`;
}

function documentXml(doc: DocxDocument): string {
  const blocks = doc.body
    .map(block => (block.type === 'paragraph' ? paragraphXml(block.paragraph) : tableXml(block.table)))
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${blocks}<w:sectPr><w:headerReference w:type="default" r:id="rId8"/><w:footerReference w:type="default" r:id="rId9"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:space="708"/></w:sectPr></w:body></w:document>`;
}

function headerXml(paragraphs: DocxParagraph[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:hdr xmlns:w="${W}" xmlns:r="${R}">${paragraphs.map(paragraphXml).join('')}</w:hdr>`;
}

function footerXml(paragraphs: DocxParagraph[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr xmlns:w="${W}" xmlns:r="${R}">${paragraphs.map(paragraphXml).join('')}</w:ftr>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;

const PACKAGE_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/><Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-AU"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="200" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="table" w:default="1" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:uiPriority w:val="39"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style></w:styles>`;

const FONT_TABLE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:fonts xmlns:w="${W}"><w:font w:name="Calibri"><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font></w:fonts>`;

const coreXml = (title: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(title)}</dc:title><dc:creator>Whiteboard</dc:creator></cp:coreProperties>`;

const APP_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Whiteboard</Application></Properties>`;

// --- Zip (stored entries) ---

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

export function zipStore(entries: ZipEntry[]): Uint8Array {
  const now = new Date();
  const dosTime = ((now.getHours() & 0x1f) << 11) | ((now.getMinutes() & 0x3f) << 5) | ((Math.floor(now.getSeconds() / 2)) & 0x1f);
  const dosDate = (((now.getFullYear() - 1980) & 0x7f) << 9) | (((now.getMonth() + 1) & 0xf) << 5) | (now.getDate() & 0x1f);
  const out: number[] = [];
  const pushU16 = (v: number) => out.push(v & 0xff, (v >> 8) & 0xff);
  const pushU32 = (v: number) => out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
  const central: { name: Uint8Array; crc: number; offset: number; size: number }[] = [];
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const crc = crc32(entry.data);
    const offset = out.length;
    out.push(0x50, 0x4b, 0x03, 0x04); // local file header
    pushU16(20); // version needed
    pushU16(0); // flags
    pushU16(0); // method: stored
    pushU16(dosTime);
    pushU16(dosDate);
    pushU32(crc);
    pushU32(entry.data.length);
    pushU32(entry.data.length);
    pushU16(name.length);
    pushU16(0); // extra length
    out.push(...name);
    out.push(...entry.data);
    central.push({ name, crc, offset, size: entry.data.length });
  }
  const centralOffset = out.length;
  for (const entry of central) {
    out.push(0x50, 0x4b, 0x01, 0x02); // central directory header
    pushU16(20); // version made by
    pushU16(20); // version needed
    pushU16(0); // flags
    pushU16(0); // method: stored
    pushU16(dosTime);
    pushU16(dosDate);
    pushU32(entry.crc);
    pushU32(entry.size);
    pushU32(entry.size);
    pushU16(entry.name.length);
    pushU16(0); // extra length
    pushU16(0); // comment length
    pushU16(0); // disk number
    pushU16(0); // internal attributes
    pushU32(0); // external attributes
    pushU32(entry.offset);
    out.push(...entry.name);
  }
  const centralSize = out.length - centralOffset;
  out.push(0x50, 0x4b, 0x05, 0x06); // end of central directory
  pushU16(0); // disk number
  pushU16(0); // central directory disk
  pushU16(central.length);
  pushU16(central.length);
  pushU32(centralSize);
  pushU32(centralOffset);
  pushU16(0); // comment length
  return Uint8Array.from(out);
}

export function buildDocx(doc: DocxDocument): Uint8Array {
  const encode = (s: string) => new TextEncoder().encode(s);
  return zipStore([
    { name: '[Content_Types].xml', data: encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: encode(PACKAGE_RELS) },
    { name: 'word/document.xml', data: encode(documentXml(doc)) },
    { name: 'word/_rels/document.xml.rels', data: encode(DOCUMENT_RELS) },
    { name: 'word/styles.xml', data: encode(STYLES) },
    { name: 'word/fontTable.xml', data: encode(FONT_TABLE) },
    { name: 'word/header1.xml', data: encode(headerXml(doc.header)) },
    { name: 'word/footer1.xml', data: encode(footerXml(doc.footer)) },
    { name: 'docProps/core.xml', data: encode(coreXml(doc.title)) },
    { name: 'docProps/app.xml', data: encode(APP_XML) },
  ]);
}
