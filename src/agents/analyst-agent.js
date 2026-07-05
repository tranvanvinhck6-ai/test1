'use strict';

const fs = require('fs');
const path = require('path');

/**
 * @fileoverview AnalystAgent - Agent phân tích kết quả và quản lý competency tracker.
 * Phân tích sâu kết quả kiểm tra, tạo/cập nhật tracker năng lực,
 * phát hiện lỗ hổng kiến thức, và tạo insights AI-driven.
 */

/**
 * Mastery level thresholds
 * @constant {Object}
 */
const MASTERY_THRESHOLDS = {
  novice: { min: 0, max: 39, label: 'Mới bắt đầu' },
  beginner: { min: 40, max: 54, label: 'Cơ bản' },
  intermediate: { min: 55, max: 69, label: 'Trung bình' },
  advanced: { min: 70, max: 84, label: 'Nâng cao' },
  expert: { min: 85, max: 100, label: 'Thành thạo' }
};

class AnalystAgent {
  /**
   * Khởi tạo AnalystAgent
   * @param {Object} params
   * @param {import('@anthropic-ai/sdk').default} params.claudeClient - Claude API client
   * @param {string} params.model - Model identifier
   * @param {Object} params.db - Database connection
   * @param {Object} params.skills - Skill instances
   * @param {import('../skills/radar-builder')} params.skills.radarBuilder - Radar chart builder
   * @param {import('../skills/gap-detector')} params.skills.gapDetector - Knowledge gap detector
   * @param {import('../skills/knowledge-retriever')} params.skills.knowledgeRetriever - Knowledge retrieval
   */
  constructor({ claudeClient, model, db, skills: { radarBuilder, gapDetector, knowledgeRetriever } }) {
    this.claude = claudeClient;
    this.model = model;
    this.db = db;
    this.radarBuilder = radarBuilder;
    this.gapDetector = gapDetector;
    this.knowledgeRetriever = knowledgeRetriever;

    // Load system prompt
    const promptPath = path.join(__dirname, '..', 'prompts', 'analysis.md');
    this.systemPrompt = fs.readFileSync(promptPath, 'utf-8');

    console.log('[AnalystAgent] Initialized successfully');
  }

  /**
   * Phân tích sâu kết quả một bài kiểm tra.
   *
   * @param {string} sessionId - Test session ID
   * @returns {Promise<Object>} Kết quả phân tích chi tiết
   */
  async analyzeTestResults(sessionId) {
    try {
      console.log(`[AnalystAgent] Analyzing test results for session ${sessionId}`);

      // Lấy session data
      const session = await this.db.get('SELECT * FROM test_sessions WHERE id = ?', [sessionId]);
      if (!session) {
        throw new Error(`Không tìm thấy session ${sessionId}`);
      }

      // Lấy questions và answers
      const questionsWithAnswers = await this.db.all(`
        SELECT
          tq.id as question_id,
          tq.domain_id,
          tq.bloom_level,
          tq.difficulty,
          tq.question_text,
          ta.user_answer,
          tq.correct_answer,
          ta.is_correct,
          ta.time_spent
        FROM test_questions tq
        LEFT JOIN test_answers ta ON tq.id = ta.question_id AND ta.session_id = ?
        WHERE tq.session_id = ?
      `, [sessionId, sessionId]);

      // Tổng hợp theo domain
      const domainAnalysis = {};
      for (const qa of questionsWithAnswers) {
        const domainId = qa.domain_id;
        if (!domainAnalysis[domainId]) {
          domainAnalysis[domainId] = {
            domain_id: domainId,
            total: 0,
            correct: 0,
            bloom_breakdown: {},
            difficulty_breakdown: {},
            total_time: 0,
            errors: []
          };
        }

        const da = domainAnalysis[domainId];
        da.total++;
        if (qa.is_correct) da.correct++;
        da.total_time += qa.time_spent || 0;

        // Bloom breakdown
        if (!da.bloom_breakdown[qa.bloom_level]) {
          da.bloom_breakdown[qa.bloom_level] = { total: 0, correct: 0 };
        }
        da.bloom_breakdown[qa.bloom_level].total++;
        if (qa.is_correct) da.bloom_breakdown[qa.bloom_level].correct++;

        // Difficulty breakdown
        const diffGroup = qa.difficulty <= 3 ? 'easy' : qa.difficulty <= 6 ? 'medium' : 'hard';
        if (!da.difficulty_breakdown[diffGroup]) {
          da.difficulty_breakdown[diffGroup] = { total: 0, correct: 0 };
        }
        da.difficulty_breakdown[diffGroup].total++;
        if (qa.is_correct) da.difficulty_breakdown[diffGroup].correct++;

        // Track errors for gap analysis
        if (!qa.is_correct) {
          da.errors.push({
            question_id: qa.question_id,
            bloom_level: qa.bloom_level,
            difficulty: qa.difficulty
          });
        }
      }

      // Tính scores cho mỗi domain
      const domainScores = Object.values(domainAnalysis).map(da => {
        const score = da.total > 0 ? Math.round((da.correct / da.total) * 100) : 0;
        const mastery = this._getMasteryLevel(score);
        const bloomAchieved = this._getBloomAchieved(da.bloom_breakdown);
        const confidence = this._getConfidence(da.total);

        return {
          ...da,
          score,
          mastery_level: mastery,
          bloom_achieved: bloomAchieved,
          confidence,
          avg_time: da.total > 0 ? Math.round(da.total_time / da.total) : 0
        };
      });

      // Phát hiện gaps
      const gaps = await this.gapDetector.detect(domainScores, questionsWithAnswers);

      // Dùng Claude phân tích sâu
      const aiInsights = await this._getAIAnalysis(session, domainScores, gaps);

      const result = {
        sessionId,
        sessionType: session.type,
        overallScore: session.score,
        totalQuestions: session.total_questions,
        correctCount: session.correct_count,
        domainScores,
        gaps,
        aiInsights,
        analyzedAt: new Date().toISOString()
      };

      console.log(`[AnalystAgent] Analysis complete for session ${sessionId}`);
      return result;
    } catch (error) {
      console.error('[AnalystAgent] Error analyzing test results:', error.message);
      throw new Error(`Không thể phân tích kết quả: ${error.message}`);
    }
  }

