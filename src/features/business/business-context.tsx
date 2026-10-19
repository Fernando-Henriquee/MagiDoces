import { useQuery } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';
import { unwrap } from '@/data/api';
import type { Business, Membership, Role } from '@/data/types';
import { todayIn } from '@/lib/dates';
import { supabase } from '@/lib/supabase';
import { useAuth } from '../auth/auth-context';

export type Capability = 'write' | 'import' | 'audit' | 'settings';

const CAPABILITIES: Record<Role, Capability[]> = {
  owner: ['write', 'import', 'audit', 'settings'],
  editor: ['write', 'import', 'audit'],
  viewer: [],
};

export const ROLE_LABELS: Record<Role, string> = { owner: 'Sócia/administradora', editor: 'Operação', viewer: 'Somente leitura' };

interface BusinessState {
  business: Business;
  role: Role;
  memberships: Array<Membership & { business: Business }>;
  can: (capability: Capability) => boolean;
  /** Hoje no fuso operacional do negócio. */
  today: () => string;
  selectBusiness: (id: string) => void;
}

const BusinessContext = createContext<BusinessState | null>(null);
const STORAGE_KEY = 'magi:business';

function readSelection(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Negócios aos quais o usuário está explicitamente associado (business_members + RLS). */
export function useMemberships(userId: string | undefined) {
  return useQuery({
    queryKey: ['memberships', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const members = await unwrap<Membership[]>(
        supabase.from('business_members').select('business_id,user_id,role').eq('user_id', userId!),
      );
      if (members.length === 0) return [];
      const businesses = await unwrap<Business[]>(
        supabase
          .from('businesses')
          .select('id,name,timezone,default_due_day,pix_key,charge_message_footer')
          .in('id', members.map((m) => m.business_id)),
      );
      return members
        .map((member) => ({ ...member, business: businesses.find((b) => b.id === member.business_id)! }))
        .filter((member) => member.business)
        .sort((a, b) => a.business.name.localeCompare(b.business.name, 'pt-BR'));
    },
  });
}

export function BusinessProvider({ memberships, children }: { memberships: Array<Membership & { business: Business }>; children: ReactNode }) {
  const [selected, setSelected] = useState<string | null>(readSelection);
  const current = memberships.find((m) => m.business_id === selected) ?? memberships[0]!;
  const value = useMemo<BusinessState>(
    () => ({
      business: current.business,
      role: current.role,
      memberships,
      can: (capability) => CAPABILITIES[current.role].includes(capability),
      today: () => todayIn(current.business.timezone),
      selectBusiness: (id) => {
        try {
          localStorage.setItem(STORAGE_KEY, id);
        } catch {
          // ignorado
        }
        setSelected(id);
      },
    }),
    [current, memberships],
  );
  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>;
}

export function useBusiness(): BusinessState {
  const context = useContext(BusinessContext);
  if (!context) throw new Error('useBusiness fora do BusinessProvider');
  return context;
}

export function useCurrentUser() {
  const { user } = useAuth();
  return user;
}
