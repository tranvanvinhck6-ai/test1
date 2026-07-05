'use strict';

/**
 * @fileoverview StreakMotivator - Hệ thống động viên và huy hiệu
 * Tạo thông điệp động viên, kiểm tra và trao huy hiệu,
 * theo dõi mốc thành tích (milestones) và xu hướng tiến bộ.
 */

/**
 * Hệ thống huy hiệu thành tích
 * @constant
 */
const BADGES = [
  // === Streak Badges ===
  {
    id: 'streak_7',
    name: '🔥 Ngọn lửa tuần',
    description: 'Học liên tục 7 ngày',
    icon: '🔥',
    category: 'streak',
    requirement: { type: 'streak', days: 7 }
  },
  {
    id: 'streak_14',
    name: '⚡ Kiên trì',
    description: 'Học liên tục 14 ngày',
    icon: '⚡',
    category: 'streak',
    requirement: { type: 'streak', days: 14 }
  },
  {
    id: 'streak_30',
    name: '🏆 Chiến binh tháng',
    description: 'Học liên tục 30 ngày',
    icon: '🏆',
    category: 'streak',
    requirement: { type: 'streak', days: 30 }
  },
  {
    id: 'streak_60',
    name: '💎 Kim cương',
    description: 'Học liên tục 60 ngày',
    icon: '💎',
    category: 'streak',
    requirement: { type: 'streak', days: 60 }
  },
  {
    id: 'streak_90',
    name: '👑 Huyền thoại',
    description: 'Học liên tục 90 ngày',
    icon: '👑',
    category: 'streak',
    requirement: { type: 'streak', days: 90 }
  },
  {
    id: 'streak_180',
    name: '🌟 Siêu sao',
    description: 'Học liên tục 180 ngày - Nửa năm không gián đoạn!',
    icon: '🌟',
    category: 'streak',
    requirement: { type: 'streak', days: 180 }
  },
  {
    id: 'streak_365',
    name: '🎓 Bậc thầy',
    description: 'Học liên tục 365 ngày - Một năm trọn vẹn!',
    icon: '🎓',
    category: 'streak',
    requirement: { type: 'streak', days: 365 }
  },

  // === Performance Badges ===
  {
    id: 'first_perfect',
    name: '💯 Hoàn hảo đầu tiên',
    description: 'Đạt 100% trong một bài kiểm tra',
    icon: '💯',
    category: 'performance',
    requirement: { type: 'perfect_score', count: 1 }
  },
  {
    id: 'all_domains_70',
    name: '🌈 Toàn diện',
    description: 'Đạt ≥70% tất cả chuyên khoa',
    icon: '🌈',
    category: 'performance',
    requirement: { type: 'all_domains_above', threshold: 70 }
  },
  {
    id: 'improvement_20',
    name: '📈 Tiến bộ vượt bậc',
    description: 'Cải thiện ≥20% trong một chuyên khoa',
    icon: '📈',
    category: 'performance',
    requirement: { type: 'improvement', percent: 20 }
  },

  // === Activity Badges ===
  {
    id: 'questions_100',
    name: '📝 100 câu hỏi',
    description: 'Hoàn thành 100 câu hỏi trắc nghiệm',
    icon: '📝',
    category: 'activity',
    requirement: { type: 'total_questions', count: 100 }
  },
  {
    id: 'questions_500',
    name: '📚 500 câu hỏi',
    description: 'Hoàn thành 500 câu hỏi trắc nghiệm',
    icon: '📚',
    category: 'activity',
    requirement: { type: 'total_questions', count: 500 }
  },
  {
    id: 'questions_1000',
    name: '🏅 1000 câu hỏi',
    description: 'Hoàn thành 1000 câu hỏi trắc nghiệm',
    icon: '🏅',
    category: 'activity',
    requirement: { type: 'total_questions', count: 1000 }
  }
];

/** Các mốc streak cần celebration */
const MILESTONE_DAYS = [7, 14, 30, 60, 90, 180, 365];

/**
 * Lớp tạo động lực và quản lý huy hiệu thành tích
 * @class StreakMotivator
 */
