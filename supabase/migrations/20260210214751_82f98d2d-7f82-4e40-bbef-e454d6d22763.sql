
-- Fix RLS policies for conversations and messages to work with Clerk (no auth.uid())
-- Match the same pattern used by leads table (application-level org isolation)

-- Conversations
DROP POLICY IF EXISTS "Users can view their org conversations" ON conversations;
DROP POLICY IF EXISTS "Users can insert their org conversations" ON conversations;
DROP POLICY IF EXISTS "Users can update their org conversations" ON conversations;
DROP POLICY IF EXISTS "Users can delete their org conversations" ON conversations;

CREATE POLICY "Allow select conversations" ON conversations FOR SELECT USING (true);
CREATE POLICY "Allow insert conversations" ON conversations FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update conversations" ON conversations FOR UPDATE USING (true);
CREATE POLICY "Allow delete conversations" ON conversations FOR DELETE USING (true);

-- Messages
DROP POLICY IF EXISTS "Users can view their org messages" ON messages;
DROP POLICY IF EXISTS "Users can insert their org messages" ON messages;
DROP POLICY IF EXISTS "Users can update their org messages" ON messages;
DROP POLICY IF EXISTS "Users can delete their org messages" ON messages;

CREATE POLICY "Allow select messages" ON messages FOR SELECT USING (true);
CREATE POLICY "Allow insert messages" ON messages FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update messages" ON messages FOR UPDATE USING (true);
CREATE POLICY "Allow delete messages" ON messages FOR DELETE USING (true);
