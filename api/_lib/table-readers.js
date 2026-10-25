/**
 * table-readers.js
 * Turns the two "not really a spreadsheet" formats the Cluster Head gets
 * into the same thing ExcelJS gives for an .xlsx: a list of rows, each a
 * list of cell strings, with merged cells filled in.
 *
 *   readHtmlGrid()  the ERP's "export to Excel", which is an HTML <table>
 *                   saved as .xls. The CGPA / GPA & Credits export has a
 *                   two-row header built from rowspan and colspan, so the
 *                   spans have to be honoured or every column after
 *                   "Semester I" lands under the wrong heading.
 *   readDocxGrid()  the Proctorial Board notice, a Word document with one
 *                   table per case.
 *
 * MERGED CELLS
 * A merged cell's text is repeated into every position it covers, across
 * (colspan / gridSpan) and down (rowspan / vMerge). That is what ExcelJS
 * reports for a merged range in an .xlsx, so a parser sees the same grid
 * whichever of the three formats the file arrived in. A CSV cannot express
 * a merge at all; parsers forward-fill where it matters.
 *
 * Neither reader interprets anything as markup or runs anything: tags are
 * only used to find row and cell boundaries, and all text is entity-decoded
 * into plain strings. No dependency is added for either format. The .docx
 * reader unzips with node:zlib, which is all a Word file needs.
 */

import { inflateRawSync } from 'node:zlib';
import { ApiError } from './http-response.js';

const MAX_SPAN = 200;

/** &amp; &lt; &#233; &#x2013; and friends -> text. Unknown names are left alone. */
export function decodeEntities(text) {
  return String(text ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => safeCodePoint(Number(code)));
}

