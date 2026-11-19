-- ============================================================
--  같이갈래 — Supabase 테이블 생성 SQL
--  Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run
--  (여러 번 실행해도 안전하도록 작성됨)
-- ============================================================

-- 1) 여행 방
create table if not exists public.rooms (
  id          text primary key,                 -- 방 코드 (?room=xxxx)
  title       text not null,
  days        int  not null default 3 check (days between 1 and 60),
  start_date  date,
  created_at  timestamptz not null default now()
);

-- 2) 장소(핀)
create table if not exists public.places (
  id           uuid primary key default gen_random_uuid(),
  room_id      text not null references public.rooms(id) on delete cascade,
  name         text not null,
  address      text default '',
  lat          double precision not null,
  lng          double precision not null,
  category     text not null default 'tour' check (category in ('food','cafe','stay','tour','shop')),
  proposer     text not null,                   -- 제안자 닉네임
  proposer_id  text,                            -- 제안자 기기 ID
  status       text not null default 'undecided' check (status in ('undecided','needed','done')),
  cost         int,
  day          int,                             -- null = 후보, 1 = 1일차 ...
  order_idx    int,                             -- 그날 방문 순서
  kakao_id     text,                            -- 검색으로 추가된 경우 장소 ID (중복 방지)
  phone        text default '',
  place_url    text default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists places_room_idx on public.places(room_id);

-- 3) 공동 메모
create table if not exists public.memos (
  id          uuid primary key default gen_random_uuid(),
  place_id    uuid not null references public.places(id) on delete cascade,
  room_id     text not null references public.rooms(id) on delete cascade,
  author      text not null,
  author_id   text,
  body        text not null check (char_length(body) <= 1000),
  created_at  timestamptz not null default now(),
  edited_at   timestamptz
);
create index if not exists memos_room_idx on public.memos(room_id);

-- 4) 하트 투표 (한 사람당 장소별 1개)
create table if not exists public.votes (
  place_id    uuid not null references public.places(id) on delete cascade,
  room_id     text not null references public.rooms(id) on delete cascade,
  voter_id    text not null,
  voter_name  text,
  created_at  timestamptz not null default now(),
  primary key (place_id, voter_id)
);
create index if not exists votes_room_idx on public.votes(room_id);

-- 5) 권한(GRANT): anon(로그인 안 한 방문자)·authenticated 역할이
--    테이블을 읽고/쓰고/지울 수 있게 합니다.
--    최근 Supabase 프로젝트는 SQL로 만든 테이블에 이 권한이 자동으로 붙지 않을 수 있어
--    빠지면 "permission denied for table ..." 오류가 납니다.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table
  public.rooms, public.places, public.memos, public.votes
  to anon, authenticated;

-- 6) 행 수준 보안(RLS): 회원가입 없는 "링크 공유" 방식이므로
--    anon 키로 모든 행의 읽기/추가/수정/삭제를 허용합니다.
--    (방 코드를 아는 사람만 해당 방을 찾을 수 있음)
--    GRANT는 "테이블에 접근할 수 있는가", RLS 정책은 "어떤 행에 접근할 수 있는가"를
--    정하므로 둘 다 있어야 동작합니다.
alter table public.rooms  enable row level security;
alter table public.places enable row level security;
alter table public.memos  enable row level security;
alter table public.votes  enable row level security;

drop policy if exists "rooms_all"  on public.rooms;
drop policy if exists "places_all" on public.places;
drop policy if exists "memos_all"  on public.memos;
drop policy if exists "votes_all"  on public.votes;
create policy "rooms_all"  on public.rooms  for all to anon, authenticated using (true) with check (true);
create policy "places_all" on public.places for all to anon, authenticated using (true) with check (true);
create policy "memos_all"  on public.memos  for all to anon, authenticated using (true) with check (true);
create policy "votes_all"  on public.votes  for all to anon, authenticated using (true) with check (true);

-- 7) 실시간(Realtime) 켜기 — 다른 사람이 핀을 추가하면 바로 보이게
alter table public.rooms  replica identity full;
alter table public.places replica identity full;
alter table public.memos  replica identity full;
alter table public.votes  replica identity full;

do $$
declare t text;
begin
  foreach t in array array['rooms','places','memos','votes'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
