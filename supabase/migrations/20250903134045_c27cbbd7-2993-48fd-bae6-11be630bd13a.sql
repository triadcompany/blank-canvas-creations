-- Verificar se as políticas já existem e criar apenas se necessário
DO $$
BEGIN
    -- Avatar images are publicly accessible
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Avatar images are publicly accessible') THEN
        CREATE POLICY "Avatar images are publicly accessible" 
        ON storage.objects 
        FOR SELECT 
        USING (bucket_id = 'avatars');
    END IF;

    -- Users can upload their own avatar
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Users can upload their own avatar') THEN
        CREATE POLICY "Users can upload their own avatar" 
        ON storage.objects 
        FOR INSERT 
        WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
    END IF;

    -- Users can update their own avatar
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Users can update their own avatar') THEN
        CREATE POLICY "Users can update their own avatar" 
        ON storage.objects 
        FOR UPDATE 
        USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
    END IF;

    -- Users can delete their own avatar
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Users can delete their own avatar') THEN
        CREATE POLICY "Users can delete their own avatar" 
        ON storage.objects 
        FOR DELETE 
        USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
    END IF;
END $$;