'use strict';

const fs = require('fs');
const path = require('path');

/**
 * @fileoverview CurriculumAgent - Agent thiết kế chương trình học cá nhân hóa.
 * Xây dựng lộ trình học tập, kế hoạch hàng ngày/tuần, tích hợp SM-2 spaced repetition,
 * và điều chỉnh linh hoạt dựa trên tiến bộ.
 */

/**
 * Danh sách domains y khoa
 * @constant {Array<Object>}
 */
const DOMAINS = [
  // USMLE Step 2 CK - Clinical Specialties & Organ Systems
  { id: 'internal', name: 'Nội khoa (Internal Medicine)', subdomains: ['Tim mạch (Cardiology)', 'Hô hấp (Pulmonology)', 'Tiêu hóa (Gastroenterology)', 'Thận-Tiết niệu (Nephrology/Urology)', 'Nội tiết (Endocrinology)', 'Huyết học-Ung bướu (Hem/Onc)', 'Cơ xương khớp (Rheumatology)'] },
  { id: 'surgery', name: 'Ngoại khoa & Chấn thương (Surgery & Trauma)', subdomains: ['Ngoại tiêu hóa', 'Chấn thương chỉnh hình', 'Ngoại thần kinh', 'Ngoại lồng ngực - Mạch máu'] },
  { id: 'obgyn', name: 'Sản phụ khoa (OB/GYN)', subdomains: ['Sản khoa (Obstetrics)', 'Phụ khoa (Gynecology)', 'Nội tiết sinh sản'] },
  { id: 'pediatrics', name: 'Nhi khoa (Pediatrics)', subdomains: ['Nhi tổng quát', 'Sơ sinh (Neonatology)', 'Cấp cứu nhi', 'Bệnh lý bẩm sinh & Di truyền'] },
  { id: 'emergency', name: 'Cấp cứu & Hồi sức (Emergency & Critical Care)', subdomains: ['Cấp cứu tim mạch', 'Sốc & Hồi sức tích cực', 'Chấn thương đa cơ quan', 'Ngộ độc & Cấp cứu môi trường'] },
  { id: 'psychiatry', name: 'Tâm thần & Thần kinh (Psychiatry & Neurology)', subdomains: ['Rối loạn khí sắc & Lo âu', 'Loạn thần & Tâm thần phân liệt', 'Tai biến mạch máu não', 'Động kinh & Bệnh thoái hóa thần kinh'] },
  // USMLE Step 1 - Foundational Medical Sciences
  { id: 'pathology', name: 'Giải phẫu bệnh & Sinh lý bệnh (Pathology)', subdomains: ['Tổn thương tế bào & Viêm', 'Bệnh lý u bướu (Neoplasia)', 'Sinh lý bệnh huyết học', 'Sinh lý bệnh tim mạch - hô hấp'] },
  { id: 'pharmacology', name: 'Dược lý lâm sàng (Pharmacology)', subdomains: ['Dược động học & Dược lực học', 'Kháng sinh & Thuốc kháng vi sinh vật', 'Thuốc tim mạch & Thận', 'Thuốc thần kinh & Tâm thần', 'Độc chất học'] },
  { id: 'physiology', name: 'Sinh lý học y khoa (Medical Physiology)', subdomains: ['Sinh lý tim mạch & Huyết áp', 'Sinh lý hô hấp & Khí máu', 'Sinh lý thận & Điện giải', 'Sinh lý nội tiết'] },
  { id: 'microbiology', name: 'Vi sinh & Miễn dịch học (Microbiology & Immunology)', subdomains: ['Vi khuẩn học lâm sàng', 'Virus & Nấm học', 'Miễn dịch bẩm sinh & Đáp ứng viêm', 'Quá mẫn & Bệnh tự miễn'] },
  { id: 'biochemistry', name: 'Hóa sinh & Di truyền y khoa (Biochemistry & Genetics)', subdomains: ['Chuyển hóa năng lượng & Enzyme', 'Di truyền phân tử & Bệnh bẩm sinh', 'Dinh dưỡng & Vitamin'] },
  { id: 'community', name: 'Y học dự phòng, Thống kê & Y đức (Preventive, Biostats & Ethics)', subdomains: ['Thống kê y học & Dịch tễ', 'Y đức & Giao tiếp bệnh nhân (Communication)', 'An toàn người bệnh & Quản lý chất lượng'] },
  { id: 'diagnostics', name: 'Cận lâm sàng & Chẩn đoán hình ảnh (Diagnostics)', subdomains: ['Chẩn đoán hình ảnh (CT/MRI/X-quang)', 'Xét nghiệm huyết học - sinh hóa', 'Điện tim (ECG) & Thăm dò chức năng'] }
];