class StreakMotivator {
  /**
   * Khởi tạo StreakMotivator
   * @param {import('@anthropic-ai/sdk').default} claudeClient - Anthropic client instance
   * @param {string} model - Tên model Claude
   */
  constructor(claudeClient, model) {
    this.client = claudeClient;
    this.model = model || 'claude-sonnet-4-20250514';
  }

  /**
   * Tạo thông điệp động viên dựa trên streak và xu hướng tiến bộ
   * @param {Object} streakData - Dữ liệu streak
   * @param {number} streakData.current_streak - Streak hiện tại (ngày)
   * @param {number} [streakData.longest_streak] - Streak dài nhất
   * @param {number} [streakData.total_study_days] - Tổng ngày đã học
   * @param {number} [streakData.total_questions] - Tổng câu hỏi đã làm
   * @param {number} [streakData.perfect_scores] - Số lần đạt điểm tuyệt đối
   * @param {string[]} [streakData.earned_badges] - Huy hiệu đã đạt
   * @param {Object} progressTrend - Xu hướng tiến bộ
   * @param {number} [progressTrend.score_change] - Thay đổi điểm (tuần qua)
   * @param {string} [progressTrend.direction] - Hướng: improving/stable/declining
   * @param {Object[]} [progressTrend.domain_scores] - Điểm từng chuyên khoa
   * @param {number} [progressTrend.domain_scores[].score] - Điểm
   * @param {string} [progressTrend.domain_scores[].domain_id] - ID
   * @returns {Promise<Object>} Kết quả động viên
   * @returns {string} return.message - Thông điệp động viên
   * @returns {Object[]} return.badges_earned - Huy hiệu mới đạt được
   * @returns {Object} return.next_milestone - Mốc tiếp theo
   * @returns {string} return.encouragement - Lời khích lệ
   */
  async motivate(streakData = {}, progressTrend = {}) {
    try {
      // Kiểm tra huy hiệu mới
      const newBadges = this.getBadges(streakData);

      // Tìm mốc tiếp theo
      const nextMilestone = this._getNextMilestone(streakData.current_streak || 0);

      // Kiểm tra xem có đang ở milestone không
      const isAtMilestone = MILESTONE_DAYS.includes(streakData.current_streak);

      // Tạo thông điệp động viên với Claude
      const message = await this._generateMotivation(streakData, progressTrend, newBadges, isAtMilestone);

      return {
        message: message.main_message,
        badges_earned: newBadges,
        next_milestone: nextMilestone,
        encouragement: message.encouragement,
        celebration: isAtMilestone ? message.celebration : null,
        stats_summary: this._buildStatsSummary(streakData, progressTrend),
        metadata: {
          generated_at: new Date().toISOString(),
          is_milestone: isAtMilestone,
          new_badges_count: newBadges.length
        }
      };
    } catch (error) {
      console.error('[StreakMotivator] Lỗi tạo động viên:', error.message);
      return this._fallbackMotivation(streakData, progressTrend);
    }
  }

  /**
   * Kiểm tra và trả về các huy hiệu mới đạt được
   * @param {Object} streakData - Dữ liệu streak và thành tích
   * @param {number} [streakData.current_streak] - Streak hiện tại
   * @param {number} [streakData.total_questions] - Tổng câu hỏi
   * @param {number} [streakData.perfect_scores] - Số lần điểm tuyệt đối
   * @param {string[]} [streakData.earned_badges] - Huy hiệu đã có
   * @param {Object[]} [streakData.domain_scores] - Điểm các chuyên khoa
   * @param {number} [streakData.max_improvement] - Cải thiện lớn nhất (%)
   * @returns {Object[]} Mảng huy hiệu mới đạt được
   */
  getBadges(streakData = {}) {
    const earned = streakData.earned_badges || [];
    const newBadges = [];

    for (const badge of BADGES) {
      // Bỏ qua nếu đã đạt
      if (earned.includes(badge.id)) continue;

      // Kiểm tra điều kiện
      const isEarned = this._checkBadgeRequirement(badge, streakData);
      if (isEarned) {
        newBadges.push({
          id: badge.id,
          name: badge.name,
          description: badge.description,
          icon: badge.icon,
          category: badge.category,
          earned_at: new Date().toISOString()
        });
      }
    }

    return newBadges;
  }

