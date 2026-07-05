'use strict';

/**
 * @fileoverview LessonComposer - Soạn bài giảng y khoa
 * Sử dụng Claude để tạo bài giảng có cấu trúc, phù hợp với
 * trình độ người học và các lỗ hổng kiến thức đã phát hiện.
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

/** Loại bài giảng và mô tả */
const LESSON_TYPES = {
  theory: {
    name: 'Lý thuyết',
    description: 'Bài giảng lý thuyết có cấu trúc, trình bày hệ thống kiến thức'
  },
  case_based: {
    name: 'Dựa trên ca lâm sàng',
    description: 'Bài giảng xoay quanh các ca lâm sàng thực tế, học qua tình huống'
  },
  review: {
    name: 'Ôn tập',
    description: 'Bài ôn tập tổng hợp, hệ thống hóa và củng cố kiến thức'
  },
  deep_dive: {
    name: 'Chuyên sâu',
    description: 'Bài giảng đi sâu vào chủ đề cụ thể, phân tích chi tiết'
  }
};

/**
 * Lớp soạn bài giảng y khoa sử dụng Claude AI
 * @class LessonComposer
 */
class LessonComposer {
  /**
   * Khởi tạo LessonComposer
   * @param {import('@anthropic-ai/sdk').default} claudeClient - Anthropic client instance
   * @param {string} model - Tên model Claude
   */
  constructor(claudeClient, model) {
    this.client = claudeClient;
    this.model = model || 'claude-sonnet-4-20250514';
  }

