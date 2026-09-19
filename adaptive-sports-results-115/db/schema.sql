-- 115年度新竹縣第23屆特殊教育學生適應體育趣味運動競賽 成績公告系統
-- 資料庫結構（PostgreSQL 14+）。此檔可重複執行（idempotent）。

CREATE TABLE IF NOT EXISTS events (
  id           SERIAL PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  edition      TEXT,
  event_date   DATE,
  venue        TEXT,
  organizer    TEXT,
  is_demo      BOOLEAN NOT NULL DEFAULT FALSE,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 組別：國小組 / 國中組
CREATE TABLE IF NOT EXISTS divisions (
  id            SERIAL PRIMARY KEY,
  event_id      INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,            -- elementary | junior
  name          TEXT NOT NULL,            -- 國小組 / 國中組
  award_places  INT NOT NULL DEFAULT 3,   -- 公開頁顯示的名次上限（國小 8、國中 3）
  spirit_places INT NOT NULL DEFAULT 3,   -- 精神總錦標錄取名額
  sort_order    INT NOT NULL DEFAULT 0,
  UNIQUE (event_id, code)
);

-- 競賽項目（含精神總錦標，kind = spirit）
CREATE TABLE IF NOT EXISTS items (
  id          SERIAL PRIMARY KEY,
  event_id    INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'ranked',  -- ranked | knockout | spirit
  score_kind  TEXT NOT NULL DEFAULT 'none',    -- none | number | text
  score_unit  TEXT,                            -- 分、秒、顆…（可空）
  score_min   NUMERIC,
  score_max   NUMERIC,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (event_id, name)
);

CREATE TABLE IF NOT EXISTS schools (
  id         SERIAL PRIMARY KEY,
  event_id   INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  short_name TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE (event_id, name)
);

-- 隊伍：學校在某組別的參賽單位（同校多隊可用 label 區分：A隊、B隊）
CREATE TABLE IF NOT EXISTS teams (
  id          SERIAL PRIMARY KEY,
  event_id    INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  division_id INT NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
  school_id   INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  label       TEXT NOT NULL DEFAULT '',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (division_id, school_id, label)
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','entry','reviewer')),
  password_hash TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS invitations (
  id          SERIAL PRIMARY KEY,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin','entry','reviewer')),
  token_hash  TEXT NOT NULL UNIQUE,
  created_by  INT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- 分工：使用者可處理的（組別、項目）
CREATE TABLE IF NOT EXISTS assignments (
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  division_id INT NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
  item_id     INT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, division_id, item_id)
);

-- 成績表：每個（組別、項目）一張工作表，狀態流程 draft → pending → published
CREATE TABLE IF NOT EXISTS sheets (
  id            SERIAL PRIMARY KEY,
  event_id      INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  division_id   INT NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
  item_id       INT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','published')),
  version       INT NOT NULL DEFAULT 1,      -- 樂觀鎖：每次儲存 +1
  revision      INT NOT NULL DEFAULT 1,      -- 發布版次：修訂草稿 +1
  note          TEXT,                        -- 輸入者備註
  return_note   TEXT,                        -- 複核退回原因
  updated_by    INT REFERENCES users(id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_by  INT REFERENCES users(id),
  submitted_at  TIMESTAMPTZ,
  UNIQUE (division_id, item_id)
);

CREATE TABLE IF NOT EXISTS sheet_rows (
  id        SERIAL PRIMARY KEY,
  sheet_id  INT NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  team_id   INT NOT NULL REFERENCES teams(id),
  rank      INT NOT NULL CHECK (rank >= 1 AND rank <= 99),
  tied      BOOLEAN NOT NULL DEFAULT FALSE,  -- 經確認的並列名次
  score     TEXT,
  remark    TEXT,
  UNIQUE (sheet_id, team_id)
);

-- 已發布版本（公開頁唯一資料來源）
CREATE TABLE IF NOT EXISTS publications (
  id           SERIAL PRIMARY KEY,
  sheet_id     INT NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  event_id     INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  division_id  INT NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
  item_id      INT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  revision     INT NOT NULL,
  rows         JSONB NOT NULL,              -- 快照：[{rank, tied, school, label, score, remark}]
  published_by INT REFERENCES users(id),
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_current   BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS publications_current_idx ON publications (division_id, item_id) WHERE is_current;

-- 冪等鍵：離線重送時避免重複寫入
CREATE TABLE IF NOT EXISTS client_ops (
  op_id      TEXT PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  result     JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 操作紀錄：誰、何時、做了什麼、修改前後
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id     INT REFERENCES users(id),
  user_name   TEXT,
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   INT,
  before      JSONB,
  after       JSONB
);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log (entity, entity_id);
