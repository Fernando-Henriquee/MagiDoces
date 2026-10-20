import { describe, expect, it } from 'vitest';
import { accessCodeProblem } from './access-code';

describe('código de consulta', () => {
  it('aceita 4 números não óbvios', () => {
    for (const code of ['4826', '0502', '1357', '9021']) expect(accessCodeProblem(code), code).toBeNull();
  });

  it('recusa formato errado, repetições e sequências (iguais ao banco)', () => {
    for (const code of ['', '123', '12345', '12a4', ' 482']) expect(accessCodeProblem(code), code).toMatch(/4 números/);
    for (const code of ['0000', '7777', '1234', '0123', '7890', '8901', '9012', '4321', '9876', '0987', '1098']) {
      expect(accessCodeProblem(code), code).toMatch(/menos óbvio/);
    }
  });
});