  /**
   * Soạn bài giảng y khoa
   * @param {Object} params - Tham số soạn bài giảng
   * @param {string} params.topic - Chủ đề bài giảng
   * @param {string} params.domain - ID chuyên khoa
   * @param {string} [params.subdomain] - Phân ngành
   * @param {number} [params.difficulty=2] - Mức độ khó (1-5)
   * @param {Object[]} [params.userGaps] - Lỗ hổng kiến thức đã phát hiện
   * @param {string} [params.userLevel='intermediate'] - Trình độ người học
   * @param {string} [params.lessonType='theory'] - Loại bài giảng
   * @returns {Promise<Object>} Bài giảng có cấu trúc
   * @returns {string} return.title - Tiêu đề bài giảng
   * @returns {string[]} return.objectives - Mục tiêu học tập
   * @returns {string} return.core_content - Nội dung chính (markdown)
   * @returns {string[]} return.key_points - Điểm chính cần nhớ
   * @returns {string[]} return.clinical_pearls - Kinh nghiệm lâm sàng
   * @returns {string[]} return.memory_aids - Mẹo ghi nhớ (mnemonics)
   * @returns {Object[]} return.self_check_questions - Câu hỏi tự kiểm tra
   * @returns {string[]} return.references - Tài liệu tham khảo
   */
  async compose(params) {
    const {
      topic,
      domain,
      subdomain,
      difficulty = 2,
      userGaps = [],
      userLevel = 'intermediate',
      lessonType = 'theory'
    } = params;

    let domainName = domain || 'Nội khoa';
    try {
      const domainInfo = DOMAINS.find(d => d.id === domain);
      domainName = domainInfo ? domainInfo.name : (domain || 'Nội khoa');
      const typeInfo = LESSON_TYPES[lessonType] || LESSON_TYPES.theory;

      // Xây dựng hướng dẫn bổ sung dựa trên lỗ hổng
      const gapGuidance = userGaps.length > 0
        ? `\n\nLƯU Ý CÁC LỖ HỔNG KIẾN THỨC CẦN GIẢI QUYẾT:\n${userGaps.map(g => `- ${g.domain_name || g.domain_id}: ${g.gap_type} (${g.score}%)`).join('\n')}`
        : '';

      const systemPrompt = `Bạn là Giáo sư Y khoa lâm sàng và Chuyên gia luyện thi USMLE hàng đầu tại Mỹ (USMLE Step 1 & Step 2 CK Faculty).
Nhiệm vụ: Soạn bài giảng Masterclass (${typeInfo.name}) về chủ đề y khoa theo chuẩn USMLE Blended Integration.

THÔNG TIN:
- Chuyên khoa: ${domainName}${subdomain ? ` > ${subdomain}` : ''}
- Loại bài giảng: ${typeInfo.name} - ${typeInfo.description}
- Mức độ: ${DIFFICULTY_LABELS[difficulty] || 'Trung bình'} (${difficulty}/5)
- Trình độ người học: ${userLevel}
${gapGuidance}

YÊU CẦU ĐẶC BIỆT (USMLE MASTERCLASS):
1. Nội dung bằng tiếng Việt y khoa chính xác, giữ nguyên thuật ngữ tiếng Anh chuẩn Quốc tế.
2. Tích hợp Khoa học cơ bản Step 1 (Sinh lý bệnh, Hóa sinh, Dược lý thụ thể) với Phác đồ điều trị lâm sàng Step 2 CK (AHA, ACC, GOLD, IDSA).
3. Sơ đồ xử trí lâm sàng phải rõ ràng từng bước (Algorithm / Flowchart).
4. Clinical pearls và Pitfalls phải là các mẹo thực chiến và lỗi cạm bẫy hay gặp trong đề thi USMLE.

Trả lời bằng JSON chuẩn:
{
  "title": "Tiêu đề bài giảng Masterclass",
  "objectives": ["Mục tiêu SMART 1", "Mục tiêu SMART 2"],
  "core_pathophysiology": "Nội dung sinh lý bệnh & cơ chế Step 1 (markdown)",
  "management_algorithms": "Sơ đồ xử trí lâm sàng từng bước Step 2 CK (markdown)",
  "core_content": "Nội dung tổng hợp chi tiết (markdown dài, có heading, list, bảng so sánh)",
  "key_points": ["Điểm chính 1", "Điểm chính 2"],
  "clinical_pearls": ["💎 Pearl 1", "💎 Pearl 2"],
  "usmle_pitfalls": ["⚠️ Cạm bẫy thi cử / Lỗi an toàn người bệnh 1"],
  "memory_aids": ["🧠 Mẹo nhớ Mnemonics 1", "🧠 Mẹo nhớ 2"],
  "self_check_questions": [
    {
      "vignette": "Tình huống lâm sàng ngắn",
      "question": "Câu hỏi về next step hoặc cơ chế",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "correct_answer": "A",
      "explanation": "Giải thích chi tiết",
      "bloom_level": "apply|analyze|evaluate"
    }
  ],
  "references": ["UpToDate 2026", "Harrison's Principles of Internal Medicine", "First Aid for USMLE Step 1/Step 2 CK"]
}`;

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 8192,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Soạn bài giảng Masterclass ${typeInfo.name} về: "${topic}"`
          }
        ]
      });

      const text = response.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        console.error('[LessonComposer] Không thể trích xuất JSON');
        return this._fallbackLesson(topic, domainName, text);
      }

      const lesson = JSON.parse(jsonMatch[0]);

      // Bổ sung metadata và đảm bảo các trường USMLE luôn tồn tại
      return {
        ...lesson,
        core_pathophysiology: lesson.core_pathophysiology || '',
        management_algorithms: lesson.management_algorithms || '',
        usmle_pitfalls: lesson.usmle_pitfalls || [],
        metadata: {
          domain_id: domain,
          domain_name: domainName,
          subdomain: subdomain || null,
          difficulty,
          lesson_type: lessonType,
          user_level: userLevel,
          created_at: new Date().toISOString(),
          estimated_duration_minutes: this._estimateDuration(lesson, difficulty)
        }
      };
    } catch (error) {
      console.warn('[LessonComposer] ⚠️ API AI lỗi hoặc hết Quota (429). Sử dụng bài giảng USMLE Masterclass dự phòng:', error.message);
      return this._fallbackLesson(topic || 'USMLE High-Yield Review', domainName || 'Chuyên khoa Nội khoa', `### 🔬 NỘI DUNG TỐT LÕI (USMLE HIGH-YIELD MASTERCLASS)\n\nTrong chuẩn bị cho kỳ thi **USMLE Step 1 & Step 2 CK**, việc nắm vững sinh lý bệnh và phác đồ xử trí lâm sàng là chìa khóa để đạt trên 250 điểm.\n\n#### 1. Sinh lý bệnh cốt lõi (Step 1 Basic Sciences)\n- Tối ưu hóa chuyển hóa cơ tim và sự mất cân bằng giữa cung - cầu Oxy trong bệnh mạch vành.\n- Nhận diện các dấu hiệu tế bào học và men tim: Troponin I/T tăng cao trong 3-4 giờ, đạt đỉnh ở 24 giờ và kéo dài 7-10 ngày.\n\n#### 2. Phác đồ lâm sàng và Tiếp cận theo bước (Step 2 CK Management)\n- **Thời gian vàng**: Can thiệp mạch vành qua da (PCI) tiên phát với Door-to-Balloon < 90 phút.\n- **Điều trị nội khoa tức thì**: Aspirin nhai, thuốc kháng thụ thể P2Y12 (Clopidogrel / Ticagrelor), Heparin trọng lượng phân tử thấp hoặc không phân đoạn, Nitroglycerin dưới lưỡi và Statin liều cao.`);
    }
  }

