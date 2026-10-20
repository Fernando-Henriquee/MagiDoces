import { describe, expect, it } from 'vitest';
import { buildPixPayload, crc16, normalizePixKey, pixText } from './pix';

/** Lê o BR Code como lista de campos (id → valor), para conferir a estrutura. */
function parse(payload: string): Map<string, string> {
  const fields = new Map<string, string>();
  let index = 0;
  while (index < payload.length) {
    const id = payload.slice(index, index + 2);
    const length = Number(payload.slice(index + 2, index + 4));
    fields.set(id, payload.slice(index + 4, index + 4 + length));
    index += 4 + length;
  }
  return fields;
}

describe('PIX copia e cola (BR Code)', () => {
  it('CRC-16/CCITT-FALSE confere com os valores de referência', () => {
    expect(crc16('123456789')).toBe('29B1');
    // Exemplo do Manual de Padrões para Iniciação do Pix (Banco Central).
    const example = '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304';
    expect(crc16(example)).toBe('1D3D');
  });

  it('reproduz o exemplo do manual quando não há valor', () => {
    const payload = buildPixPayload({ key: '123e4567-e12b-12d1-a456-426655440000', name: 'Fulano de Tal', city: 'Brasilia' });
    expect(payload).toBe(
      '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913FULANO DE TAL6008BRASILIA62070503***6304' +
        crc16('00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913FULANO DE TAL6008BRASILIA62070503***6304'),
    );
  });

  it('inclui chave, valor, nome e cidade com os tamanhos certos', () => {
    const payload = buildPixPayload({ key: ' GihRamos92@Gmail.com ', name: 'Magi Doces', city: 'São José dos Pinhais', amountCents: 3950 });
    const fields = parse(payload);
    expect(fields.get('00')).toBe('01');
    expect(parse(fields.get('26')!)).toEqual(new Map([['00', 'br.gov.bcb.pix'], ['01', 'gihramos92@gmail.com']]));
    expect(fields.get('52')).toBe('0000');
    expect(fields.get('53')).toBe('986');
    expect(fields.get('54')).toBe('39.50');
    expect(fields.get('58')).toBe('BR');
    expect(fields.get('59')).toBe('MAGI DOCES');
    expect(fields.get('60')).toBe('SAO JOSE DOS PI');
    expect(fields.get('62')).toBe('0503***');
    expect(payload.slice(-8, -4)).toBe('6304');
    expect(payload.slice(-4)).toBe(crc16(payload.slice(0, -4)));
  });

  it('valores em centavos sem erro de arredondamento', () => {
    expect(parse(buildPixPayload({ key: 'a@b.co', name: 'X', amountCents: 1 })).get('54')).toBe('0.01');
    expect(parse(buildPixPayload({ key: 'a@b.co', name: 'X', amountCents: 123456 })).get('54')).toBe('1234.56');
    expect(() => buildPixPayload({ key: 'a@b.co', name: 'X', amountCents: 12.5 })).toThrow();
  });

  it('sem cidade usa BRASIL; nome com símbolos é limpo', () => {
    const fields = parse(buildPixPayload({ key: 'a@b.co', name: 'Magi Doces (ambiente local) & Cia — confeitaria', city: null }));
    expect(fields.get('59')).toBe('MAGI DOCES AMBIENTE LOCAL');
    expect(fields.get('60')).toBe('BRASIL');
  });

  it('normaliza a chave como o DICT espera', () => {
    expect(normalizePixKey('+55 (11) 98765-4321')).toBe('+5511987654321');
    expect(normalizePixKey('123.456.789-09')).toBe('12345678909');
    expect(normalizePixKey('12.345.678/0001-95')).toBe('12345678000195');
    expect(normalizePixKey('123E4567-E12B-12D1-A456-426655440000')).toBe('123e4567-e12b-12d1-a456-426655440000');
    expect(pixText('Açaí  & Cia', 25)).toBe('ACAI CIA');
  });
});
