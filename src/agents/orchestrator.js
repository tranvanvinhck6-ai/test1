'use strict';

/**
 * @fileoverview AdaptiveOrchestrator - Main controller điều phối toàn bộ hệ thống MedAdapt.
 * Quản lý luồng xử lý chính: đăng ký user → diagnostic → analysis → curriculum → content → coaching.
 * Điều phối 7 agent con hoạt động nhịp nhàng trong vòng lặp thích ứng hàng ngày.
 */

class AdaptiveOrchestrator {
  /**
   * Khởi tạo AdaptiveOrchestrator
   * @param {Object} params
   * @param {Object} params.db - Database connection
   * @param {Object} params.agents - All agent instances
   * @param {import('./assessment-agent')} params.agents.assessment - AssessmentAgent
   * @param {import('./analyst-agent')} params.agents.analyst - AnalystAgent
   * @param {import('./curriculum-agent')} params.agents.curriculum - CurriculumAgent
   * @param {import('./content-agent')} params.agents.content - ContentAgent
   * @param {import('./mentor-agent')} params.agents.mentor - MentorAgent
   * @param {import('./notion-agent')} params.agents.notion - NotionAgent
   * @param {import('./coach-agent')} params.agents.coach - CoachAgent
   */
  constructor({ db, agents: { assessment, analyst, curriculum, content, mentor, notion, coach } }) {
    this.db = db;
    this.assessment = assessment;
    this.analyst = analyst;
    this.curriculum = curriculum;
    this.content = content;
    this.mentor = mentor;
    this.notion = notion;
    this.coach = coach;

    console.log('[Orchestrator] Initialized with all 7 agents');
  }

  /**
   * Xử lý khi user mới đăng ký.
   * Luồng: Lấy profile → Tạo diagnostic test → Trả về test cho user làm.
   *
   * @param {string} userId - ID của user mới
   * @returns {Promise<Object>} Diagnostic test session
   */
  async onUserRegistered(userId) {
    try {
      console.log(`[Orchestrator] === New User Registered: ${userId} ===`);

      // Step 1: Lấy user profile
      const userProfile = await this.db.get('SELECT * FROM users WHERE id = ?', [userId]);
      if (!userProfile) {
        throw new Error(`User ${userId} không tồn tại trong database`);
      }

      console.log(`[Orchestrator] User profile: ${userProfile.name}, specialty: ${userProfile.specialty}`);

      // Step 2: Tạo bài kiểm tra chẩn đoán
      console.log('[Orchestrator] Step 1/2: Creating diagnostic test...');
      const diagnosticTest = await this.assessment.createDiagnosticTest(userProfile);

      // Step 3: Generate welcome briefing
      console.log('[Orchestrator] Step 2/2: Generating welcome message...');
      const welcomeBriefing = {
        type: 'welcome',
        message: `Chào mừng ${userProfile.name || 'bạn'} đến với MedAdapt! 🎓`,
        instructions: [
          'Bước 1: Hoàn thành bài kiểm tra chẩn đoán (40 câu, ~45 phút)',
          'Bước 2: Hệ thống sẽ phân tích năng lực và tạo lộ trình cá nhân hóa',
          'Bước 3: Bắt đầu học theo kế hoạch thích ứng hàng ngày'
        ],
        diagnosticTest: {
          sessionId: diagnosticTest.id,
          totalQuestions: diagnosticTest.totalQuestions,
          estimatedMinutes: 45,
          type: 'diagnostic'
        }
      };

      console.log(`[Orchestrator] === User ${userId} onboarding ready ===`);
      return welcomeBriefing;
    } catch (error) {
      console.error(`[Orchestrator] Error in onUserRegistered for ${userId}:`, error.message);
      throw new Error(`Không thể khởi tạo cho user mới: ${error.message}`);
    }
  }

