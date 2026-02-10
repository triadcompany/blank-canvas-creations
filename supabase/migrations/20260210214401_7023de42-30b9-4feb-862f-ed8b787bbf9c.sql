
-- Fix FK: conversations.organization_id should reference organizations, not saas_organizations
ALTER TABLE conversations DROP CONSTRAINT conversations_organization_id_fkey;
ALTER TABLE conversations ADD CONSTRAINT conversations_organization_id_fkey 
  FOREIGN KEY (organization_id) REFERENCES organizations(id);

-- Fix FK: messages.organization_id should reference organizations, not saas_organizations  
ALTER TABLE messages DROP CONSTRAINT messages_organization_id_fkey;
ALTER TABLE messages ADD CONSTRAINT messages_organization_id_fkey 
  FOREIGN KEY (organization_id) REFERENCES organizations(id);
