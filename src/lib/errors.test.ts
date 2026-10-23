import { describe, expect, it } from 'vitest';
import { describeError, OfflineError } from './errors';

describe('mensagens de erro', () => {
  it('traduz erros de login do Supabase', () => {
    expect(describeError({ message: 'Invalid login credentials' })).toBe('E-mail ou senha incorretos.');
    expect(describeError({ message: 'Email logins are disabled', code: 'email_provider_disabled' })).toMatch(/login por e-mail está desativado/);
  });

  it('falha de rede e modo offline têm mensagens próprias', () => {
    expect(describeError(new TypeError('Failed to fetch'))).toMatch(/Falha de conexão/);
    expect(describeError(new OfflineError())).toMatch(/Nada foi gravado/);
  });

  it('mensagens técnicas viram texto genérico; as das RPCs passam', () => {
    expect(describeError({ message: 'permission denied for table sales', code: '42501' })).toBe('Você não tem permissão para esta operação.');
    expect(describeError({ message: 'Informe o motivo do cancelamento.', code: '22023' })).toBe('Informe o motivo do cancelamento.');
  });
});