  /**
   * Xử lý khi user submit bài kiểm tra.
   * Luồng: Chấm điểm → Phân tích → Cập nhật tracker → Điều chỉnh curriculum
   *         → Đồng bộ Notion → Coach feedback → Kiểm tra milestones.
   *
   * @param {string} userId - User ID
   * @param {string} sessionId - Test session ID
   * @param {Array<Object>} answers - Danh sách câu trả lời
   * @returns {Promise<Object>} Kết quả xử lý tổng hợp
   */
  async onTestSubmitted(userId, sessionId, answers) {
    try {
      console.log(`[Orchestrator] === Test Submitted: user ${userId}, session ${sessionId} ===`);
      const results = {};
      const startTime = Date.now();

      // Step 1: Chấm điểm
      console.log('[Orchestrator] Step 1/7: Evaluating answers...');
      results.evaluation = await this.assessment.evaluateAnswers(sessionId, answers);
      console.log(`[Orchestrator] Score: ${results.evaluation.overallScore}%`);

      // Step 2: Phân tích sâu
      console.log('[Orchestrator] Step 2/7: Deep analysis...');
      results.analysis = await this.analyst.analyzeTestResults(sessionId);

      // Step 3: Cập nhật hoặc tạo tracker
      console.log('[Orchestrator] Step 3/7: Updating tracker...');
      const existingTracker = await this.db.all(
        'SELECT * FROM tracker WHERE user_id = ?', [userId]
      );

      if (existingTracker.length === 0) {
        // First test (diagnostic) → Create tracker
        results.trackerUpdate = await this.analyst.createTracker(userId, results.analysis);
      } else {
        // Subsequent test → Update tracker
        results.trackerUpdate = await this.analyst.updateTracker(userId, results.analysis);
      }

      // Step 4: Điều chỉnh curriculum
      console.log('[Orchestrator] Step 4/7: Adjusting curriculum...');
      const updatedTracker = await this.db.all(
        'SELECT * FROM tracker WHERE user_id = ?', [userId]
      );
      results.curriculum = await this.curriculum.adjustPlan(userId, updatedTracker);

      // Step 5: Cập nhật daily progress
      console.log('[Orchestrator] Step 5/7: Updating daily progress...');
      results.progress = await this._updateDailyProgress(userId, results.evaluation);

      // Bước 6: Đồng bộ Notion — fire-and-forget (KHÔNG bắt user đợi)
      console.log('[Orchestrator] Step 6/7: Queueing Notion sync (background)...');
      Promise.resolve()
        .then(() => this.notion.syncTracker(userId))
        .then(() => this.notion.syncTest(results.evaluation))
        .catch((notionErr) => console.warn('[Orchestrator] Notion sync (bg) skipped:', notionErr.message));
      results.notionSync = { queued: true };

      // Bước 7: Coach feedback + Milestones chạy SONG SONG
      console.log('[Orchestrator] Step 7/7: Coach feedback & milestones (parallel)...');
      const [feedback, milestones] = await Promise.all([
        this.coach.testFeedback(userId, results.evaluation),
        this.coach.checkMilestones(userId)
      ]);
      results.feedback = feedback;
      results.milestones = milestones;

      const elapsed = Date.now() - startTime;
      console.log(`[Orchestrator] === Test processing complete in ${elapsed}ms ===`);

      return {
        success: true,
        score: results.evaluation.overallScore,
        feedback: results.feedback,
        newMilestones: results.milestones.newMilestones,
        nextPlan: results.curriculum,
        analysis: {
          gaps: results.analysis.gaps,
          insights: results.analysis.aiInsights
        },
        processingTime: elapsed
      };
    } catch (error) {
      console.error(`[Orchestrator] Error in onTestSubmitted:`, error.message);
      throw new Error(`Không thể xử lý bài kiểm tra: ${error.message}`);
    }
  }

