-- Giới hạn số lần login-precheck (thay Firestore _security_login_rate).

create table if not exists public.login_rate_buckets (
  id text primary key,
  count int not null default 0,
  window_start bigint not null,
  blocked_until bigint not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.login_rate_buckets is 'Rate limit đăng nhập; chỉ service_role ghi đọc.';

alter table public.login_rate_buckets enable row level security;
