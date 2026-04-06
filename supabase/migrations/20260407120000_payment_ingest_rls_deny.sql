-- Chặn rõ ràng anon/authenticated trên bảng chỉ dành cho service_role (defense in depth).
-- Service role vẫn bypass RLS.

create policy "payment_webhook_ingest_deny_authenticated"
  on public.payment_webhook_ingest
  for all
  to authenticated
  using (false)
  with check (false);

create policy "payment_webhook_ingest_deny_anon"
  on public.payment_webhook_ingest
  for all
  to anon
  using (false)
  with check (false);

create policy "login_rate_buckets_deny_authenticated"
  on public.login_rate_buckets
  for all
  to authenticated
  using (false)
  with check (false);

create policy "login_rate_buckets_deny_anon"
  on public.login_rate_buckets
  for all
  to anon
  using (false)
  with check (false);

comment on table public.payment_webhook_ingest is
  'SePay / webhook: idempotency theo txn_id; outcome có thể là processing | unmatched | matched | matched_upgrade | matched_ingest. Chỉ service_role ghi.';