  /**
   * Chạy vòng lặp thích ứng hàng ngày.
   * Luồng: Briefing → Review test (nếu có) → Bài học → Daily test → Sync.
   *
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Daily loop data
   */
  async runDailyLoop(userId) {
    try {
      console.log(`[Orchestrator] === Daily Loop Start: user ${userId} ===`);
      const dailyData = {};

      // Step 1: Get tracker
      console.log('[Orchestrator] Daily 1/6: Loading tracker...');
      const { tracker, gaps } = await this.analyst.getTracker(userId);

      if (!tracker || tracker.length === 0) {
        console.log('[Orchestrator] No tracker found. User needs to complete diagnostic test first.');
        return {
          needsDiagnostic: true,
          message: 'Vui lòng hoàn thành bài kiểm tra chẩn đoán trước khi bắt đầu học.'
        };
      }

      // Step 2, 3, 5, 6 & Milestones: Song song hóa các agent độc lập (Coach, Curriculum, Content, Assessment)
      console.log('[Orchestrator] Daily 2-6: Parallelizing Briefing, Planning, Lesson, Daily Test & Milestones...');
      const [briefing, todayPlan, lesson, dailyTest, milestones] = await Promise.all([
        this.coach.dailyBriefingForUser(userId),
        this.curriculum.planToday(userId, tracker),
        this.content.getTodayLesson(userId),
        this.assessment.createDailyTest(userId, tracker),
        this.coach.checkMilestones(userId)
      ]);

      dailyData.briefing = briefing;
      dailyData.todayPlan = todayPlan;
      dailyData.lesson = lesson;
      dailyData.dailyTest = dailyTest;
      dailyData.milestones = milestones;

      // Step 4: Create review test if SM-2 items are due
      console.log('[Orchestrator] Daily check: Review queue...');
      if (dailyData.todayPlan.reviewQueue && dailyData.todayPlan.reviewQueue.length > 0) {
        dailyData.reviewTest = await this.assessment.createReviewTest(
          userId,
          dailyData.todayPlan.reviewQueue
        );
      } else {
        dailyData.reviewTest = null;
      }

      console.log(`[Orchestrator] === Daily Loop Ready for user ${userId} ===`);

      return {
        success: true,
        briefing: dailyData.briefing,
        todayPlan: dailyData.todayPlan,
        reviewTest: dailyData.reviewTest,
        lesson: {
          id: dailyData.lesson.id,
          title: dailyData.lesson.title,
          domain: dailyData.lesson.domain_id,
          isNew: dailyData.lesson.isNew
        },
        dailyTest: {
          sessionId: dailyData.dailyTest.id,
          totalQuestions: dailyData.dailyTest.totalQuestions
        },
        newMilestones: dailyData.milestones.newMilestones
      };
    } catch (error) {
      console.error(`[Orchestrator] Error in runDailyLoop:`, error.message);
      throw new Error(`Không thể chạy daily loop: ${error.message}`);
    }
  }

