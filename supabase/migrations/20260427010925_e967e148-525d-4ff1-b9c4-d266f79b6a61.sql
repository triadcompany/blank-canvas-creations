-- Allow anon role to upload/delete in campaign-media bucket
-- This project uses Clerk auth, so requests come as the anon role rather than authenticated.
-- The bucket is already public for reads. Tighten by limiting to bucket only.

DROP POLICY IF EXISTS campaign_media_upload ON storage.objects;
DROP POLICY IF EXISTS campaign_media_delete ON storage.objects;

CREATE POLICY campaign_media_upload
  ON storage.objects
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id = 'campaign-media');

CREATE POLICY campaign_media_delete
  ON storage.objects
  FOR DELETE
  TO anon, authenticated
  USING (bucket_id = 'campaign-media');