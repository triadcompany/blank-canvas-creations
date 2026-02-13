import React from 'react';
import { Building2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface PageHeaderProps {
  title: string;
  description?: string;
  showOrgName?: boolean;
  children?: React.ReactNode;
}

export function PageHeader({ title, description, showOrgName = true, children }: PageHeaderProps) {
  const { orgName } = useAuth();

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
      <div>
        {showOrgName && orgName && (
          <div className="flex items-center gap-2 mb-1">
            <Building2 className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-primary">{orgName}</span>
          </div>
        )}
        <h1 className="text-2xl font-poppins font-bold text-foreground">{title}</h1>
        {description && (
          <p className="text-muted-foreground font-poppins mt-1">{description}</p>
        )}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
