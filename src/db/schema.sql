-- MedAdapt Database Schema
-- SQLite database for adaptive medical learning

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    specialty TEXT DEFAULT 'general',
    experience_years INTEGER DEFAULT 0,
    level TEXT DEFAULT 'intern' CHECK(level IN ('student', 'intern', 'resident', 'specialist', 'consultant')),
    goals TEXT DEFAULT '[]', -- JSON array of learning goals
    daily_study_minutes INTEGER DEFAULT 30,
    preferred_language TEXT DEFAULT 'vi',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Competency Domains (seeded on setup)
CREATE TABLE IF NOT EXISTS competency_domains (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain_id TEXT NOT NULL UNIQUE,
    domain_name TEXT NOT NULL,
    subdomain TEXT,
    parent_domain_id TEXT,
    is_critical INTEGER DEFAULT 0,
    display_order INTEGER DEFAULT 0,
    icon TEXT DEFAULT '📋'
);

-- Competency Tracker (one row per user per domain)
CREATE TABLE IF NOT EXISTS tracker (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    domain_id TEXT NOT NULL REFERENCES competency_domains(domain_id),
    score REAL DEFAULT 0,           -- 0-100
    confidence REAL DEFAULT 0,      -- 0-1
    bloom_level TEXT DEFAULT 'remember', -- remember/understand/apply/analyze/evaluate/create
    mastery_level TEXT DEFAULT 'novice' CHECK(mastery_level IN ('novice', 'beginner', 'intermediate', 'advanced', 'proficient', 'expert')),
    questions_attempted INTEGER DEFAULT 0,
    questions_correct INTEGER DEFAULT 0,
    last_tested DATETIME,
    next_review DATETIME,
    interval_days REAL DEFAULT 1,
    easiness_factor REAL DEFAULT 2.5,
    repetition INTEGER DEFAULT 0,
    streak INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, domain_id)
);

-- Tracker History (snapshots for trend analysis)
CREATE TABLE IF NOT EXISTS tracker_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    domain_id TEXT NOT NULL,
    score REAL,
    confidence REAL,
    mastery_level TEXT,
    snapshot_date DATE DEFAULT (date('now')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Test Sessions
CREATE TABLE IF NOT EXISTS test_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    type TEXT NOT NULL CHECK(type IN ('diagnostic', 'daily', 'review', 'custom')),
    total_questions INTEGER DEFAULT 0,
    correct_count INTEGER DEFAULT 0,
    score REAL DEFAULT 0,
    time_spent INTEGER DEFAULT 0,     -- seconds
    domains_covered TEXT DEFAULT '[]', -- JSON array
    ai_analysis TEXT,                 -- JSON: AI analysis results
    status TEXT DEFAULT 'in_progress' CHECK(status IN ('in_progress', 'completed', 'abandoned')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
);

-- Test Questions
CREATE TABLE IF NOT EXISTS test_questions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES test_sessions(id),
    domain_id TEXT NOT NULL,
    subdomain TEXT,
    question_text TEXT NOT NULL,
    clinical_vignette TEXT,
    options TEXT NOT NULL,        -- JSON array of {id, text}
    correct_answer TEXT NOT NULL, -- option id
    explanation TEXT,
    bloom_level TEXT DEFAULT 'remember',
    difficulty INTEGER DEFAULT 3 CHECK(difficulty BETWEEN 1 AND 5),
    tags TEXT DEFAULT '[]',      -- JSON array
    order_index INTEGER DEFAULT 0
);

-- Test Answers
CREATE TABLE IF NOT EXISTS test_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id TEXT NOT NULL REFERENCES test_questions(id),
    session_id TEXT NOT NULL REFERENCES test_sessions(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    user_answer TEXT,
    is_correct INTEGER DEFAULT 0,
    time_spent INTEGER DEFAULT 0, -- seconds per question
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Lessons
CREATE TABLE IF NOT EXISTS lessons (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    domain_id TEXT NOT NULL,
    subdomain TEXT,
    title TEXT NOT NULL,
    lesson_type TEXT DEFAULT 'theory' CHECK(lesson_type IN ('theory', 'case_based', 'review', 'deep_dive')),
    content TEXT NOT NULL,        -- Full markdown content
    objectives TEXT DEFAULT '[]', -- JSON array
    key_points TEXT DEFAULT '[]', -- JSON array
    clinical_pearls TEXT DEFAULT '[]',
    self_check TEXT DEFAULT '[]', -- JSON array of self-check questions
    difficulty INTEGER DEFAULT 3,
    estimated_minutes INTEGER DEFAULT 15,
    is_completed INTEGER DEFAULT 0,
    completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Daily Progress
CREATE TABLE IF NOT EXISTS daily_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    date DATE NOT NULL DEFAULT (date('now')),
    tests_taken INTEGER DEFAULT 0,
    lessons_completed INTEGER DEFAULT 0,
    questions_attempted INTEGER DEFAULT 0,
    questions_correct INTEGER DEFAULT 0,
    avg_score REAL DEFAULT 0,
    study_minutes INTEGER DEFAULT 0,
    domains_studied TEXT DEFAULT '[]', -- JSON array
    streak INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, date)
);