  /**
   * Tạo competency tracker ban đầu cho user (sau diagnostic test).
   *
   * @param {string} userId - User ID
   * @param {Object} analysisResults - Kết quả phân tích từ analyzeTestResults
   * @returns {Promise<Array<Object>>} Tracker entries đã tạo
   */
  async createTracker(userId, analysisResults) {
    try {
      console.log(`[AnalystAgent] Creating initial tracker for user ${userId}`);

      const trackerEntries = [];
      for (const domainScore of analysisResults.domainScores) {
        const entry = await this.db.run(
          `INSERT OR REPLACE INTO tracker (user_id, domain_id, score, confidence, bloom_level, mastery_level,
            last_tested, interval_days, easiness_factor, repetition)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'), 1, 2.5, 0)`,
          [
            userId,
            domainScore.domain_id,
            domainScore.score,
            domainScore.confidence,
            domainScore.bloom_achieved,
            domainScore.mastery_level
          ]
        );

        trackerEntries.push({
          id: entry.lastID,
          user_id: userId,
          domain_id: domainScore.domain_id,
          score: domainScore.score,
          confidence: domainScore.confidence,
          bloom_level: domainScore.bloom_achieved,
          mastery_level: domainScore.mastery_level,
          interval_days: 1,
          easiness_factor: 2.5,
          repetition: 0
        });
      }

      console.log(`[AnalystAgent] Tracker created with ${trackerEntries.length} domain entries`);
      return trackerEntries;
    } catch (error) {
      console.error('[AnalystAgent] Error creating tracker:', error.message);
      throw new Error(`Không thể tạo tracker: ${error.message}`);
    }
  }

