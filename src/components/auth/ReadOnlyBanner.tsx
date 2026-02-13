import { Shield } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Shows a read-only warning banner when the current user is a seller.
 * Renders nothing for admins.
 */
export function ReadOnlyBanner() {
  const { isAdmin } = useAuth();

  if (isAdmin) return null;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-4 py-2.5 mb-4">
      <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
      <p className="text-sm text-muted-foreground font-poppins">
        Você está no modo visualização. Apenas administradores podem editar estas configurações.
      </p>
    </div>
  );
}
