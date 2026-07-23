-- Server-side hardening for the world-readable `public-media` bucket.
--
-- Uploads land here DIRECTLY from the browser (avatars, teacher signatures,
-- storefront logo/hero, course covers/thumbnails) -- all images. Client code
-- validates type and size, but a crafted request skips the client entirely, so
-- the only durable gate is on the bucket row itself.
--
-- allowed_mime_types: restrict to raster image types. This is the full set both
--   upload paths produce -- profile media is jpeg/png/webp
--   (src/lib/data/profile-media.ts), course covers pass image/* which in
--   practice is these plus gif/avif (src/domain/course-asset.ts). SVG is
--   excluded on purpose: nothing uploads it and it is a stored-XSS vector when
--   served by public URL.
-- file_size_limit: keep the existing 25 MB ceiling. Course covers legitimately
--   run larger than the 5 MB avatar cap, so shrinking it would 413 valid covers;
--   25 MB already bounds the "giant file" risk for an image.
--
-- Only NEW uploads are gated; existing objects are untouched. Idempotent.
-- ponytail: the private `course-content` bucket is left as-is -- it is
-- ownership-gated (only a course owner can insert) and holds videos plus mixed
-- material types, so a mime lock there is neither safe nor needed. Add one when
-- an abuse path through owner accounts actually shows up.
update storage.buckets
set
  file_size_limit = 26214400,
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif'
  ]
where id = 'public-media';
