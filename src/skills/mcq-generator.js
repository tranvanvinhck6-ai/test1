'use strict';

/**
 * @fileoverview MCQGenerator - Tạo câu hỏi trắc nghiệm y khoa chuẩn USMLE Step 1 & Step 2 CK
 * Sử dụng AI (Gemini/Claude) để tạo câu hỏi lâm sàng 2-3 bước tư duy,
 * có kèm Ngọc lâm sàng (Clinical Pearl) và giải thích từng phương án.
 */

const { v4: uuidv4 } = require('uuid');

/** Các chuyên khoa y khoa chuẩn USMLE Step 1 & Step 2 CK */
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
  1: 'Cơ bản (Step 1 Foundation)', 2: 'Trung bình (Step 1 High-Yield)', 3: 'Nâng cao (Step 2 CK Clinical Mastery)', 4: 'Khó (Step 2 CK Board Level)', 5: 'Chuyên sâu (Chuyên gia / Expert)'
};

/**
 * Lớp tạo câu hỏi trắc nghiệm y khoa USMLE
 * @class MCQGenerator
 */
class MCQGenerator {
  /**
   * Khởi tạo MCQGenerator
   * @param {import('@anthropic-ai/sdk').default} claudeClient - Anthropic client instance
   * @param {string} model - Tên model Claude
   */
  constructor(claudeClient, model) {
    this.client = claudeClient;
    this.model = model || 'claude-sonnet-4-20250514';
  }

