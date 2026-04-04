/**
 * Schema tương đương Firebase Realtime Database + rules bạn dán.
 *
 * Luồng payment (khuyến nghị):
 *   - Client INSERT user_profiles: payment_status = 'pending' (trigger chặn giá trị khác nếu không phải service_role).
 *   - Webhook / job: service_role UPDATE payment_status = 'active' (và các cột liên quan).
 *
 * Ánh xạ:
 *   users/{uid}           → public.user_profiles
 *   shops/{slug}          → public.shops
 *   trialShops/{slug}     → public.trial_shops
 *   backups/shop_*        → public.pos_backups (nhiều dòng / shop_key = nhiều snapshot theo thời gian)
 *   trial_backups/shop_*  → public.trial_pos_backups
 */

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_service_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select auth.jwt() ->> 'role'),
    current_setting('request.jwt.claim.role', true)
  ) = 'service_role';
$$;

comment on function public.is_service_role() is 'true khi request dùng Supabase service_role (webhook, admin job).';

create or replace function public.shop_slug_from_key(p_shop_key text)
returns text
language sql
immutable
as $$
  select nullif(trim(both from regexp_replace(p_shop_key, '^shop_', '')), '');
$$;

comment on function public.shop_slug_from_key(text) is 'shop_try-foo → try-foo (bỏ đúng một tiền tố shop_ ở đầu).';

create or replace function public.update_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- user_profiles  (~ users/$uid)
-- ---------------------------------------------------------------------------

create table public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  payment_status text not null default 'pending',
  payment_ref text,
  registration_trial boolean,
  trial_expires_at timestamptz,
  shop_slug text,
  shop_display_name text,
  created_at timestamptz not null default now(),
  last_seen timestamptz,
  upgrade_target_slug text,
  upgrade_from_slug text,
  extra jsonb not null default '{}'::jsonb,
  constraint user_profiles_payment_status_allowed check (
    payment_status in ('pending', 'active', 'pending_upgrade')
  )
);

comment on table public.user_profiles is 'RTDB users/{uid}. Client chỉ INSERT pending; active do server/webhook (service_role).';

create index user_profiles_payment_status_idx on public.user_profiles (payment_status);
create index user_profiles_payment_ref_idx on public.user_profiles (payment_ref) where payment_ref is not null;

-- Một slug gắn tối đa một user (đồng bộ với shops.slug unique).
create unique index user_profiles_shop_slug_unique
  on public.user_profiles (shop_slug)
  where shop_slug is not null;

create or replace function public.user_profiles_lock_sensitive_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_service_role() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.payment_status is distinct from 'pending' then
      raise exception 'payment_status ban đầu phải là pending (kích hoạt qua service_role / webhook)';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.payment_status is distinct from old.payment_status then
      raise exception 'payment_status chỉ được đổi bởi server (service_role)';
    end if;
    -- Cho phép đổi slug khi trigger đồng bộ từ shops / trial_shops (nâng cấp trial → slug mới).
    if current_setting('app.internal_profile_sync', true) <> 'on' then
      if old.shop_slug is not null and new.shop_slug is distinct from old.shop_slug then
        raise exception 'shop_slug không được đổi sau khi đã có giá trị';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger user_profiles_lock_sensitive_columns_trg
  before insert or update on public.user_profiles
  for each row
  execute procedure public.user_profiles_lock_sensitive_columns();

alter table public.user_profiles add constraint user_profiles_registration_trial_check check (
  registration_trial is null or registration_trial in (true, false)
);

alter table public.user_profiles add constraint user_profiles_trial_expires_check check (
  trial_expires_at is null or trial_expires_at > to_timestamp(0)
);

alter table public.user_profiles enable row level security;

create policy "user_profiles_select_own"
  on public.user_profiles for select
  using (auth.uid() = id);

create policy "user_profiles_insert_own"
  on public.user_profiles for insert
  with check (auth.uid() = id);

