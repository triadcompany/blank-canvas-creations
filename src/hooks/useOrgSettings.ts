import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface OrgSettings {
  inbox_enabled: boolean;
}

export function useOrgSettings() {
  const { orgId } = useAuth();
  const [settings, setSettings] = useState<OrgSettings>({ inbox_enabled: true });
  const [loading, setLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    if (!orgId) return;
    try {
      const { data } = await supabase
        .from('organizations')
        .select('inbox_enabled')
        .eq('id', orgId)
        .single();

      if (data) {
        setSettings({ inbox_enabled: data.inbox_enabled ?? true });
      }
    } catch (err) {
      console.error('Error fetching org settings:', err);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateInboxEnabled = useCallback(async (enabled: boolean) => {
    if (!orgId) return;
    const { error } = await supabase
      .from('organizations')
      .update({ inbox_enabled: enabled })
      .eq('id', orgId);

    if (!error) {
      setSettings(prev => ({ ...prev, inbox_enabled: enabled }));
    }
    return error;
  }, [orgId]);

  return { settings, loading, updateInboxEnabled, refetch: fetchSettings };
}
