/**
 * PIX "copia e cola" estático (BR Code, padrão EMV do Banco Central), com valor.
 * O mesmo texto vira o QR code que o app do banco lê. Nada passa por terceiros:
 * o pagamento vai direto para a chave cadastrada nas Configurações.
 */

export interface PixInput {
  key: string;
  /** Nome exibido no app do banco (até 25 caracteres, sem acentos). */
  name: string;
  /** Cidade exibida (até 15 caracteres). Sem cidade cadastrada, usa "BRASIL". */
  city?: string | null;
  amountCents?: number | null;
  /** Identificador da cobrança (até 25 letras/números). Padrão "***" (sem identificador). */
  txid?: string;
}

function field(id: string, value: string): string {
  if (value.length > 99) throw new Error(`Campo PIX ${id} longo demais`);
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

/** Sem acentos e só caracteres seguros para o padrão (letras, números e espaço). */
export function pixText(value: string, max: number): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, max)
    .trim();
}

/**
 * Chave como o DICT espera: e-mail e aleatória em minúsculas, celular com +55,
 * CPF/CNPJ só com dígitos. Celular sem +55 é indistinguível de CPF: as
 * Configurações orientam a cadastrar no formato +55DDDNÚMERO.
 */
export function normalizePixKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.includes('@')) return trimmed.toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (trimmed.startsWith('+')) return `+${trimmed.replace(/\D/g, '')}`;
  if (/^[\d.\-/\s()]+$/.test(trimmed)) return trimmed.replace(/\D/g, '');
  return trimmed;
}

/** CRC-16/CCITT-FALSE (polinômio 0x1021, início 0xFFFF), exigido pelo BR Code. */
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(payload)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function formatAmount(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error('Valor PIX inválido');
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export function buildPixPayload(input: PixInput): string {
  const key = normalizePixKey(input.key);
  if (!key) throw new Error('Chave PIX vazia');
  const name = pixText(input.name, 25) || 'RECEBEDOR';
  const city = pixText(input.city ?? '', 15) || 'BRASIL';
  const txid = (input.txid ?? '***').replace(/[^A-Za-z0-9*]/g, '').slice(0, 25) || '***';

  const account = field('00', 'br.gov.bcb.pix') + field('01', key);
  let payload =
    field('00', '01') +
    field('26', account) +
    field('52', '0000') +
    field('53', '986') +
    (input.amountCents ? field('54', formatAmount(input.amountCents)) : '') +
    field('58', 'BR') +
    field('59', name) +
    field('60', city) +
    field('62', field('05', txid));
  payload += '6304';
  return payload + crc16(payload);
}
