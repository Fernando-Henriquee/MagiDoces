import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Download, HardDrive, Share, Trash2, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { ErrorState, LoadingBlock } from '@/components/ui/states';
import { useBusinessMembers, useSaveBusinessSettings } from '@/data/settings';
import { useAuth, wipeLocalData } from '@/features/auth/auth-context';
import { ROLE_LABELS, useBusiness } from '@/features/business/business-context';
import { formatDateBR } from '@/lib/dates';
import { env } from '@/lib/env';
import { CACHE_MAX_AGE_MS } from '@/lib/query-cache';
import { isIOS, useInstallPrompt } from './install-prompt';

export const BRAZIL_TIMEZONES: Array<{ value: string; label: string }> = [
  { value: 'America/Sao_Paulo', label: 'Horário de Brasília' },
  { value: 'America/Fortaleza', label: 'Fortaleza (igual a Brasília)' },
  { value: 'America/Recife', label: 'Recife (igual a Brasília)' },
  { value: 'America/Belem', label: 'Belém (igual a Brasília)' },
  { value: 'America/Manaus', label: 'Manaus (−1 h)' },
  { value: 'America/Cuiaba', label: 'Cuiabá (−1 h)' },
  { value: 'America/Porto_Velho', label: 'Porto Velho (−1 h)' },
  { value: 'America/Rio_Branco', label: 'Rio Branco (−2 h)' },
  { value: 'America/Noronha', label: 'Fernando de Noronha (+1 h)' },
];

const schema = z.object({
  name: z.string().trim().min(1, 'Informe o nome do negócio.').max(120, 'Use no máximo 120 caracteres.'),
  timezone: z.string().min(1, 'Escolha o fuso horário.'),
  default_due_day: z.number({ message: 'Informe um dia entre 1 e 31.' }).int('Informe um dia inteiro.').min(1, 'Mínimo 1.').max(31, 'Máximo 31.'),
  pix_key: z.string().trim().max(140, 'Use no máximo 140 caracteres.'),
  charge_message_footer: z.string().trim().max(500, 'Use no máximo 500 caracteres.'),
});

type Values = z.infer<typeof schema>;

function BusinessForm() {
  const { business, can } = useBusiness();
  const editable = can('settings');
  const save = useSaveBusinessSettings();
  const toValues = (): Values => ({
    name: business.name,
    timezone: business.timezone,
    default_due_day: business.default_due_day,
    pix_key: business.pix_key ?? '',
    charge_message_footer: business.charge_message_footer ?? '',
  });
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues() });
  const { reset } = form;

  useEffect(() => {
    reset(toValues());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business, reset]);

  const timezones = BRAZIL_TIMEZONES.some((tz) => tz.value === business.timezone)
    ? BRAZIL_TIMEZONES
    : [{ value: business.timezone, label: business.timezone }, ...BRAZIL_TIMEZONES];

  // Erros já são exibidos pelo toast de useWrite; a rejeição é absorvida aqui.
  const onSubmit = form.handleSubmit((values) =>
    save
      .mutateAsync({
        name: values.name,
        timezone: values.timezone,
        default_due_day: values.default_due_day,
        pix_key: values.pix_key || null,
        charge_message_footer: values.charge_message_footer || null,
      })
      .catch(() => undefined),
  );

  const errors = form.formState.errors;
  return (
    <Card>
      <CardHeader
        title="Negócio"
        description={editable ? 'Dados usados em vencimentos, relatórios e mensagens de cobrança.' : 'Somente sócias/administradoras podem alterar estes dados.'}
      />
      <form onSubmit={onSubmit} className="space-y-4 p-4" noValidate>
        <fieldset disabled={!editable || save.isPending} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Nome do negócio" required error={errors.name?.message} className="sm:col-span-2">
            <Input autoComplete="organization" {...form.register('name')} />
          </Field>
          <Field label="Fuso horário operacional" hint="Define o “hoje” de vencimentos e relatórios." error={errors.timezone?.message}>
            <Select {...form.register('timezone')}>
              {timezones.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Dia padrão de vencimento" hint="Usado como sugestão de vencimento (ex.: dia 10)." error={errors.default_due_day?.message}>
            <Input type="number" inputMode="numeric" min={1} max={31} {...form.register('default_due_day', { valueAsNumber: true })} />
          </Field>
          <Field label="Chave PIX" hint="Aparece no resumo de cobrança enviado pelo WhatsApp." error={errors.pix_key?.message} className="sm:col-span-2">
            <Input autoComplete="off" {...form.register('pix_key')} />
          </Field>
          <Field
            label="Rodapé da mensagem de cobrança"
            hint="Opcional. Sem texto, usamos: “Qualquer dúvida, é só chamar. Agradecemos a preferência!”"
            error={errors.charge_message_footer?.message}
            className="sm:col-span-2"
          >
            <Textarea rows={2} {...form.register('charge_message_footer')} />
          </Field>
        </fieldset>
        {editable ? (
          <div className="flex justify-end">
            <Button type="submit" loading={save.isPending} disabled={!form.formState.isDirty}>
              Salvar configurações
            </Button>
          </div>
        ) : null}
      </form>
    </Card>
  );
}