  /**
   * Tạo câu hỏi trắc nghiệm y khoa chuẩn USMLE
   * @param {Object} params - Tham số tạo câu hỏi
   * @param {string[]} params.domains - Danh sách domain_id cần tạo câu hỏi
   * @param {number} params.difficulty - Mức độ khó (1-5)
   * @param {number} params.count - Số lượng câu hỏi cần tạo
   * @param {Object} [params.userProfile] - Hồ sơ người học
   * @param {string[]} [params.focusAreas] - Lĩnh vực trọng tâm
   * @param {Object} [params.bloomDistribution] - Phân bổ Bloom mục tiêu
   * @returns {Promise<Object[]>} Mảng câu hỏi MCQ
   */
  async generate(params) {
    const domains = params.domains || (params.domain ? [params.domain] : ['internal']);
    const {
      difficulty = 3,
      count = 5,
      userProfile = {},
      focusAreas = [],
      bloomDistribution = null,
      subdomains = []
    } = params;

    let domainDetails = 'internal';
    try {
      // Xây dựng thông tin chuyên khoa và tiểu mục
      domainDetails = domains.map(d => {
        const info = DOMAINS.find(dm => dm.id === d);
        const subList = subdomains.length > 0 ? subdomains : (info ? info.subdomains : []);
        return info ? `${info.name} (các tiểu mục trọng tâm: ${subList.join(', ')})` : d;
      }).join('; ');

      // Xây dựng hướng dẫn phân bổ Bloom
      const bloomGuide = bloomDistribution
        ? `Phân bổ Bloom mục tiêu: ${JSON.stringify(bloomDistribution)}`
        : 'Ưu tiên Bloom Phân tích (Analyze), Đánh giá (Evaluate), Áp dụng (Apply) theo chuẩn USMLE.';

      const targetDomainId = params.domain || domains[0] || 'internal';
      const randomSeed = Math.floor(Math.random() * 1000000);

      // Tạo prompt cho Claude/Gemini
      const systemPrompt = `Bạn là Giáo sư Y khoa lâm sàng hàng đầu, chuyên ra đề thi USMLE Step 1 & Step 2 CK.
(Mã đa dạng hóa đề thi: #${randomSeed})

YÊU CẦU:
1. Tạo ${count} câu hỏi trắc nghiệm lâm sàng chuẩn USMLE Step 1 / Step 2 CK
2. Chuyên khoa: ${domainDetails}
3. Mức độ khó: ${difficulty}/5 (${DIFFICULTY_LABELS[difficulty] || 'Nâng cao'})
4. ${bloomGuide}
${focusAreas.length > 0 ? `5. Trọng tâm High-Yield: ${focusAreas.join(', ')}` : ''}

QUY TẮC & ĐA DẠNG HÓA TRACKER:
- LƯU Ý ĐẶC BIỆT (vòng lặp thích ứng): Để làm đa dạng toàn diện bảng đánh giá năng lực (Tracker), hãy liên tục thay đổi góc độ lâm sàng, xoay vòng các mặt bệnh và khám phá sâu vào các tiểu mục khác nhau. KHÔNG lặp lại lối mòn!
- Mỗi câu hỏi PHẢI có tình huống lâm sàng (clinical vignette) bằng tiếng Việt đầy đủ cấu trúc: Tuổi, giới, lý do đến khám, bệnh sử, tiền sử, sinh hiệu, khám thực thể, xét nghiệm/cận lâm sàng quan trọng.
- Câu hỏi (question_text) hỏi về bước xử trí tiếp theo (Next best step in management), xét nghiệm chẩn đoán ban đầu tốt nhất, chẩn đoán khả dĩ nhất, hoặc cơ chế sinh lý bệnh/dược lý sâu (tư duy 2-3 bước).
- 4 phương án trả lời A, B, C, D (chỉ 1 đáp án đúng). Các đáp án nhiễu phải là các bẫy lâm sàng hợp lý.
- BẮT BUỘC có trường "clinical_pearl" (Ngọc lâm sàng): 1 câu quy tắc vàng (Rule of thumb / Classic triad / Buzzword) dễ nhớ để thi đậu điểm cao.
- BẮT BUỘC có trường "option_explanations" giải thích rõ vì sao từng phương án A, B, C, D là đúng hoặc sai (vì sao bị chống chỉ định, hoặc chưa phải bước ban đầu).
- Giá trị "domain_id" trong JSON trả về PHẢI LÀ "${targetDomainId}".

Trả lời bằng JSON array:
[
  {
    "domain_id": "${targetDomainId}",
    "subdomain": "phân ngành cụ thể",
    "question_text": "câu hỏi chốt (ví dụ: Bước xử trí tiếp theo phù hợp nhất là gì?)",
    "clinical_vignette": "Tình huống lâm sàng chi tiết",
    "options": [
      {"id": "A", "text": "Phương án A"},
      {"id": "B", "text": "Phương án B"},
      {"id": "C", "text": "Phương án C"},
      {"id": "D", "text": "Phương án D"}
    ],
    "correct_answer": "A|B|C|D",
    "explanation": "Giải thích tổng quan phác đồ/cơ chế sinh lý bệnh",
    "option_explanations": {
      "A": "Giải thích chi tiết vì sao A đúng hoặc sai",
      "B": "Giải thích chi tiết vì sao B đúng hoặc sai",
      "C": "Giải thích chi tiết vì sao C đúng hoặc sai",
      "D": "Giải thích chi tiết vì sao D đúng hoặc sai"
    },
    "clinical_pearl": "Ngọc lâm sàng USMLE - quy tắc vàng 1 câu dễ nhớ",
    "usmle_step": "step1|step2ck",
    "bloom_level": "apply|analyze|evaluate|create",
    "difficulty": ${difficulty},
    "tags": ["USMLE Step 2 CK", "High Yield"]
  }
]`;

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 8192,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Tạo ${count} câu hỏi trắc nghiệm y khoa chuẩn USMLE cho chuyên khoa: ${domainDetails}.${userProfile.goals ? ` Mục tiêu: ${userProfile.goals}.` : ''}`
          }
        ]
      });

      const text = response.content[0].text;

      // Trích xuất JSON array từ phản hồi
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.error('[MCQGenerator] Không thể trích xuất JSON từ phản hồi AI');
        return [];
      }

      const questions = JSON.parse(jsonMatch[0]);

      // Thêm ID duy nhất cho mỗi câu hỏi và validate
      return questions.map(q => this._normalizeQuestion(q, difficulty));
    } catch (error) {
      console.warn('[MCQGenerator] ⚠️ API AI gặp lỗi hoặc hết Quota (429). Tự động sử dụng bộ câu hỏi USMLE High-Yield dự phòng offline:', error.message);
      return this._getFallbackQuestions(domainDetails || 'internal', count, difficulty);
    }
  }

  /**
   * Bộ câu hỏi USMLE High-Yield dự phòng khi API hết Quota
   * @private
   */
  _getFallbackQuestions(domain, count, difficulty) {
    const fallbacks = [
      {
        domain_id: 'internal',
        subdomain: 'Cardiology (Tim mạch)',
        question_text: 'Bệnh nhân nam 58 tuổi tiền sử đái tháo đường nhập viện vì đau thắt ngực dữ dội lan ra tay trái và vã mồ hôi 2 giờ nay. Điện tâm đồ ghi nhận ST chênh lên 3mm ở các chuyển đạo V1-V4. Sau khi cho aspirin nhai, clopidogrel và heparin, bước xử trí cấp cứu ưu tiên tiếp theo phù hợp nhất là gì?',
        clinical_vignette: 'Bệnh nhân nam 58 tuổi, Tiền sử: Đái tháo đường týp 2, Tăng huyết áp. Triệu chứng: Đau ngực sau xương ức như bóp nghẹt lan tay trái 2 giờ. Sinh hiệu: HA 135/85 mmHg, Mạch 96 lần/phút, SpO2 96%. ECG: ST chênh lên V1-V4. Troponin I: 5.2 ng/mL (Tăng cao).',
        options: [
          { id: 'A', text: 'Chuyển ngay phòng can thiệp tim mạch mạc vành (PCI) tiên phát trong vòng 90 phút' },
          { id: 'B', text: 'Chỉ định tiêu sợi huyết tĩnh mạch (Alteplase) ngay tại phòng cấp cứu' },
          { id: 'C', text: 'Cho nitroglycerin ngậm dưới lưỡi và theo dõi ECG mỗi 30 phút' },
          { id: 'D', text: 'Chụp cắt lớp vi tính (CT) mạch vành để xác định vị trí tắc nghẽn' },
          { id: 'E', text: 'Bắt đầu dùng thuốc chẹn beta giao cảm liều cao ngay lập tức' }
        ],
        correct_answer: 'A',
        explanation: 'Bệnh nhân được chẩn đoán xác định Nhồi máu cơ tim cấp có ST chênh lên (STEMI) thành trước (ST chênh ở V1-V4 tương ứng động mạch liên thất trước - LAD). Theo phác đồ chuẩn USMLE Step 2 CK và AHA/ACC, can thiệp mạch vành qua da (PCI) tiên phát là phương pháp tái thông mạch ưu tiên tuyệt đối nếu có thể thực hiện trong vòng 90 phút từ khi bệnh nhân tới viện.',
        option_explanations: {
          "A": "Đáp án chính xác. PCI tiên phát giảm tỉ lệ tử vong và biến chứng vượt trội so với tiêu sợi huyết nếu thực hiện đúng giờ vàng (đích thời gian cửa - bóng < 90 phút).",
          "B": "Tiêu sợi huyết chỉ chỉ định khi không có khả năng chuyển đến trung tâm có PCI trong vòng 120 phút.",
          "C": "Nitroglycerin chỉ là điều trị triệu chứng, không thay thế việc tái thông mạch vành khẩn cấp trong STEMI.",
          "D": "CT mạch vành chống chỉ định trong STEMI cấp vì mất thời gian và độc tính thuốc cản quang; bệnh nhân cần vào phòng can thiệp ngay.",
          "E": "Chẹn beta nên bắt đầu trong 24 giờ đầu nhưng không phải là ưu tiên khẩn cấp nhất lúc này và cần thận trọng nếu có dấu hiệu suy tim cấp."
        },
        clinical_pearl: 'Thời gian là cơ tim (Time is muscle). Trong STEMI, ưu tiên cao nhất luôn là tái thông mạch vành bằng PCI tiên phát (nếu < 90 phút) hoặc Tiêu sợi huyết (nếu không thể PCI trong < 120 phút).',
        usmle_step: 'step2ck',
        bloom_level: 'evaluate',
        tags: ['Cardiology', 'STEMI', 'Emergency', 'USMLE High-Yield']
      },
      {
        domain_id: 'microbiology',
        subdomain: 'Bacteriology (Vi khuẩn học)',
        question_text: 'Bệnh nhân nữ 24 tuổi nhập viện vì sốt cao 39.5°C, rét run và tiểu buốt, tiểu rắt 2 ngày nay. Khám lâm sàng có nghiệm pháp vỗ vùng hông lưng (CVA tenderness) bên phải dương tính rõ ràng. Nhuộm Gram nước tiểu cho thấy trực khuẩn Gram âm Gr(-), không sinh bào tử, lên men lactose nhanh trên thạch MacConkey và có phản ứng indol dương tính. Tác nhân gây bệnh khả dĩ nhất là gì?',
        clinical_vignette: 'Bệnh nhân nữ 24 tuổi. Triệu chứng: Sốt 39.5°C, ớn lạnh, đau vùng hông lưng phải, tiểu buốt rắt. Khám: CVA tenderness (+) bên phải. Xét nghiệm nước tiểu: Bạch cầu (++), Nitrite (+). Vi sinh: Trực khuẩn Gram âm, lên men lactose nhanh, Indol (+).',
        options: [
          { id: 'A', text: 'Escherichia coli (E. coli)' },
          { id: 'B', text: 'Klebsiella pneumoniae' },
          { id: 'C', text: 'Proteus mirabilis' },
          { id: 'D', text: 'Pseudomonas aeruginosa' },
          { id: 'E', text: 'Enterococcus faecalis' }
        ],
        correct_answer: 'A',
        explanation: 'Bệnh cảnh lâm sàng điển hình của Viêm bể thận cấp (Acute Pyelonephritis) với sốt, đau vùng hông lưng và dấu hiệu nhiễm trùng tiểu. Tác nhân phổ biến nhất chiếm >80% là Escherichia coli. Về đặc tính vi sinh (chuẩn USMLE Step 1): E. coli là trực khuẩn Gram âm, lên men lactose nhanh (màu hồng trên thạch MacConkey), và đặc biệt Indol dương tính (giúp phân biệt với Klebsiella lên men lactose nhưng Indol âm tính).',
        option_explanations: {
          "A": "Đáp án chính xác. E. coli là nguyên nhân số 1 gây UTI và có các đặc tính vi sinh: Gr(-), lên men lactose nhanh, Indol (+).",
          "B": "Klebsiella cũng là trực khuẩn Gr(-) lên men lactose nhanh, nhưng phản ứng Indol âm tính (trừ K. oxytoca rất hiếm).",
          "C": "Proteus mirabilis không lên men lactose và sản xuất enzyme urease làm tăng pH nước tiểu gây sỏi struvite.",
          "D": "Pseudomonas aeruginosa không lên men lactose, oxidase dương tính.",
          "E": "Enterococcus là cầu khuẩn Gram dương, không phải trực khuẩn Gram âm."
        },
        clinical_pearl: 'Để phân biệt nhanh 2 trực khuẩn Gram âm lên men lactose gây nhiễm trùng tiểu trên đề thi USMLE Step 1: E. coli là Indol (+), trong khi Klebsiella pneumoniae là Indol (-).',
        usmle_step: 'step1',
        bloom_level: 'analyze',
        tags: ['Microbiology', 'UTI', 'Pyelonephritis', 'USMLE Step 1']
      },
      {
        domain_id: 'pharmacology',
        subdomain: 'Cardiovascular Pharmacology',
        question_text: 'Bệnh nhân nam 62 tuổi mắc suy tim sung huyết với phân suất tống máu giảm (HFrEF, EF 32%) đang được điều trị bằng Enalapril, Metoprolol và Furosemide. Gần đây bệnh nhân xuất hiện ho khan dai dẳng, ngứa họng về đêm, không kèm sốt hay khó thở khò khè. Bác sĩ quyết định thay thế Enalapril bằng một loại thuốc khác có tác dụng ức chế hệ RAAS tương đương nhưng không gây ho khan. Cơ chế tác dụng chính xác của thuốc được thay thế là gì?',
        clinical_vignette: 'Bệnh nhân nam 62 tuổi. Tiền sử: HFrEF (EF 32%). Thuốc đang dùng: Enalapril, Metoprolol, Furosemide. Triệu chứng mới: Ho khan kéo dài 3 tuần, ngứa cổ họng, khám phổi trong. X-quang phổi: Không thâm nhiễm hay phù phổi.',
        options: [
          { id: 'A', text: 'Đối kháng chọn lọc trên thụ thể Angiotensin II týp 1 (AT1 receptor blocker)' },
          { id: 'B', text: 'Ức chế trực tiếp enzyme chuyển Angiotensin I thành Angiotensin II (ACE inhibitor)' },
          { id: 'C', text: 'Đối kháng cạnh tranh thụ thể Aldosterone tại ống lượn xa và ống góp' },
          { id: 'D', text: 'Ức chế trực tiếp Renin, ngăn chặn sự hình thành Angiotensin I' },
          { id: 'E', text: 'Kích thích thụ thể alpha-2 adrenergic trung ương làm giảm trương lực giao cảm' }
        ],
        correct_answer: 'A',
        explanation: 'Thuốc ức chế men chuyển (ACE inhibitors như Enalapril) làm giảm thoái biến bradykinin và chất P ở phổi, dẫn đến tác dụng phụ ho khan dai dẳng ở khoảng 10-20% bệnh nhân. Khi gặp tác dụng phụ này, phác đồ chuẩn là chuyển sang thuốc chẹn thụ thể Angiotensin II (ARB - như Valsartan, Losartan). ARBs hoạt động bằng cách đối kháng chọn lọc trên thụ thể AT1 của Angiotensin II, không tác động đến enzyme ACE nên không làm tích tụ bradykinin, từ đó không gây ho.',
        option_explanations: {
          "A": "Đáp án chính xác. ARBs (Angiotensin Receptor Blockers) đối kháng thụ thể AT1, có hiệu quả bảo vệ tim mạch tương đương ACEi nhưng không gây ho khan.",
          "B": "Đây là cơ chế của ACEi (Enalapril), chính là nguyên nhân gây ho do tích tụ bradykinin.",
          "C": "Đây là cơ chế của Spironolactone hoặc Eplerenone (thuốc đối kháng Aldosterone).",
          "D": "Đây là cơ chế của Aliskiren (thuốc ức chế Renin trực tiếp), ít được ưu tiên thay thế cho ACEi trong HFrEF bằng ARB.",
          "E": "Đây là cơ chế của Clonidine hoặc Methyldopa, thuốc hạ huyết áp trung ương không dùng trong phác đồ chuẩn HFrEF."
        },
        clinical_pearl: 'Ho khan do ACEi là do tích tụ Bradykinin trong phổi. Chuyển sang ARB (Angiotensin Receptor Blocker) sẽ giải quyết được triệu chứng ho mà vẫn duy trì ức chế hệ RAAS bảo vệ tim mạch.',
        usmle_step: 'step1',
        bloom_level: 'apply',
        tags: ['Pharmacology', 'Heart Failure', 'ACEi vs ARB', 'USMLE Step 1']
      }
    ];

    const result = [];
    for (let i = 0; i < count; i++) {
      const template = fallbacks[i % fallbacks.length];
      const q = JSON.parse(JSON.stringify(template));
      q.id = uuidv4();
      result.push(this._normalizeQuestion(q, difficulty));
    }
    return result;
  }

  /**
   * Chuẩn hóa và validate câu hỏi
   * @private
   * @param {Object} question - Câu hỏi thô từ AI
   * @param {number} defaultDifficulty - Độ khó mặc định
   * @returns {Object} Câu hỏi đã chuẩn hóa
   */
  _normalizeQuestion(question, defaultDifficulty) {
    // Đảm bảo mỗi câu hỏi có đầy đủ các trường
    const options = (question.options || []).map((opt, idx) => ({
      id: opt.id || String.fromCharCode(65 + idx), // A, B, C, D
      text: opt.text || ''
    }));

    return {
      id: uuidv4(),
      domain_id: question.domain_id || 'internal',
      subdomain: question.subdomain || 'Chung',
      question_text: question.question_text || 'Bước xử trí tiếp theo phù hợp nhất là gì?',
      clinical_vignette: question.clinical_vignette || '',
      options: options,
      correct_answer: question.correct_answer || 'A',
      explanation: question.explanation || 'Chưa có giải thích tổng quan',
      option_explanations: question.option_explanations || {
        "A": "Xem lời giải thích tổng quan ở trên.",
        "B": "Phương án không chính xác trong bệnh cảnh lâm sàng này.",
        "C": "Phương án không chính xác trong bệnh cảnh lâm sàng này.",
        "D": "Phương án không chính xác trong bệnh cảnh lâm sàng này."
      },
      clinical_pearl: question.clinical_pearl || 'Ghi nhớ phác đồ chẩn đoán và điều trị chuẩn theo từng bước.',
      usmle_step: question.usmle_step || (question.domain_id === 'pathology' || question.domain_id === 'pharmacology' || question.domain_id === 'physiology' ? 'step1' : 'step2ck'),
      bloom_level: question.bloom_level || 'analyze',
      difficulty: question.difficulty || defaultDifficulty,
      tags: question.tags || ['USMLE High-Yield'],
      created_at: new Date().toISOString()
    };
  }
}

module.exports = MCQGenerator;