  /**
   * Lấy tất cả dữ liệu cho dashboard.
   *
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Dashboard data
   */
  async getDashboardData(userId) {
    try {
      console.log(`[Orchestrator] Loading dashboard for user ${userId}`);

      const user = await this.db.get('SELECT * FROM users WHERE id = ?', [userId]);
      if (!user) {
        throw new Error(`User ${userId} không tồn tại`);
      }

      // Parallel data loading for performance
      const [trackerData, history, recentSessions, weeklyPlan, insights] = await Promise.all([
        this.analyst.getTracker(userId),
        this.analyst.getTrackerHistory(userId, 30),
        this.db.all(
          'SELECT * FROM test_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 5',
          [userId]
        ),
        this.curriculum.getWeeklyPlan(userId).catch(() => null),
        this.analyst.generateInsights(userId).catch(() => null)
      ]);

      // Get streak and milestones
      const latestProgress = await this.db.get(
        'SELECT * FROM daily_progress WHERE user_id = ? ORDER BY date DESC LIMIT 1',
        [userId]
      );

      return {
        user: {
          name: user.name,
          specialty: user.specialty,
          level: user.level,
          joinedAt: user.created_at
        },
        tracker: {
          domains: trackerData.tracker,
          overallScore: trackerData.overallScore,
          radarConfig: trackerData.radarConfig,
          gaps: trackerData.gaps
        },
        history: {
          trends: history.trends,
          dailyScores: history.dailyScores.slice(-14) // Last 14 days
        },
        recentTests: recentSessions.map(s => ({
          id: s.id,
          type: s.type,
          score: s.score,
          totalQuestions: s.total_questions,
          date: s.created_at
        })),
        weeklyPlan,
        insights: insights?.insights || null,
        streak: latestProgress?.streak || 0,
        loadedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error(`[Orchestrator] Error loading dashboard:`, error.message);
      throw new Error(`Không thể tải dashboard: ${error.message}`);
    }
  }

  /**
   * Lấy trạng thái hiện tại của hệ thống cho user.
   *
   * @param {string} userId - User ID
   * @returns {Promise<Object>} System status
   */
  async getStatus(userId) {
    try {
      const user = await this.db.get('SELECT * FROM users WHERE id = ?', [userId]);
      if (!user) {
        return { exists: false, message: 'User chưa đăng ký' };
      }

      const trackerCount = await this.db.get(
        'SELECT COUNT(*) as count FROM tracker WHERE user_id = ?', [userId]
      );

      const testCount = await this.db.get(
        'SELECT COUNT(*) as count FROM test_sessions WHERE user_id = ?', [userId]
      );

      const latestTest = await this.db.get(
        'SELECT * FROM test_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
        [userId]
      );

      const latestProgress = await this.db.get(
        'SELECT * FROM daily_progress WHERE user_id = ? ORDER BY date DESC LIMIT 1',
        [userId]
      );

      const hasDiagnostic = await this.db.get(
        `SELECT id FROM test_sessions WHERE user_id = ? AND type = 'diagnostic' LIMIT 1`,
        [userId]
      );

      // Determine current phase
      let phase;
      if (!hasDiagnostic) {
        phase = 'onboarding';
      } else if (trackerCount.count === 0) {
        phase = 'awaiting_diagnostic_results';
      } else if (testCount.count <= 1) {
        phase = 'post_diagnostic';
      } else {
        phase = 'active_learning';
      }

      return {
        exists: true,
        user: { name: user.name, specialty: user.specialty },
        phase,
        stats: {
          domainsTracked: trackerCount.count,
          totalTests: testCount.count,
          currentStreak: latestProgress?.streak || 0,
          lastTestDate: latestTest?.created_at || null,
          lastTestScore: latestTest?.score || null
        },
        checkedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error(`[Orchestrator] Error getting status:`, error.message);
      throw new Error(`Không thể lấy trạng thái: ${error.message}`);
    }
  }

  // ===================== PRIVATE METHODS =====================

  /**
   * Cập nhật daily progress sau khi hoàn thành test
   * @private
   * @param {string} userId
   * @param {Object} evaluation
   * @returns {Promise<Object>}
   */
  async _updateDailyProgress(userId, evaluation) {
    try {
      const today = new Date().toISOString().split('T')[0];

      // Check if entry exists for today
      const existing = await this.db.get(
        'SELECT * FROM daily_progress WHERE user_id = ? AND date = ?',
        [userId, today]
      );

      if (existing) {
        // Update existing
        const newTestsCount = existing.tests_taken + 1;
        const newAvgScore = Math.round(
          ((existing.avg_score * existing.tests_taken) + evaluation.overallScore) / newTestsCount
        );

        await this.db.run(
          `UPDATE daily_progress SET tests_taken = ?, avg_score = ? WHERE user_id = ? AND date = ?`,
          [newTestsCount, newAvgScore, userId, today]
        );

        return { testsToday: newTestsCount, avgScore: newAvgScore, streak: existing.streak };
      } else {
        // Create new entry, calculate streak
        const yesterday = await this.db.get(
          `SELECT * FROM daily_progress WHERE user_id = ? AND date = date(?, '-1 day')`,
          [userId, today]
        );

        const streak = yesterday ? (yesterday.streak || 0) + 1 : 1;

        await this.db.run(
          `INSERT INTO daily_progress (user_id, date, tests_taken, lessons_completed, avg_score, streak)
           VALUES (?, ?, 1, 0, ?, ?)`,
          [userId, today, evaluation.overallScore, streak]
        );

        return { testsToday: 1, avgScore: evaluation.overallScore, streak };
      }
    } catch (error) {
      console.warn('[Orchestrator] Error updating daily progress:', error.message);
      return { error: error.message };
    }
  }
}

module.exports = AdaptiveOrchestrator;
