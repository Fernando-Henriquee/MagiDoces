import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyExistingFingerprints, buildPreview, toRpcRows } from '../../src/lib/import/build';
import { suggestMapping } from '../../src/lib/import/detect';
import { sha256Bytes } from '../../src/lib/import/sha256';
import { DEFAULT_RULES, type ProductRef } from '../../src/lib/import/types';
import { readWorkbookFromBuffer, sheetDataRows, sheetHeaders } from '../../src/lib/import/workbook';
import { n, TestEnv } from './env';

/**
 * Integração completa: planilha XLSX → leitura → mapeamento sugerido → prévia →
 * payload → RPC import_sales_batch no banco → reprocessamento idempotente.
 */

let env: TestEnv;
let ana: string;
let biz: string;
let products: ProductRef[];

const serial = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000 + 25569;

function workbook(): ArrayBuffer {
  const rows = [
    ['Data', 'Cliente', 'Bolo de pote', 'Torta de limão', 'Morango cravejado', 'Surpresa de uva', 'Total', 'Pago'],
    [serial('2025-03-05'), 'Maria', 2, null, null, null, 24, 'sim'],
    [serial('2025-03-06'), 'João', null, 1, null, null, 15, 'não'],
    [serial('2025-03-06'), 'Ana', 1, 1, null, null, null, null],
    [serial('2025-03-07'), 'Maria', 1, null, null, 2, null, 'sim'],
    [serial('2025-03-07'), 'Maria', 1, null, null, 2, null, 'sim'],
    ['data ruim', 'Bia', 1, null, null, null, 12, 'sim'],
  ];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Vendas');
  const data = new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

beforeAll(async () => {
  env = await TestEnv.create();
  ana = await env.createUser('ana@example.com');
  biz = await env.createBusiness('Magi Doces', [{ userId: ana, role: 'owner' }]);
  products = await env.as(ana, async (s) => {
    await s.query(`update public.products set price_cents = 1200 where business_id = $1 and name = 'Bolo de pote'`, [biz]);
    await s.query(`update public.products set price_cents = 1500 where business_id = $1 and name = 'Torta de limão'`, [biz]);
    await s.query(`update public.products set price_cents = 900 where business_id = $1 and name = 'Surpresa de uva'`, [biz]);
    return s.query<ProductRef>(`select id, name, price_cents, active from public.products where business_id = $1`, [biz]);
  });
});

afterAll(async () => {
  await env.close();
});

async function runPipeline() {
  const buffer = workbook();
  const [sheet] = readWorkbookFromBuffer(XLSX, buffer, 'controle.xlsx');
  const headers = sheetHeaders(sheet!);
  const rows = sheetDataRows(sheet!);
  const customers = await env.as(ana, (s) => s.query<{ id: string; name: string }>(`select id, name from public.customers`));
  const { columns, layout } = suggestMapping(headers, rows.map((r) => r.cells), products);
  const rules = { ...DEFAULT_RULES, missingPrice: 'current_product_price' as const, paidWithoutDate: 'use_sale_date' as const };
  let preview = buildPreview({ headers, rows, columns, layout, rules, products, customers, productAliases: {}, overrides: {}, today: await env.today() });
  const fingerprints = preview.map((r) => r.fingerprint).filter((f): f is string => f !== null);
  const existing = await env.as(ana, (s) =>
    s.query<{ fingerprint: string }>(`select fingerprint from public.import_existing_fingerprints($1, $2)`, [biz, fingerprints]),
  );
  preview = applyExistingFingerprints(preview, new Set(existing.map((e) => e.fingerprint)));
  const result = await env.as(ana, (s) =>
    s.rpc<Record<string, number>>('import_sales_batch', {
      p_business_id: biz,
      p_batch: {
        file_name: 'controle.xlsx',
        file_sha256: sha256Bytes(new Uint8Array(buffer)),
        file_size_bytes: buffer.byteLength,
        sheet_name: sheet!.name,
        layout,
        mapping: columns,
        rules,
      },
      p_rows: toRpcRows(preview, new Set()),
    }),
  );
  return { preview, result };
}

describe('pipeline de importação', () => {
  it('importa a planilha com totais iguais aos da prévia', async () => {
    const { preview, result } = await runPipeline();
    expect(result).toMatchObject({ imported: 5, duplicates: 0, invalid: 1, created_customers: 3 });

    const previewTotal = preview.reduce((sum, row) => sum + (row.sale?.totalCents ?? 0), 0);
    const dbTotal = await env.as(ana, (s) => s.one<{ t: string }>(`select sum(total_cents) as t from public.sales`));
    expect(n(dbTotal.t)).toBe(previewTotal);
    expect(previewTotal).toBe(2400 + 1500 + 2700 + 3000 + 3000);

    const statuses = await env.as(ana, (s) =>
      s.query<{ customer_name: string; payment_status: string; payment_confirmation_pending: boolean }>(
        `select customer_name, payment_status, payment_confirmation_pending from public.v_sales order by sale_date, customer_name`,
      ),
    );
    expect(statuses).toEqual([
      { customer_name: 'Maria', payment_status: 'paid', payment_confirmation_pending: false },
      { customer_name: 'Ana', payment_status: 'pending', payment_confirmation_pending: true },
      { customer_name: 'João', payment_status: 'pending', payment_confirmation_pending: false },
      { customer_name: 'Maria', payment_status: 'paid', payment_confirmation_pending: false },
      { customer_name: 'Maria', payment_status: 'paid', payment_confirmation_pending: false },
    ]);
  });

  it('reprocessar o mesmo arquivo não cria nada novo', async () => {
    const { preview, result } = await runPipeline();
    expect(preview.filter((r) => r.status === 'duplicate')).toHaveLength(5);
    expect(result).toMatchObject({ imported: 0, duplicates: 5, created_customers: 0 });
    const counts = await env.as(ana, (s) =>
      s.one<{ sales: number; customers: number; payments: number }>(
        `select (select count(*)::int from public.sales) as sales, (select count(*)::int from public.customers) as customers,
                (select count(*)::int from public.payments) as payments`,
      ),
    );
    expect(counts).toEqual({ sales: 5, customers: 3, payments: 3 });
  });
});
