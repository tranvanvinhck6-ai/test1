'use strict';

/**
 * @fileoverview GapDetector - Phát hiện lỗ hổng kiến thức
 * Phân tích dữ liệu tracker và lịch sử kiểm tra để xác định
 * các lỗ hổng kiến thức, phân loại mức độ ưu tiên và đề xuất hành động.
 */

/** Các chuyên khoa y khoa */
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
 * Bản đồ phụ thuộc giữa các chuyên khoa (USMLE Step 1 <-> Step 2 CK Integration)
 * Khi một môn lâm sàng yếu, hệ thống tìm ra môn cơ sở bị hổng để bổ trợ
 * @constant
 */
const DOMAIN_DEPENDENCIES = {
  internal: ['pharmacology', 'pathology', 'physiology', 'diagnostics'],
  surgery: ['pathology', 'internal', 'emergency', 'diagnostics'],
  obgyn: ['physiology', 'pathology', 'internal', 'pharmacology'],
  pediatrics: ['biochemistry', 'microbiology', 'pharmacology', 'internal'],
  emergency: ['physiology', 'pharmacology', 'internal', 'surgery'],
  psychiatry: ['pharmacology', 'physiology', 'internal'],
  pathology: ['biochemistry', 'physiology', 'microbiology'],
  pharmacology: ['biochemistry', 'physiology'],
  physiology: ['biochemistry'],
  microbiology: ['biochemistry', 'pharmacology'],
  biochemistry: [],
  community: ['internal'],
  diagnostics: ['pathology', 'physiology', 'internal']
};

/** Ngưỡng phân loại lỗ hổng */
const GAP_THRESHOLDS = {
  CRITICAL: 30,  // < 30%: Lỗ hổng nghiêm trọng
  MAJOR: 50,     // 30-50%: Lỗ hổng lớn
  MINOR: 70      // 50-70%: Lỗ hổng nhỏ
};

/**
 * Lớp phát hiện lỗ hổng kiến thức y khoa
 * @class GapDetector
 */
class GapDetector {
  /**
   * Phát hiện các lỗ hổng kiến thức từ dữ liệu tracker và lịch sử kiểm tra
   * @param {Object[]} trackerData - Dữ liệu tracker cho các chuyên khoa
   * @param {string} trackerData[].domain_id - ID chuyên khoa
   * @param {number} trackerData[].score - Điểm hiện tại (0-100)
   * @param {number} [trackerData[].total_questions] - Tổng số câu hỏi đã làm
   * @param {number} [trackerData[].correct_answers] - Số câu trả lời đúng
   * @param {string} [trackerData[].last_tested] - Ngày kiểm tra gần nhất
   * @param {Object[]} testHistory - Lịch sử bài kiểm tra
   * @param {string} testHistory[].domain_id - ID chuyên khoa
   * @param {number} testHistory[].score - Điểm (0-100)
   * @param {string} testHistory[].date - Ngày kiểm tra
   * @param {string} [testHistory[].subdomain] - Phân ngành
   * @returns {Object[]} Mảng lỗ hổng đã sắp xếp theo ưu tiên
   */
  detect(trackerData = [], testHistory = []) {
    try {
      const gaps = [];

      // Phân tích từng chuyên khoa
      for (const domain of DOMAINS) {
        const tracker = trackerData.find(t => t.domain_id === domain.id);
        const score = tracker ? tracker.score : 0;

        // Chỉ phát hiện lỗ hổng nếu điểm < 70% (ngưỡng MINOR)
        if (score >= GAP_THRESHOLDS.MINOR) continue;

        // Phân loại lỗ hổng
        const gapType = this._classifyGap(score);

        // Phân tích xu hướng từ lịch sử kiểm tra
        const domainHistory = testHistory
          .filter(t => t.domain_id === domain.id)
          .sort((a, b) => new Date(b.date) - new Date(a.date));
        const trend = this._analyzeTrend(domainHistory);

        // Tính mức ưu tiên
        const priority = this._calculatePriority(score, gapType, trend, domain.id);

        // Xác định hành động đề xuất
        const recommendedAction = this._getRecommendedAction(gapType, trend, domain);

        gaps.push({
          domain_id: domain.id,
          domain_name: domain.name,
          score: Math.round(score * 100) / 100,
          priority,
          gap_type: gapType,
          trend,
          recommended_action: recommendedAction,
          last_tested: tracker ? tracker.last_tested : null,
          subdomain_gaps: this._detectSubdomainGaps(domain, testHistory),
          affected_domains: this._getAffectedDomains(domain.id)
        });
      }

      // Phát hiện lỗ hổng liên chuyên khoa (cross-domain)
      this._detectCrossDomainGaps(gaps);

      // Sắp xếp theo mức ưu tiên (cao nhất trước)
      return gaps.sort((a, b) => b.priority - a.priority);
    } catch (error) {
      console.error('[GapDetector] Lỗi phát hiện lỗ hổng:', error.message);
      return [];
    }
  }

