-- Permitir uploads no bucket chat-media para qualquer requisição com a anon key
-- (necessário porque o app usa Clerk e auth.uid() do Supabase é sempre null)
DROP POLICY IF EXISTS "Authenticated users can upload chat media" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can update chat media" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete chat media" ON storage.objects;

CREATE POLICY "Anyone can upload chat media"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'chat-media');

CREATE POLICY "Anyone can update chat media"
ON storage.objects FOR UPDATE
TO anon, authenticated
USING (bucket_id = 'chat-media');

CREATE POLICY "Anyone can delete chat media"
ON storage.objects FOR DELETE
TO anon, authenticated
USING (bucket_id = 'chat-media');