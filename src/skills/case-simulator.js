'use strict';

/**
 * @fileoverview CaseSimulator - Mô phỏng ca lâm sàng
 * Sử dụng Claude để tạo ca lâm sàng tương tác với hai phong cách:
 * guided (từng bước) và open (tự do), hỗ trợ nhánh rẽ tương tác.
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

/** Nhãn độ khó */
const DIFFICULTY_LABELS = {
  1: 'Cơ bản', 2: 'Trung bình', 3: 'Nâng cao', 4: 'Khó', 5: 'Chuyên sâu'
};

/**
 * Lớp mô phỏng ca lâm sàng tương tác
 * @class CaseSimulator
 */
class CaseSimulator {
  /**
   * Khởi tạo CaseSimulator
   * @param {import('@anthropic-ai/sdk').default} claudeClient - Anthropic client instance
   * @param {string} model - Tên model Claude
   */
  constructor(claudeClient, model) {
    this.client = claudeClient;
    this.model = model || 'claude-sonnet-4-20250514';
  }

  /**
   * Tạo ca lâm sàng mô phỏng
   * @param {Object} params - Tham số tạo ca lâm sàng
   * @param {string} params.domain - ID chuyên khoa
   * @param {number} [params.difficulty=2] - Mức độ khó (1-5)
   * @param {string[]} [params.objectives] - Mục tiêu học tập
   * @param {string} [params.style='guided'] - Phong cách: 'guided' (từng bước) hoặc 'open' (tự do)
   * @param {string} [params.subdomain] - Phân ngành cụ thể
   * @param {string} [params.scenario] - Tình huống cụ thể (tùy chọn)
   * @returns {Promise<Object>} Ca lâm sàng mô phỏng
   * @returns {Object} return.patient_info - Thông tin bệnh nhân
   * @returns {string} return.chief_complaint - Lý do khám
   * @returns {Object[]} return.history_steps - Các bước khai thác bệnh sử
   * @returns {Object} return.examination_findings - Kết quả khám lâm sàng
   * @returns {Object[]} return.investigations - Cận lâm sàng
   * @returns {Object} return.diagnosis - Chẩn đoán
   * @returns {Object} return.treatment_plan - Phác đồ điều trị
   * @returns {string[]} return.teaching_points - Điểm giảng dạy
   */
  async simulate(params) {
    const {
      domain,
      difficulty = 2,
      objectives = [],
      style = 'guided',
      subdomain,
      scenario
    } = params;

    try {
      const domainInfo = DOMAINS.find(d => d.id === domain);
      const domainName = domainInfo ? domainInfo.name : domain;

      const styleGuide = style === 'guided'
        ? `PHONG CÁCH GUIDED (Từng bước):
- Chia ca lâm sàng thành các bước tuần tự
- Mỗi bước có câu hỏi hướng dẫn và gợi ý
- Cung cấp phản hồi cho mỗi bước
- Các nhánh rẽ (branching) cho các quyết định quan trọng`
        : `PHONG CÁCH OPEN (Tự do):
- Trình bày tình huống đầy đủ
- Người học tự quyết định các bước tiếp theo
- Cung cấp tất cả thông tin cần thiết
- Cho phép đưa ra chẩn đoán và điều trị tự do`;

      const systemPrompt = `Bạn là Giáo sư Lâm sàng và Chuyên gia ra đề thi USMLE tại bệnh viện giảng dạy Mỹ (Attending Physician & USMLE Faculty).
Nhiệm vụ: Tạo ca bệnh mô phỏng lâm sàng sâu sắc, thử thách tư duy sắc bén theo chuẩn USMLE Step 1 & Step 2 CK.

THÔNG TIN:
- Chuyên khoa: ${domainName}${subdomain ? ` > ${subdomain}` : ''}
- Mức độ: ${DIFFICULTY_LABELS[difficulty] || 'Trung bình'} (${difficulty}/5)
${objectives.length > 0 ? `- Mục tiêu: ${objectives.join('; ')}` : ''}
${scenario ? `- Tình huống yêu cầu: ${scenario}` : ''}

${styleGuide}

YÊU CẦU ĐẶC BIỆT (USMLE STANDARDS):
1. Tình huống lâm sàng phải phong phú: Tiền sử mạn tính, các yếu tố nguy cơ, thuốc đang dùng (tên gốc Generic).
2. Tích hợp tư duy chẩn đoán phân biệt theo khung VINDICATE.
3. Phân biệt rõ giữa Xét nghiệm làm BAN ĐẦU (Most appropriate initial test) và Xét nghiệm CHẮC CHẮN nhất (Definitive / Gold standard test).
4. Lợi ích điều trị phải bám sát hướng dẫn của các Hiệp hội Mỹ (AHA, ACC, GOLD, IDSA, ADA...) và giải thích rõ cơ chế dược lý Step 1.
5. Ngôn ngữ tiếng Việt lâm sàng chuẩn xác, giữ nguyên thuật ngữ y khoa tiếng Anh chuẩn Quốc tế.

Trả lời bằng JSON chuẩn:
{
  "patient_info": {
    "name": "Tên (giả)",
    "age": 45,
    "gender": "Nam/Nữ",
    "occupation": "Nghề nghiệp",
    "address": "Địa chỉ tổng quát",
    "admission_date": "Ngày nhập viện"
  },
  "chief_complaint": "Lý do đến khám (Chief Complaint)",
  "history_steps": [
    {
      "step": 1,
      "title": "Bệnh sử & Tiền sử (HPI & PMH)",
      "content": "Mô tả chi tiết diễn tiến, tiền sử gia đình, thói quen và thuốc đang dùng",
      "key_info": ["Thông tin quan trọng"],
      "guiding_question": "Câu hỏi hướng dẫn tư duy Socratic",
      "expected_answer": "Đáp án mong đợi",
      "branching_options": [
        {
          "choice": "Lựa chọn xử trí 1",
          "consequence": "Hệ quả lâm sàng",
          "is_optimal": true
        }
      ]
    }
  ],
  "examination_findings": {
    "vital_signs": {
      "blood_pressure": "130/80 mmHg",
      "heart_rate": "88 lần/phút",
      "temperature": "37.0 °C",
      "respiratory_rate": "18 lần/phút",
      "spo2": "98% (khí trời)"
    },
    "general": "Toàn trạng",
    "systems": {
      "cardiovascular": "Tim mạch",
      "respiratory": "Hô hấp",
      "gastrointestinal": "Tiêu hóa",
      "neurological": "Thần kinh",
      "other": "Khác"
    }
  },
  "vindicate_differential": [
    {
      "diagnosis": "Chẩn đoán phân biệt 1",
      "category": "Vascular/Infection/...",
      "rule_in_signs": ["Triệu chứng ủng hộ"],
      "rule_out_signs": ["Triệu chứng loại trừ"]
    }
  ],
  "investigations": [
    {
      "test": "Tên xét nghiệm / CĐHA",
      "test_type": "initial|definitive|routine",
      "result": "Kết quả chi tiết kèm chỉ số bình thường",
      "interpretation": "Nhận định ý nghĩa lâm sàng",
      "is_critical": false
    }
  ],
  "diagnosis": {
    "primary": "Chẩn đoán xác định",
    "differential": ["Chẩn đoán phân biệt chính"],
    "reasoning": "Lý luận chẩn đoán kết nối lâm sàng và cận lâm sàng"
  },
  "treatment_plan": {
    "immediate": ["Xử trí cấp cứu ngay (Step 2 CK Priority)"],
    "medications": [
      {
        "drug": "Tên thuốc (Generic)",
        "dose": "Liều lượng",
        "route": "Đường dùng",
        "duration": "Thời gian",
        "rationale": "Lý do chỉ định theo guideline",
        "step1_mechanism": "Cơ chế tác dụng dược lý / sinh lý bệnh (Step 1 Integration)"
      }
    ],
    "monitoring": ["Theo dõi chỉ số gì"],
    "follow_up": "Kế hoạch tái khám"
  },
  "teaching_points": ["📌 Điểm giảng dạy lâm sàng 1", "📌 Điểm giảng dạy 2"],
  "clinical_pearl": "💎 Ngọc lâm sàng USMLE cốt lõi 1 câu",
  "usmle_pitfall": "⚠️ Sai lầm lâm sàng cần tránh (Patient Safety Trap)",
  "complexity_notes": "Ghi chú về độ phức tạp ca bệnh"
}`;

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 8192,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Tạo ca lâm sàng mô phỏng cho chuyên khoa ${domainName}${subdomain ? ` - ${subdomain}` : ''}.${scenario ? ` Tình huống: ${scenario}` : ''}`
          }
        ]
      });

      const text = response.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        console.error('[CaseSimulator] Không thể trích xuất JSON');
        throw new Error('Không thể tạo ca lâm sàng từ phản hồi AI');
      }

      const clinicalCase = JSON.parse(jsonMatch[0]);

      // Bổ sung metadata
      return {
        ...clinicalCase,
        metadata: {
          domain_id: domain,
          domain_name: domainName,
          subdomain: subdomain || null,
          difficulty,
          style,
          objectives,
          created_at: new Date().toISOString(),
          total_steps: (clinicalCase.history_steps || []).length,
          has_branching: this._hasBranching(clinicalCase)
        }
      };
    } catch (error) {
      console.error('[CaseSimulator] Lỗi mô phỏng ca lâm sàng:', error.message);
      throw new Error(`Không thể tạo ca lâm sàng: ${error.message}`);
    }
  }

  /**
   * Kiểm tra ca lâm sàng có nhánh rẽ tương tác không
   * @private
   * @param {Object} clinicalCase - Ca lâm sàng
   * @returns {boolean} Có nhánh rẽ hay không
   */
  _hasBranching(clinicalCase) {
    if (!clinicalCase.history_steps) return false;
    return clinicalCase.history_steps.some(
      step => step.branching_options && step.branching_options.length > 0
    );
  }
}

module.exports = CaseSimulator;
