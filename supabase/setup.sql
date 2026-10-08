-- Dieta Dani & Alba - sincronizacion en la nube (Supabase)
-- Pegar ENTERO en Supabase > SQL Editor (con el editor vacio) y pulsar Run.
-- Se puede ejecutar varias veces sin problema.

create table if not exists public.dieta_sync (household text not null, kind text not null, id text not null, data jsonb, deleted boolean not null default false, client_ts bigint not null, server_ts timestamptz not null default clock_timestamp(), primary key (household, kind, id));

create index if not exists dieta_sync_household_server_ts on public.dieta_sync (household, server_ts);

-- Nadie puede leer ni escribir la tabla directamente (RLS activado y sin politicas).
-- Solo se accede con las dos funciones de abajo, que exigen la clave secreta del hogar.
alter table public.dieta_sync enable row level security;

revoke all on public.dieta_sync from anon, authenticated;

-- Subir cambios: gana la version mas reciente (client_ts) de cada documento.
create or replace function public.dieta_push(p_household text, p_rows jsonb) returns integer language plpgsql security definer set search_path = public as $fn$
declare
  n integer;
begin
  if p_household is null or length(p_household) < 20 then
    raise exception 'Clave de hogar no valida';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Demasiadas filas';
  end if;
  insert into dieta_sync (household, kind, id, data, deleted, client_ts, server_ts)
    select p_household, r->>'kind', r->>'id', r->'data', coalesce((r->>'deleted')::boolean, false), (r->>'ts')::bigint, clock_timestamp()
    from jsonb_array_elements(p_rows) as r
  on conflict (household, kind, id) do update
    set data = excluded.data, deleted = excluded.deleted, client_ts = excluded.client_ts, server_ts = excluded.server_ts
    where excluded.client_ts > dieta_sync.client_ts;
  get diagnostics n = row_count;
  return n;
end;
$fn$;

-- Descargar cambios desde un momento dado.
create or replace function public.dieta_pull(p_household text, p_since timestamptz) returns table (kind text, id text, data jsonb, deleted boolean, client_ts bigint, server_ts timestamptz) language sql security definer set search_path = public as $fn$
  select s.kind, s.id, s.data, s.deleted, s.client_ts, s.server_ts from dieta_sync s where s.household = p_household and length(p_household) >= 20 and s.server_ts > coalesce(p_since, 'epoch'::timestamptz) order by s.server_ts limit 5000;
$fn$;

revoke all on function public.dieta_push(text, jsonb) from public;

revoke all on function public.dieta_pull(text, timestamptz) from public;

grant execute on function public.dieta_push(text, jsonb) to anon, authenticated;

grant execute on function public.dieta_pull(text, timestamptz) to anon, authenticated;

-- Comprobacion: debe devolver la palabra OK
select 'OK' as resultado;
