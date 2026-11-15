-- =====================================================================
-- fiubaLost - sede y franja horaria en las publicaciones
-- Ejecutar en: Supabase > SQL Editor > New query > Run
-- Es seguro correrlo más de una vez. Las publicaciones viejas quedan
-- con estos campos vacíos; las nuevas los piden en el formulario.
-- =====================================================================

alter table public.items
  add column if not exists campus text check (char_length(campus) <= 60),
  add column if not exists time_from time,
  add column if not exists time_to time;

alter table public.items drop constraint if exists items_time_order;
alter table public.items
  add constraint items_time_order
  check (time_to is null or time_from is null or time_to >= time_from);