create policy "user_profiles_update_own"
  on public.user_profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "user_profiles_delete_own"
  on public.user_profiles for delete
  using (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- shops  (~ shops/$shopSlug)
-- ---------------------------------------------------------------------------

create table public.shops (
  slug text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  display_name text,
  owner_email text,
  created_at timestamptz not null default now(),
  trial_shop boolean,
  upgraded_to text,
  extra jsonb not null default '{}'::jsonb
);

alter table public.shops add constraint shops_trial_shop_boolean check (trial_shop is null or trial_shop in (true, false));

alter table public.shops enable row level security;

create policy "shops_select_owner"
  on public.shops for select
  using (owner_id = auth.uid());

create policy "shops_insert_owner"
  on public.shops for insert
  with check (owner_id = auth.uid());

create policy "shops_update_owner"
  on public.shops for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "shops_delete_owner"
  on public.shops for delete
  using (owner_id = auth.uid());

-- Đồng bộ user_profiles.shop_slug khi tạo/đổi slug hoặc owner (SECURITY DEFINER).
create or replace function public.sync_user_profile_shop_slug_from_shop()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.internal_profile_sync', 'on', true);
  update public.user_profiles
  set shop_slug = new.slug
  where id = new.owner_id;
  perform set_config('app.internal_profile_sync', '', true);
  return new;
end;
$$;

create trigger shops_sync_profile_slug_trg
  after insert or update of slug, owner_id on public.shops
  for each row
  execute procedure public.sync_user_profile_shop_slug_from_shop();

-- ---------------------------------------------------------------------------
-- trial_shops  (~ trialShops/$shopSlug)
-- ---------------------------------------------------------------------------

create table public.trial_shops (
  slug text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  display_name text,
  owner_email text,
  trial boolean,
  trial_shop boolean,
  created_at timestamptz,
  expires_at timestamptz,
  upgraded_to text,
  extra jsonb not null default '{}'::jsonb
);

-- Cho phép trial = false sau khi cron đánh dấu hết hạn (khác rule RTDB chỉ cho true khi set).
alter table public.trial_shops add constraint trial_shops_trial_boolean check (trial is null or trial in (true, false));
alter table public.trial_shops add constraint trial_shops_trial_shop_boolean check (trial_shop is null or trial_shop in (true, false));
alter table public.trial_shops add constraint trial_shops_created_pos check (created_at is null or created_at > to_timestamp(0));
alter table public.trial_shops add constraint trial_shops_expires_pos check (expires_at is null or expires_at > to_timestamp(0));

alter table public.trial_shops enable row level security;

-- Client chỉ thấy / sửa trial còn hiệu lực (hoặc chưa set expires_at).
create policy "trial_shops_select_owner_active"
  on public.trial_shops for select
  using (
    owner_id = auth.uid()
    and (expires_at is null or expires_at > now())
  );

create policy "trial_shops_insert_owner_active"
  on public.trial_shops for insert
  with check (
    owner_id = auth.uid()
    and (expires_at is null or expires_at > now())
  );

create policy "trial_shops_update_owner_active"
  on public.trial_shops for update
  using (
    owner_id = auth.uid()
    and (expires_at is null or expires_at > now())
  )
  with check (
    owner_id = auth.uid()
    and (expires_at is null or expires_at > now())
  );

-- Xóa vẫn cho phép (dọn dẹp), kể cả đã hết hạn.
create policy "trial_shops_delete_owner"
  on public.trial_shops for delete
  using (owner_id = auth.uid());

create or replace function public.sync_user_profile_shop_slug_from_trial_shop()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.internal_profile_sync', 'on', true);
  update public.user_profiles
  set shop_slug = new.slug
  where id = new.owner_id;
  perform set_config('app.internal_profile_sync', '', true);
  return new;
end;
$$;

create trigger trial_shops_sync_profile_slug_trg
  after insert or update of slug, owner_id on public.trial_shops
  for each row
  execute procedure public.sync_user_profile_shop_slug_from_trial_shop();

-- Gọi định kỳ (pg_cron) hoặc Edge Function với service_role.
create or replace function public.mark_expired_trial_shops()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.trial_shops
  set trial = false
  where expires_at is not null
    and expires_at < now()
    and coalesce(trial, true) is distinct from false;
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.mark_expired_trial_shops() is
  'Đánh dấu trial hết hạn (trial = false). Gắn pg_cron: select public.mark_expired_trial_shops();';

-- ---------------------------------------------------------------------------
-- POS backups — nhiều snapshot / shop_key (uuid PK)
-- ---------------------------------------------------------------------------

create table public.pos_backups (
  id uuid primary key default gen_random_uuid(),
  shop_key text not null check (shop_key like 'shop\_%' escape '\'),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pos_backups_shop_key_created_idx on public.pos_backups (shop_key, created_at desc);

alter table public.pos_backups enable row level security;

create trigger pos_backups_updated_at_trg
  before update on public.pos_backups
  for each row
  execute procedure public.update_updated_at();

create policy "pos_backups_select_pro_owner"
  on public.pos_backups for select
  using (
    exists (
      select 1
      from public.shops s
      where s.slug = public.shop_slug_from_key(pos_backups.shop_key)
        and s.owner_id = auth.uid()
    )
  );

create policy "pos_backups_insert_pro_owner"
  on public.pos_backups for insert
  with check (
    exists (
      select 1
      from public.shops s
      where s.slug = public.shop_slug_from_key(pos_backups.shop_key)
        and s.owner_id = auth.uid()
    )
  );

create policy "pos_backups_update_pro_owner"
  on public.pos_backups for update
  using (
    exists (
      select 1
      from public.shops s
      where s.slug = public.shop_slug_from_key(pos_backups.shop_key)
        and s.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.shops s
      where s.slug = public.shop_slug_from_key(pos_backups.shop_key)
        and s.owner_id = auth.uid()
    )
  );

create policy "pos_backups_delete_pro_owner"
  on public.pos_backups for delete
  using (
    exists (
      select 1
      from public.shops s
      where s.slug = public.shop_slug_from_key(pos_backups.shop_key)
        and s.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Trial POS backups — nhiều snapshot / shop_key
-- ---------------------------------------------------------------------------

create table public.trial_pos_backups (
  id uuid primary key default gen_random_uuid(),
  shop_key text not null check (shop_key like 'shop\_%' escape '\'),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index trial_pos_backups_shop_key_created_idx on public.trial_pos_backups (shop_key, created_at desc);

alter table public.trial_pos_backups enable row level security;

create trigger trial_pos_backups_updated_at_trg
  before update on public.trial_pos_backups
  for each row
  execute procedure public.update_updated_at();

create policy "trial_pos_backups_select_trial_owner"
  on public.trial_pos_backups for select
  using (
    exists (
      select 1
      from public.trial_shops t
      where t.slug = public.shop_slug_from_key(trial_pos_backups.shop_key)
        and t.owner_id = auth.uid()
        and (t.expires_at is null or t.expires_at > now())
    )
  );

create policy "trial_pos_backups_insert_trial_owner"
  on public.trial_pos_backups for insert
  with check (
    exists (
      select 1
      from public.trial_shops t
      where t.slug = public.shop_slug_from_key(trial_pos_backups.shop_key)
        and t.owner_id = auth.uid()
        and (t.expires_at is null or t.expires_at > now())
    )
  );

create policy "trial_pos_backups_update_trial_owner"
  on public.trial_pos_backups for update
  using (
    exists (
      select 1
      from public.trial_shops t
      where t.slug = public.shop_slug_from_key(trial_pos_backups.shop_key)
        and t.owner_id = auth.uid()
        and (t.expires_at is null or t.expires_at > now())
    )
  )
  with check (
    exists (
      select 1
      from public.trial_shops t
      where t.slug = public.shop_slug_from_key(trial_pos_backups.shop_key)
        and t.owner_id = auth.uid()
        and (t.expires_at is null or t.expires_at > now())
    )
  );

create policy "trial_pos_backups_delete_trial_owner"
  on public.trial_pos_backups for delete
  using (
    exists (
      select 1
      from public.trial_shops t
      where t.slug = public.shop_slug_from_key(trial_pos_backups.shop_key)
        and t.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Realtime (tuỳ chọn)
-- ---------------------------------------------------------------------------

alter table public.user_profiles replica identity full;
alter table public.shops replica identity full;
alter table public.trial_shops replica identity full;
alter table public.pos_backups replica identity full;
alter table public.trial_pos_backups replica identity full;

-- Dashboard → Replication → bật bảng cần listen.
-- pg_cron (nếu bật extension): select cron.schedule('expire-trials', '*/15 * * * *', $$ select public.mark_expired_trial_shops(); $$);
