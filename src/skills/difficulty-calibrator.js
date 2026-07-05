'use strict';

/**
 * @fileoverview DifficultyCalibrator - Hiệu chỉnh độ khó thích ứng
 * Điều chỉnh mức độ khó của câu hỏi dựa trên hồ sơ người dùng
 * và lịch sử hiệu suất học tập.
 */

/** Nhãn mức độ khó bằng tiếng Việt */
const DIFFICULTY_LABELS = {
  1: 'Cơ bản',
  2: 'Trung bình',
  3: 'Nâng cao',
  4: 'Khó',
  5: 'Chuyên sâu'
};

/** Ngưỡng điểm để tăng/giảm độ khó */
const THRESHOLDS = {
  INCREASE: 0.80,    // Tăng độ khó nếu điểm >= 80%
  DECREASE: 0.40,    // Giảm độ khó nếu điểm < 40%
  STABLE_LOW: 0.50,  // Giữ nguyên nếu điểm 40-50%
  STABLE_HIGH: 0.79  // Giữ nguyên nếu điểm 50-79%
};

/**
 * Lớp hiệu chỉnh độ khó thích ứng cho hệ thống học tập
 * @class DifficultyCalibrator
 */
class DifficultyCalibrator {
  /**
   * Hiệu chỉnh mức độ khó dựa trên hồ sơ người dùng và lịch sử hiệu suất
   * @param {Object} userProfile - Hồ sơ người dùng
   * @param {string} userProfile.level - Trình độ hiện tại (beginner/intermediate/advanced)
   * @param {number} [userProfile.current_difficulty] - Mức độ khó hiện tại (1-5)
   * @param {string} [userProfile.study_year] - Năm học (Y1-Y6)
   * @param {Object[]} performanceHistory - Lịch sử hiệu suất
   * @param {number} performanceHistory[].score - Điểm số (0-1)
   * @param {number} performanceHistory[].difficulty - Mức độ khó
   * @param {string} performanceHistory[].date - Ngày làm bài
   * @param {string} [performanceHistory[].domain_id] - Chuyên khoa
   * @returns {number} Mức độ khó được đề xuất (1-5)
   */
  calibrate(userProfile, performanceHistory = []) {
    try {
      // Chuẩn hóa performanceHistory thành Array
      let historyArray = [];
      if (Array.isArray(performanceHistory)) {
        historyArray = performanceHistory;
      } else if (performanceHistory && typeof performanceHistory === 'object') {
        if (Array.isArray(performanceHistory.history)) {
          historyArray = performanceHistory.history;
        } else if (Array.isArray(performanceHistory.tracker)) {
          historyArray = performanceHistory.tracker.map(t => ({
            score: (t.score !== undefined && t.score !== null ? t.score : (t.mastery_level === 'mastered' ? 85 : 50)) / 100,
            date: t.last_tested || new Date().toISOString()
          }));
        }
      }

      // Nếu chưa có lịch sử, dựa vào trình độ người dùng
      if (!historyArray || historyArray.length === 0) {
        const initialDiff = this._getInitialDifficulty(userProfile || {});
        const res = new Number(initialDiff);
        res.difficulty = initialDiff;
        res.label = this.getDifficultyLabel(initialDiff);
        res.confidence = 0.5;
        return res;
      }

      const currentDifficulty = userProfile?.current_difficulty || this._getInitialDifficulty(userProfile || {});

      // Lấy 5 bài kiểm tra gần nhất để phân tích
      const recentTests = historyArray
        .sort((a, b) => new Date(b.date || Date.now()) - new Date(a.date || Date.now()))
        .slice(0, 5);

      // Tính điểm trung bình gần đây
      const avgScore = recentTests.reduce((sum, t) => sum + (t.score || 0), 0) / (recentTests.length || 1);

      // Phân tích xu hướng (trend) - so sánh nửa đầu vs nửa sau
      const trend = this._analyzeTrend(recentTests);

      // Tính toán mức độ khó mới
      let newDifficulty = currentDifficulty;

      if (avgScore >= THRESHOLDS.INCREASE) {
        newDifficulty = Math.min(5, currentDifficulty + 1);
        if (trend > 0.15 && avgScore >= 0.90) {
          newDifficulty = Math.min(5, newDifficulty + 1);
        }
      } else if (avgScore < THRESHOLDS.DECREASE) {
        newDifficulty = Math.max(1, currentDifficulty - 1);
        if (trend < -0.15 && avgScore < 0.25) {
          newDifficulty = Math.max(1, newDifficulty - 1);
        }
      }

      const variance = this._calculateVariance(recentTests.map(t => t.score || 0));
      if (variance > 0.1 && newDifficulty > 1) {
        newDifficulty = Math.max(1, newDifficulty - 1);
      }

      const finalDiff = Math.round(newDifficulty);
      const res = new Number(finalDiff);
      res.difficulty = finalDiff;
      res.label = this.getDifficultyLabel(finalDiff);
      res.confidence = 0.85;
      return res;
    } catch (error) {
      console.error('[DifficultyCalibrator] Lỗi hiệu chỉnh:', error.message);
      const defaultDiff = userProfile?.current_difficulty || 2;
      const res = new Number(defaultDiff);
      res.difficulty = defaultDiff;
      res.label = 'Mặc định';
      return res;
    }
  }