  /**
   * Ước tính thời gian học (phút)
   * @private
   * @param {Object} lesson - Bài giảng
   * @param {number} difficulty - Mức độ khó
   * @returns {number} Thời gian ước tính (phút)
   */
  _estimateDuration(lesson, difficulty) {
    // Ước tính dựa trên độ dài nội dung và độ khó
    const contentLength = (lesson.core_content || '').length;
    const baseMinutes = Math.ceil(contentLength / 500); // ~500 ký tự/phút đọc
    const difficultyMultiplier = 1 + (difficulty - 1) * 0.15; // Khó hơn = lâu hơn
    const questionsTime = (lesson.self_check_questions || []).length * 2; // 2 phút/câu

    return Math.max(10, Math.round(baseMinutes * difficultyMultiplier + questionsTime));
  }

  /**
   * Tạo bài giảng fallback khi không parse được JSON
   * @private
   * @param {string} topic - Chủ đề
   * @param {string} domainName - Tên chuyên khoa
   * @param {string} rawText - Nội dung thô
   * @returns {Object} Bài giảng cơ bản
   */
  _fallbackLesson(topic, domainName, rawText) {
    return {
      title: topic,
      objectives: [
        `Nắm vững sinh lý bệnh cơ sở chuẩn USMLE Step 1 cho ${topic}`,
        `Phân tích các bước chỉ định cận lâm sàng và phác đồ điều trị chuẩn USMLE Step 2 CK`,
        `Nhận diện các cạm bẫy lâm sàng (USMLE Pitfalls) thường gặp trong đề thi`
      ],
      core_content: rawText,
      key_points: [
        "**Thời gian vàng (Time is muscle)**: Tái thông mạch vành bằng PCI tiên phát trong < 90 phút là ưu tiên số 1 trong STEMI.",
        "**Men tim**: Troponin I và T có độ nhạy và đặc hiệu cao nhất, tăng sau 3-4 giờ và kéo dài đến 7-10 ngày.",
        "**Thuốc giảm tử vong rõ ràng nhất trong cấp cứu ban đầu**: Aspirin nhai (325mg) cần được cho ngay lập tức khi nghi ngờ ACS."
      ],
      clinical_pearls: [
        "💎 Nếu bệnh nhân STEMI kèm nhịp chậm hoặc tụt huyết áp và ST chênh ở II, III, aVF -> Nghĩ ngay đến Nhồi máu cơ tim thất phải (RV Infarct). TUYỆT ĐỐI TRÁNH dùng Nitroglycerin và Lợi tiểu vì sẽ làm tụt huyết áp nặng hơn do giảm tiền tải! Cần truyền dịch nước muối sinh lý (Normal Saline)."
      ],
      memory_aids: [
        {
          title: "Thần chú xử trí ban đầu ACS (MONA-B)",
          content: "**M**orphine (khi đau dai dẳng) - **O**xygen (khi SpO2 < 90%) - **N**itroglycerin (dưới lưỡi) - **A**spirin (nhai 325mg) - **B**eta-blocker (trong 24h đầu nếu không có suy tim cấp)."
        }
      ],
      self_check_questions: [
        {
          question: "Tại sao chống chỉ định dùng Nitroglycerin trong Nhồi máu cơ tim thất phải?",
          answer: "Vì cơ tim thất phải phụ thuộc rất lớn vào tiền tải (preload) để duy trì cung lượng tim. Nitroglycerin gây giãn tĩnh mạch làm giảm mạnh tiền tải, dẫn đến tụt huyết áp nghiêm trọng và sốc tim."
        }
      ],
      references: [
        "AHA/ACC 2023 Guidelines for the Management of Patients With Acute Myocardial Infarction",
        "USMLE Step 2 CK Lecture Notes - Internal Medicine & Cardiology"
      ],
      metadata: {
        domain_name: domainName,
        lesson_type: 'deep_dive',
        created_at: new Date().toISOString(),
        estimated_duration_minutes: 20,
        is_fallback: true
      }
    };
  }
}

module.exports = LessonComposer;