  /**
   * Cập nhật tracker với dữ liệu kiểm tra mới.
   * Sử dụng exponential moving average để smooth transitions.
   *
   * @param {string} userId - User ID
   * @param {Object} newResults - Kết quả phân tích bài kiểm tra mới
   * @returns {Promise<Array<Object>>} Updated tracker entries
   */
  async updateTracker(userId, newResults) {
    try {
      console.log(`[AnalystAgent] Updating tracker for user ${userId}`);

      const updatedEntries = [];
      const alpha = 0.3; // Smoothing factor for EMA

      for (const domainScore of newResults.domainScores) {
        // Lấy tracker hiện tại
        const current = await this.db.get(
          'SELECT * FROM tracker WHERE user_id = ? AND domain_id = ?',
          [userId, domainScore.domain_id]
        );

        if (current) {
          // EMA: newScore = alpha * newValue + (1 - alpha) * oldValue
          const smoothedScore = Math.round(alpha * domainScore.score + (1 - alpha) * current.score);
          const newMastery = this._getMasteryLevel(smoothedScore);
          const newBloom = this._higherBloom(current.bloom_level, domainScore.bloom_achieved);

          await this.db.run(
            `UPDATE tracker
             SET score = ?, confidence = ?, bloom_level = ?, mastery_level = ?,
                 last_tested = datetime('now')
             WHERE user_id = ? AND domain_id = ?`,
            [smoothedScore, domainScore.confidence, newBloom, newMastery, userId, domainScore.domain_id]
          );

          updatedEntries.push({
            domain_id: domainScore.domain_id,
            previous_score: current.score,
            new_score: smoothedScore,
            score_change: smoothedScore - current.score,
            mastery_level: newMastery,
            bloom_level: newBloom
          });
        } else {
          // Domain mới - tạo entry mới
          await this.db.run(
            `INSERT OR REPLACE INTO tracker (user_id, domain_id, score, confidence, bloom_level, mastery_level,
              last_tested, interval_days, easiness_factor, repetition)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now'), 1, 2.5, 0)`,
            [userId, domainScore.domain_id, domainScore.score, domainScore.confidence,
             domainScore.bloom_achieved, domainScore.mastery_level]
          );

          updatedEntries.push({
            domain_id: domainScore.domain_id,
            previous_score: 0,
            new_score: domainScore.score,
            score_change: domainScore.score,
            mastery_level: domainScore.mastery_level,
            bloom_level: domainScore.bloom_achieved
          });
        }
      }

      console.log(`[AnalystAgent] Tracker updated: ${updatedEntries.length} domains`);
      return updatedEntries;
    } catch (error) {
      console.error('[AnalystAgent] Error updating tracker:', error.message);
      throw new Error(`Không thể cập nhật tracker: ${error.message}`);
    }
  }