  /**
   * Kiểm tra điều kiện của một huy hiệu
   * @private
   * @param {Object} badge - Huy hiệu cần kiểm tra
   * @param {Object} streakData - Dữ liệu streak
   * @returns {boolean} Đã đạt điều kiện chưa
   */
  _checkBadgeRequirement(badge, streakData) {
    const req = badge.requirement;
    switch (req.type) {
      case 'streak':
        return (streakData.current_streak || 0) >= req.days;

      case 'perfect_score':
        return (streakData.perfect_scores || 0) >= req.count;

      case 'total_questions':
        return (streakData.total_questions || 0) >= req.count;

      case 'all_domains_above':
        if (!streakData.domain_scores || streakData.domain_scores.length === 0) return false;
        return streakData.domain_scores.every(d => (d.score || 0) >= req.threshold);

      case 'improvement':
        return (streakData.max_improvement || 0) >= req.percent;

      default:
        return false;
    }
  }

  /**
   * Tìm mốc thành tích tiếp theo
   * @private
   * @param {number} currentStreak - Streak hiện tại
   * @returns {Object} Mốc tiếp theo
   */
  _getNextMilestone(currentStreak) {
    const nextDay = MILESTONE_DAYS.find(d => d > currentStreak);

    if (!nextDay) {
      return {
        days: currentStreak + 30, // Mỗi 30 ngày sau 365
        days_remaining: 30,
        message: `🎯 Tiếp tục duy trì, mốc tiếp theo: ${currentStreak + 30} ngày!`
      };
    }

    const remaining = nextDay - currentStreak;
    const badgeInfo = BADGES.find(b => b.requirement.type === 'streak' && b.requirement.days === nextDay);

    return {
      days: nextDay,
      days_remaining: remaining,
      badge: badgeInfo ? badgeInfo.name : null,
      message: `🎯 Còn ${remaining} ngày nữa để đạt mốc ${nextDay} ngày${badgeInfo ? ` - ${badgeInfo.name}` : ''}!`
    };
  }

  /**
   * Tạo thông điệp động viên với Claude AI
   * @private
   * @param {Object} streakData - Dữ liệu streak
   * @param {Object} progressTrend - Xu hướng tiến bộ
   * @param {Object[]} newBadges - Huy hiệu mới
   * @param {boolean} isAtMilestone - Có đang ở mốc thành tích không
   * @returns {Promise<Object>} Thông điệp
   */
  async _generateMotivation(streakData, progressTrend, newBadges, isAtMilestone) {
    try {
      const systemPrompt = `Bạn là trợ lý động viên học tập y khoa MedAdapt.
Nhiệm vụ: Tạo thông điệp động viên bằng tiếng Việt.

GIỌNG ĐIỆU:
- Nồng nhiệt, chân thành
- Cụ thể (dùng số liệu thực)
- Ngắn gọn nhưng ấm áp
${isAtMilestone ? '- ĐÂY LÀ MỐC THÀNH TÍCH! Hãy celebrate thật đặc biệt!' : ''}
${newBadges.length > 0 ? `- CHÚC MỪNG HUY HIỆU MỚI: ${newBadges.map(b => b.name).join(', ')}` : ''}

DỮ LIỆU:
- Streak hiện tại: ${streakData.current_streak || 0} ngày
- Streak dài nhất: ${streakData.longest_streak || 0} ngày
- Xu hướng: ${progressTrend.direction || 'stable'}
- Thay đổi điểm: ${progressTrend.score_change || 0}%

Trả lời bằng JSON:
{
  "main_message": "Thông điệp chính (1-2 câu)",
  "encouragement": "Lời khích lệ cụ thể (1-2 câu)",
  "celebration": "Thông điệp celebration nếu ở milestone, null nếu không"
}`;

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 512,
        system: systemPrompt,
        messages: [
          { role: 'user', content: 'Tạo thông điệp động viên.' }
        ]
      });

