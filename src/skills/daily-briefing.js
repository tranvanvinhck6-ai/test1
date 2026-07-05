'use strict';

/**
 * @fileoverview DailyBriefing - Tạo bản tin học tập hàng ngày
 * Sử dụng Claude để tạo bản tin cá nhân hóa với giọng điệu
 * động viên, gợi ý trọng tâm và thời gian ôn tập phù hợp.
 */

/** Các chuyên khoa y khoa */
const DOMAINS = [
  { id: 'internal', name: 'Nội khoa (Internal Medicine)' },
  { id: 'surgery', name: 'Ngoại khoa & Chấn thương (Surgery & Trauma)' },
  { id: 'obgyn', name: 'Sản phụ khoa (OB/GYN)' },
  { id: 'pediatrics', name: 'Nhi khoa (Pediatrics)' },
  { id: 'emergency', name: 'Cấp cứu & Hồi sức (Emergency & Critical Care)' },
  { id: 'psychiatry', name: 'Tâm thần & Thần kinh (Psychiatry & Neurology)' },
  { id: 'pathology', name: 'Giải phẫu bệnh & Sinh lý bệnh (Pathology)' },
  { id: 'pharmacology', name: 'Dược lý lâm sàng (Pharmacology)' },
  { id: 'physiology', name: 'Sinh lý học y khoa (Medical Physiology)' },
  { id: 'microbiology', name: 'Vi sinh & Miễn dịch học (Microbiology & Immunology)' },
  { id: 'biochemistry', name: 'Hóa sinh & Di truyền y khoa (Biochemistry & Genetics)' },
  { id: 'community', name: 'Y học dự phòng, Thống kê & Y đức (Preventive, Biostats & Ethics)' },
  { id: 'diagnostics', name: 'Cận lâm sàng & Chẩn đoán hình ảnh (Diagnostics)' }
];

/**
 * Lớp tạo bản tin học tập hàng ngày
 * @class DailyBriefing
 */
class DailyBriefing {
  /**
   * Khởi tạo DailyBriefing
   * @param {import('@anthropic-ai/sdk').default} claudeClient - Anthropic client instance
   * @param {string} model - Tên model Claude
   */
  constructor(claudeClient, model) {
    this.client = claudeClient;
    this.model = model || 'claude-sonnet-4-20250514';
  }