  /**
   * Lấy tracker hiện tại với computed fields (radar data, gaps).
   *
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Tracker data with computed fields
   */
  async getTracker(userId) {
    try {
      const trackerData = await this.db.all(
        'SELECT * FROM tracker WHERE user_id = ? ORDER BY domain_id',
        [userId]
      );

      if (!trackerData || trackerData.length === 0) {
        return { tracker: [], radarConfig: null, gaps: [], overallScore: 0 };
      }

      // Build radar chart config
      const radarConfig = await this.radarBuilder.build(trackerData);

      // Detect current gaps
      const gaps = await this.gapDetector.detect(trackerData, []);

      // Calculate overall score
      const overallScore = Math.round(
        trackerData.reduce((sum, t) => sum + (t.score || 0), 0) / trackerData.length
      );

      return {
        tracker: trackerData,
        radarConfig,
        gaps,
        overallScore,
        domainCount: trackerData.length,
        retrievedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('[AnalystAgent] Error getting tracker:', error.message);
      throw new Error(`Không thể lấy tracker: ${error.message}`);
    }
  }

  /**
   * Lấy tracker snapshots qua thời gian để phân tích xu hướng.
   *
   * @param {string} userId - User ID
   * @param {number} [days=30] - Số ngày lịch sử
   * @returns {Promise<Object>} Tracker history với trend data
   */
  async getTrackerHistory(userId, days = 30) {
    try {
      const history = await this.db.all(`
        SELECT ts.created_at as test_date, ts.type, ts.score as session_score,
               tq.domain_id, ta.is_correct
        FROM test_sessions ts
        JOIN test_questions tq ON tq.session_id = ts.id
        LEFT JOIN test_answers ta ON ta.question_id = tq.id AND ta.session_id = ts.id
        WHERE ts.user_id = ? AND ts.created_at >= datetime('now', ?)
        ORDER BY ts.created_at ASC
      `, [userId, `-${days} days`]);

      // Group by date and domain
      const dateMap = {};
      for (const row of history) {
        const date = row.test_date.split('T')[0].split(' ')[0];
        if (!dateMap[date]) dateMap[date] = {};
        if (!dateMap[date][row.domain_id]) {
          dateMap[date][row.domain_id] = { total: 0, correct: 0 };
        }
        dateMap[date][row.domain_id].total++;
        if (row.is_correct) dateMap[date][row.domain_id].correct++;
      }

      // Compute daily scores
      const dailyScores = Object.entries(dateMap).map(([date, domains]) => ({
        date,
        domains: Object.entries(domains).map(([domainId, data]) => ({
          domain_id: domainId,
          score: data.total > 0 ? Math.round((data.correct / data.total) * 100) : 0
        }))
      }));

      // Compute trends per domain
      const trends = this._computeTrends(dailyScores);

      return {
        userId,
        days,
        dailyScores,
        trends,
        retrievedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('[AnalystAgent] Error getting tracker history:', error.message);
      throw new Error(`Không thể lấy lịch sử tracker: ${error.message}`);
    }
  }

  /**
   * Tạo insights AI-driven về performance của user.
   *
   * @param {string} userId - User ID
   * @returns {Promise<Object>} AI-generated insights
   */
  async generateInsights(userId) {
    try {
      console.log(`[AnalystAgent] Generating insights for user ${userId}`);

      // Gather all data
      const trackerData = await this.getTracker(userId);
      const history = await this.getTrackerHistory(userId, 30);
      const user = await this.db.get('SELECT * FROM users WHERE id = ?', [userId]);

      // Get recent test sessions
      const recentSessions = await this.db.all(
        `SELECT * FROM test_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`,
        [userId]
      );

      // Retrieve relevant knowledge for context
      const knowledgeContext = await this.knowledgeRetriever.retrieve(
        `competency analysis medical student ${user?.specialty || ''}`
      );

      // Generate insights using Claude
      const response = await this.claude.messages.create({
        model: this.model,
        max_tokens: 3000,
        system: this.systemPrompt,
        messages: [{
          role: 'user',
          content: `Phân tích toàn diện năng lực học tập và đưa ra insights chi tiết bằng tiếng Việt.

Thông tin người học:
${JSON.stringify(user, null, 2)}

Tracker hiện tại:
${JSON.stringify(trackerData.tracker, null, 2)}

Gaps phát hiện:
${JSON.stringify(trackerData.gaps, null, 2)}

Lịch sử trends:
${JSON.stringify(history.trends, null, 2)}

Các bài kiểm tra gần đây:
${JSON.stringify(recentSessions, null, 2)}

Hãy trả về JSON theo format:
{
  "overall_assessment": "string",
  "strengths": [{"domain": "string", "detail": "string"}],
  "weaknesses": [{"domain": "string", "detail": "string", "priority": "critical|high|medium|low"}],
  "trends": {"summary": "string", "improving": ["string"], "declining": ["string"], "stable": ["string"]},
  "learning_style_observations": "string",
  "recommendations": [{"action": "string", "reason": "string", "priority": "number 1-5"}],
  "encouragement": "string",
  "next_milestone": {"name": "string", "progress": "string", "tip": "string"}
}`
        }]
      });

      let insights = {};
      try {
        const content = response.content[0].text;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          insights = JSON.parse(jsonMatch[0]);
        }
      } catch (parseErr) {
        console.warn('[AnalystAgent] Could not parse insights JSON:', parseErr.message);
        insights = {
          overall_assessment: response.content[0].text,
          recommendations: []
        };
      }

      console.log('[AnalystAgent] Insights generated successfully');
      return {
        userId,
        insights,
        generatedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('[AnalystAgent] Error generating insights:', error.message);
      throw new Error(`Không thể tạo insights: ${error.message}`);
    }
  }

  // ===================== PRIVATE METHODS =====================

  /**
   * Xác định mastery level từ score
   * @private
   * @param {number} score
   * @returns {string}
   */
  _getMasteryLevel(score) {
    for (const [level, range] of Object.entries(MASTERY_THRESHOLDS)) {
      if (score >= range.min && score <= range.max) return level;
    }
    return 'novice';
  }

  /**
   * Xác định Bloom level cao nhất đạt ≥60%
   * @private
   * @param {Object} bloomBreakdown
   * @returns {string}
   */
  _getBloomAchieved(bloomBreakdown) {
    const levels = ['create', 'evaluate', 'analyze', 'apply', 'understand', 'remember'];
    for (const level of levels) {
      const data = bloomBreakdown[level];
      if (data && data.total > 0 && (data.correct / data.total) >= 0.6) {
        return level;
      }
    }
    return 'remember';
  }

  /**
   * Xác định confidence dựa trên số câu hỏi
   * @private
   * @param {number} questionCount
   * @returns {string}
   */
  _getConfidence(questionCount) {
    if (questionCount > 15) return 'high';
    if (questionCount >= 5) return 'medium';
    return 'low';
  }

  /**
   * Trả về Bloom level cao hơn trong 2 level
   * @private
   * @param {string} level1
   * @param {string} level2
   * @returns {string}
   */
  _higherBloom(level1, level2) {
    const order = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];
    const idx1 = order.indexOf(level1 || 'remember');
    const idx2 = order.indexOf(level2 || 'remember');
    return order[Math.max(idx1, idx2)];
  }

  /**
   * Tính trends cho mỗi domain từ daily scores
   * @private
   * @param {Array<Object>} dailyScores
   * @returns {Object}
   */
  _computeTrends(dailyScores) {
    const domainData = {};

    for (const day of dailyScores) {
      for (const domain of day.domains) {
        if (!domainData[domain.domain_id]) {
          domainData[domain.domain_id] = [];
        }
        domainData[domain.domain_id].push({ date: day.date, score: domain.score });
      }
    }

    const trends = {};
    for (const [domainId, scores] of Object.entries(domainData)) {
      if (scores.length < 2) {
        trends[domainId] = { trend: 'new', delta: 0, dataPoints: scores.length };
        continue;
      }

      // Simple linear regression slope
      const n = scores.length;
      const halfIdx = Math.floor(n / 2);
      const firstHalfAvg = scores.slice(0, halfIdx).reduce((s, d) => s + d.score, 0) / halfIdx;
      const secondHalfAvg = scores.slice(halfIdx).reduce((s, d) => s + d.score, 0) / (n - halfIdx);
      const delta = secondHalfAvg - firstHalfAvg;

      let trend;
      if (delta > 5) trend = 'improving';
      else if (delta < -5) trend = 'declining';
      else trend = 'stable';

      trends[domainId] = { trend, delta: Math.round(delta), dataPoints: n };
    }

    return trends;
  }

  /**
   * Dùng Claude để phân tích sâu kết quả test
   * @private
   * @param {Object} session
   * @param {Array<Object>} domainScores
   * @param {Array<Object>} gaps
   * @returns {Promise<Object>}
   */
  async _getAIAnalysis(session, domainScores, gaps) {
    try {
      const response = await this.claude.messages.create({
        model: this.model,
        max_tokens: 1500,
        system: this.systemPrompt,
        messages: [{
          role: 'user',
          content: `Phân tích sâu năng lực làm bài của ứng viên theo tiêu chuẩn thi USMLE Step 1 (Cơ chế sinh lý bệnh/dược lý) và USMLE Step 2 CK (Điều trị chuyên khoa sâu) bằng tiếng Việt lâm sàng chuẩn mực.

Tổng điểm: ${session.score}% (${session.correct_count}/${session.total_questions})
Kết quả theo domain: ${JSON.stringify(domainScores.map(d => ({ domain: d.domain_id, score: d.score, mastery: d.mastery_level, bloom: d.bloom_achieved })))}
Lỗ hổng (Gaps) phát hiện: ${JSON.stringify(gaps)}

Yêu cầu nhận định:
1. "summary": Nhận xét tổng quan về độ sẵn sàng thi đậu USMLE High Percentile (ví dụ: tư duy chẩn đoán tốt hay chưa, bị hổng kiến thức khoa học cơ bản Step 1 hay phác đồ quản lý ca bệnh Step 2 CK).
2. "key_findings": Mảng gồm 2-3 phát hiện sâu về thế mạnh và lỗ hổng chí mạng (ví dụ: "Nắm vững phác đồ Hồi sức tim mạch nhưng nhầm lẫn cơ chế tác dụng của thuốc thần kinh").
3. "action_items": Mảng gồm 2-3 hành động thiết thực cần ôn luyện ngay để cải thiện điểm số USMLE.

Trả về đúng JSON: {"summary": "string", "key_findings": ["string"], "action_items": ["string"]}`
        }]
      });

      const content = response.content[0].text;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : { summary: content };
    } catch (err) {
      console.warn('[AnalystAgent] AI analysis fallback:', err.message);
      return { summary: `Điểm tổng: ${session.score}%`, key_findings: [], action_items: [] };
    }
  }
}

module.exports = AnalystAgent;
