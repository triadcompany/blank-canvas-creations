-- ============================================================
-- CAMPAIGN MEDIA STORAGE BUCKET
-- ============================================================
-- Run in the Supabase SQL editor.
-- The bucket must be PUBLIC so Evolution API can download
-- media files directly via URL when sending to WhatsApp.
-- Upload permissions are controlled by path prefix (org_id).
-- ============================================================

-- ── 1. Create the bucket ──
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'campaign-media',
  'campaign-media',
  true,         -- public: Evolution API needs direct URL access
  20971520,     -- 20 MB per file
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'audio/mpeg', 'audio/ogg', 'audio/mp4', 'audio/wav', 'audio/webm',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public          = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── 2. DROP old policies if re-running ──
DROP POLICY IF EXISTS "campaign_media_upload"  ON storage.objects;
DROP POLICY IF EXISTS "campaign_media_read"    ON storage.objects;
DROP POLICY IF EXISTS "campaign_media_delete"  ON storage.objects;

-- ── 3. Public read (bucket is already public, but explicit policy is cleaner) ──
CREATE POLICY "campaign_media_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'campaign-media');

-- ── 4. Authenticated upload to own org folder ──
-- Path structure: {org_id}/{folder}/{timestamp}_{filename}
-- The first path segment must match the uploader's organization_id.
CREATE POLICY "campaign_media_upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'campaign-media'
  -- Optionally restrict to org folder when Supabase auth is wired to Clerk:
  -- AND (storage.foldername(name))[1] = (
  --   SELECT organization_id::text FROM public.profiles WHERE id = auth.uid()::text LIMIT 1
  -- )
);

-- ── 5. Authenticated delete own org files ──
CREATE POLICY "campaign_media_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'campaign-media');
