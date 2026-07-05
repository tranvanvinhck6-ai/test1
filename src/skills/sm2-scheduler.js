'use strict';

/**
 * @fileoverview SM2Scheduler - Lập lịch ôn tập theo thuật toán SM-2
 * Triển khai thuật toán SuperMemo 2 (SM-2) được tùy chỉnh cho y khoa,
 * với khoảng cách ngắn hơn cho các chuyên khoa quan trọng.
 */

/**
 * Các chuyên khoa quan trọng cần ôn tập thường xuyên hơn
 * (Các chuyên khoa liên quan đến cấp cứu và lâm sàng)
 * @constant
 */
const CRITICAL_DOMAINS = ['emergency', 'internal', 'clinical_skills', 'pharmacology'];

/**
 * Hệ số rút ngắn khoảng cách cho chuyên khoa quan trọng
 * @constant
 */
const CRITICAL_INTERVAL_FACTOR = 0.7;

/**
 * Lớp lập lịch ôn tập sử dụng thuật toán SM-2 tùy chỉnh
 * @class SM2Scheduler
 */
class SM2Scheduler {
  /**
   * Tính toán lịch ôn tập tiếp theo sử dụng thuật toán SM-2
   *
   * Thuật toán SM-2:
   * - EF (Easiness Factor) >= 1.3
   * - EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
   * - Nếu q < 3: repetition = 0, interval = 1
   * - Interval: 1 -> 6 -> interval * EF
   *
   * Tùy chỉnh cho y khoa:
   * - Chuyên khoa critical: interval * 0.7
   * - Điểm chất lượng thấp liên tục: giảm EF nhanh hơn
   *
   * @param {Object} domainTracker - Dữ liệu tracker của chuyên khoa
   * @param {string} domainTracker.domain_id - ID chuyên khoa
   * @param {number} [domainTracker.easiness_factor] - Hệ số dễ hiện tại (mặc định 2.5)
   * @param {number} [domainTracker.repetition] - Số lần lặp lại (mặc định 0)
   * @param {number} [domainTracker.interval] - Khoảng cách hiện tại (ngày, mặc định 0)
   * @param {string} [domainTracker.last_review] - Ngày ôn tập gần nhất
   * @param {number} quality - Chất lượng trả lời (0-5)
   *   0 = Hoàn toàn không nhớ
   *   1 = Sai hoàn toàn nhưng nhận ra đáp án đúng
   *   2 = Sai nhưng đáp án đúng có vẻ quen thuộc
   *   3 = Trả lời đúng nhưng rất khó khăn
   *   4 = Trả lời đúng sau khi do dự
   *   5 = Trả lời đúng hoàn hảo
   * @returns {Object} Lịch ôn tập mới
   * @returns {string} return.next_review_date - Ngày ôn tập tiếp theo (ISO string)
   * @returns {number} return.interval - Khoảng cách (ngày)
   * @returns {number} return.easiness_factor - Hệ số dễ mới
   * @returns {number} return.repetition - Số lần lặp lại mới
   */
  schedule(domainTracker, quality) {
    try {
      // Validate và chuẩn hóa input
      const q = Math.max(0, Math.min(5, Math.round(quality)));
      let ef = domainTracker.easiness_factor || 2.5;
      let rep = domainTracker.repetition || 0;
      let interval = domainTracker.interval || 0;
      const domainId = domainTracker.domain_id || '';

      // Áp dụng thuật toán SM-2
      if (q < 3) {
        // Chất lượng kém: reset lại từ đầu
        rep = 0;
        interval = 1;
      } else {
        // Chất lượng đạt: tăng khoảng cách
        if (rep === 0) {
          interval = 1;
        } else if (rep === 1) {
          interval = 6;
        } else {
          interval = Math.round(interval * ef);
        }
        rep += 1;
      }

      // Tính hệ số dễ mới (EF)
      // EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
      ef = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));

      // EF không được nhỏ hơn 1.3
      ef = Math.max(1.3, ef);

      // Tùy chỉnh y khoa: chuyên khoa quan trọng có khoảng cách ngắn hơn
      if (CRITICAL_DOMAINS.includes(domainId)) {
        interval = Math.max(1, Math.round(interval * CRITICAL_INTERVAL_FACTOR));
      }

      // Giới hạn interval tối đa 180 ngày (y khoa cần ôn tập thường xuyên)
      interval = Math.min(180, interval);

      // Tính ngày ôn tập tiếp theo
      const now = new Date();
      const nextReview = new Date(now);
      nextReview.setDate(nextReview.getDate() + interval);