function safeCodePoint(code) {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

/** Collapses whitespace inside each line and drops empty lines. Lines survive as "\n". */
function tidyCell(raw) {
  return decodeEntities(raw)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function spanValue(attrs, name) {
  const match = new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, 'i').exec(attrs ?? '');
  const value = match ? Number(match[1]) : 1;
  return Math.min(Math.max(Number.isFinite(value) ? value : 1, 1), MAX_SPAN);
}

// =====================================================================
// HTML tables
// =====================================================================
/**
 * Every <table> in the document, in order, flattened into one list of
 * rows. Rows with nothing in them are dropped. A table nested inside a
 * cell contributes its own rows rather than being mashed into the cell.
 */
export function readHtmlGrid(html) {
  const rows = [];
  const tables = [];
  const top = () => tables[tables.length - 1];

  // Cells whose rowspan reaches into later rows, per column.
  const occupyCarried = (table) => {
    while (table.carry[table.col]?.remaining > 0) {
      table.row[table.col] = table.carry[table.col].text;
      table.carry[table.col].remaining -= 1;
      table.col += 1;
    }
  };

  const finishCell = (table) => {
    if (!table.cell) return;
    if (!table.row) {
      table.row = [];
      table.col = 0;
    }
    occupyCarried(table);
    const text = tidyCell(table.cell.text);
    for (let i = 0; i < table.cell.colspan; i += 1) {
      table.row[table.col + i] = text;
      if (table.cell.rowspan > 1) {
        table.carry[table.col + i] = { text, remaining: table.cell.rowspan - 1 };
      }
    }
    table.col += table.cell.colspan;
    table.cell = null;
  };

  const finishRow = (table) => {
    finishCell(table);
    if (!table.row) return;
    // A rowspan from above can sit to the right of this row's last cell.
    for (let c = table.col; c < table.carry.length; c += 1) {
      if (table.carry[c]?.remaining > 0) {
        table.row[c] = table.carry[c].text;
        table.carry[c].remaining -= 1;
      }
    }
    const cells = Array.from(table.row, (value) => value ?? '');
    if (cells.some((value) => value !== '')) rows.push(cells);
    table.row = null;
  };

  // Comments are skipped whole; every other tag only marks a boundary.
  const TAG = /<!--[\s\S]*?-->|<(\/?)([a-z][a-z0-9]*)\b([^>]*)>/gi;
  let last = 0;
  let match;
  while ((match = TAG.exec(html))) {
    const between = html.slice(last, match.index);
    last = TAG.lastIndex;
    const table = top();
    // Source formatting (newlines, indentation) is just a space; only
    // <br> and block ends below become real line breaks.
    if (table?.cell && between) table.cell.text += between.replace(/\s+/g, ' ');
    if (!match[2]) continue;

    const closing = match[1] === '/';
    const name = match[2].toLowerCase();

    if (name === 'table') {
      if (!closing) {
        tables.push({ carry: [], row: null, col: 0, cell: null });
      } else if (tables.length) {
        finishRow(tables.pop());
      }
      continue;
    }
    if (!table) continue;

    if (name === 'tr') {
      finishRow(table);
      if (!closing) {
        table.row = [];
        table.col = 0;
      }
    } else if (name === 'td' || name === 'th') {
      finishCell(table);
      if (!closing) {
        table.cell = {
          text: '',
          colspan: spanValue(match[3], 'colspan'),
          rowspan: spanValue(match[3], 'rowspan')
        };
      }
    } else if (table.cell && (name === 'br' || (closing && ['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(name)))) {
      table.cell.text += '\n';
    }
  }
  while (tables.length) finishRow(tables.pop());
  return rows;
}

// =====================================================================
// Word documents
// =====================================================================
/** One entry out of a .zip (a .docx is one), without a zip dependency. */
function readZipEntry(buffer, wantedName) {
  const fail = () => new ApiError('That file could not be opened as a Word document. Save it as .docx and try again.', 400);
  try {
    // End-of-central-directory record: in the last 22 bytes, or up to 64 KB
    // earlier when the archive carries a comment.
    const floor = Math.max(0, buffer.length - 22 - 0xffff);
    let eocd = -1;
    for (let i = buffer.length - 22; i >= floor; i -= 1) {
      if (buffer.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw fail();

    const entries = buffer.readUInt16LE(eocd + 10);
    let offset = buffer.readUInt32LE(eocd + 16);
    for (let n = 0; n < entries; n += 1) {
      if (buffer.readUInt32LE(offset) !== 0x02014b50) throw fail();
      const method = buffer.readUInt16LE(offset + 10);
      const compressedSize = buffer.readUInt32LE(offset + 20);
      const nameLength = buffer.readUInt16LE(offset + 28);
      const extraLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      const localOffset = buffer.readUInt32LE(offset + 42);
      const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

      if (name === wantedName) {
        if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw fail();
        // Sizes come from the central directory: the local header may
        // leave them zero when a data descriptor follows the data.
        const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
        const data = buffer.subarray(start, start + compressedSize);
        if (method === 0) return data;
        if (method === 8) return inflateRawSync(data, { maxOutputLength: 32 * 1024 * 1024 });
        throw fail();
      }
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return null;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw fail();
  }
}

/**
 * Every table in the document body, in order, flattened into one list of
 * rows. Paragraphs inside a cell become lines ("B Tech ECE\nSec- F1").
 * Text outside tables (headings, signatures) is not returned.
 */
export function readDocxGrid(buffer) {
  const xmlBuffer = readZipEntry(buffer, 'word/document.xml');
  if (!xmlBuffer) {
    throw new ApiError('That file is not a Word document (no word/document.xml inside). Save it as .docx and try again.', 400);
  }
  const xml = xmlBuffer.toString('utf8');

  const out = [];
  const tables = [];
  const top = () => tables[tables.length - 1];

  const finishTable = (table) => {
    const grid = [];
    for (const row of table.rows) {
      const cells = [];
      let col = 0;
      for (const cell of row) {
        let text = tidyCell(cell.text);
        // A vertically merged continuation shows the text of the cell
        // above it, which is where Word keeps the merged cell's content.
        if (cell.vMerge === 'continue' && grid.length) {
          text = grid[grid.length - 1][col] ?? '';
        }
        for (let i = 0; i < cell.span; i += 1) cells[col + i] = text;
        col += cell.span;
      }
      grid.push(Array.from(cells, (value) => value ?? ''));
    }
    for (const cells of grid) {
      if (cells.some((value) => value !== '')) out.push(cells);
    }
  };

  // w:t carries the text; everything else only marks structure. \b stops
  // w:tbl matching w:tblPr, w:p matching w:pPr, and so on.
  const TOKEN = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<(\/?)(w:tbl|w:tr|w:tc|w:p|w:tab|w:br|w:cr|w:gridSpan|w:vMerge)\b([^>]*?)(\/?)>/g;
  let match;
  while ((match = TOKEN.exec(xml))) {
    const table = top();
    if (match[1] !== undefined) {
      if (table?.cell) table.cell.text += match[1];
      continue;
    }
    const closing = match[2] === '/';
    const selfClosing = match[5] === '/';
    const name = match[3];
    const attrs = match[4] ?? '';

    if (name === 'w:tbl') {
      if (!closing && !selfClosing) tables.push({ rows: [], row: null, cell: null });
      else if (closing && tables.length) finishTable(tables.pop());
      continue;
    }
    if (!table) continue;

    if (name === 'w:tr') {
      if (!closing && !selfClosing) table.row = [];
      else if (closing && table.row) {
        table.rows.push(table.row);
        table.row = null;
      }
    } else if (name === 'w:tc') {
      if (!closing && !selfClosing) {
        table.cell = { text: '', span: 1, vMerge: null };
      } else if (closing && table.cell) {
        (table.row ?? (table.row = [])).push(table.cell);
        table.cell = null;
      }
    } else if (!table.cell) {
      continue;
    } else if (name === 'w:p') {
      if (closing) table.cell.text += '\n';
    } else if (name === 'w:tab') {
      table.cell.text += ' ';
    } else if (name === 'w:br' || name === 'w:cr') {
      table.cell.text += '\n';
    } else if (name === 'w:gridSpan') {
      table.cell.span = spanValue(attrs, 'w:val');
    } else if (name === 'w:vMerge') {
      table.cell.vMerge = /w:val\s*=\s*["']restart["']/.test(attrs) ? 'restart' : 'continue';
    }
  }
  while (tables.length) finishTable(tables.pop());
  return out;
}
