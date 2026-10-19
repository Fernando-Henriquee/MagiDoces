import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/lib/supabase';
import { unwrap } from './api';
import { useBusinessQuery, useWrite } from './hooks';
import type { Business, MemberRow, Profile } from './types';

export function useBusinessMembers() {
  return useBusinessQuery(['members', 'list'], (businessId) =>
    unwrap<MemberRow[]>(supabase.from('v_business_members').select('*').eq('business_id', businessId).order('created_at')),
  );
}

/** Perfis visíveis (o próprio e os de quem compartilha o negócio, pela RLS). */
export function useProfiles() {
  return useBusinessQuery(
    ['profiles', 'map'],
    async () => {
      const rows = await unwrap<Profile[]>(supabase.from('profiles').select('id,display_name'));
      return Object.fromEntries(rows.map((row) => [row.id, row.display_name])) as Record<string, string>;
    },
    { staleTime: 5 * 60 * 1000 },
  );
}

export function useMyProfile() {
  const { user } = useAuth();
  return useBusinessQuery(
    ['profiles', 'me', user?.id],
    () => unwrap<Profile>(supabase.from('profiles').select('id,display_name').eq('id', user!.id).single()),
    { enabled: Boolean(user) },
  );
}

export type BusinessSettingsInput = Pick<Business, 'name' | 'timezone' | 'default_due_day' | 'pix_key' | 'charge_message_footer'>;

export function useSaveBusinessSettings() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useWrite<BusinessSettingsInput, Business>({
    mutationFn: (values, businessId) =>
      unwrap<Business>(
        supabase
          .from('businesses')
          .update(values)
          .eq('id', businessId)
          .select('id,name,timezone,default_due_day,pix_key,charge_message_footer')
          .single(),
      ),
    success: 'Configurações salvas.',
    // O negócio atual vem da consulta de associações: recarrega para refletir as mudanças.
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['memberships', user?.id] }),
  });
}

export function useSaveDisplayName() {
  const { user } = useAuth();
  return useWrite<{ displayName: string }, void>({
    mutationFn: async ({ displayName }) => {
      await unwrap(supabase.from('profiles').update({ display_name: displayName }).eq('id', user!.id).select('id').single());
      // Mantém o nome exibido no menu da conta (metadados da sessão) sincronizado.
      const { error } = await supabase.auth.updateUser({ data: { display_name: displayName } });
      if (error) throw error;
    },
    success: 'Nome atualizado.',
  });
}
