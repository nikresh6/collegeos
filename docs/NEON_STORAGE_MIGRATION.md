+# Neon storage migration
+
+CollegeOS currently stores uploaded course files and lecture audio in Supabase Storage. The migration workflow copies both buckets into a private Neon Object Storage bucket without deleting the source.
+
+The current source inventory is small, but lecture audio is the fastest-growing category. The mirror keeps binary uploads out of the Postgres database and produces a checksum manifest for every run.
+
+## Required configuration
+
+Create a Neon project in `us-east-2` and a private bucket named `collegeos-files`.
+
+Repository variables:
+
+- `NEON_ARCHIVE_BUCKET=collegeos-files`
+- `NEON_AWS_REGION=us-east-2`
+
+Repository secrets:
+
+- `NEON_AWS_ENDPOINT_URL_S3`
+- `NEON_AWS_ACCESS_KEY_ID`
+- `NEON_AWS_SECRET_ACCESS_KEY`
+- Existing `SUPABASE_URL`
+- Existing `SUPABASE_SERVICE_ROLE_KEY`
+
+Run **Neon Storage Mirror** first with execute disabled to inventory the source. Then run it with execute enabled. The workflow verifies every copied object by byte count and SHA-256 metadata and writes a manifest under `migration-manifests/`.
+
+Supabase objects remain untouched until CollegeOS reads and writes through Neon successfully.
+
