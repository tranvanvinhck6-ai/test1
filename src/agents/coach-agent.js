'use strict';

const fs = require('fs');
const path = require('path');

/**
 * @fileoverview CoachAgent - Agent huấn luyện và động viên người học.
 * Tạo daily briefing, feedback sau test, báo cáo tuần,
 * và quản lý hệ thống milestones/achievements.
 */

/**
 * Streak milestone definitions
 * @constant {Array<Object>}
 */
const STREAK_MILESTONES = [
  { days: 3, emoji: '🔥', title: 'Khởi đầu tốt!', message: '3 ngày liên tục học tập!' },
  { days: 7, emoji: '🔥🔥', title: 'Một tuần kiên trì!', message: '7 ngày không bỏ cuộc!' },
  { days: 14, emoji: '🔥🔥🔥', title: 'Hai tuần dedication!', message: '14 ngày - thói quen đang hình thành!' },
  { days: 30, emoji: '⚡', title: 'Một tháng!', message: '30 ngày kiên trì - thật đáng ngưỡng mộ!' },
  { days: 60, emoji: '💎', title: 'Kỷ luật thép!', message: '60 ngày - em là inspiration!' },
  { days: 100, emoji: '👑', title: 'Bậc thầy kiên trì!', message: '100 ngày - truyền thuyết!' }
];

/**
 * Performance milestone definitions
 * @constant {Array<Object>}
 */
const PERFORMANCE_MILESTONES = [
  { id: 'diagnostic_done', condition: (t) => t && t.length >= 13, emoji: '🎯', title: 'Hoàn thành bản đồ năng lực 13 chuyên khoa USMLE' },
  { id: 'first_70', condition: (t) => t.some(d => d.score >= 70), emoji: '⭐', title: 'Đạt 70% chuyên khoa đầu tiên (USMLE Passing Standard)' },
  { id: 'first_80', condition: (t) => t.some(d => d.score >= 80), emoji: '⭐⭐', title: 'Đạt 80% chuyên khoa trọng điểm (High-Yield Mastery)' },
  { id: 'first_90', condition: (t) => t.some(d => d.score >= 90), emoji: '⭐⭐⭐', title: 'Đạt 90% - Bậc thầy Lâm sàng USMLE Step 2 CK!' },
  { id: 'all_60', condition: (t) => t.every(d => d.score >= 60), emoji: '🛡️', title: 'Tất cả 13 chuyên khoa vượt chuẩn an toàn 60%' },
  { id: 'improve_20', condition: (t, h) => h && h.some(d => d.delta >= 20), emoji: '📈', title: 'Bứt phá tăng 20% điểm số lâm sàng!' }
];

class CoachAgent {
  /**
   * Khởi tạo CoachAgent
   * @param {Object} params
   * @param {import('@anthropic-ai/sdk').default} params.claudeClient - Claude API client
   * @param {string} params.model - Model identifier
   * @param {Object} params.db - Database connection
   * @param {Object} params.skills - Skill instances
   * @param {import('../skills/streak-motivator')} params.skills.streakMotivator - Streak motivation skill
   * @param {import('../skills/radar-builder')} params.skills.radarBuilder - Radar chart builder
   * @param {import('../skills/daily-briefing')} params.skills.dailyBriefing - Daily briefing generator
   */
  constructor({ claudeClient, model, db, skills: { streakMotivator, radarBuilder, dailyBriefing } }) {
    this.claude = claudeClient;
    this.model = model;
    this.db = db;
    this.streakMotivator = streakMotivator;
    this.radarBuilder = radarBuilder;
    this.dailyBriefing = dailyBriefing;

    // Load system prompt
    const promptPath = path.join(__dirname, '..', 'prompts', 'coach.md');
    this.systemPrompt = fs.readFileSync(promptPath, 'utf-8');

    console.log('[CoachAgent] Initialized successfully');
  }