      const text = response.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      return this._fallbackMessages(streakData, isAtMilestone);
    } catch (error) {
      console.error('[StreakMotivator] Lỗi tạo thông điệp AI:', error.message);
      return this._fallbackMessages(streakData, isAtMilestone);
    }
  }

  /**
   * Tạo thông điệp fallback
   * @private
   * @param {Object} streakData - Dữ liệu streak
   * @param {boolean} isAtMilestone - Có ở mốc không
   * @returns {Object} Thông điệp
   */
  _fallbackMessages(streakData, isAtMilestone) {
    const streak = streakData.current_streak || 0;

    const messages = {
      0: 'Hôm nay là ngày tuyệt vời để bắt đầu! Mỗi hành trình đều bắt đầu từ bước đầu tiên. 🌱',
      1: 'Bạn đã bắt đầu rồi! Hãy tiếp tục ngày mai nhé. 💪',
      7: 'Một tuần liên tục! Thói quen đang hình thành. 🔥',
      14: 'Hai tuần kiên trì! Bạn thật đáng ngưỡng mộ. ⚡',
      30: 'MỘT THÁNG! Thói quen học tập đã trở thành bản năng. 🏆',
      60: 'HAI THÁNG! Sự kiên trì của bạn thật phi thường. 💎',
      90: 'BA THÁNG! Bạn là huyền thoại của MedAdapt! 👑',
      180: 'NỬA NĂM! Không có gì cản được bạn. 🌟',
      365: 'MỘT NĂM TRỌN VẸN! Bạn là bậc thầy đích thực! 🎓'
    };

    let mainMessage = messages[0];
    if (streak > 0) {
      const matchedKey = Object.keys(messages)
        .map(Number)
        .filter(k => k <= streak)
        .sort((a, b) => b - a)[0];
      mainMessage = messages[matchedKey] || `${streak} ngày liên tiếp! Tiếp tục nào! 💪`;
    }

    return {
      main_message: mainMessage,
      encouragement: streak > 0
        ? `Mỗi ngày bạn đến gần hơn với mục tiêu. Đã ${streak} ngày, hãy giữ vững!`
        : 'Kiến thức y khoa là hành trang quý giá nhất. Hãy bắt đầu ngay hôm nay!',
      celebration: isAtMilestone ? `🎉🎊 CHÚC MỪNG MỐC ${streak} NGÀY! Thành tích xuất sắc! 🎊🎉` : null
    };
  }

  /**
   * Tạo tóm tắt thống kê
   * @private
   * @param {Object} streakData - Dữ liệu streak
   * @param {Object} progressTrend - Xu hướng
   * @returns {Object} Tóm tắt
   */
  _buildStatsSummary(streakData, progressTrend) {
    return {
      current_streak: streakData.current_streak || 0,
      longest_streak: streakData.longest_streak || 0,
      total_study_days: streakData.total_study_days || 0,
      total_questions: streakData.total_questions || 0,
      trend_direction: progressTrend.direction || 'stable',
      score_change: progressTrend.score_change || 0,
      total_badges: (streakData.earned_badges || []).length
    };
  }

  /**
   * Kết quả fallback khi Claude không khả dụng
   * @private
   * @param {Object} streakData - Dữ liệu streak
   * @param {Object} progressTrend - Xu hướng
   * @returns {Object} Kết quả động viên cơ bản
   */
  _fallbackMotivation(streakData, progressTrend) {
    const newBadges = this.getBadges(streakData);
    const nextMilestone = this._getNextMilestone(streakData.current_streak || 0);
    const isAtMilestone = MILESTONE_DAYS.includes(streakData.current_streak);
    const messages = this._fallbackMessages(streakData, isAtMilestone);

    return {
      message: messages.main_message,
      badges_earned: newBadges,
      next_milestone: nextMilestone,
      encouragement: messages.encouragement,
      celebration: messages.celebration,
      stats_summary: this._buildStatsSummary(streakData, progressTrend),
      metadata: {
        generated_at: new Date().toISOString(),
        is_milestone: isAtMilestone,
        new_badges_count: newBadges.length,
        is_fallback: true
      }
    };
  }

  /**
   * Truy cập danh sách huy hiệu
   * @static
   * @returns {Object[]} Mảng huy hiệu
   */
  static get BADGES() {
    return BADGES;
  }

  /**
   * Truy cập mốc ngày streak
   * @static
   * @returns {number[]} Mảng số ngày mốc
   */
  static get MILESTONE_DAYS() {
    return MILESTONE_DAYS;
  }
}

module.exports = StreakMotivator;
