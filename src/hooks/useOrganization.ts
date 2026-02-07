import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface Organization {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  cnpj: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export function useOrganization() {
  const { profile } = useAuth();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOrganization = async () => {
      if (!profile?.organization_id) {
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', profile.organization_id)
          .single();

        if (error) {
          console.error('Error fetching organization:', error);
        } else {
          setOrganization(data);
        }
      } catch (err) {
        console.error('Error fetching organization:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchOrganization();
  }, [profile?.organization_id]);

  return { organization, loading };
}
