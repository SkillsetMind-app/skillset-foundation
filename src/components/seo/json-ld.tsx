/**
 * Renders a `<script type="application/ld+json">` tag for structured data.
 *
 * The `<` -> `<` escape stops any field value from prematurely closing the
 * script element (`</script>`) — defensive even though current callers pass our
 * own typed catalog data, so it stays safe if a field ever carries user content.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
