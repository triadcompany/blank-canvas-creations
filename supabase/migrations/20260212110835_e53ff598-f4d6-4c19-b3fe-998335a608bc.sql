
-- Drop restrictive policies that rely on auth.uid() (doesn't work with Clerk)
DROP POLICY IF EXISTS "Users can view own org meta_capi_settings" ON meta_capi_settings;
DROP POLICY IF EXISTS "Users can insert own org meta_capi_settings" ON meta_capi_settings;
DROP POLICY IF EXISTS "Users can update own org meta_capi_settings" ON meta_capi_settings;

-- Create permissive policies matching the project's Clerk-based auth pattern
CREATE POLICY "Allow select meta_capi_settings"
ON meta_capi_settings FOR SELECT USING (true);

CREATE POLICY "Allow insert meta_capi_settings"
ON meta_capi_settings FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow update meta_capi_settings"
ON meta_capi_settings FOR UPDATE USING (true);
