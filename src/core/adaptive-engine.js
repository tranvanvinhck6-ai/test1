'use strict';

/**
 * MedAdapt Adaptive Learning Engine
 * Core logic cho vòng lặp học tập thích ứng
 * 
 * Flow:
 * 1. User registers → Diagnostic Test
 * 2. Test results → Claude Analysis → Competency Tracker
 * 3. Tracker → Identify Gaps → Generate Learning Path
 * 4. Learning Path → Create Personalized Lesson
 * 5. Daily Test → Update Tracker → Adjust Path
 * 6. Repeat daily (Steps 3-5)
 */
class AdaptiveEngine {
  /**
   * @param {Object} params
   * @param {import('../db/database')} params.db
   * @param {Object} params.orchestrator - AdaptiveOrchestrator instance
   */
  constructor({ db, orchestrator }) {
    this.db = db;
    this.orchestrator = orchestrator;
  }

  /**
   * Chạy vòng lặp adaptive learning hàng ngày cho một user
   * @param {string} userId
   * @returns {Object} Daily loop results
   */
  async runDailyAdaptiveLoop(userId) {
    console.log(`[AdaptiveEngine] Starting daily loop for user: ${userId}`);
    const startTime = Date.now();

    try {
      const user = this.db.getUser(userId);
      if (!user) throw new Error('User not found');

      // Step 1: Snapshot tracker trước khi update
      this.db.saveTrackerSnapshot(userId);

      // Step 2: Chạy orchestrator daily loop
      const result = await this.orchestrator.runDailyLoop(userId);

      // Step 3: Log progress
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[AdaptiveEngine] Daily loop completed in ${elapsed}s for user: ${user.name}`);

      return {
        success: true,
        userId,
        userName: user.name,
        elapsed: `${elapsed}s`,
        ...result
      };
    } catch (error) {
      console.error(`[AdaptiveEngine] Daily loop error for user ${userId}:`, error.message);
      return {
        success: false,
        userId,
        error: error.message
      };
    }
  }

  /**
   * Chạy daily loop cho tất cả users
   * @returns {Array} Results for each user
   */
  async runDailyLoopAllUsers() {
    console.log('[AdaptiveEngine] Running daily loop for all users...');
    const users = this.db.db.prepare('SELECT id FROM users').all();
    const results = [];

    for (const user of users) {
      const result = await this.runDailyAdaptiveLoop(user.id);
      results.push(result);
      // Delay giữa users để tránh rate limit
      await this._delay(2000);
    }

    console.log(`[AdaptiveEngine] Daily loop completed for ${users.length} users`);
    return results;
  }

  /**
   * Khởi tạo user mới - tạo diagnostic test
   * @param {string} userId
   * @returns {Object}
   */
  async initializeNewUser(userId) {
    console.log(`[AdaptiveEngine] Initializing new user: ${userId}`);

    // Initialize tracker entries for all domains
    this.db.initializeTracker(userId);

    // Create diagnostic test via orchestrator
    const result = await this.orchestrator.onUserRegistered(userId);

    return result;
  }

  /**
   * Xử lý khi user hoàn thành test
   * @param {string} userId
   * @param {string} sessionId
   * @param {Array} answers
   * @returns {Object}
   */
  async processTestCompletion(userId, sessionId, answers) {
    console.log(`[AdaptiveEngine] Processing test completion: session=${sessionId}`);

    const result = await this.orchestrator.onTestSubmitted(userId, sessionId, answers);

    // Update daily progress
    const session = this.db.getTestSession(sessionId);
    if (session) {
      this.db.updateDailyProgress(userId, {
        tests_taken: 1,
        questions_attempted: session.total_questions,
        questions_correct: session.correct_count,
        avg_score: session.score,
        study_minutes: Math.ceil(session.time_spent / 60),
        domains_studied: session.domains_covered || []
      });
    }

    return result;
  }

  /**
   * Lấy trạng thái hiện tại của adaptive loop
   * @param {string} userId
   * @returns {Object}
   */
  getAdaptiveStatus(userId) {
    const user = this.db.getUser(userId);
    if (!user) return null;

    const tracker = this.db.getTracker(userId);
    const recentTests = this.db.getRecentTests(userId, 5);
    const streak = this.db.getCurrentStreak(userId);
    const todayPlan = this.db.getTodayPlan(userId);
    const todayLessons = this.db.getTodayLessons(userId);

    // Calculate overall progress
    const avgScore = tracker.length > 0
      ? tracker.reduce((sum, t) => sum + t.score, 0) / tracker.length
      : 0;

    const masteredCount = tracker.filter(t =>
      t.mastery_level === 'proficient' || t.mastery_level === 'expert'
    ).length;

    const criticalGaps = tracker.filter(t => t.score < 30 && t.score > 0).length;
    const totalDomains = tracker.length;

    // Determine phase
    let phase = 'onboarding';
    if (recentTests.length > 0) {
      const hasDiagnostic = recentTests.some(t => t.type === 'diagnostic');
      if (hasDiagnostic && recentTests.length === 1) {
        phase = 'initial_learning';
      } else if (recentTests.length > 1) {
        phase = 'daily_loop';
      }
    }

    return {
      user: {
        name: user.name,
        specialty: user.specialty,
        level: user.level
      },
      phase,
      overallScore: Math.round(avgScore),
      masteredDomains: masteredCount,
      criticalGaps,
      totalDomains,
      streak,
      recentTestCount: recentTests.length,
      hasTodayPlan: todayPlan.length > 0,
      hasTodayLesson: todayLessons.length > 0,
      lastTestDate: recentTests[0]?.completed_at || null
    };
  }

  /** Utility: delay */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = AdaptiveEngine;