  /**
   * Tạo daily briefing cho người học.
   * Tóm tắt hôm qua, kế hoạch hôm nay, streak info, upcoming reviews.
   *
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Daily briefing
   */
  async dailyBriefingForUser(userId) {
    try {
      console.log(`[CoachAgent] Generating daily briefing for user ${userId}`);

      const user = await this.db.get('SELECT * FROM users WHERE id = ?', [userId]);

      // Get tracker data
      const tracker = await this.db.all(
        'SELECT * FROM tracker WHERE user_id = ?', [userId]
      );

      // Get yesterday's progress
      const yesterday = await this.db.get(
        `SELECT * FROM daily_progress WHERE user_id = ? AND date = date('now', '-1 day')`,
        [userId]
      );

      // Get current streak
      const streakData = await this._getCurrentStreak(userId);

      // Get streak motivation message
      const streakMessage = await this.streakMotivator.motivate(streakData);

      // Get upcoming SM-2 reviews
      const reviewsDue = await this.db.all(
        `SELECT domain_id FROM tracker WHERE user_id = ?
         AND date(last_tested, '+' || interval || ' days') <= date('now')`,
        [userId]
      );

      // Generate briefing with skill
      const skillBriefing = await this.dailyBriefing.generate(tracker, {
        streak: streakData,
        reviews: reviewsDue,
        yesterday
      });

      // Enhance with Claude for personalization
      const response = await this.claude.messages.create({
        model: this.model,
        max_tokens: 1500,
        system: this.systemPrompt,
        messages: [{
          role: 'user',
          content: `Tạo daily briefing cá nhân hóa bằng tiếng Việt. Trả về JSON.

Tên người học: ${user?.name || 'bạn'}
Giờ hiện tại: ${new Date().getHours()}h

Streak: ${streakData.current} ngày
${streakMessage ? `Streak message: ${streakMessage}` : ''}

Hôm qua: ${yesterday ? `${yesterday.tests_taken} tests, ${yesterday.lessons_completed} lessons, avg score: ${yesterday.avg_score}%` : 'Không có dữ liệu'}

Reviews đến hạn: ${reviewsDue.length} domains (${reviewsDue.map(r => r.domain_id).join(', ')})

Tracker summary: ${JSON.stringify(tracker.map(t => ({ domain: t.domain_id, score: t.score, mastery: t.mastery_level })))}

Briefing từ skill: ${JSON.stringify(skillBriefing)}

Trả về JSON:
{
  "greeting": "string",
  "streak_info": { "current_streak": number, "message": "string", "emoji": "string" },
  "yesterday_summary": { "tests_taken": number, "avg_score": number, "lessons_completed": number, "highlight": "string" },
  "today_focus": { "main_goal": "string", "domains": ["string"], "estimated_time": "string", "motivation": "string" },
  "upcoming_reviews": { "count": number, "domains": ["string"] },
  "milestones_near": [{ "name": "string", "progress": "string", "message": "string" }],
  "quote": "string"
}`
        }]
      });

      let briefing = {};
      try {
        const content = response.content[0].text;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          briefing = JSON.parse(jsonMatch[0]);
        }
      } catch (parseErr) {
        console.warn('[CoachAgent] Could not parse briefing JSON:', parseErr.message);
        briefing = {
          greeting: this._getGreeting(user?.name),
          streak_info: { current_streak: streakData.current, message: streakMessage || '', emoji: '🔥' },
          today_focus: { main_goal: 'Duy trì streak và học tập', motivation: 'Cố lên!' },
          upcoming_reviews: { count: reviewsDue.length, domains: reviewsDue.map(r => r.domain_id) }
        };
      }

      console.log(`[CoachAgent] Daily briefing generated for user ${userId}`);
      return briefing;
    } catch (error) {
      console.error('[CoachAgent] Error generating daily briefing:', error.message);
      throw new Error(`Không thể tạo daily briefing: ${error.message}`);
    }
  }

  /**
   * Tạo feedback sau bài kiểm tra.
   *
   * @param {string} userId - User ID
   * @param {Object} testResults - Kết quả bài kiểm tra
   * @returns {Promise<Object>} Test feedback
   */
  async testFeedback(userId, testResults) {
    try {
      console.log(`[CoachAgent] Generating test feedback for user ${userId}`);

      const user = await this.db.get('SELECT * FROM users WHERE id = ?', [userId]);

      // Get previous test for comparison
      const prevTest = await this.db.get(
        `SELECT * FROM test_sessions WHERE user_id = ? AND id != ? ORDER BY created_at DESC LIMIT 1`,
        [userId, testResults.sessionId]
      );

      const response = await this.claude.messages.create({
        model: this.model,
        max_tokens: 1500,
        system: this.systemPrompt,
        messages: [{
          role: 'user',
          content: `Tạo feedback sau bài kiểm tra, bằng tiếng Việt, tích cực và khuyến khích. Trả về JSON.

Tên: ${user?.name || 'bạn'}
Kết quả lần này: ${testResults.overallScore}% (${testResults.correctCount}/${testResults.totalQuestions})
Loại test: ${testResults.type}
${prevTest ? `Lần trước: ${prevTest.score}%` : 'Đây là bài test đầu tiên'}

Domain scores: ${JSON.stringify(testResults.domainScores?.map(d => ({ domain: d.domain_id, score: d.score })) || [])}

Trả về JSON:
{
  "score_summary": { "score": number, "total": number, "percentage": number, "comparison": "string" },
  "emoji_rating": "string",
  "encouragement": "string",
  "highlights": ["string"],
  "improvements": ["string"],
  "next_steps": ["string"],
  "fun_fact": "string"
}`
        }]
      });

      let feedback = {};
      try {
        const content = response.content[0].text;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          feedback = JSON.parse(jsonMatch[0]);
        }
      } catch (parseErr) {
        console.warn('[CoachAgent] Could not parse test feedback:', parseErr.message);
        const score = testResults.overallScore;
        feedback = {
          score_summary: {
            score: testResults.correctCount,
            total: testResults.totalQuestions,
            percentage: score,
            comparison: prevTest ? `Lần trước: ${prevTest.score}%` : 'Bài test đầu tiên'
          },
          emoji_rating: score >= 80 ? '🌟' : score >= 60 ? '👍' : score >= 40 ? '💪' : '📚',
          encouragement: score >= 70 ? 'Làm tốt lắm!' : 'Mỗi lần làm bài là một lần tiến bộ!',
          highlights: [],
          improvements: [],
          next_steps: ['Tiếp tục ôn luyện']
        };
      }

      console.log(`[CoachAgent] Test feedback generated: ${testResults.overallScore}%`);
      return feedback;
    } catch (error) {
      console.error('[CoachAgent] Error generating test feedback:', error.message);
      throw new Error(`Không thể tạo feedback: ${error.message}`);
    }
  }

  /**
   * Tạo báo cáo tiến bộ hàng tuần.
   *
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Weekly report
   */
  async weeklyReport(userId) {
    try {
      console.log(`[CoachAgent] Generating weekly report for user ${userId}`);

      const user = await this.db.get('SELECT * FROM users WHERE id = ?', [userId]);

      // Get this week's data
      const weekSessions = await this.db.all(
        `SELECT * FROM test_sessions WHERE user_id = ? AND created_at >= date('now', '-7 days')`,
        [userId]
      );

      const weekProgress = await this.db.all(
        `SELECT * FROM daily_progress WHERE user_id = ? AND date >= date('now', '-7 days') ORDER BY date`,
        [userId]
      );

      const weekLessons = await this.db.all(
        `SELECT * FROM lessons WHERE user_id = ? AND created_at >= date('now', '-7 days')`,
        [userId]
      );

      // Get tracker for domain progress
      const tracker = await this.db.all('SELECT * FROM tracker WHERE user_id = ?', [userId]);

      // Build radar chart
      const radarConfig = await this.radarBuilder.build(tracker);

      // Calculate week stats
      const totalTests = weekSessions.length;
      const avgScore = totalTests > 0
        ? Math.round(weekSessions.reduce((sum, s) => sum + s.score, 0) / totalTests)
        : 0;
      const currentStreak = await this._getCurrentStreak(userId);

      const response = await this.claude.messages.create({
        model: this.model,
        max_tokens: 2500,
        system: this.systemPrompt,
        messages: [{
          role: 'user',
          content: `Tạo báo cáo tuần chi tiết bằng tiếng Việt. Trả về JSON.

Tên: ${user?.name || 'bạn'}
Tuần: ${this._getWeekRange()}

Stats tuần:
- Tests: ${totalTests}
- Avg score: ${avgScore}%
- Lessons: ${weekLessons.length}
- Streak: ${currentStreak.current} ngày

Daily progress: ${JSON.stringify(weekProgress)}
Test sessions: ${JSON.stringify(weekSessions.map(s => ({ type: s.type, score: s.score, date: s.created_at })))}

Tracker: ${JSON.stringify(tracker.map(t => ({ domain: t.domain_id, score: t.score, mastery: t.mastery_level })))}

Trả về JSON:
{
  "week_summary": {
    "total_tests": ${totalTests},
    "total_lessons": ${weekLessons.length},
    "avg_score": ${avgScore},
    "score_trend": "improving|stable|declining",
    "total_study_minutes": number,
    "streak_maintained": ${currentStreak.current >= 7}
  },
  "domain_progress": [{ "domain": "string", "score_change": number, "trend_emoji": "📈|📊|📉", "comment": "string" }],
  "achievements": ["string"],
  "challenges": ["string"],
  "next_week_preview": { "focus_areas": ["string"], "goals": ["string"], "motivation": "string" },
  "overall_message": "string"
}`
        }]
      });

      let report = {};
      try {
        const content = response.content[0].text;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          report = JSON.parse(jsonMatch[0]);
        }
      } catch (parseErr) {
        console.warn('[CoachAgent] Could not parse weekly report:', parseErr.message);
        report = {
          week_summary: { total_tests: totalTests, total_lessons: weekLessons.length, avg_score: avgScore },
          overall_message: `Tuần này: ${totalTests} bài test, điểm TB ${avgScore}%. Tiếp tục phát huy!`
        };
      }

      report.radarConfig = radarConfig;

      console.log(`[CoachAgent] Weekly report generated for user ${userId}`);
      return report;
    } catch (error) {
      console.error('[CoachAgent] Error generating weekly report:', error.message);
      throw new Error(`Không thể tạo báo cáo tuần: ${error.message}`);
    }
  }

  /**
   * Kiểm tra và trao milestones.
   *
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Milestones check result
   */
  async checkMilestones(userId) {
    try {
      console.log(`[CoachAgent] Checking milestones for user ${userId}`);

      const tracker = await this.db.all('SELECT * FROM tracker WHERE user_id = ?', [userId]);
      const streakData = await this._getCurrentStreak(userId);

      // Check existing milestones from DB (prevent re-awarding)
      const existing = await this._getExistingMilestones(userId);

      const newMilestones = [];

      // Check streak milestones
      for (const milestone of STREAK_MILESTONES) {
        const milestoneId = `streak_${milestone.days}`;
        if (streakData.current >= milestone.days && !existing.includes(milestoneId)) {
          newMilestones.push({
            id: milestoneId,
            type: 'streak',
            emoji: milestone.emoji,
            title: milestone.title,
            message: milestone.message,
            awardedAt: new Date().toISOString()
          });
        }
      }

      // Check performance milestones
      const historyDeltas = tracker.map(t => ({
        domain_id: t.domain_id,
        delta: t.score - (t.initial_score || 0)
      }));

      for (const milestone of PERFORMANCE_MILESTONES) {
        if (!existing.includes(milestone.id) && milestone.condition(tracker, historyDeltas)) {
          newMilestones.push({
            id: milestone.id,
            type: 'performance',
            emoji: milestone.emoji,
            title: milestone.title,
            message: `🎉 Chúc mừng! ${milestone.title}`,
            awardedAt: new Date().toISOString()
          });
        }
      }

      // Check learning milestones
      const totalTests = await this.db.get(
        'SELECT COUNT(*) as count FROM test_sessions WHERE user_id = ?', [userId]
      );
      const totalLessons = await this.db.get(
        'SELECT COUNT(*) as count FROM lessons WHERE user_id = ?', [userId]
      );
      const totalQuestions = await this.db.get(
        `SELECT COUNT(*) as count FROM test_answers ta
         JOIN test_sessions ts ON ta.session_id = ts.id
         WHERE ts.user_id = ?`, [userId]
      );

      const learningMilestones = [
        { id: 'lessons_10', count: totalLessons?.count || 0, target: 10, emoji: '📚', title: 'Hoàn thành 10 bài học' },
        { id: 'lessons_50', count: totalLessons?.count || 0, target: 50, emoji: '📚📚', title: 'Hoàn thành 50 bài học' },
        { id: 'questions_100', count: totalQuestions?.count || 0, target: 100, emoji: '📝', title: 'Làm 100 câu hỏi MCQ' },
        { id: 'questions_500', count: totalQuestions?.count || 0, target: 500, emoji: '📝📝', title: 'Làm 500 câu hỏi MCQ' }
      ];

      for (const lm of learningMilestones) {
        if (lm.count >= lm.target && !existing.includes(lm.id)) {
          newMilestones.push({
            id: lm.id,
            type: 'learning',
            emoji: lm.emoji,
            title: lm.title,
            message: `🎉 ${lm.title}! Tuyệt vời!`,
            awardedAt: new Date().toISOString()
          });
        }
      }

      // Store new milestones
      for (const milestone of newMilestones) {
        await this._storeMilestone(userId, milestone);
      }

      console.log(`[CoachAgent] Milestones checked: ${newMilestones.length} new achievements`);
      return {
        newMilestones,
        totalMilestones: existing.length + newMilestones.length,
        currentStreak: streakData.current
      };
    } catch (error) {
      console.error('[CoachAgent] Error checking milestones:', error.message);
      throw new Error(`Không thể kiểm tra milestones: ${error.message}`);
    }
  }

  // ===================== PRIVATE METHODS =====================

  /**
   * Lấy streak hiện tại từ DB
   * @private
   * @param {string} userId
   * @returns {Promise<Object>}
   */
  async _getCurrentStreak(userId) {
    try {
      const latest = await this.db.get(
        `SELECT streak FROM daily_progress WHERE user_id = ? ORDER BY date DESC LIMIT 1`,
        [userId]
      );
      return {
        current: latest?.streak || 0,
        isActive: !!latest
      };
    } catch {
      return { current: 0, isActive: false };
    }
  }

  /**
   * Lấy milestones đã đạt
   * @private
   * @param {string} userId
   * @returns {Promise<Array<string>>}
   */
  async _getExistingMilestones(userId) {
    try {
      // Ensure milestones table exists
      await this.db.run(`
        CREATE TABLE IF NOT EXISTS milestones (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          milestone_id TEXT NOT NULL,
          type TEXT,
          title TEXT,
          awarded_at TEXT,
          UNIQUE(user_id, milestone_id)
        )
      `);

      const rows = await this.db.all(
        'SELECT milestone_id FROM milestones WHERE user_id = ?', [userId]
      );
      return rows.map(r => r.milestone_id);
    } catch {
      return [];
    }
  }

  /**
   * Lưu milestone mới
   * @private
   * @param {string} userId
   * @param {Object} milestone
   */
  async _storeMilestone(userId, milestone) {
    try {
      await this.db.run(
        `INSERT OR IGNORE INTO milestones (user_id, milestone_id, type, title, awarded_at)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, milestone.id, milestone.type, milestone.title, milestone.awardedAt]
      );
    } catch (err) {
      console.warn('[CoachAgent] Could not store milestone:', err.message);
    }
  }

  /**
   * Tạo lời chào theo giờ
   * @private
   * @param {string} name
   * @returns {string}
   */
  _getGreeting(name) {
    const hour = new Date().getHours();
    const displayName = name || 'bạn';
    if (hour < 12) return `Chào buổi sáng, ${displayName}! ☀️`;
    if (hour < 18) return `Chào buổi chiều, ${displayName}! 🌤️`;
    return `Chào buổi tối, ${displayName}! 🌙`;
  }

  /**
   * Lấy khoảng thời gian tuần hiện tại
   * @private
   * @returns {string}
   */
  _getWeekRange() {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const fmt = (d) => `${d.getDate()}/${d.getMonth() + 1}`;
    return `${fmt(monday)} - ${fmt(sunday)}`;
  }
}

module.exports = CoachAgent;
