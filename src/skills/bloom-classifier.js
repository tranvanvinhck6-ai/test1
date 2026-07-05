'use strict';

/**
 * @fileoverview BloomClassifier - Phân loại theo thang Bloom
 * Phân loại câu hỏi y khoa theo các cấp độ tư duy Bloom
 * và tạo phân bổ mục tiêu phù hợp với trình độ người học.
 */

/**
 * Các cấp độ tư duy Bloom với mô tả tiếng Việt
 * @constant
 */
const BLOOM_LEVELS = {
  remember: {
    level: 1,
    name: 'Nhớ',
    nameEn: 'Remember',
    description: 'Nhận biết, nhắc lại kiến thức đã học',
    verbs: ['liệt kê', 'nhận biết', 'mô tả', 'định nghĩa', 'gọi tên'],
    example: 'Liệt kê các triệu chứng của viêm phổi'
  },
  understand: {
    level: 2,
    name: 'Hiểu',
    nameEn: 'Understand',
    description: 'Giải thích, tóm tắt, diễn giải kiến thức',
    verbs: ['giải thích', 'tóm tắt', 'phân biệt', 'so sánh', 'diễn giải'],
    example: 'Giải thích cơ chế bệnh sinh của đái tháo đường type 2'
  },
  apply: {
    level: 3,
    name: 'Áp dụng',
    nameEn: 'Apply',
    description: 'Sử dụng kiến thức vào tình huống cụ thể',
    verbs: ['áp dụng', 'tính toán', 'sử dụng', 'thực hiện', 'chọn'],
    example: 'Tính liều thuốc kháng sinh cho bệnh nhân suy thận'
  },
  analyze: {
    level: 4,
    name: 'Phân tích',
    nameEn: 'Analyze',
    description: 'Phân tích tình huống, tìm mối liên hệ',
    verbs: ['phân tích', 'so sánh', 'đối chiếu', 'phân biệt', 'đánh giá nguyên nhân'],
    example: 'Phân tích kết quả xét nghiệm để chẩn đoán phân biệt'
  },
  evaluate: {
    level: 5,
    name: 'Đánh giá',
    nameEn: 'Evaluate',
    description: 'Đánh giá, phê bình, quyết định dựa trên bằng chứng',
    verbs: ['đánh giá', 'phê bình', 'biện luận', 'quyết định', 'lựa chọn phương án tốt nhất'],
    example: 'Đánh giá phác đồ điều trị phù hợp nhất cho bệnh nhân'
  },
  create: {
    level: 6,
    name: 'Sáng tạo',
    nameEn: 'Create',
    description: 'Tổng hợp, lập kế hoạch, thiết kế giải pháp mới',
    verbs: ['thiết kế', 'lập kế hoạch', 'đề xuất', 'tổng hợp', 'xây dựng'],
    example: 'Thiết kế kế hoạch chăm sóc toàn diện cho bệnh nhân đa bệnh lý'
  }
};

/**
 * Phân bổ Bloom mục tiêu theo trình độ người học
 * Tỷ lệ phần trăm cho mỗi cấp độ
 * @constant
 */
const TARGET_DISTRIBUTIONS = {
  beginner: {
    remember: 0.35,
    understand: 0.30,
    apply: 0.20,
    analyze: 0.10,
    evaluate: 0.05,
    create: 0.00
  },
  intermediate: {
    remember: 0.10,
    understand: 0.20,
    apply: 0.30,
    analyze: 0.25,
    evaluate: 0.10,
    create: 0.05
  },
  advanced: {
    remember: 0.05,
    understand: 0.10,
    apply: 0.20,
    analyze: 0.30,
    evaluate: 0.25,
    create: 0.10
  }
};

/**
 * Lớp phân loại câu hỏi theo thang tư duy Bloom
 * @class BloomClassifier
 */
class BloomClassifier {
  /**
   * Khởi tạo BloomClassifier
   * @param {import('@anthropic-ai/sdk').default} claudeClient - Anthropic client instance
   * @param {string} model - Tên model Claude
   */
  constructor(claudeClient, model) {
    this.client = claudeClient;
    this.model = model || 'claude-sonnet-4-20250514';
  }