  /**
   * Phân loại lỗ hổng dựa trên điểm số
   * @private
   * @param {number} score - Điểm (0-100)
   * @returns {string} Loại lỗ hổng: critical/major/minor
   */
  _classifyGap(score) {
    if (score < GAP_THRESHOLDS.CRITICAL) return 'critical';
    if (score < GAP_THRESHOLDS.MAJOR) return 'major';
    return 'minor';
  }

  /**
   * Phân tích xu hướng từ lịch sử kiểm tra
   * So sánh 3 bài kiểm tra gần nhất
   * @private
   * @param {Object[]} history - Lịch sử kiểm tra (đã sắp xếp mới nhất trước)
   * @returns {string} Xu hướng: improving/declining/stable/insufficient_data
   */
  _analyzeTrend(history) {
    if (history.length < 3) return 'insufficient_data';

    const recent3 = history.slice(0, 3);
    const scores = recent3.map(h => h.score);

    // Tính sự thay đổi trung bình
    const changes = [];
    for (let i = 0; i < scores.length - 1; i++) {
      changes.push(scores[i] - scores[i + 1]); // Mới - Cũ
    }
    const avgChange = changes.reduce((s, c) => s + c, 0) / changes.length;

    if (avgChange > 5) return 'improving';     // Cải thiện > 5 điểm
    if (avgChange < -5) return 'declining';     // Giảm > 5 điểm
    return 'stable';                             // Ổn định
  }

  /**
   * Tính mức ưu tiên cho lỗ hổng
   * @private
   * @param {number} score - Điểm số
   * @param {string} gapType - Loại lỗ hổng
   * @param {string} trend - Xu hướng
   * @param {string} domainId - ID chuyên khoa
   * @returns {number} Mức ưu tiên (1-5)
   */
  _calculatePriority(score, gapType, trend, domainId) {
    let priority = 1;

    // Cơ sở: dựa trên loại lỗ hổng
    switch (gapType) {
      case 'critical': priority = 4; break;
      case 'major': priority = 3; break;
      case 'minor': priority = 2; break;
    }

    // Điều chỉnh theo xu hướng
    if (trend === 'declining') priority = Math.min(5, priority + 1);
    if (trend === 'improving') priority = Math.max(1, priority - 1);

    // Các chuyên khoa cấp cứu và lâm sàng luôn ưu tiên cao
    const criticalDomains = ['emergency', 'clinical_skills', 'internal'];
    if (criticalDomains.includes(domainId) && priority < 5) {
      priority = Math.min(5, priority + 1);
    }

    return priority;
  }