  /**
   * Điều chỉnh độ khó ngay sau bài kiểm tra
   * @param {number} currentDifficulty - Mức độ khó hiện tại (1-5)
   * @param {number} testScore - Điểm bài kiểm tra (0-1 hoặc 0-100)
   * @returns {number} Mức độ khó mới (1-5)
   */
  adjustAfterTest(currentDifficulty, testScore) {
    try {
      // Chuẩn hóa điểm về thang 0-1
      const score = testScore > 1 ? testScore / 100 : testScore;
      const difficulty = Math.max(1, Math.min(5, currentDifficulty));

      if (score >= 0.90) {
        // Xuất sắc: tăng 1 cấp
        return Math.min(5, difficulty + 1);
      } else if (score >= THRESHOLDS.INCREASE) {
        // Tốt: tăng 1 cấp (nếu chưa ở mức cao nhất)
        return Math.min(5, difficulty + 1);
      } else if (score >= THRESHOLDS.STABLE_LOW) {
        // Trung bình: giữ nguyên
        return difficulty;
      } else if (score >= 0.25) {
        // Yếu: giảm 1 cấp
        return Math.max(1, difficulty - 1);
      } else {
        // Rất yếu: giảm 2 cấp
        return Math.max(1, difficulty - 2);
      }
    } catch (error) {
      console.error('[DifficultyCalibrator] Lỗi điều chỉnh sau test:', error.message);
      return currentDifficulty;
    }
  }

  /**
   * Lấy nhãn mức độ khó bằng tiếng Việt
   * @param {number} level - Mức độ khó (1-5)
   * @returns {string} Nhãn tiếng Việt
   */
  getDifficultyLabel(level) {
    const safeLevel = Math.max(1, Math.min(5, Math.round(level)));
    return DIFFICULTY_LABELS[safeLevel] || 'Không xác định';
  }

  /**
   * Xác định mức độ khó ban đầu dựa trên hồ sơ người dùng
   * @private
   * @param {Object} userProfile - Hồ sơ người dùng
   * @returns {number} Mức độ khó ban đầu (1-5)
   */
  _getInitialDifficulty(userProfile) {
    // Dựa vào năm học nếu có
    if (userProfile.study_year) {
      const yearMap = { 'Y1': 1, 'Y2': 1, 'Y3': 2, 'Y4': 3, 'Y5': 4, 'Y6': 4 };
      return yearMap[userProfile.study_year] || 2;
    }

    // Dựa vào trình độ
    const levelMap = { 'beginner': 1, 'intermediate': 3, 'advanced': 4 };
    return levelMap[userProfile.level] || 2;
  }

  /**
   * Phân tích xu hướng điểm số
   * @private
   * @param {Object[]} tests - Danh sách bài kiểm tra (đã sắp xếp theo thời gian mới nhất)
   * @returns {number} Xu hướng: dương = tăng, âm = giảm
   */
  _analyzeTrend(tests) {
    if (tests.length < 2) return 0;
    const half = Math.ceil(tests.length / 2);
    // Nửa đầu là mới nhất (do đã sort desc)
    const recentHalf = tests.slice(0, half);
    const olderHalf = tests.slice(half);

    const recentAvg = recentHalf.reduce((s, t) => s + t.score, 0) / recentHalf.length;
    const olderAvg = olderHalf.reduce((s, t) => s + t.score, 0) / olderHalf.length;

    return recentAvg - olderAvg;
  }

  /**
   * Tính phương sai của mảng điểm số
   * @private
   * @param {number[]} scores - Mảng điểm
   * @returns {number} Phương sai
   */
  _calculateVariance(scores) {
    if (scores.length < 2) return 0;
    const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
    const squaredDiffs = scores.map(s => Math.pow(s - mean, 2));
    return squaredDiffs.reduce((s, v) => s + v, 0) / scores.length;
  }
}

module.exports = DifficultyCalibrator;