  /**
   * Phân loại câu hỏi vào cấp độ Bloom
   * @param {string} questionText - Nội dung câu hỏi cần phân loại
   * @returns {Promise<Object>} Kết quả phân loại
   * @returns {string} return.level - Cấp độ Bloom (remember/understand/apply/analyze/evaluate/create)
   * @returns {string} return.level_name - Tên tiếng Việt
   * @returns {number} return.level_number - Số thứ tự (1-6)
   * @returns {string} return.justification - Giải thích lý do phân loại
   * @returns {number} return.confidence - Độ tin cậy (0-1)
   */
  async classify(questionText) {
    try {
      const levelsDescription = Object.entries(BLOOM_LEVELS)
        .map(([key, val]) => `- ${key} (${val.name}): ${val.description}. Các động từ: ${val.verbs.join(', ')}`)
        .join('\n');

      const response = await this.client.messages.create({
        model: 'fast',
        max_tokens: 1024,
        system: `Bạn là chuyên gia giáo dục y khoa. Phân loại câu hỏi theo thang tư duy Bloom.

Các cấp độ Bloom:
${levelsDescription}

Trả lời bằng JSON:
{
  "level": "remember|understand|apply|analyze|evaluate|create",
  "level_name": "Tên tiếng Việt",
  "level_number": 1-6,
  "justification": "Giải thích ngắn gọn",
  "confidence": 0.0-1.0
}`,
        messages: [
          {
            role: 'user',
            content: `Phân loại câu hỏi sau theo thang Bloom:\n\n"${questionText}"`
          }
        ]
      });

      const text = response.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        // Fallback: phân loại heuristic dựa trên từ khóa
        return this._heuristicClassify(questionText);
      }

      const result = JSON.parse(jsonMatch[0]);

      // Validate kết quả
      if (!BLOOM_LEVELS[result.level]) {
        return this._heuristicClassify(questionText);
      }

      return result;
    } catch (error) {
      console.error('[BloomClassifier] Lỗi phân loại:', error.message);
      // Fallback: sử dụng phân loại heuristic
      return this._heuristicClassify(questionText);
    }
  }

  /**
   * Lấy phân bổ Bloom mục tiêu cho trình độ người học
   * @param {string} userLevel - Trình độ: 'beginner', 'intermediate', 'advanced'
   * @returns {Object} Phân bổ mục tiêu cho mỗi cấp độ Bloom
   */
  getTargetDistribution(userLevel) {
    const level = userLevel && TARGET_DISTRIBUTIONS[userLevel]
      ? userLevel
      : 'intermediate';

    return {
      distribution: TARGET_DISTRIBUTIONS[level],
      level: level,
      description: this._getDistributionDescription(level)
    };
  }

  /**
   * Phân loại heuristic dựa trên từ khóa (fallback khi Claude không khả dụng)
   * @private
   * @param {string} text - Nội dung câu hỏi
   * @returns {Object} Kết quả phân loại
   */
  _heuristicClassify(text) {
    const lower = text.toLowerCase();

    // Kiểm tra từ khóa theo thứ tự ưu tiên (từ cao đến thấp)
    const patterns = [
      { level: 'create', keywords: ['thiết kế', 'lập kế hoạch', 'đề xuất phương án', 'xây dựng', 'tạo ra'] },
      { level: 'evaluate', keywords: ['đánh giá', 'phê bình', 'biện luận', 'phương án tốt nhất', 'lựa chọn tối ưu', 'quyết định'] },
      { level: 'analyze', keywords: ['phân tích', 'chẩn đoán phân biệt', 'nguyên nhân', 'mối liên hệ', 'so sánh và đối chiếu'] },
      { level: 'apply', keywords: ['tính toán', 'áp dụng', 'sử dụng', 'xử trí', 'kê đơn', 'liều lượng', 'chỉ định'] },
      { level: 'understand', keywords: ['giải thích', 'tóm tắt', 'cơ chế', 'phân biệt', 'mô tả cơ chế', 'tại sao'] },
      { level: 'remember', keywords: ['liệt kê', 'kể tên', 'định nghĩa', 'nêu', 'là gì', 'bao gồm'] }
    ];

    for (const pattern of patterns) {
      if (pattern.keywords.some(kw => lower.includes(kw))) {
        const bloom = BLOOM_LEVELS[pattern.level];
        return {
          level: pattern.level,
          level_name: bloom.name,
          level_number: bloom.level,
          justification: `Phân loại heuristic dựa trên từ khóa`,
          confidence: 0.6
        };
      }
    }

    // Mặc định: understand
    return {
      level: 'understand',
      level_name: 'Hiểu',
      level_number: 2,
      justification: 'Phân loại mặc định - không tìm thấy từ khóa đặc trưng',
      confidence: 0.3
    };
  }

  /**
   * Mô tả phân bổ Bloom mục tiêu
   * @private
   * @param {string} level - Trình độ
   * @returns {string} Mô tả
   */
  _getDistributionDescription(level) {
    const descriptions = {
      beginner: 'Tập trung vào Nhớ và Hiểu, từng bước xây dựng nền tảng kiến thức',
      intermediate: 'Cân bằng giữa Áp dụng và Phân tích, phát triển tư duy lâm sàng',
      advanced: 'Nhấn mạnh Phân tích và Đánh giá, hướng đến ra quyết định lâm sàng'
    };
    return descriptions[level];
  }

  /**
   * Truy cập hằng số BLOOM_LEVELS
   * @static
   * @returns {Object} Các cấp độ Bloom
   */
  static get BLOOM_LEVELS() {
    return BLOOM_LEVELS;
  }
}

module.exports = BloomClassifier;
