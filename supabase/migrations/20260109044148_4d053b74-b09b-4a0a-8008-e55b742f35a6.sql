-- Drop existing policies that cause recursion
DROP POLICY IF EXISTS "Users can view n8n_workflows for their organization" ON n8n_workflows;
DROP POLICY IF EXISTS "Users can insert n8n_workflows for their organization" ON n8n_workflows;
DROP POLICY IF EXISTS "Users can update n8n_workflows for their organization" ON n8n_workflows;
DROP POLICY IF EXISTS "Users can delete n8n_workflows for their organization" ON n8n_workflows;

-- Create simple RLS policies without recursion
-- Allow users to view workflows for their organization
CREATE POLICY "Allow users to view n8n_workflows" ON n8n_workflows
FOR SELECT USING (
  organization_id IN (
    SELECT organization_id FROM profiles WHERE id = auth.uid()
  )
);

-- Allow users to insert workflows for their organization  
CREATE POLICY "Allow users to insert n8n_workflows" ON n8n_workflows
FOR INSERT WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM profiles WHERE id = auth.uid()
  )
);

-- Allow users to update workflows for their organization
CREATE POLICY "Allow users to update n8n_workflows" ON n8n_workflows
FOR UPDATE USING (
  organization_id IN (
    SELECT organization_id FROM profiles WHERE id = auth.uid()
  )
);

-- Allow users to delete workflows for their organization
CREATE POLICY "Allow users to delete n8n_workflows" ON n8n_workflows
FOR DELETE USING (
  organization_id IN (
    SELECT organization_id FROM profiles WHERE id = auth.uid()
  )
);