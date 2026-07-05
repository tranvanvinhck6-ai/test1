'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

/**
 * MedAdapt Database Layer
 * Handles all database operations with better-sqlite3
 */
class MedAdaptDB {
  /**
   * @param {string} dbPath - Path to SQLite database file
   */
  constructor(dbPath) {
    // Chọn đường dẫn GHI ĐƯỢC; nếu DB_PATH cấu hình sai (vd /data chưa gắn disk trên cloud)
    // thì tự chuyển về thư mục project ./data, cuối cùng là thư mục tạm — KHÔNG crash.
    dbPath = MedAdaptDB._ensureWritablePath(dbPath);
    this.dbPath = dbPath;

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('temp_store = MEMORY');
    this.db.pragma('cache_size = -16000');
    this.db.pragma('mmap_size = 268435456');
    this._stmtCache = new Map();
    this._initialize();
  }

  /** Trả về đường dẫn DB ghi được; thử dbPath -> ./data project -> os.tmpdir */
  static _ensureWritablePath(dbPath) {
    const os = require('os');
    const canUse = (p) => {
      try {
        const dir = path.dirname(p);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.accessSync(dir, fs.constants.W_OK);
        return true;
      } catch (e) { return false; }
    };
    if (canUse(dbPath)) return dbPath;

    const projectDb = path.join(__dirname, '..', '..', 'data', 'medadapt.db');
    if (projectDb !== dbPath && canUse(projectDb)) {
      console.warn(`[DB] ⚠️  Không ghi được '${dbPath}'. Dùng '${projectDb}'. ` +
        `(Muốn dữ liệu bền trên cloud: gắn Disk và trỏ DB_PATH vào mount path đó.)`);
      return projectDb;
    }

    const tmpDb = path.join(os.tmpdir(), 'medadapt.db');
    console.warn(`[DB] ⚠️  Không ghi được '${dbPath}'. Dùng thư mục tạm '${tmpDb}' (dữ liệu KHÔNG bền).`);
    return tmpDb;
  }

  /** Initialize database with schema */
  _initialize() {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    this.db.exec(schema);
    console.log('[DB] Database initialized successfully');
  }