  /**
   * Tạo bản tin học tập hàng ngày
   * @param {Object[]} tracker - Dữ liệu tracker các chuyên khoa
   * @param {string} tracker[].domain_id - ID chuyên khoa
   * @param {number} tracker[].score - Điểm (0-100)
   * @param {string} [tracker[].next_review_date] - Ngày ôn tập tiếp
   * @param {string} [tracker[].last_review] - Lần ôn cuối
   * @param {Object[]} schedule - Lịch ôn tập hôm nay (từ SM2Scheduler.getReviewQueue)
   * @param {string} schedule[].domain_id - ID chuyên khoa
   * @param {string} schedule[].domain_name - Tên chuyên khoa
   * @param {number} schedule[].overdue_days - Số ngày quá hạn
   * @param {string} schedule[].review_urgency - Mức độ khẩn cấp
   * @param {number} schedule[].suggested_time_minutes - Thời gian gợi ý
   * @param {Object} streakData - Dữ liệu streak
   * @param {number} streakData.current_streak - Streak hiện tại (ngày)
   * @param {number} [streakData.longest_streak] - Streak dài nhất
   * @param {number} [streakData.total_study_days] - Tổng số ngày đã học
   * @param {string} [streakData.last_study_date] - Ngày học gần nhất
   * @returns {Promise<Object>} Bản tin hàng ngày
   * @returns {string} return.greeting - Lời chào
   * @returns {string} return.today_focus - Trọng tâm hôm nay
   * @returns {number} return.recommended_study_time - Thời gian ôn tập gợi ý (phút)
   * @returns {Object[]} return.priority_domains - Chuyên khoa ưu tiên
   * @returns {string} return.motivation_message - Thông điệp động viên
   */
  async generate(tracker = [], schedule = [], streakData = {}) {
    try {
      // Phân tích tình hình hiện tại
      const analysis = this._analyzeCurrentState(tracker, schedule, streakData);

      const systemPrompt = `Bạn là trợ lý học tập y khoa MedAdapt, thân thiện và động viên.
Nhiệm vụ: Tạo bản tin học tập hàng ngày bằng tiếng Việt.

GIỌNG ĐIỆU:
- Thân thiện, gần gũi nhưng chuyên nghiệp
- Động viên, khích lệ nhưng không quá sáo rỗng
- Cụ thể, có số liệu, có hành động rõ ràng
- Như một người anh/chị đồng nghiệp đi trước

TÌNH HÌNH HIỆN TẠI:
${JSON.stringify(analysis, null, 2)}

Trả lời bằng JSON:
{
  "greeting": "Lời chào cá nhân hóa theo thời gian trong ngày và streak",
  "today_focus": "Mô tả trọng tâm hôm nay (2-3 câu, cụ thể)",
  "recommended_study_time": <số phút>,
  "priority_domains": [
    {
      "domain_id": "id",
      "domain_name": "Tên",
      "reason": "Lý do ưu tiên",
      "suggested_activity": "Hoạt động gợi ý",
      "time_minutes": <số phút>
    }
  ],
  "motivation_message": "Thông điệp động viên cá nhân hóa (2-3 câu)",
  "daily_tip": "Mẹo học tập hôm nay",
  "quote": "Câu nói y khoa truyền cảm hứng"
}`;

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: 'Tạo bản tin học tập hàng ngày cho tôi.'
          }
        ]
      });

      const text = response.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        return this._fallbackBriefing(analysis);
      }

      const briefing = JSON.parse(jsonMatch[0]);

      // Bổ sung metadata
      return {
        ...briefing,
        metadata: {
          generated_at: new Date().toISOString(),
          streak: streakData.current_streak || 0,
          domains_due: schedule.length,
          overall_score: analysis.overall_score
        }
      };
    } catch (error) {
      console.error('[DailyBriefing] Lỗi tạo bản tin:', error.message);
      return this._fallbackBriefing(
        this._analyzeCurrentState(tracker, schedule, streakData)
      );
    }
  }

  /**
   * Phân tích tình hình học tập hiện tại
   * @private
   * @param {Object[]} tracker - Dữ liệu tracker
   * @param {Object[]} schedule - Lịch ôn tập
   * @param {Object} streakData - Dữ liệu streak
   * @returns {Object} Phân tích tổng hợp
   */
  _analyzeCurrentState(tracker, schedule, streakData) {
    const scores = tracker.map(t => t.score || 0);
    const overallScore = scores.length > 0
      ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length * 100) / 100
      : 0;

    // Tìm chuyên khoa mạnh nhất và yếu nhất
    const sortedByScore = [...tracker].sort((a, b) => (a.score || 0) - (b.score || 0));
    const weakest = sortedByScore.slice(0, 3).map(t => {
      const domain = DOMAINS.find(d => d.id === t.domain_id);
      return { domain_id: t.domain_id, name: domain ? domain.name : t.domain_id, score: t.score || 0 };
    });
    const strongest = sortedByScore.slice(-3).reverse().map(t => {
      const domain = DOMAINS.find(d => d.id === t.domain_id);
      return { domain_id: t.domain_id, name: domain ? domain.name : t.domain_id, score: t.score || 0 };
    });

    // Tổng thời gian ôn tập gợi ý
    const totalSuggestedTime = schedule.reduce((s, item) =>
      s + (item.suggested_time_minutes || 20), 0
    );

    // Xác định thời gian trong ngày
    const hour = new Date().getHours();
    let timeOfDay = 'sáng';
    if (hour >= 12 && hour < 17) timeOfDay = 'chiều';
    else if (hour >= 17 && hour < 21) timeOfDay = 'tối';
    else if (hour >= 21 || hour < 5) timeOfDay = 'khuya';

    return {
      time_of_day: timeOfDay,
      overall_score: overallScore,
      weakest_domains: weakest,
      strongest_domains: strongest,
      domains_due_today: schedule.length,
      total_suggested_time: Math.min(totalSuggestedTime, 180), // Tối đa 3 giờ
      current_streak: streakData.current_streak || 0,
      longest_streak: streakData.longest_streak || 0,
      total_study_days: streakData.total_study_days || 0,
      overdue_domains: schedule.filter(s => s.overdue_days > 3).length
    };
  }

  /**
   * Tạo bản tin fallback khi Claude không khả dụng
   * @private
   * @param {Object} analysis - Phân tích hiện tại
   * @returns {Object} Bản tin cơ bản
   */
  _fallbackBriefing(analysis) {
    const greetings = {
      sáng: 'Chào buổi sáng! ☀️',
      chiều: 'Chào buổi chiều! 🌤️',
      tối: 'Chào buổi tối! 🌙',
      khuya: 'Đêm khuya rồi, đừng quên nghỉ ngơi! 🌃'
    };

    const priorityDomains = analysis.weakest_domains.map(d => ({
      domain_id: d.domain_id,
      domain_name: d.name,
      reason: `Điểm hiện tại: ${d.score}%`,
      suggested_activity: 'Ôn tập lý thuyết cơ bản',
      time_minutes: 20
    }));

    return {
      greeting: greetings[analysis.time_of_day] || 'Xin chào! 👋',
      today_focus: analysis.domains_due_today > 0
        ? `Hôm nay bạn có ${analysis.domains_due_today} chuyên khoa cần ôn tập. Hãy bắt đầu với những chuyên khoa yếu nhất.`
        : 'Hôm nay không có lịch ôn tập cụ thể. Hãy dành thời gian củng cố kiến thức tổng quát.',
      recommended_study_time: analysis.total_suggested_time || 30,
      priority_domains: priorityDomains,
      motivation_message: analysis.current_streak > 0
        ? `Tuyệt vời! Bạn đã duy trì streak ${analysis.current_streak} ngày liên tiếp. Hãy tiếp tục! 💪`
        : 'Hôm nay là ngày tuyệt vời để bắt đầu hành trình học tập! 🚀',
      daily_tip: 'Chia nhỏ thời gian học thành các phiên 25 phút (Pomodoro) để tập trung hiệu quả hơn.',
      metadata: {
        generated_at: new Date().toISOString(),
        streak: analysis.current_streak,
        domains_due: analysis.domains_due_today,
        overall_score: analysis.overall_score,
        is_fallback: true
      }
    };
  }
}

module.exports = DailyBriefing;