  /**
   * Xác định hành động đề xuất
   * @private
   * @param {string} gapType - Loại lỗ hổng
   * @param {string} trend - Xu hướng
   * @param {Object} domain - Thông tin chuyên khoa
   * @returns {string} Hành động đề xuất bằng tiếng Việt
   */
  _getRecommendedAction(gapType, trend, domain) {
    if (gapType === 'critical') {
      if (trend === 'declining') {
        return `⚠️ CẤP BÁCH: Ôn lại kiến thức nền tảng ${domain.name} ngay. Bắt đầu từ bài giảng cơ bản.`;
      }
      return `🔴 Cần ôn tập chuyên sâu ${domain.name}. Tập trung vào các khái niệm cốt lõi.`;
    }

    if (gapType === 'major') {
      if (trend === 'improving') {
        return `🟡 Tiếp tục ôn tập ${domain.name}. Xu hướng cải thiện tốt, cần duy trì.`;
      }
      return `🟡 Lên kế hoạch ôn tập ${domain.name}. Tập trung vào: ${domain.subdomains.slice(0, 2).join(', ')}.`;
    }

    // minor
    if (trend === 'declining') {
      return `🟠 Chú ý ${domain.name} đang giảm. Cần ôn lại để duy trì kiến thức.`;
    }
    return `🔵 Bổ sung kiến thức ${domain.name} qua bài tập thực hành.`;
  }

  /**
   * Phát hiện lỗ hổng trong các phân ngành
   * @private
   * @param {Object} domain - Thông tin chuyên khoa
   * @param {Object[]} testHistory - Lịch sử kiểm tra
   * @returns {Object[]} Lỗ hổng phân ngành
   */
  _detectSubdomainGaps(domain, testHistory) {
    const subdomainGaps = [];

    for (const sub of domain.subdomains) {
      const subHistory = testHistory.filter(
        t => t.domain_id === domain.id && t.subdomain === sub
      );

      if (subHistory.length === 0) {
        // Chưa có dữ liệu: cần kiểm tra
        subdomainGaps.push({
          subdomain: sub,
          status: 'untested',
          message: `Chưa có dữ liệu cho ${sub}`
        });
        continue;
      }

      const avgScore = subHistory.reduce((s, t) => s + t.score, 0) / subHistory.length;
      if (avgScore < GAP_THRESHOLDS.MINOR) {
        subdomainGaps.push({
          subdomain: sub,
          score: Math.round(avgScore * 100) / 100,
          status: avgScore < GAP_THRESHOLDS.CRITICAL ? 'critical' : avgScore < GAP_THRESHOLDS.MAJOR ? 'major' : 'minor'
        });
      }
    }

    return subdomainGaps;
  }

  /**
   * Lấy danh sách chuyên khoa bị ảnh hưởng bởi lỗ hổng
   * @private
   * @param {string} domainId - ID chuyên khoa có lỗ hổng
   * @returns {string[]} Danh sách chuyên khoa bị ảnh hưởng
   */
  _getAffectedDomains(domainId) {
    // Tìm các chuyên khoa phụ thuộc vào domainId
    const affected = [];
    for (const [dep, dependencies] of Object.entries(DOMAIN_DEPENDENCIES)) {
      if (dependencies.includes(domainId) && dep !== domainId) {
        const domainInfo = DOMAINS.find(d => d.id === dep);
        if (domainInfo) {
          affected.push(domainInfo.name);
        }
      }
    }
    return affected;
  }

  /**
   * Phát hiện lỗ hổng liên chuyên khoa
   * Nếu nhiều chuyên khoa liên quan cùng yếu, tăng mức ưu tiên
   * @private
   * @param {Object[]} gaps - Mảng lỗ hổng đã phát hiện (sẽ được mutate)
   */
  _detectCrossDomainGaps(gaps) {
    for (const gap of gaps) {
      const dependencies = DOMAIN_DEPENDENCIES[gap.domain_id] || [];
      const relatedGaps = gaps.filter(g =>
        dependencies.includes(g.domain_id) && g.gap_type !== 'minor'
      );

      // Nếu có nhiều lỗ hổng liên quan, tăng ưu tiên
      if (relatedGaps.length >= 2) {
        gap.priority = Math.min(5, gap.priority + 1);
        gap.cross_domain_warning = `⚠️ Lỗ hổng liên chuyên khoa: ${relatedGaps.map(g => g.domain_name).join(', ')} cũng cần cải thiện.`;
      }
    }
  }
}

module.exports = GapDetector;
