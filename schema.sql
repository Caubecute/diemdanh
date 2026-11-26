-- Bảng dữ liệu Điểm Danh (Cloudflare D1)
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,            -- yyyy-mm-dd
  student TEXT NOT NULL,
  grade TEXT DEFAULT '',
  ta TEXT DEFAULT '',            -- tên trợ giảng
  slot TEXT DEFAULT '',          -- giờ học
  status TEXT DEFAULT 'present', -- present | late | excused | absent
  att INTEGER,                   -- thái độ / tập trung 1-10
  hw INTEGER,                    -- bài tập 1-10
  lesson TEXT DEFAULT '',
  note TEXT DEFAULT '',          -- nhận xét của trợ giảng
  todo TEXT DEFAULT '',          -- dặn dò
  teacher_note TEXT DEFAULT '',  -- ghi chú của giáo viên cho buổi đó
  state TEXT DEFAULT 'draft',    -- draft (nháp) | sent (đã gửi GV) | final (GV đã xác nhận)
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_rec_date ON records(date);
CREATE INDEX IF NOT EXISTS idx_rec_student ON records(student, date);
CREATE TABLE IF NOT EXISTS month_evals (
  month TEXT NOT NULL, student TEXT NOT NULL, text TEXT DEFAULT '', updated_at INTEGER,
  PRIMARY KEY (month, student)
);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT, updated_at INTEGER);
