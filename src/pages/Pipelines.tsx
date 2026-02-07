import React from 'react';
import { PipelineManagement } from '@/components/settings/PipelineManagement';
import { PageHeader } from '@/components/layout/PageHeader';

export function Pipelines() {
  return (
    <div className="p-6 space-y-6">
      <PageHeader 
        title="Gerenciar Pipelines" 
        description="Configure os estágios do funil de vendas da sua organização"
      />

      <PipelineManagement />
    </div>
  );
}