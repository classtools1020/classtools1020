-- 115年度新竹縣第二十三屆特殊教育學生適應體育趣味運動競賽 成績公告系統
-- Supabase 後台：在 Supabase → SQL Editor 貼上整段 → Run。可重複執行。
--
-- 安全設計：
--   匿名（anon）只能讀「已公布」成績、學校名單、公告；寫入一律透過 RPC 函式並附認證碼，
--   函式以 security definer 執行，認證碼只存在 asr_staff 表，anon 完全讀不到。

create schema if not exists asr;

create table if not exists asr.staff (
  id serial primary key,
  name text not null,
  code text not null unique,
  role text not null default 'entry' check (role in ('admin','entry')),
  active boolean not null default true
);

create table if not exists asr.schools (
  name text primary key,
  elementary boolean not null default false,
  junior boolean not null default false,
  sort int not null default 0
);

create table if not exists asr.results (
  id bigserial primary key,
  division text not null check (division in ('國小組','國中組')),
  item text not null,
  rank int not null check (rank between 1 and 8),
  school text not null,
  score text,
  published boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text,
  unique (division, item, school)
);

create table if not exists asr.settings (key text primary key, value text);

create table if not exists asr.log (
  id bigserial primary key,
  at timestamptz not null default now(),
  who text,
  action text not null,
  detail jsonb
);

-- 預設資料（已存在則不覆蓋）
insert into asr.schools (name, elementary, junior, sort) values
  ('大同國小', true, false, 1), ('山崎國小', true, false, 2), ('嘉豐國小', true, false, 3), ('中山國小', true, false, 4),
  ('竹仁國小', true, false, 5), ('竹北國小', true, false, 6), ('竹東國小', true, false, 7), ('芎林國小', true, false, 8),
  ('博愛國小', true, false, 9), ('湖口國小', true, false, 10), ('新社國小', true, false, 11), ('新埔國小', true, false, 12),
  ('新湖國小', true, false, 13), ('新豐國小', true, false, 14), ('橫山國小', true, false, 15), ('關西國小', true, false, 16),
  ('竹北國中', false, true, 21), ('竹東國中', false, true, 22), ('芎林國中', false, true, 23), ('富光國中', false, true, 24),
  ('湖口國中', false, true, 25), ('新豐國中', false, true, 26), ('新竹特教學校', true, true, 30)
on conflict (name) do nothing;

insert into asr.settings (key, value) values ('公告', '') on conflict do nothing;

-- 預設人員：管理者 1 位（8 碼）、登打 3 位（6 碼）。認證碼請到 Table Editor → asr.staff 查看或修改。
insert into asr.staff (name, code, role)
select * from (values
  ('管理者', upper(substr(md5(random()::text), 1, 8)), 'admin'),
  ('登打甲', lpad((floor(random() * 1000000))::int::text, 6, '0'), 'entry'),
  ('登打乙', lpad((floor(random() * 1000000))::int::text, 6, '0'), 'entry'),
  ('登打丙', lpad((floor(random() * 1000000))::int::text, 6, '0'), 'entry')
) v(name, code, role)
where not exists (select 1 from asr.staff);

-- ---------- 公開讀取（anon 可讀） ----------
create or replace view public.asr_public_results as
  select division, item, rank, school, score, updated_at
    from asr.results where published;

create or replace view public.asr_public_schools as
  select name, elementary, junior, sort from asr.schools order by sort, name;

create or replace view public.asr_public_settings as
  select key, value from asr.settings where key = '公告';

-- ---------- 認證 ----------
create or replace function asr.find_staff(p_code text)
returns asr.staff language sql security definer set search_path = asr, public as $$
  select * from asr.staff
   where active and upper(regexp_replace(code, '[\s-]', '', 'g')) = upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g'))
   limit 1
$$;

-- ---------- 登打人員讀取（附認證碼） ----------
create or replace function public.asr_staff_load(p_code text)
returns jsonb language plpgsql security definer set search_path = asr, public as $$
declare u asr.staff;
begin
  u := asr.find_staff(p_code);
  if u.id is null then return jsonb_build_object('ok', false, 'error', '認證碼不正確'); end if;
  return jsonb_build_object(
    'ok', true,
    'user', jsonb_build_object('name', u.name, 'role', u.role),
    'announcement', coalesce((select value from asr.settings where key = '公告'), ''),
    'schools', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'elementary', elementary, 'junior', junior) order by sort, name) from asr.schools), '[]'::jsonb),
    'results', coalesce((select jsonb_agg(jsonb_build_object('division', division, 'item', item, 'rank', rank, 'school', school, 'score', coalesce(score, ''), 'published', published,
                 'updated_at', to_char(updated_at at time zone 'Asia/Taipei', 'YYYY-MM-DD HH24:MI:SS'), 'updated_by', coalesce(updated_by, '')) order by division, item, rank) from asr.results), '[]'::jsonb)
  );