      return {
        next_review_date: nextReview.toISOString(),
        interval,
        easiness_factor: Math.round(ef * 100) / 100,
        repetition: rep
      };
    } catch (error) {
      console.error('[SM2Scheduler] Lỗi lập lịch:', error.message);
      // Fallback: ôn tập ngày mai
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return {
        next_review_date: tomorrow.toISOString(),
        interval: 1,
        easiness_factor: domainTracker.easiness_factor || 2.5,
        repetition: domainTracker.repetition || 0
      };
    }
  }

  /**
   * Lấy hàng đợi ôn tập ưu tiên cho ngày hôm nay
   * @param {Object[]} allTrackers - Tất cả domain tracker
   * @param {string} allTrackers[].domain_id - ID chuyên khoa
   * @param {string} allTrackers[].domain_name - Tên chuyên khoa
   * @param {string} [allTrackers[].next_review_date] - Ngày ôn tập tiếp theo
   * @param {number} [allTrackers[].easiness_factor] - Hệ số dễ
   * @param {number} [allTrackers[].score] - Điểm hiện tại
   * @param {number} [allTrackers[].interval] - Khoảng cách hiện tại
   * @returns {Object[]} Hàng đợi ôn tập đã sắp xếp theo ưu tiên
   */
  getReviewQueue(allTrackers = []) {
    try {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      const queue = [];

      for (const tracker of allTrackers) {
        const reviewDate = tracker.next_review_date
          ? new Date(tracker.next_review_date)
          : new Date(0); // Chưa có lịch ôn -> ưu tiên cao

        const reviewDay = new Date(reviewDate.getFullYear(), reviewDate.getMonth(), reviewDate.getDate());

        // Chỉ lấy các chuyên khoa đến hạn ôn tập (hoặc quá hạn)
        if (reviewDay <= today) {
          // Tính số ngày quá hạn
          const overdueDays = Math.floor((today - reviewDay) / (1000 * 60 * 60 * 24));

          // Tính điểm ưu tiên
          const priorityScore = this._calculateReviewPriority(tracker, overdueDays);

          queue.push({
            domain_id: tracker.domain_id,
            domain_name: tracker.domain_name || tracker.domain_id,
            overdue_days: overdueDays,
            priority_score: priorityScore,
            current_score: tracker.score || 0,
            easiness_factor: tracker.easiness_factor || 2.5,
            is_critical: CRITICAL_DOMAINS.includes(tracker.domain_id),
            review_urgency: this._getUrgencyLabel(overdueDays),
            suggested_time_minutes: this._suggestStudyTime(tracker)
          });
        }
      }

      // Sắp xếp theo điểm ưu tiên (cao nhất trước)
      return queue.sort((a, b) => b.priority_score - a.priority_score);
    } catch (error) {
      console.error('[SM2Scheduler] Lỗi tạo hàng đợi ôn tập:', error.message);
      return [];
    }
  }

  /**
   * Tính điểm ưu tiên ôn tập
   * @private
   * @param {Object} tracker - Domain tracker
   * @param {number} overdueDays - Số ngày quá hạn
   * @returns {number} Điểm ưu tiên
   */
  _calculateReviewPriority(tracker, overdueDays) {
    let score = 0;

    // Quá hạn càng lâu, ưu tiên càng cao
    score += Math.min(overdueDays * 2, 20);

    // Chuyên khoa quan trọng: +10 điểm
    if (CRITICAL_DOMAINS.includes(tracker.domain_id)) {
      score += 10;
    }

    // Điểm thấp: ưu tiên cao hơn
    const currentScore = tracker.score || 0;
    if (currentScore < 30) score += 15;
    else if (currentScore < 50) score += 10;
    else if (currentScore < 70) score += 5;

    // Hệ số dễ thấp (khó nhớ): ưu tiên cao
    const ef = tracker.easiness_factor || 2.5;
    if (ef < 1.8) score += 8;
    else if (ef < 2.2) score += 4;

    return score;
  }

  /**
   * Lấy nhãn mức độ khẩn cấp
   * @private
   * @param {number} overdueDays - Số ngày quá hạn
   * @returns {string} Nhãn khẩn cấp bằng tiếng Việt
   */
  _getUrgencyLabel(overdueDays) {
    if (overdueDays > 14) return '🔴 Rất khẩn cấp';
    if (overdueDays > 7) return '🟠 Khẩn cấp';
    if (overdueDays > 3) return '🟡 Cần ôn sớm';
    if (overdueDays > 0) return '🔵 Đến hạn';
    return '🟢 Hôm nay';
  }

  /**
   * Đề xuất thời gian ôn tập (phút)
   * @private
   * @param {Object} tracker - Domain tracker
   * @returns {number} Thời gian đề xuất (phút)
   */
  _suggestStudyTime(tracker) {
    const score = tracker.score || 0;
    if (score < 30) return 45;    // Cần ôn kỹ
    if (score < 50) return 30;    // Ôn trung bình
    if (score < 70) return 20;    // Ôn nhẹ
    return 15;                     // Ôn nhanh (củng cố)
  }

  /**
   * Truy cập danh sách chuyên khoa quan trọng
   * @static
   * @returns {string[]} Mảng domain ID
   */
  static get CRITICAL_DOMAINS() {
    return CRITICAL_DOMAINS;
  }
}

module.exports = SM2Scheduler;