function Members() {
  const { user } = useAuth();
  const members = useBusinessMembers();
  return (
    <Card>
      <CardHeader title="Pessoas com acesso" description="Cada pessoa tem a própria conta e enxerga os mesmos dados do negócio." />
      <div className="p-4">
        {members.isPending ? <LoadingBlock rows={2} /> : null}
        {members.isError && !members.data ? <ErrorState error={members.error} onRetry={() => void members.refetch()} /> : null}
        <ul className="divide-y divide-line">
          {members.data?.map((member) => (
            <li key={member.user_id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {member.display_name || 'Sem nome'} {member.user_id === user?.id ? <span className="text-muted">(você)</span> : null}
                </p>
                <p className="text-xs text-muted">Desde {formatDateBR(member.created_at.slice(0, 10))}</p>
              </div>
              <Badge tone={member.role === 'owner' ? 'brand' : member.role === 'editor' ? 'info' : 'neutral'}>{ROLE_LABELS[member.role]}</Badge>
            </li>
          ))}
        </ul>
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-subtle px-3 py-2 text-xs text-ink-soft">
          <Users className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Não há cadastro público. Novas pessoas são convidadas e associadas ao negócio por um processo administrativo seguro, feito no
          painel do Supabase (veja docs/SUPABASE.md).
        </p>
      </div>
    </Card>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

const ENV_LABELS: Record<string, string> = {
  local: 'Local (testes)',
  development: 'Desenvolvimento',
  preview: 'Pré-visualização',
  production: 'Produção',
};

function AppSection() {
  const install = useInstallPrompt();
  const [confirmWipe, setConfirmWipe] = useState(false);
  const storage = useQuery({
    queryKey: ['device-storage'],
    meta: { persist: false },
    queryFn: async () => {
      if (!navigator.storage?.estimate) return null;
      const estimate = await navigator.storage.estimate();
      return { usage: estimate.usage ?? 0 };
    },
  });

  return (
    <Card>
      <CardHeader title="Aplicativo" description="Instalação, versão e dados salvos neste aparelho." />
      <div className="space-y-4 p-4 text-sm">
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted">Versão</dt>
            <dd className="num font-medium">{__APP_VERSION__}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Ambiente</dt>
            <dd className="font-medium">{ENV_LABELS[env.appEnv] ?? env.appEnv}</dd>
          </div>
        </dl>

        <div className="rounded-lg border border-line p-3">
          <p className="font-medium">Instalar no celular ou computador</p>
          {install.standalone ? (
            <p className="mt-1 text-xs text-success">O aplicativo já está instalado e aberto como app.</p>
          ) : install.canPrompt ? (
            <Button
              className="mt-2"
              size="sm"
              onClick={async () => {
                const accepted = await install.install();
                if (accepted) toast.success('Aplicativo instalado.');
              }}
            >
              <Download /> Instalar aplicativo
            </Button>
          ) : isIOS() ? (
            <p className="mt-1 flex items-start gap-1.5 text-xs text-ink-soft">
              <Share className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              No iPhone/iPad (Safari): toque em Compartilhar e depois em “Adicionar à Tela de Início”.
            </p>
          ) : (
            <p className="mt-1 text-xs text-ink-soft">
              No Chrome ou Edge, use o ícone de instalação na barra de endereço ou o menu “Instalar Magi Doces”. No iPhone (Safari): Compartilhar →
              “Adicionar à Tela de Início”.
            </p>
          )}
        </div>

        <div className="rounded-lg border border-line p-3">
          <p className="flex items-center gap-1.5 font-medium">
            <HardDrive className="size-4 text-muted" aria-hidden /> Dados salvos neste aparelho
          </p>
          <p className="mt-1 text-xs text-ink-soft">
            Para consulta sem internet, as telas abertas recentemente ficam salvas por até {Math.round(CACHE_MAX_AGE_MS / 3_600_000)} horas e são
            apagadas ao sair da conta. Senhas não são salvas.
            {storage.data ? ` Uso atual do armazenamento do site: ${formatBytes(storage.data.usage)}.` : ''}
          </p>
          <Button variant="danger-outline" size="sm" className="mt-2" onClick={() => setConfirmWipe(true)}>
            <Trash2 /> Apagar dados salvos neste aparelho
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmWipe}
        onOpenChange={setConfirmWipe}
        title="Apagar dados salvos neste aparelho?"
        description="Remove o cache de consulta offline e as preferências locais. Nenhum dado do negócio é apagado do servidor. A página será recarregada."
        confirmLabel="Apagar e recarregar"
        onConfirm={async () => {
          await wipeLocalData();
          window.location.reload();
        }}
      />
    </Card>
  );
}

export function SettingsPage() {
  return (
    <Page>
      <PageHeader title="Configurações" description="Dados do negócio, pessoas com acesso e o aplicativo." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <BusinessForm />
        </div>
        <div className="space-y-4">
          <Members />
          <AppSection />
        </div>
      </div>
    </Page>
  );
}
