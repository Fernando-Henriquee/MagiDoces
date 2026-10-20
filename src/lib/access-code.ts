/**
 * Código de consulta do link de compras: 4 números, sem repetições (1111) nem
 * sequências (1234, 9876). Mesma regra de private.is_weak_access_code no banco.
 */
export function accessCodeProblem(code: string): string | null {
  if (!/^\d{4}$/.test(code)) return 'O código precisa ter 4 números.';
  if (/^(\d)\1{3}$/.test(code) || '0123456789012'.includes(code) || '9876543210987'.includes(code)) {
    return 'Escolha um código menos óbvio (evite sequências como 1234 ou repetições como 1111).';
  }
  return null;
}
