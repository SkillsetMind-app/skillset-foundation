-- Storage upserts return object metadata after writing. Keep that SELECT
-- capability scoped to the same owners already allowed to mutate public media.
DROP POLICY IF EXISTS public_media_select_owner ON storage.objects;

CREATE POLICY public_media_select_owner
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'public-media'
  AND (
    public.is_admin()
    OR (
      (storage.foldername(name))[1] = 'users'
      AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
    )
    OR (
      (storage.foldername(name))[1] = 'courses'
      AND EXISTS (
        SELECT 1
        FROM public.courses AS course_row
        WHERE course_row.id = (storage.foldername(storage.objects.name))[2]
          AND course_row.owner_id = (SELECT auth.uid())::text
      )
    )
  )
);
