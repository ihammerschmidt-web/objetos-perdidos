-- =====================================================================
-- Objetos Perdidos - esquema de base de datos (Supabase / Postgres)
-- Ejecutar completo en: Supabase > SQL Editor > New query > Run
-- =====================================================================

-- ---------- Perfiles (extiende auth.users) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'student' check (role in ('student', 'staff')),
  created_at timestamptz not null default now()
);

-- Al registrarse un usuario se crea su perfil como 'student'.
-- El rol 'staff' se asigna a mano (ver README): nadie puede auto-promoverse.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'staff'
  );
$$;

-- ---------- Objetos (encontrados por el personal / perdidos por alumnos) ----------
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('found', 'lost')),
  title text not null check (char_length(title) between 3 and 100),
  description text not null default '' check (char_length(description) <= 1000),
  location text not null check (char_length(location) between 2 and 150),
  event_date date not null default current_date,
  pickup_point text check (char_length(pickup_point) <= 150),
  photo_url text,
  status text not null default 'open' check (status in ('open', 'returned')),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists items_type_status_idx on public.items (type, status, created_at desc);

-- ---------- Reclamos ----------
-- Sobre un objeto "found": un alumno dice "es mío".
-- Sobre un objeto "lost": alguien dice "creo que lo encontré".
create table if not exists public.claims (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  claimant_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  message text not null check (char_length(message) between 5 and 500),
  contact text not null check (char_length(contact) between 3 and 100),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  unique (item_id, claimant_id)
);

-- =====================================================================
-- Seguridad (Row Level Security)
-- =====================================================================
alter table public.profiles enable row level security;
alter table public.items    enable row level security;
alter table public.claims   enable row level security;

-- profiles: cada uno ve el suyo, el personal ve todos. Sin policy de UPDATE:
-- el rol solo se cambia desde el panel de Supabase.
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_staff());

-- items: el listado es público (se puede ver sin cuenta).
drop policy if exists "items_select" on public.items;
create policy "items_select" on public.items
  for select to anon, authenticated
  using (true);

-- Los alumnos solo publican "lost"; el personal publica ambos tipos.
drop policy if exists "items_insert" on public.items;
create policy "items_insert" on public.items
  for insert to authenticated
  with check (created_by = auth.uid() and (type = 'lost' or public.is_staff()));

drop policy if exists "items_update" on public.items;
create policy "items_update" on public.items
  for update to authenticated
  using (created_by = auth.uid() or public.is_staff())
  with check ((created_by = auth.uid() and type = 'lost') or public.is_staff());

drop policy if exists "items_delete" on public.items;
create policy "items_delete" on public.items
  for delete to authenticated
  using (created_by = auth.uid() or public.is_staff());

-- claims: los ve quien reclama, el dueño de la publicación y el personal.
drop policy if exists "claims_select" on public.claims;
create policy "claims_select" on public.claims
  for select to authenticated
  using (
    claimant_id = auth.uid()
    or public.is_staff()
    or exists (select 1 from public.items i where i.id = item_id and i.created_by = auth.uid())
  );

-- Solo se puede reclamar un objeto abierto que no sea propio.
drop policy if exists "claims_insert" on public.claims;
create policy "claims_insert" on public.claims
  for insert to authenticated
  with check (
    claimant_id = auth.uid()
    and exists (
      select 1 from public.items i
      where i.id = item_id and i.status = 'open' and i.created_by <> auth.uid()
    )
  );

-- Aprobar / rechazar: dueño de la publicación o personal. Solo se puede cambiar "status".
drop policy if exists "claims_update" on public.claims;
create policy "claims_update" on public.claims
  for update to authenticated
  using (
    public.is_staff()
    or exists (select 1 from public.items i where i.id = item_id and i.created_by = auth.uid())
  );

revoke update on public.claims from authenticated;
grant update (status) on public.claims to authenticated;

drop policy if exists "claims_delete" on public.claims;
create policy "claims_delete" on public.claims
  for delete to authenticated
  using (claimant_id = auth.uid() or public.is_staff());

-- =====================================================================
-- Almacenamiento de fotos
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('item-photos', 'item-photos', true)
on conflict (id) do nothing;

drop policy if exists "fotos_lectura_publica" on storage.objects;
create policy "fotos_lectura_publica" on storage.objects
  for select using (bucket_id = 'item-photos');

-- Cada usuario sube a su propia carpeta: <user_id>/archivo.jpg
drop policy if exists "fotos_subida_propia" on storage.objects;
create policy "fotos_subida_propia" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'item-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "fotos_borrado_propio" on storage.objects;
create policy "fotos_borrado_propio" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'item-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
