# Migrations notes

- `public.pending_clarifications` is **deprecated and unused by app code** as of
  the clarification-flow removal. The table is intentionally not dropped to
  avoid a destructive migration; it can be removed in a future cleanup.
