-- Supabase 数据库结构（v0.5 学习记录上云）
-- 用法：Supabase 控制台 → SQL Editor → 粘贴执行
-- 设计原则：单学习者免账号密码（匿名身份），RLS 限定只能读写自己的行

-- 1) SRS 卡片状态（对标 Anki 的卡片表，SM-2 参数）
create table if not exists public.srs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid(),
  card_key text not null,          -- '<packId>/<itemId>'，如 'a1-leccion-1/v1'
  interval_days int not null default 0,
  ease real not null default 2.5,
  due_date date not null,
  lapses int not null default 0,
  updated_at timestamptz not null default now(),
  unique (user_id, card_key)
);

-- 2) 每日活动聚合（对标 Duolingo 的练习记录）
create table if not exists public.activity (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid(),
  day date not null,               -- 自然日
  type text not null,              -- vocab | listen | shadow | dictation | review
  correct int not null default 0,
  total int not null default 0,
  duration_s int not null default 0,
  updated_at timestamptz not null default now(),
  unique (user_id, day, type)
);

-- 3) 发音评分历史（v0.8 SpeechSuper 接入后使用；ELSA 式"薄弱音素档案"的数据源）
create table if not exists public.scores (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid(),
  pack_id text not null,
  sentence_id text not null,
  score real,                      -- 0-100
  phoneme_errors jsonb,            -- [{phoneme, errorType: insertion|deletion|substitution, expected, actual}]
  engine text not null default 'webspeech',  -- webspeech | speechsuper
  created_at timestamptz not null default now()
);

-- 4) 行级安全：匿名/登录身份只能操作自己的数据
alter table public.srs enable row level security;
alter table public.activity enable row level security;
alter table public.scores enable row level security;

create policy "own srs" on public.srs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own activity" on public.activity
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own scores" on public.scores
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 5) 索引（查询模式：按用户+日期、按用户+到期）
create index if not exists srs_user_due_idx on public.srs (user_id, due_date);
create index if not exists activity_user_day_idx on public.activity (user_id, day);
create index if not exists scores_user_time_idx on public.scores (user_id, created_at desc);

-- 说明：
-- - 前端用 supabase-js 的 signInAnonymously() 获得匿名身份（无需用户注册，自动）
-- - anon key 可公开；service_role key 只用于管理端/Edge Function，绝不进网页
-- - 断网时前端 localStorage 兜底，联网后按 (user_id, card_key)/(user_id, day, type) upsert 合并
