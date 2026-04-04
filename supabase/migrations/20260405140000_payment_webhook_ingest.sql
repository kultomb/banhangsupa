-- Idempotency cho webhook thanh toán (thay paymentWebhookIngest / paymentEvents trên RTDB).

create table if not exists public.payment_webhook_ingest (
  txn_id text primary key,
  outcome text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.payment_webhook_ingest is 'SePay / webhook: tránh xử lý trùng txn_id; chỉ ghi bằng service_role.';

alter table public.payment_webhook_ingest enable row level security;