-- Learning Path
CREATE TABLE IF NOT EXISTS learning_path (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    domain_id TEXT NOT NULL,
    priority INTEGER DEFAULT 3, -- 1=highest
    planned_date DATE,
    lesson_type TEXT DEFAULT 'theory',
    difficulty INTEGER DEFAULT 3,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'skipped')),
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Notion Sync Metadata
CREATE TABLE IF NOT EXISTS notion_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    workspace_page_id TEXT,
    tracker_db_id TEXT,
    tracker_ds_id TEXT,
    tests_db_id TEXT,
    tests_ds_id TEXT,
    lessons_db_id TEXT,
    lessons_ds_id TEXT,
    progress_db_id TEXT,
    progress_ds_id TEXT,
    last_synced DATETIME,
    sync_enabled INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

-- Settings
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    key TEXT NOT NULL,
    value TEXT,
    UNIQUE(user_id, key)
);

-- Badges earned
CREATE TABLE IF NOT EXISTS badges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    badge_id TEXT NOT NULL,
    badge_name TEXT NOT NULL,
    badge_icon TEXT,
    earned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, badge_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tracker_user ON tracker(user_id);
CREATE INDEX IF NOT EXISTS idx_tracker_domain ON tracker(domain_id);
CREATE INDEX IF NOT EXISTS idx_tracker_history_user ON tracker_history(user_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_test_sessions_user ON test_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_test_questions_session ON test_questions(session_id);
CREATE INDEX IF NOT EXISTS idx_test_answers_session ON test_answers(session_id);
CREATE INDEX IF NOT EXISTS idx_lessons_user ON lessons(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_progress_user ON daily_progress(user_id, date);
CREATE INDEX IF NOT EXISTS idx_learning_path_user ON learning_path(user_id, planned_date);

-- Seed: Competency Domains (13 USMLE Step 1 & Step 2 CK Specialties)
INSERT OR IGNORE INTO competency_domains (domain_id, domain_name, subdomain, is_critical, display_order, icon) VALUES
('internal', 'Nội khoa (Internal Medicine)', NULL, 1, 1, '🫀'),
('surgery', 'Ngoại khoa & Chấn thương (Surgery & Trauma)', NULL, 1, 2, '🔪'),
('obgyn', 'Sản phụ khoa (OB/GYN)', NULL, 1, 3, '🤰'),
('pediatrics', 'Nhi khoa (Pediatrics)', NULL, 1, 4, '👶'),
('emergency', 'Cấp cứu & Hồi sức (Emergency & Critical Care)', NULL, 1, 5, '🚑'),
('psychiatry', 'Tâm thần & Thần kinh (Psychiatry & Neurology)', NULL, 0, 6, '🧠'),
('pathology', 'Giải phẫu bệnh & Sinh lý bệnh (Pathology)', NULL, 1, 7, '🔬'),
('pharmacology', 'Dược lý lâm sàng (Pharmacology)', NULL, 1, 8, '💊'),
('physiology', 'Sinh lý học y khoa (Medical Physiology)', NULL, 1, 9, '⚡'),
('microbiology', 'Vi sinh & Miễn dịch học (Microbiology & Immunology)', NULL, 0, 10, '🦠'),
('biochemistry', 'Hóa sinh & Di truyền y khoa (Biochemistry & Genetics)', NULL, 0, 11, '🧬'),
('community', 'Y học dự phòng, Thống kê & Y đức (Preventive, Biostats & Ethics)', NULL, 0, 12, '🌍'),
('diagnostics', 'Cận lâm sàng & Chẩn đoán hình ảnh (Diagnostics)', NULL, 0, 13, '📷');