/**
 * Activity types với thời gian ước tính mặc định (phút)
 * @constant {Object}
 */
const ACTIVITY_DEFAULTS = {
  review: { defaultMinutes: 15, label: 'Ôn tập' },
  lesson: { defaultMinutes: 25, label: 'Bài học' },
  test: { defaultMinutes: 20, label: 'Kiểm tra' },
  case: { defaultMinutes: 20, label: 'Ca lâm sàng' }
};

class CurriculumAgent {
  /**
   * Khởi tạo CurriculumAgent
   * @param {Object} params
   * @param {import('@anthropic-ai/sdk').default} params.claudeClient - Claude API client
   * @param {string} params.model - Model identifier
   * @param {Object} params.db - Database connection
   * @param {Object} params.skills - Skill instances
   * @param {import('../skills/gap-detector')} params.skills.gapDetector - Gap detection skill
   * @param {import('../skills/sm2-scheduler')} params.skills.sm2Scheduler - SM-2 scheduling skill
   * @param {import('../skills/difficulty-calibrator')} params.skills.difficultyCalibrator - Difficulty calibration
   */
  constructor({ claudeClient, model, db, skills: { gapDetector, sm2Scheduler, difficultyCalibrator } }) {
    this.claude = claudeClient;
    this.model = model;
    this.db = db;
    this.gapDetector = gapDetector;
    this.sm2Scheduler = sm2Scheduler;
    this.difficultyCalibrator = difficultyCalibrator;

    // Load system prompt
    const promptPath = path.join(__dirname, '..', 'prompts', 'curriculum.md');
    this.systemPrompt = fs.readFileSync(promptPath, 'utf-8');

    console.log('[CurriculumAgent] Initialized successfully');
  }

