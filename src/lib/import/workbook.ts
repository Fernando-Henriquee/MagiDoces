import { sha256File } from './sha256';
import type { CellValue, SheetData, WorkbookData } from './types';

/**
 * Leitura de XLSX, XLS e CSV com SheetJS. Datas do Excel chegam como número serial
 * e são interpretadas conforme o papel da coluna. CSV é lido como texto puro
 * (UTF-8 ou Windows-1252) para preservar "12,50" e "05/03/2025".
 */

export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

type SheetJS = typeof import('xlsx');

function decodeText(buffer: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  if (!utf8.includes('�')) return utf8.replace(/^﻿/, '');
  return new TextDecoder('windows-1252').decode(buffer);
}

function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 10).join('\n');
  const counts = [';', ',', '\t'].map((delimiter) => ({ delimiter, count: sample.split(delimiter).length - 1 }));
  counts.sort((a, b) => b.count - a.count);
  return counts[0]?.count ? counts[0].delimiter : ',';
}

/** Escolhe a primeira linha com pelo menos 2 textos e maioria textual como cabeçalho. */
export function detectHeaderRow(rows: CellValue[][]): number {
  const limit = Math.min(rows.length, 20);
  for (let index = 0; index < limit; index += 1) {
    const cells = (rows[index] ?? []).filter((cell) => cell !== null && String(cell).trim() !== '');
    const texts = cells.filter((cell) => typeof cell === 'string' && !/^[\d.,\s/R$-]+$/.test(cell));
    if (texts.length >= 2 && texts.length >= cells.length * 0.6) return index;
  }
  return 0;
}

function trimRows(rows: CellValue[][]): CellValue[][] {
  let end = rows.length;
  while (end > 0 && (rows[end - 1] ?? []).every((cell) => cell === null || String(cell).trim() === '')) end -= 1;
  return rows.slice(0, end);
}

export function readWorkbookFromBuffer(XLSX: SheetJS, buffer: ArrayBuffer, fileName: string): SheetData[] {
  const isCSV = fileName.toLowerCase().endsWith('.csv');
  const book = isCSV
    ? XLSX.read(decodeText(buffer), { type: 'string', raw: true, FS: detectDelimiter(decodeText(buffer)) } as Parameters<SheetJS['read']>[1])
    : XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: false });
  return book.SheetNames.map((name) => {
    const sheet = book.Sheets[name];
    const allRows = sheet
      ? trimRows(
          XLSX.utils.sheet_to_json<CellValue[]>(sheet, { header: 1, raw: true, defval: null, blankrows: true }).map((row) =>
            row.map((cell) => (typeof cell === 'string' ? cell.trim() : cell)),
          ),
        )
      : [];
    return { name, headerRowIndex: detectHeaderRow(allRows), allRows };
  });
}

export async function readWorkbook(file: File): Promise<WorkbookData> {
  const lower = file.name.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    throw new Error('Formato não suportado. Envie um arquivo .xlsx, .xls ou .csv.');
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    throw new Error('Arquivo maior que 10 MB. Divida a planilha antes de importar.');
  }
  const buffer = await file.arrayBuffer();
  const [XLSX, sha256] = await Promise.all([import('xlsx'), sha256File(buffer)]);
  const sheets = readWorkbookFromBuffer(XLSX, buffer, file.name);
  if (sheets.every((sheet) => sheet.allRows.length === 0)) throw new Error('A planilha está vazia.');
  return { fileName: file.name, sizeBytes: file.size, sha256, sheets };
}

/** Cabeçalhos únicos (colunas sem nome viram "Coluna N"). */
export function sheetHeaders(sheet: SheetData): string[] {
  const headerRow = sheet.allRows[sheet.headerRowIndex] ?? [];
  const width = Math.max(headerRow.length, ...sheet.allRows.slice(sheet.headerRowIndex + 1, sheet.headerRowIndex + 50).map((r) => r.length));
  const seen = new Map<string, number>();
  return Array.from({ length: width }, (_, index) => {
    const base = String(headerRow[index] ?? '').trim() || `Coluna ${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

/** Linhas de dados com o número da linha na planilha (1-based). */
export function sheetDataRows(sheet: SheetData): Array<{ rowNumber: number; cells: CellValue[] }> {
  return sheet.allRows.slice(sheet.headerRowIndex + 1).map((cells, offset) => ({
    rowNumber: sheet.headerRowIndex + offset + 2,
    cells,
  }));
}