end $$;

-- ---------- 儲存一個項目（整個項目的名次一次取代） ----------
create or replace function public.asr_save_item(p_code text, p_division text, p_item text, p_publish boolean, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = asr, public as $$
declare
  u asr.staff;
  max_rank int;
  r jsonb;
  v_rank int; v_school text; v_score text;
  before jsonb;
  n int := 0;
begin
  u := asr.find_staff(p_code);
  if u.id is null then return jsonb_build_object('ok', false, 'error', '認證碼不正確或已停用'); end if;
  if p_division = '國小組' then max_rank := 8; elsif p_division = '國中組' then max_rank := 3;
  else return jsonb_build_object('ok', false, 'error', '組別不正確'); end if;
  if p_item is null or length(p_item) = 0 or length(p_item) > 40 then return jsonb_build_object('ok', false, 'error', '項目不正確'); end if;

  -- 檢查
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_rank := (r->>'rank')::int; v_school := trim(r->>'school');
    if v_school is null or v_school = '' then continue; end if;
    if v_rank is null or v_rank < 1 or v_rank > max_rank then return jsonb_build_object('ok', false, 'error', '名次須為 1–' || max_rank); end if;
    if not exists (select 1 from asr.schools s where s.name = v_school and ((p_division = '國小組' and s.elementary) or (p_division = '國中組' and s.junior))) then
      return jsonb_build_object('ok', false, 'error', v_school || ' 不在' || p_division || '的學校名單中');
    end if;
  end loop;
  if (select count(*) from (select distinct trim(x->>'school') s from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x where trim(x->>'school') <> '') d)
     <> (select count(*) from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x where trim(x->>'school') <> '') then
    return jsonb_build_object('ok', false, 'error', '同一所學校重複出現');
  end if;

  -- 鎖定此項目，避免兩人同時儲存互相覆蓋
  perform pg_advisory_xact_lock(hashtext(p_division || '|' || p_item));
  before := coalesce((select jsonb_agg(jsonb_build_object('rank', rank, 'school', school, 'score', score, 'published', published) order by rank)
                        from asr.results where division = p_division and item = p_item), '[]'::jsonb);
  delete from asr.results where division = p_division and item = p_item;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_rank := (r->>'rank')::int; v_school := trim(r->>'school'); v_score := left(trim(coalesce(r->>'score', '')), 40);
    if v_school is null or v_school = '' then continue; end if;
    insert into asr.results (division, item, rank, school, score, published, updated_by)
      values (p_division, p_item, v_rank, v_school, nullif(v_score, ''), p_publish, u.name);
    n := n + 1;
  end loop;
  insert into asr.log (who, action, detail) values (u.name, case when p_publish then '儲存並公布' else '儲存草稿' end,
    jsonb_build_object('division', p_division, 'item', p_item, 'before', before, 'after', p_rows));
  return jsonb_build_object('ok', true, 'saved', n, 'published', p_publish, 'updated_at', to_char(now() at time zone 'Asia/Taipei', 'YYYY-MM-DD HH24:MI:SS'));
end $$;

-- ---------- 公告（管理者） ----------
create or replace function public.asr_set_announcement(p_code text, p_text text)
returns jsonb language plpgsql security definer set search_path = asr, public as $$
declare u asr.staff;
begin
  u := asr.find_staff(p_code);
  if u.id is null then return jsonb_build_object('ok', false, 'error', '認證碼不正確或已停用'); end if;
  if u.role <> 'admin' then return jsonb_build_object('ok', false, 'error', '只有管理者可以修改公告'); end if;
  insert into asr.settings (key, value) values ('公告', left(coalesce(p_text, ''), 200))
    on conflict (key) do update set value = excluded.value;
  insert into asr.log (who, action, detail) values (u.name, '公告', to_jsonb(p_text));
  return jsonb_build_object('ok', true);
end $$;

-- ---------- 權限：anon 只能讀公開 view 與呼叫上述函式 ----------
revoke all on schema asr from anon, authenticated;
revoke all on all tables in schema asr from anon, authenticated;
grant usage on schema public to anon;
grant select on public.asr_public_results, public.asr_public_schools, public.asr_public_settings to anon, authenticated;
grant execute on function public.asr_staff_load(text), public.asr_save_item(text, text, text, boolean, jsonb), public.asr_set_announcement(text, text) to anon, authenticated;
