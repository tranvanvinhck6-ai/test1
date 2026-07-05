'use strict';

/**
 * @fileoverview NotionAgent - Agent đồng bộ dữ liệu với Notion workspace.
 * Quản lý workspace, đồng bộ tracker, tests, lessons, và progress lên Notion.
 * Không sử dụng Claude API - chỉ tương tác qua NotionSync skill.
 */

class NotionAgent {
  /**
   * Khởi tạo NotionAgent
   * @param {Object} params
   * @param {Object} params.db - Database connection
   * @param {Object} params.skills - Skill instances
   * @param {import('../skills/notion-sync')} params.skills.notionSync - Notion sync skill
   */
  constructor({ db, skills: { notionSync } }) {
    this.db = db;
    this.notionSync = notionSync;

    /**
     * Cache Notion database IDs để tránh query lại mỗi lần.
     * @type {Object|null}
     */
    this.notionDbIds = null;

    console.log('[NotionAgent] Initialized successfully');
  }

  /**
   * Thiết lập Notion workspace với các databases cần thiết.
   * Tạo các databases: Tracker, Tests, Lessons, Daily Progress.
   *
   * @param {string} notionPageId - ID của Notion page gốc
   * @returns {Promise<Object>} Workspace setup result với database IDs
   */
  async setupWorkspace(notionPageId) {
    try {
      console.log(`[NotionAgent] Setting up Notion workspace on page ${notionPageId}`);

      // Database schemas cho MedAdapt
      const databases = {
        tracker: {
          title: '📊 MedAdapt - Competency Tracker',
          properties: {
            'Domain': { type: 'title' },
            'Score': { type: 'number', format: 'percent' },
            'Mastery Level': { type: 'select', options: ['Novice', 'Beginner', 'Intermediate', 'Advanced', 'Expert'] },
            'Bloom Level': { type: 'select', options: ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'] },
            'Confidence': { type: 'select', options: ['Low', 'Medium', 'High'] },
            'Last Tested': { type: 'date' },
            'Interval (days)': { type: 'number' },
            'EF': { type: 'number' },
            'Trend': { type: 'select', options: ['📈 Improving', '📊 Stable', '📉 Declining', '🆕 New'] }
          }
        },
        tests: {
          title: '📝 MedAdapt - Test Results',
          properties: {
            'Test': { type: 'title' },
            'Type': { type: 'select', options: ['Diagnostic', 'Daily', 'Review'] },
            'Score': { type: 'number', format: 'percent' },
            'Questions': { type: 'number' },
            'Correct': { type: 'number' },
            'Date': { type: 'date' },
            'Domains Tested': { type: 'multi_select' },
            'Notes': { type: 'rich_text' }
          }
        },
        lessons: {
          title: '📚 MedAdapt - Lessons',
          properties: {
            'Title': { type: 'title' },
            'Domain': { type: 'select' },
            'Difficulty': { type: 'number' },
            'Type': { type: 'select', options: ['Lesson', 'Case Study'] },
            'Bloom Level': { type: 'select', options: ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'] },
            'Created': { type: 'date' },
            'Completed': { type: 'checkbox' },
            'Notes': { type: 'rich_text' }
          }
        },
        progress: {
          title: '📈 MedAdapt - Daily Progress',
          properties: {
            'Date': { type: 'title' },
            'Tests Taken': { type: 'number' },
            'Lessons Completed': { type: 'number' },
            'Avg Score': { type: 'number', format: 'percent' },
            'Streak': { type: 'number' },
            'Study Minutes': { type: 'number' },
            'Mood': { type: 'select', options: ['🔥 On Fire', '😊 Good', '😐 Okay', '😫 Struggling'] },
            'Notes': { type: 'rich_text' }
          }
        }
      };

      // Create each database via NotionSync
      const createdDbs = {};
      for (const [key, schema] of Object.entries(databases)) {
        const result = await this.notionSync.sync({
          action: 'createDatabase',
          parentPageId: notionPageId,
          title: schema.title,
          properties: schema.properties
        });
        createdDbs[key] = result.id || result.databaseId;
      }

      // Store database IDs in local DB for future reference
      await this._storeNotionDbIds(createdDbs);
      this.notionDbIds = createdDbs;

      console.log('[NotionAgent] Workspace setup complete:', Object.keys(createdDbs));
      return {
        success: true,
        databases: createdDbs,
        message: 'Notion workspace đã được thiết lập thành công'
      };
    } catch (error) {
      console.error('[NotionAgent] Error setting up workspace:', error.message);
      throw new Error(`Không thể thiết lập Notion workspace: ${error.message}`);
    }
  }

  /**
   * Đồng bộ toàn bộ dữ liệu cho user lên Notion.
   *
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Sync result summary
   */
  async syncAll(userId) {
    try {
      console.log(`[NotionAgent] Starting full sync for user ${userId}`);

      const dbIds = await this._getNotionDbIds();
      if (!dbIds) {
        throw new Error('Notion workspace chưa được thiết lập. Hãy chạy setupWorkspace trước.');
      }

      const results = {
        tracker: null,
        tests: null,
        lessons: null,
        progress: null,
        errors: []
      };

      // 1. Sync tracker
      try {
        results.tracker = await this.syncTracker(userId);
      } catch (err) {
        results.errors.push({ component: 'tracker', error: err.message });
        console.warn('[NotionAgent] Tracker sync failed:', err.message);
      }

      // 2. Sync recent tests
      try {
        const recentTests = await this.db.all(
          `SELECT * FROM test_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`,
          [userId]
        );
        for (const test of recentTests) {
          await this.syncTest(test);
        }
        results.tests = { synced: recentTests.length };
      } catch (err) {
        results.errors.push({ component: 'tests', error: err.message });
        console.warn('[NotionAgent] Tests sync failed:', err.message);
      }

      // 3. Sync recent lessons
      try {
        const recentLessons = await this.db.all(
          `SELECT * FROM lessons WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`,
          [userId]
        );
        for (const lesson of recentLessons) {
          await this.syncLesson(lesson);
        }
        results.lessons = { synced: recentLessons.length };
      } catch (err) {
        results.errors.push({ component: 'lessons', error: err.message });
        console.warn('[NotionAgent] Lessons sync failed:', err.message);
      }

      // 4. Sync daily progress
      try {
        const progress = await this.db.all(
          `SELECT * FROM daily_progress WHERE user_id = ? ORDER BY date DESC LIMIT 7`,
          [userId]
        );
        for (const day of progress) {
          await this._syncProgressEntry(day);
        }
        results.progress = { synced: progress.length };
      } catch (err) {
        results.errors.push({ component: 'progress', error: err.message });
        console.warn('[NotionAgent] Progress sync failed:', err.message);
      }

      const hasErrors = results.errors.length > 0;
      console.log(`[NotionAgent] Full sync ${hasErrors ? 'completed with errors' : 'successful'} for user ${userId}`);

      return {
        success: !hasErrors,
        results,
        syncedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('[NotionAgent] Error in syncAll:', error.message);
      throw new Error(`Không thể đồng bộ Notion: ${error.message}`);
    }
  }

  /**
   * Đồng bộ competency tracker lên Notion.
   *
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Sync result
   */
  async syncTracker(userId) {
    try {
      const dbIds = await this._getNotionDbIds();
      if (!dbIds?.tracker) {
        throw new Error('Tracker database chưa được tạo trên Notion');
      }

      const trackerData = await this.db.all(
        'SELECT * FROM tracker WHERE user_id = ?',
        [userId]
      );

      const syncResults = [];
      for (const entry of trackerData) {
        const result = await this.notionSync.sync({
          action: 'upsertPage',
          databaseId: dbIds.tracker,
          uniqueKey: { property: 'Domain', value: entry.domain_id },
          properties: {
            'Domain': entry.domain_id,
            'Score': (entry.score || 0) / 100,
            'Mastery Level': this._capitalize(entry.mastery_level || 'novice'),
            'Bloom Level': this._capitalize(entry.bloom_level || 'remember'),
            'Confidence': this._capitalize(entry.confidence || 'low'),
            'Last Tested': entry.last_tested || new Date().toISOString(),
            'Interval (days)': entry.interval || 1,
            'EF': entry.easiness_factor || 2.5
          }
        });
        syncResults.push(result);
      }

      console.log(`[NotionAgent] Tracker synced: ${syncResults.length} domains`);
      return { synced: syncResults.length, domains: trackerData.map(t => t.domain_id) };
    } catch (error) {
      console.error('[NotionAgent] Error syncing tracker:', error.message);
      throw new Error(`Không thể đồng bộ tracker: ${error.message}`);
    }
  }

  /**
   * Đồng bộ kết quả một bài kiểm tra lên Notion.
   *
   * @param {Object} testSession - Test session object
   * @returns {Promise<Object>} Sync result
   */
  async syncTest(testSession) {
    try {
      const dbIds = await this._getNotionDbIds();
      if (!dbIds?.tests) {
        throw new Error('Tests database chưa được tạo trên Notion');
      }

      // Get domains tested
      const domains = await this.db.all(
        'SELECT DISTINCT domain_id FROM test_questions WHERE session_id = ?',
        [testSession.id]
      );

      const result = await this.notionSync.sync({
        action: 'createPage',
        databaseId: dbIds.tests,
        properties: {
          'Test': `${this._capitalize(testSession.type)} Test #${testSession.id}`,
          'Type': this._capitalize(testSession.type),
          'Score': (testSession.score || 0) / 100,
          'Questions': testSession.total_questions,
          'Correct': testSession.correct_count,
          'Date': testSession.created_at || new Date().toISOString(),
          'Domains Tested': domains.map(d => d.domain_id)
        }
      });

      console.log(`[NotionAgent] Test synced: session ${testSession.id}`);
      return result;
    } catch (error) {
      console.error('[NotionAgent] Error syncing test:', error.message);
      throw new Error(`Không thể đồng bộ test: ${error.message}`);
    }
  }

  /**
   * Đồng bộ một bài học lên Notion.
   *
   * @param {Object} lesson - Lesson object
   * @returns {Promise<Object>} Sync result
   */
  async syncLesson(lesson) {
    try {
      const dbIds = await this._getNotionDbIds();
      if (!dbIds?.lessons) {
        throw new Error('Lessons database chưa được tạo trên Notion');
      }

      let lessonContent = {};
      try {
        lessonContent = typeof lesson.content === 'string' ? JSON.parse(lesson.content) : lesson.content;
      } catch {
        lessonContent = { title: lesson.title };
      }

      const result = await this.notionSync.sync({
        action: 'createPage',
        databaseId: dbIds.lessons,
        properties: {
          'Title': lessonContent.title || lesson.title || 'Untitled Lesson',
          'Domain': lesson.domain_id,
          'Difficulty': lesson.difficulty || 5,
          'Type': lesson.type === 'case_study' ? 'Case Study' : 'Lesson',
          'Bloom Level': this._capitalize(lessonContent.bloom_level || 'apply'),
          'Created': lesson.created_at || new Date().toISOString(),
          'Completed': false
        },
        // Add lesson content as page body
        content: lessonContent.core_knowledge || ''
      });

      console.log(`[NotionAgent] Lesson synced: ${lesson.id}`);
      return result;
    } catch (error) {
      console.error('[NotionAgent] Error syncing lesson:', error.message);
      throw new Error(`Không thể đồng bộ lesson: ${error.message}`);
    }
  }

  // ===================== PRIVATE METHODS =====================

  /**
   * Đồng bộ một entry daily progress
   * @private
   * @param {Object} progressEntry
   * @returns {Promise<Object>}
   */
  async _syncProgressEntry(progressEntry) {
    const dbIds = await this._getNotionDbIds();
    if (!dbIds?.progress) return null;

    const mood = this._scoreToMood(progressEntry.avg_score);

    return this.notionSync.sync({
      action: 'upsertPage',
      databaseId: dbIds.progress,
      uniqueKey: { property: 'Date', value: progressEntry.date },
      properties: {
        'Date': progressEntry.date,
        'Tests Taken': progressEntry.tests_taken || 0,
        'Lessons Completed': progressEntry.lessons_completed || 0,
        'Avg Score': (progressEntry.avg_score || 0) / 100,
        'Streak': progressEntry.streak || 0,
        'Mood': mood
      }
    });
  }

  /**
   * Lưu Notion database IDs vào local DB
   * @private
   * @param {Object} dbIds
   */
  async _storeNotionDbIds(dbIds) {
    // Create table if not exists (settings table for key-value storage)
    await this.db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT
      )
    `);

    await this.db.run(
      `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
      ['notion_db_ids', JSON.stringify(dbIds)]
    );
  }

  /**
   * Lấy Notion database IDs từ cache hoặc DB
   * @private
   * @returns {Promise<Object|null>}
   */
  async _getNotionDbIds() {
    if (this.notionDbIds) return this.notionDbIds;

    try {
      const row = await this.db.get(
        'SELECT value FROM settings WHERE key = ?',
        ['notion_db_ids']
      );
      if (row) {
        this.notionDbIds = JSON.parse(row.value);
        return this.notionDbIds;
      }
    } catch {
      // settings table may not exist yet
    }

    return null;
  }

  /**
   * Capitalize first letter
   * @private
   * @param {string} str
   * @returns {string}
   */
  _capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Chuyển đổi score sang mood emoji
   * @private
   * @param {number} score
   * @returns {string}
   */
  _scoreToMood(score) {
    if (score >= 80) return '🔥 On Fire';
    if (score >= 60) return '😊 Good';
    if (score >= 40) return '😐 Okay';
    return '😫 Struggling';
  }
}

module.exports = NotionAgent;
