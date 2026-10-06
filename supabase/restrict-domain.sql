-- =====================================================================
-- fiubaLost - restringir el registro a mails @fi.uba.ar
-- Ejecutar en: Supabase > SQL Editor > New query > Run
-- (Solo afecta a cuentas NUEVAS: las ya creadas siguen funcionando.)
-- =====================================================================

create or replace function public.enforce_email_domain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is null or lower(new.email) !~ '^[^@\s]+@fi\.uba\.ar$' then
    raise exception 'Solo se permite registrarse con un mail @fi.uba.ar';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_email_domain on auth.users;
create trigger enforce_email_domain
  before insert on auth.users
  for each row execute function public.enforce_email_domain();