  /**
   * Tạo lộ trình học tập dài hạn cá nhân hóa.
   *
   * @param {string} userId - User ID
   * @param {Array<Object>} tracker - Competency tracker data
   * @returns {Promise<Object>} Learning path
   */
  async createLearningPath(userId, tracker) {
    try {
      console.log(`[CurriculumAgent] Creating learning path for user ${userId}`);

      const user = await this.db.get('SELECT * FROM users WHERE id = ?', [userId]);
      const gaps = await this.gapDetector.detect(tracker, []);

      // Classify gaps by priority
      const criticalGaps = gaps.filter(g => g.priority === 'critical');
      const highGaps = gaps.filter(g => g.priority === 'high');
      const mediumGaps = gaps.filter(g => g.priority === 'medium');
      const lowGaps = gaps.filter(g => g.priority === 'low');

      // Use Claude to design the learning path
      const response = await this.claude.messages.create({
        model: this.model,
        max_tokens: 4000,
        system: this.systemPrompt,
        messages: [{
          role: 'user',
          content: `Thiết kế lộ trình học tập cá nhân hóa cho người học sau. Trả về JSON.

Thông tin người học:
- Chuyên ngành: ${user?.specialty || 'Đa khoa'}
- Kinh nghiệm: ${user?.experience_years || 0} năm
- Mục tiêu: ${user?.goals || 'Thi tốt nghiệp'}

Tracker hiện tại:
${JSON.stringify(tracker.map(t => ({
  domain: t.domain_id,
  score: t.score,
  mastery: t.mastery_level,
  bloom: t.bloom_level
})), null, 2)}

Lỗ hổng phát hiện:
- Critical (${criticalGaps.length}): ${JSON.stringify(criticalGaps.map(g => g.domain_id))}
- High (${highGaps.length}): ${JSON.stringify(highGaps.map(g => g.domain_id))}
- Medium (${mediumGaps.length}): ${JSON.stringify(mediumGaps.map(g => g.domain_id))}
- Low (${lowGaps.length}): ${JSON.stringify(lowGaps.map(g => g.domain_id))}

Domains:
${JSON.stringify(DOMAINS.map(d => ({ id: d.id, name: d.name })), null, 2)}

Trả về JSON theo format:
{
  "total_weeks": number,
  "phases": [
    {
      "phase": number,
      "name": "string",
      "weeks": "string (e.g. '1-4')",
      "focus": ["domain_id"],
      "bloom_target": "string",
      "difficulty_range": "string (e.g. '3-6')",
      "goals": ["string"],
      "milestones": ["string"]
    }
  ],
  "expected_outcomes": ["string"],
  "study_schedule": {
    "daily_minutes": number,
    "days_per_week": number,
    "rest_day": "string"
  }
}`
        }]
      });

      let learningPath = {};
      try {
        const content = response.content[0].text;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          learningPath = JSON.parse(jsonMatch[0]);
        }
      } catch (parseErr) {
        console.warn('[CurriculumAgent] Could not parse learning path JSON:', parseErr.message);
        learningPath = this._createDefaultLearningPath(tracker, gaps);
      }

      learningPath.userId = userId;
      learningPath.createdAt = new Date().toISOString();

      console.log(`[CurriculumAgent] Learning path created: ${learningPath.total_weeks || '?'} weeks, ${learningPath.phases?.length || 0} phases`);
      return learningPath;
    } catch (error) {
      console.error('[CurriculumAgent] Error creating learning path:', error.message);
      throw new Error(`Không thể tạo lộ trình học tập: ${error.message}`);
    }
  }

  /**
   * Lên kế hoạch học tập cho ngày hôm nay.
   *
   * @param {string} userId - User ID
   * @param {Array<Object>} tracker - Competency tracker data
   * @returns {Promise<Object>} Today's plan
   */
  async planToday(userId, tracker) {
    try {
      console.log(`[CurriculumAgent] Planning today for user ${userId}`);

      // Lấy SM-2 review queue bằng hàm chuẩn của scheduler
      const sm2Queue = this.sm2Scheduler.getReviewQueue(tracker);
      const reviewQueue = sm2Queue.map(item => ({
        domain_id: item.domain_id,
        priority: item.overdue_days > 3 ? 'critical' : 'high',
        overdueDays: item.overdue_days,
        easiness_factor: item.easiness_factor
      }));

      // Detect current gaps
      const gaps = await this.gapDetector.detect(tracker, []);

      // Get user profile for calibration
      const user = await this.db.get('SELECT * FROM users WHERE id = ?', [userId]);

      // Calibrate difficulty
      const calibration = await this.difficultyCalibrator.calibrate(user, { tracker });

      // Get recent progress
      const recentProgress = await this.db.get(
        `SELECT * FROM daily_progress WHERE user_id = ? ORDER BY date DESC LIMIT 1`,
        [userId]
      );

      // Build today's plan with Claude
      const response = await this.claude.messages.create({
        model: this.model,
        max_tokens: 2000,
        system: this.systemPrompt,
        messages: [{
          role: 'user',
          content: `Lên kế hoạch học tập cho hôm nay. Trả về JSON.

Review queue (SM-2):
${JSON.stringify(reviewQueue, null, 2)}

Gaps cần xử lý:
${JSON.stringify(gaps.slice(0, 5), null, 2)}

Tracker:
${JSON.stringify(tracker.map(t => ({ domain: t.domain_id, score: t.score, mastery: t.mastery_level })), null, 2)}

Độ khó phù hợp: ${calibration.difficulty || 5}
Streak hiện tại: ${recentProgress?.streak || 0}

Trả về JSON:
{
  "date": "${new Date().toISOString().split('T')[0]}",
  "estimated_time_minutes": number (60-90),
  "activities": [
    {
      "order": number,
      "type": "review|lesson|test|case",
      "domain_id": "string",
      "title": "string",
      "description": "string",
      "estimated_minutes": number,
      "difficulty": 1-10,
      "bloom_target": "string",
      "priority": "critical|high|medium|low",
      "reason": "string"
    }
  ],
  "goals": ["string"],
  "motivation": "string"
}`
        }]
      });

      let todayPlan = {};
      try {
        const content = response.content[0].text;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          todayPlan = JSON.parse(jsonMatch[0]);
        }
      } catch (parseErr) {
        console.warn('[CurriculumAgent] Could not parse daily plan:', parseErr.message);
        todayPlan = this._createDefaultDailyPlan(tracker, reviewQueue, gaps);
      }

      todayPlan.userId = userId;
      todayPlan.reviewQueue = reviewQueue;

      console.log(`[CurriculumAgent] Today's plan: ${todayPlan.activities?.length || 0} activities, ~${todayPlan.estimated_time_minutes || 60} min`);
      return todayPlan;
    } catch (error) {
      console.error('[CurriculumAgent] Error planning today:', error.message);
      throw new Error(`Không thể lên kế hoạch hôm nay: ${error.message}`);
    }
  }

  /**
   * Điều chỉnh kế hoạch dựa trên tracker cập nhật.
   *
   * @param {string} userId - User ID
   * @param {Array<Object>} updatedTracker - Updated tracker data
   * @returns {Promise<Object>} Adjusted plan
   */
  async adjustPlan(userId, updatedTracker) {
    try {
      console.log(`[CurriculumAgent] Adjusting plan for user ${userId}`);

      // Phát hiện gaps mới
      const newGaps = await this.gapDetector.detect(updatedTracker, []);

      // Recalibrate difficulty
      const user = await this.db.get('SELECT * FROM users WHERE id = ?', [userId]);
      const calibration = await this.difficultyCalibrator.calibrate(user, {
        tracker: updatedTracker
      });

      // Tìm domains có thay đổi đáng kể
      const significantChanges = updatedTracker.filter(t => {
        // Domains có score thay đổi > 10 điểm kể từ lần kiểm tra gần nhất
        return Math.abs(t.score_change || 0) > 10;
      });

      const adjustedPlan = await this.planToday(userId, updatedTracker);

      adjustedPlan.adjustments = {
        reason: significantChanges.length > 0
          ? `Điều chỉnh do thay đổi ở: ${significantChanges.map(c => c.domain_id).join(', ')}`
          : 'Cập nhật theo tiến bộ mới nhất',
        newGapsCount: newGaps.length,
        calibratedDifficulty: calibration.difficulty,
        adjustedAt: new Date().toISOString()
      };

      console.log(`[CurriculumAgent] Plan adjusted: ${adjustedPlan.adjustments.reason}`);
      return adjustedPlan;
    } catch (error) {
      console.error('[CurriculumAgent] Error adjusting plan:', error.message);
      throw new Error(`Không thể điều chỉnh kế hoạch: ${error.message}`);
    }
  }

  /**
   * Lấy kế hoạch tổng quan tuần.
   *
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Weekly plan
   */
  async getWeeklyPlan(userId) {
    try {
      console.log(`[CurriculumAgent] Getting weekly plan for user ${userId}`);

      const tracker = await this.db.all(
        'SELECT * FROM tracker WHERE user_id = ?', [userId]
      );
      const user = await this.db.get('SELECT * FROM users WHERE id = ?', [userId]);
      const gaps = await this.gapDetector.detect(tracker, []);

      // Get this week's progress so far
      const weekProgress = await this.db.all(
        `SELECT * FROM daily_progress WHERE user_id = ? AND date >= date('now', '-7 days') ORDER BY date`,
        [userId]
      );

      const response = await this.claude.messages.create({
        model: this.model,
        max_tokens: 3000,
        system: this.systemPrompt,
        messages: [{
          role: 'user',
          content: `Tạo kế hoạch tuần tổng quan. Trả về JSON.

Người học: ${user?.name || 'N/A'}, chuyên ngành: ${user?.specialty || 'Đa khoa'}
Tracker: ${JSON.stringify(tracker.map(t => ({ domain: t.domain_id, score: t.score, mastery: t.mastery_level })))}
Gaps: ${JSON.stringify(gaps.slice(0, 5).map(g => ({ domain: g.domain_id, priority: g.priority, type: g.type })))}
Tiến bộ tuần này: ${JSON.stringify(weekProgress)}

Trả về JSON:
{
  "week_start": "${this._getMonday()}",
  "week_end": "${this._getSunday()}",
  "theme": "string",
  "weekly_goals": ["string"],
  "daily_plans": [
    {
      "day": "string",
      "focus_domains": ["string"],
      "key_activities": ["string"],
      "estimated_minutes": number
    }
  ],
  "weekly_targets": {
    "tests_target": number,
    "lessons_target": number,
    "review_items": number,
    "score_target": number
  },
  "adjustments_from_last_week": "string"
}`
        }]
      });

      let weeklyPlan = {};
      try {
        const content = response.content[0].text;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          weeklyPlan = JSON.parse(jsonMatch[0]);
        }
      } catch (parseErr) {
        console.warn('[CurriculumAgent] Could not parse weekly plan:', parseErr.message);
        weeklyPlan = { theme: 'Ôn tập và củng cố', weekly_goals: ['Duy trì streak'], daily_plans: [] };
      }

      weeklyPlan.userId = userId;

      console.log(`[CurriculumAgent] Weekly plan generated: theme "${weeklyPlan.theme}"`);
      return weeklyPlan;
    } catch (error) {
      console.error('[CurriculumAgent] Error getting weekly plan:', error.message);
      throw new Error(`Không thể lấy kế hoạch tuần: ${error.message}`);
    }
  }

  // ===================== PRIVATE METHODS =====================

  /**
   * Tạo lộ trình mặc định khi AI parse fail
   * @private
   * @param {Array<Object>} tracker
   * @param {Array<Object>} gaps
   * @returns {Object}
   */
  _createDefaultLearningPath(tracker, gaps) {
    return {
      total_weeks: 12,
      phases: [
        {
          phase: 1,
          name: 'Củng cố nền tảng',
          weeks: '1-4',
          focus: gaps.filter(g => g.priority === 'critical').map(g => g.domain_id),
          bloom_target: 'understand',
          difficulty_range: '3-5',
          goals: ['Xử lý các lỗ hổng critical', 'Đạt mastery Beginner ở tất cả domains'],
          milestones: ['Tất cả domains ≥ 40%']
        },
        {
          phase: 2,
          name: 'Phát triển ứng dụng',
          weeks: '5-8',
          focus: gaps.filter(g => g.priority === 'high').map(g => g.domain_id),
          bloom_target: 'apply',
          difficulty_range: '5-7',
          goals: ['Nâng cao domains yếu', 'Bắt đầu case-based learning'],
          milestones: ['Đạt Intermediate ở 5+ domains']
        },
        {
          phase: 3,
          name: 'Thành thạo',
          weeks: '9-12',
          focus: tracker.map(t => t.domain_id),
          bloom_target: 'evaluate',
          difficulty_range: '7-9',
          goals: ['Đạt Advanced ở domains chính', 'Tích hợp kiến thức liên chuyên khoa'],
          milestones: ['Đạt Advanced ở 3+ domains', 'Score trung bình ≥ 75%']
        }
      ],
      expected_outcomes: ['Sẵn sàng cho thi tốt nghiệp', 'Tư duy lâm sàng hệ thống']
    };
  }

  /**
   * Tạo kế hoạch ngày mặc định
   * @private
   * @param {Array<Object>} tracker
   * @param {Array<Object>} reviewQueue
   * @param {Array<Object>} gaps
   * @returns {Object}
   */
  _createDefaultDailyPlan(tracker, reviewQueue, gaps) {
    const activities = [];
    let order = 1;

    // Add review items first
    if (reviewQueue.length > 0) {
      activities.push({
        order: order++,
        type: 'review',
        domain_id: reviewQueue[0].domain_id,
        title: `Ôn tập ${reviewQueue[0].domain_id}`,
        description: 'Ôn tập theo SM-2',
        estimated_minutes: 15,
        difficulty: 5,
        bloom_target: 'apply',
        priority: 'high',
        reason: 'SM-2 review đến hạn'
      });
    }

    // Add gap-focused lesson
    if (gaps.length > 0) {
      activities.push({
        order: order++,
        type: 'lesson',
        domain_id: gaps[0].domain_id,
        title: `Bài học: ${gaps[0].domain_id}`,
        description: `Bổ sung lỗ hổng ${gaps[0].type}`,
        estimated_minutes: 25,
        difficulty: 5,
        bloom_target: 'understand',
        priority: gaps[0].priority,
        reason: `Gap ${gaps[0].priority}: ${gaps[0].description || gaps[0].domain_id}`
      });
    }

    // Add test
    activities.push({
      order: order++,
      type: 'test',
      domain_id: 'mixed',
      title: 'Kiểm tra hàng ngày',
      description: '12 câu hỏi tập trung vùng yếu',
      estimated_minutes: 20,
      difficulty: 5,
      bloom_target: 'apply',
      priority: 'high',
      reason: 'Đánh giá tiến bộ'
    });

    return {
      date: new Date().toISOString().split('T')[0],
      estimated_time_minutes: 60,
      activities,
      goals: ['Duy trì streak', 'Cải thiện domain yếu nhất'],
      motivation: 'Mỗi ngày tiến bộ một chút! 💪'
    };
  }

  /**
   * Lấy ngày Thứ Hai của tuần hiện tại
   * @private
   * @returns {string} YYYY-MM-DD
   */
  _getMonday() {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    return monday.toISOString().split('T')[0];
  }

  /**
   * Lấy ngày Chủ Nhật của tuần hiện tại
   * @private
   * @returns {string} YYYY-MM-DD
   */
  _getSunday() {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() + (7 - day);
    const sunday = new Date(d.setDate(diff));
    return sunday.toISOString().split('T')[0];
  }
}

module.exports = CurriculumAgent;