  // ═══════════════════════════════════════════
  // RAW SQL WRAPPERS (với Statement Cache cho hiệu năng cao)
  // ═══════════════════════════════════════════
  /** @private Lấy (và cache) prepared statement theo chuỗi SQL */
  _prep(sql) {
    let stmt = this._stmtCache.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this._stmtCache.set(sql, stmt);
    }
    return stmt;
  }
  get(sql, params = []) { return this._prep(sql).get(...(Array.isArray(params) ? params : [params])); }
  all(sql, params = []) { return this._prep(sql).all(...(Array.isArray(params) ? params : [params])); }
  run(sql, params = []) { return this._prep(sql).run(...(Array.isArray(params) ? params : [params])); }

  // ═══════════════════════════════════════════
  // USER OPERATIONS
  // ═══════════════════════════════════════════

  /**
   * Create a new user
   * @param {Object} userData
   * @returns {Object} Created user
   */
  createUser({ name, email, specialty, experience_years, level, goals, daily_study_minutes }) {
    const id = uuidv4();
    const goalsJson = JSON.stringify(goals || []);
    const stmt = this.db.prepare(`
      INSERT INTO users (id, name, email, specialty, experience_years, level, goals, daily_study_minutes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, name, email || null, specialty || 'general', experience_years || 0, level || 'intern', goalsJson, daily_study_minutes || 30);
    return this.getUser(id);
  }

  /**
   * Get user by ID
   * @param {string} userId
   * @returns {Object|null}
   */
  getUser(userId) {
    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (user && user.goals) {
      try {
        user.goals = JSON.parse(user.goals);
      } catch (e) {
        user.goals = [user.goals];
      }
    }
    return user || null;
  }

  /**
   * Get first/default user (for single-user mode)
   * @returns {Object|null}
   */
  getDefaultUser() {
    const user = this.db.prepare('SELECT * FROM users ORDER BY created_at ASC LIMIT 1').get();
    if (user && user.goals) {
      try {
        user.goals = JSON.parse(user.goals);
      } catch (e) {
        user.goals = [user.goals];
      }
    }
    return user || null;
  }

  /**
   * Update user profile
   * @param {string} userId
   * @param {Object} updates
   */
  updateUser(userId, updates) {
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(updates)) {
      if (['name', 'email', 'specialty', 'experience_years', 'level', 'goals', 'daily_study_minutes', 'preferred_language'].includes(key)) {
        fields.push(`${key} = ?`);
        values.push(key === 'goals' ? JSON.stringify(value) : value);
      }
    }
    if (fields.length === 0) return;
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(userId);
    this.db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  // ═══════════════════════════════════════════
  // COMPETENCY DOMAINS
  // ═══════════════════════════════════════════

  /** Get all domains */
  getDomains() {
    return this.db.prepare('SELECT * FROM competency_domains ORDER BY display_order').all();
  }

  /** Get main domains (no subdomain) */
  getMainDomains() {
    return this.db.prepare('SELECT * FROM competency_domains WHERE subdomain IS NULL ORDER BY display_order').all();
  }

  /** Get subdomains of a domain */
  getSubdomains(parentDomainId) {
    return this.db.prepare(
      "SELECT * FROM competency_domains WHERE domain_id LIKE ? AND subdomain IS NOT NULL ORDER BY display_order"
    ).all(`${parentDomainId}%`);
  }

  // ═══════════════════════════════════════════
  // TRACKER OPERATIONS
  // ═══════════════════════════════════════════

  /**
   * Get tracker for a user
   * @param {string} userId
   * @returns {Array} Tracker entries with domain info
   */
  getTracker(userId) {
    return this.db.prepare(`
      SELECT t.*, cd.domain_name, cd.subdomain, cd.icon, cd.is_critical, cd.display_order
      FROM tracker t
      JOIN competency_domains cd ON t.domain_id = cd.domain_id
      WHERE t.user_id = ?
      ORDER BY cd.display_order
    `).all(userId);
  }

  /**
   * Get tracker entry for specific domain
   */
  getTrackerEntry(userId, domainId) {
    return this.db.prepare(`
      SELECT t.*, cd.domain_name, cd.subdomain, cd.icon
      FROM tracker t
      JOIN competency_domains cd ON t.domain_id = cd.domain_id
      WHERE t.user_id = ? AND t.domain_id = ?
    `).get(userId, domainId);
  }

  /**
   * Upsert tracker entry
   * @param {string} userId
   * @param {Object} entry
   */
  upsertTracker(userId, entry) {
    const stmt = this.db.prepare(`
      INSERT INTO tracker (user_id, domain_id, score, confidence, bloom_level, mastery_level,
        questions_attempted, questions_correct, last_tested, next_review,
        interval_days, easiness_factor, repetition, streak, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, domain_id) DO UPDATE SET
        score = excluded.score,
        confidence = excluded.confidence,
        bloom_level = excluded.bloom_level,
        mastery_level = excluded.mastery_level,
        questions_attempted = tracker.questions_attempted + excluded.questions_attempted,
        questions_correct = tracker.questions_correct + excluded.questions_correct,
        last_tested = excluded.last_tested,
        next_review = excluded.next_review,
        interval_days = excluded.interval_days,
        easiness_factor = excluded.easiness_factor,
        repetition = excluded.repetition,
        streak = excluded.streak,
        updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(
      userId,
      entry.domain_id,
      entry.score || 0,
      entry.confidence || 0,
      entry.bloom_level || 'remember',
      entry.mastery_level || 'novice',
      entry.questions_attempted || 0,
      entry.questions_correct || 0,
      entry.last_tested || new Date().toISOString(),
      entry.next_review || null,
      entry.interval_days || 1,
      entry.easiness_factor || 2.5,
      entry.repetition || 0,
      entry.streak || 0
    );
  }

  /**
   * Initialize tracker for all domains for a user
   */
  initializeTracker(userId) {
    const domains = this.getDomains();
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO tracker (user_id, domain_id, score, confidence, mastery_level)
      VALUES (?, ?, 0, 0, 'novice')
    `);
    const insertMany = this.db.transaction((domains) => {
      for (const domain of domains) {
        stmt.run(userId, domain.domain_id);
      }
    });
    insertMany(domains);
  }

  /**
   * Save tracker snapshot for history
   */
  saveTrackerSnapshot(userId) {
    const tracker = this.getTracker(userId);
    const stmt = this.db.prepare(`
      INSERT INTO tracker_history (user_id, domain_id, score, confidence, mastery_level)
      VALUES (?, ?, ?, ?, ?)
    `);
    const saveAll = this.db.transaction((entries) => {
      for (const entry of entries) {
        stmt.run(userId, entry.domain_id, entry.score, entry.confidence, entry.mastery_level);
      }
    });
    saveAll(tracker);
  }

  /**
   * Get tracker history for trend analysis
   */
  getTrackerHistory(userId, days = 30) {
    return this.db.prepare(`
      SELECT * FROM tracker_history
      WHERE user_id = ? AND snapshot_date >= date('now', '-' || ? || ' days')
      ORDER BY snapshot_date ASC, domain_id
    `).all(userId, days);
  }

  // ═══════════════════════════════════════════
  // TEST SESSION OPERATIONS
  // ═══════════════════════════════════════════

  /**
   * Create test session
   */
  createTestSession(userId, type, totalQuestions = 0) {
    const id = uuidv4();
    this.db.prepare(`
      INSERT INTO test_sessions (id, user_id, type, total_questions, status)
      VALUES (?, ?, ?, ?, 'in_progress')
    `).run(id, userId, type, totalQuestions);
    return id;
  }

  /**
   * Add questions to test session
   */
  addTestQuestions(sessionId, questions) {
    const stmt = this.db.prepare(`
      INSERT INTO test_questions (id, session_id, domain_id, subdomain, question_text, clinical_vignette,
        options, correct_answer, explanation, bloom_level, difficulty, tags, order_index)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMany = this.db.transaction((questions) => {
      questions.forEach((q, index) => {
        const qId = q.id || uuidv4();
        stmt.run(
          qId, sessionId, q.domain_id, q.subdomain || null,
          q.question_text, q.clinical_vignette || null,
          JSON.stringify(q.options), q.correct_answer,
          q.explanation || null, q.bloom_level || 'remember',
          q.difficulty || 3, JSON.stringify(q.tags || []), index
        );
      });
    });
    insertMany(questions);
    // Update total count
    this.db.prepare('UPDATE test_sessions SET total_questions = ? WHERE id = ?').run(questions.length, sessionId);
  }

  /**
   * Get test session with questions
   */
  getTestSession(sessionId) {
    const session = this.db.prepare('SELECT * FROM test_sessions WHERE id = ?').get(sessionId);
    if (!session) return null;
    if (session.domains_covered) session.domains_covered = JSON.parse(session.domains_covered);
    if (session.ai_analysis) session.ai_analysis = JSON.parse(session.ai_analysis);

    session.questions = this.db.prepare(
      'SELECT * FROM test_questions WHERE session_id = ? ORDER BY order_index'
    ).all(sessionId).map(q => {
      q.options = JSON.parse(q.options);
      q.tags = JSON.parse(q.tags);
      return q;
    });

    session.answers = this.db.prepare(
      'SELECT * FROM test_answers WHERE session_id = ?'
    ).all(sessionId);

    return session;
  }

  /**
   * Submit test answers
   */
  submitTestAnswers(sessionId, userId, answers) {
    const questions = this.db.prepare(
      'SELECT id, correct_answer FROM test_questions WHERE session_id = ?'
    ).all(sessionId);

    const questionMap = new Map(questions.map(q => [q.id, q.correct_answer]));
    let correctCount = 0;

    const stmt = this.db.prepare(`
      INSERT INTO test_answers (question_id, session_id, user_id, user_answer, is_correct, time_spent)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const submitAll = this.db.transaction((answers) => {
      for (const answer of answers) {
        const isCorrect = questionMap.get(answer.question_id) === answer.answer ? 1 : 0;
        if (isCorrect) correctCount++;
        stmt.run(answer.question_id, sessionId, userId, answer.answer, isCorrect, answer.time_spent || 0);
      }
    });
    submitAll(answers);

    // Update session
    const score = questions.length > 0 ? (correctCount / questions.length) * 100 : 0;
    const totalTime = answers.reduce((sum, a) => sum + (a.time_spent || 0), 0);
    const domainsCovered = [...new Set(
      this.db.prepare('SELECT DISTINCT domain_id FROM test_questions WHERE session_id = ?')
        .all(sessionId).map(r => r.domain_id)
    )];

    this.db.prepare(`
      UPDATE test_sessions SET
        correct_count = ?, score = ?, time_spent = ?,
        domains_covered = ?, status = 'completed', completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(correctCount, score, totalTime, JSON.stringify(domainsCovered), sessionId);

    return { correctCount, totalQuestions: questions.length, score, domainsCovered };
  }

  /**
   * Get recent test sessions for a user
   */
  getRecentTests(userId, limit = 10) {
    return this.db.prepare(`
      SELECT * FROM test_sessions
      WHERE user_id = ? AND status = 'completed'
      ORDER BY completed_at DESC LIMIT ?
    `).all(userId, limit).map(s => {
      if (s.domains_covered) s.domains_covered = JSON.parse(s.domains_covered);
      return s;
    });
  }

  /**
   * Get test results by domain
   */
  getTestResultsByDomain(sessionId) {
    return this.db.prepare(`
      SELECT
        tq.domain_id,
        cd.domain_name,
        cd.icon,
        COUNT(*) as total,
        SUM(ta.is_correct) as correct,
        ROUND(CAST(SUM(ta.is_correct) AS REAL) / COUNT(*) * 100, 1) as score
      FROM test_questions tq
      JOIN test_answers ta ON tq.id = ta.question_id
      JOIN competency_domains cd ON tq.domain_id = cd.domain_id
      WHERE tq.session_id = ?
      GROUP BY tq.domain_id
      ORDER BY score ASC
    `).all(sessionId);
  }

  // ═══════════════════════════════════════════
  // LESSON OPERATIONS
  // ═══════════════════════════════════════════

  /**
   * Create a lesson
   */
  createLesson(userId, lessonData) {
    const id = uuidv4();
    this.db.prepare(`
      INSERT INTO lessons (id, user_id, domain_id, subdomain, title, lesson_type,
        content, objectives, key_points, clinical_pearls, self_check, difficulty, estimated_minutes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, userId, lessonData.domain_id, lessonData.subdomain || null,
      lessonData.title, lessonData.lesson_type || 'theory',
      lessonData.content,
      JSON.stringify(lessonData.objectives || []),
      JSON.stringify(lessonData.key_points || []),
      JSON.stringify(lessonData.clinical_pearls || []),
      JSON.stringify(lessonData.self_check || []),
      lessonData.difficulty || 3,
      lessonData.estimated_minutes || 15
    );
    return this.getLesson(id);
  }

  /** Get lesson by ID */
  getLesson(lessonId) {
    const lesson = this.db.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId);
    if (!lesson) return null;
    lesson.objectives = JSON.parse(lesson.objectives);
    lesson.key_points = JSON.parse(lesson.key_points);
    lesson.clinical_pearls = JSON.parse(lesson.clinical_pearls);
    lesson.self_check = JSON.parse(lesson.self_check);
    return lesson;
  }

  /** Get today's lessons for user */
  getTodayLessons(userId) {
    return this.db.prepare(`
      SELECT * FROM lessons
      WHERE user_id = ? AND date(created_at) = date('now')
      ORDER BY created_at DESC
    `).all(userId).map(l => {
      l.objectives = JSON.parse(l.objectives);
      l.key_points = JSON.parse(l.key_points);
      l.clinical_pearls = JSON.parse(l.clinical_pearls);
      l.self_check = JSON.parse(l.self_check);
      return l;
    });
  }

  /** Mark lesson completed */
  completeLesson(lessonId) {
    this.db.prepare(`
      UPDATE lessons SET is_completed = 1, completed_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(lessonId);
  }

  /** Get recent lessons */
  getRecentLessons(userId, limit = 10) {
    return this.db.prepare(`
      SELECT id, domain_id, subdomain, title, lesson_type, difficulty,
        estimated_minutes, is_completed, created_at
      FROM lessons WHERE user_id = ?
      ORDER BY created_at DESC LIMIT ?
    `).all(userId, limit);
  }

  // ═══════════════════════════════════════════
  // DAILY PROGRESS OPERATIONS
  // ═══════════════════════════════════════════

  /**
   * Update or create daily progress
   */
  updateDailyProgress(userId, data) {
    const today = new Date().toISOString().split('T')[0];

    // Calculate streak
    const yesterday = this.db.prepare(`
      SELECT streak FROM daily_progress
      WHERE user_id = ? AND date = date('now', '-1 day')
    `).get(userId);
    const currentStreak = yesterday ? yesterday.streak + 1 : 1;

    this.db.prepare(`
      INSERT INTO daily_progress (user_id, date, tests_taken, lessons_completed,
        questions_attempted, questions_correct, avg_score, study_minutes, domains_studied, streak)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, date) DO UPDATE SET
        tests_taken = daily_progress.tests_taken + excluded.tests_taken,
        lessons_completed = daily_progress.lessons_completed + excluded.lessons_completed,
        questions_attempted = daily_progress.questions_attempted + excluded.questions_attempted,
        questions_correct = daily_progress.questions_correct + excluded.questions_correct,
        avg_score = CASE
          WHEN daily_progress.tests_taken + excluded.tests_taken > 0
          THEN (daily_progress.avg_score * daily_progress.tests_taken + excluded.avg_score * excluded.tests_taken)
               / (daily_progress.tests_taken + excluded.tests_taken)
          ELSE 0
        END,
        study_minutes = daily_progress.study_minutes + excluded.study_minutes,
        streak = excluded.streak
    `).run(
      userId, today,
      data.tests_taken || 0,
      data.lessons_completed || 0,
      data.questions_attempted || 0,
      data.questions_correct || 0,
      data.avg_score || 0,
      data.study_minutes || 0,
      JSON.stringify(data.domains_studied || []),
      currentStreak
    );
  }

  /** Get daily progress for a date range */
  getProgressHistory(userId, days = 30) {
    return this.db.prepare(`
      SELECT * FROM daily_progress
      WHERE user_id = ? AND date >= date('now', '-' || ? || ' days')
      ORDER BY date ASC
    `).all(userId, days).map(p => {
      p.domains_studied = JSON.parse(p.domains_studied);
      return p;
    });
  }

  /** Get current streak */
  getCurrentStreak(userId) {
    const today = this.db.prepare(
      "SELECT streak FROM daily_progress WHERE user_id = ? AND date = date('now')"
    ).get(userId);
    if (today) return today.streak;

    const yesterday = this.db.prepare(
      "SELECT streak FROM daily_progress WHERE user_id = ? AND date = date('now', '-1 day')"
    ).get(userId);
    return yesterday ? yesterday.streak : 0;
  }

  // ═══════════════════════════════════════════
  // LEARNING PATH OPERATIONS
  // ═══════════════════════════════════════════

  /** Save learning path entries */
  saveLearningPath(userId, entries) {
    // Clear future pending entries
    this.db.prepare(`
      DELETE FROM learning_path
      WHERE user_id = ? AND status = 'pending' AND planned_date >= date('now')
    `).run(userId);

    const stmt = this.db.prepare(`
      INSERT INTO learning_path (user_id, domain_id, priority, planned_date, lesson_type, difficulty, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMany = this.db.transaction((entries) => {
      for (const entry of entries) {
        stmt.run(userId, entry.domain_id, entry.priority || 3, entry.planned_date, entry.lesson_type || 'theory', entry.difficulty || 3, entry.notes || null);
      }
    });
    insertMany(entries);
  }

  /** Get today's learning path */
  getTodayPlan(userId) {
    return this.db.prepare(`
      SELECT lp.*, cd.domain_name, cd.icon
      FROM learning_path lp
      JOIN competency_domains cd ON lp.domain_id = cd.domain_id
      WHERE lp.user_id = ? AND lp.planned_date = date('now')
      ORDER BY lp.priority ASC
    `).all(userId);
  }

  // ═══════════════════════════════════════════
  // NOTION CONFIG
  // ═══════════════════════════════════════════

  /** Save Notion config */
  saveNotionConfig(userId, config) {
    this.db.prepare(`
      INSERT INTO notion_config (user_id, workspace_page_id, tracker_db_id, tracker_ds_id,
        tests_db_id, tests_ds_id, lessons_db_id, lessons_ds_id, progress_db_id, progress_ds_id, sync_enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        workspace_page_id = excluded.workspace_page_id,
        tracker_db_id = excluded.tracker_db_id,
        tracker_ds_id = excluded.tracker_ds_id,
        tests_db_id = excluded.tests_db_id,
        tests_ds_id = excluded.tests_ds_id,
        lessons_db_id = excluded.lessons_db_id,
        lessons_ds_id = excluded.lessons_ds_id,
        progress_db_id = excluded.progress_db_id,
        progress_ds_id = excluded.progress_ds_id,
        sync_enabled = excluded.sync_enabled
    `).run(
      userId, config.workspace_page_id,
      config.tracker_db_id || null, config.tracker_ds_id || null,
      config.tests_db_id || null, config.tests_ds_id || null,
      config.lessons_db_id || null, config.lessons_ds_id || null,
      config.progress_db_id || null, config.progress_ds_id || null,
      config.sync_enabled ? 1 : 0
    );
  }

  /** Get Notion config */
  getNotionConfig(userId) {
    return this.db.prepare('SELECT * FROM notion_config WHERE user_id = ?').get(userId) || null;
  }

  /** Update last synced time */
  updateNotionSyncTime(userId) {
    this.db.prepare('UPDATE notion_config SET last_synced = CURRENT_TIMESTAMP WHERE user_id = ?').run(userId);
  }

  // ═══════════════════════════════════════════
  // SETTINGS
  // ═══════════════════════════════════════════

  getSetting(userId, key) {
    const row = this.db.prepare('SELECT value FROM settings WHERE user_id = ? AND key = ?').get(userId, key);
    return row ? row.value : null;
  }

  setSetting(userId, key, value) {
    this.db.prepare(`
      INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)
      ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
    `).run(userId, key, value);
  }

  // ═══════════════════════════════════════════
  // BADGES
  // ═══════════════════════════════════════════

  earnBadge(userId, badge) {
    this.db.prepare(`
      INSERT OR IGNORE INTO badges (user_id, badge_id, badge_name, badge_icon)
      VALUES (?, ?, ?, ?)
    `).run(userId, badge.id, badge.name, badge.icon || '🏆');
  }

  getBadges(userId) {
    return this.db.prepare('SELECT * FROM badges WHERE user_id = ? ORDER BY earned_at DESC').all(userId);
  }

  // ═══════════════════════════════════════════
  // STATISTICS
  // ═══════════════════════════════════════════

  getStats(userId) {
    const totalTests = this.db.prepare(
      "SELECT COUNT(*) as count FROM test_sessions WHERE user_id = ? AND status = 'completed'"
    ).get(userId).count;

    const totalQuestions = this.db.prepare(
      'SELECT SUM(questions_attempted) as total FROM tracker WHERE user_id = ?'
    ).get(userId).total || 0;

    const avgScore = this.db.prepare(
      'SELECT AVG(score) as avg FROM tracker WHERE user_id = ? AND score > 0'
    ).get(userId).avg || 0;

    const masteredDomains = this.db.prepare(
      "SELECT COUNT(*) as count FROM tracker WHERE user_id = ? AND mastery_level IN ('proficient', 'expert')"
    ).get(userId).count;

    const streak = this.getCurrentStreak(userId);
    const badges = this.db.prepare('SELECT COUNT(*) as count FROM badges WHERE user_id = ?').get(userId).count;
    const lessonsCompleted = this.db.prepare(
      'SELECT COUNT(*) as count FROM lessons WHERE user_id = ? AND is_completed = 1'
    ).get(userId).count;

    return {
      totalTests,
      totalQuestions,
      avgScore: Math.round(avgScore * 10) / 10,
      masteredDomains,
      streak,
      badges,
      lessonsCompleted
    };
  }

  /** Close database connection */
  close() {
    this.db.close();
  }
}

module.exports = MedAdaptDB;
