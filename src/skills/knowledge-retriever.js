'use strict';

/**
 * @fileoverview KnowledgeRetriever - Truy xuất và tạo kiến thức y khoa
 * Sử dụng Claude API để truy xuất kiến thức y khoa, hướng dẫn lâm sàng,
 * và xác minh các phát biểu y khoa.
 */

/** Các chuyên khoa y khoa trong hệ thống */
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
 * Lớp truy xuất kiến thức y khoa sử dụng Claude AI
 * @class KnowledgeRetriever
 */
class KnowledgeRetriever {
  /**
   * Khởi tạo KnowledgeRetriever
   * @param {import('@anthropic-ai/sdk').default} claudeClient - Anthropic client instance
   * @param {string} model - Tên model Claude (vd: 'claude-sonnet-4-20250514')
   */
  constructor(claudeClient, model) {
    this.client = claudeClient;
    this.model = model || 'claude-sonnet-4-20250514';
  }

  /**
   * Truy xuất / tạo kiến thức y khoa dựa trên câu hỏi và ngữ cảnh
   * @param {string} query - Câu hỏi hoặc chủ đề cần truy xuất
   * @param {Object} [context={}] - Ngữ cảnh bổ sung
   * @param {string} [context.domain] - Chuyên khoa liên quan
   * @param {string} [context.subdomain] - Phân ngành
   * @param {number} [context.difficulty] - Mức độ khó (1-5)
   * @param {string} [context.userLevel] - Trình độ người học
   * @returns {Promise<Object>} Kết quả truy xuất kiến thức
   * @returns {string} return.content - Nội dung kiến thức (markdown)
   * @returns {string[]} return.key_concepts - Các khái niệm chính
   * @returns {string[]} return.references - Tài liệu tham khảo
   * @returns {string} return.domain - Chuyên khoa
   * @returns {string} return.confidence - Mức độ tin cậy (high/medium/low)
   */
  async retrieve(query, context = {}) {
    try {
      const domainInfo = context.domain
        ? DOMAINS.find(d => d.id === context.domain)
        : null;

      const systemPrompt = `Bạn là một giáo sư y khoa giàu kinh nghiệm, chuyên gia trong lĩnh vực ${domainInfo ? domainInfo.name : 'y khoa tổng quát'}.
Nhiệm vụ: Cung cấp kiến thức y khoa chính xác, cập nhật và dễ hiểu.
Ngôn ngữ: Tiếng Việt, sử dụng thuật ngữ y khoa chuẩn.
Mức độ: ${context.difficulty ? `Cấp độ ${context.difficulty}/5` : 'Phù hợp với sinh viên y khoa'}.

Trả lời theo format JSON:
{
  "content": "Nội dung chi tiết (markdown)",
  "key_concepts": ["Khái niệm 1", "Khái niệm 2"],
  "references": ["Tài liệu tham khảo 1"],
  "domain": "domain_id",
  "confidence": "high|medium|low"
}`;

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Truy xuất kiến thức y khoa về: ${query}${context.subdomain ? `\nPhân ngành: ${context.subdomain}` : ''}${context.userLevel ? `\nTrình độ người học: ${context.userLevel}` : ''}`
          }
        ]
      });

      const text = response.content[0].text;
      // Trích xuất JSON từ phản hồi
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          content: text,
          key_concepts: [],
          references: [],
          domain: context.domain || 'unknown',
          confidence: 'medium'
        };
      }

      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      console.error('[KnowledgeRetriever] Lỗi truy xuất kiến thức:', error.message);
      throw new Error(`Không thể truy xuất kiến thức: ${error.message}`);
    }
  }

  /**
   * Lấy hướng dẫn lâm sàng hiện hành cho một chuyên khoa
   * @param {string} domain - ID chuyên khoa (vd: 'internal', 'surgery')
   * @returns {Promise<Object>} Hướng dẫn lâm sàng
   * @returns {string} return.domain - Tên chuyên khoa
   * @returns {Object[]} return.guidelines - Danh sách hướng dẫn
   * @returns {string} return.guidelines[].title - Tiêu đề hướng dẫn
   * @returns {string} return.guidelines[].summary - Tóm tắt
   * @returns {string} return.guidelines[].source - Nguồn
   * @returns {string} return.guidelines[].year - Năm ban hành
   * @returns {string[]} return.guidelines[].key_recommendations - Khuyến cáo chính
   */
  async getGuidelines(domain) {
    try {
      const domainInfo = DOMAINS.find(d => d.id === domain);
      if (!domainInfo) {
        throw new Error(`Không tìm thấy chuyên khoa: ${domain}`);
      }

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: `Bạn là chuyên gia y khoa. Cung cấp các hướng dẫn lâm sàng quan trọng và cập nhật nhất cho chuyên khoa ${domainInfo.name}.
Bao gồm các hướng dẫn từ: WHO, Bộ Y tế Việt Nam, các hiệp hội chuyên khoa quốc tế.
Trả lời bằng JSON:
{
  "domain": "${domainInfo.name}",
  "guidelines": [
    {
      "title": "Tên hướng dẫn",
      "summary": "Tóm tắt ngắn",
      "source": "Nguồn/Tổ chức",
      "year": "Năm",
      "key_recommendations": ["Khuyến cáo 1", "Khuyến cáo 2"]
    }
  ]
}`,
        messages: [
          {
            role: 'user',
            content: `Liệt kê các hướng dẫn lâm sàng quan trọng nhất cho ${domainInfo.name}, bao gồm các phân ngành: ${domainInfo.subdomains.join(', ')}.`
          }
        ]
      });

      const text = response.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { domain: domainInfo.name, guidelines: [] };
      }

      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      console.error('[KnowledgeRetriever] Lỗi lấy hướng dẫn:', error.message);
      throw new Error(`Không thể lấy hướng dẫn cho ${domain}: ${error.message}`);
    }
  }

  /**
   * Xác minh tính chính xác của một phát biểu y khoa
   * @param {string} statement - Phát biểu cần xác minh
   * @returns {Promise<Object>} Kết quả xác minh
   * @returns {boolean} return.is_accurate - Phát biểu có chính xác không
   * @returns {string} return.confidence - Mức độ tin cậy (high/medium/low)
   * @returns {string} return.explanation - Giải thích chi tiết
   * @returns {string} [return.correction] - Nội dung sửa chữa (nếu sai)
   * @returns {string[]} return.references - Tài liệu tham khảo
   */
  async verifyFact(statement) {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2048,
        system: `Bạn là chuyên gia xác minh thông tin y khoa. Đánh giá tính chính xác của phát biểu y khoa dựa trên bằng chứng khoa học hiện hành.
Trả lời bằng JSON:
{
  "is_accurate": true/false,
  "confidence": "high|medium|low",
  "explanation": "Giải thích chi tiết bằng tiếng Việt",
  "correction": "Nội dung sửa chữa nếu phát biểu sai (bỏ qua nếu đúng)",
  "references": ["Tài liệu tham khảo"]
}`,
        messages: [
          {
            role: 'user',
            content: `Xác minh phát biểu y khoa sau:\n"${statement}"`
          }
        ]
      });

      const text = response.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          is_accurate: false,
          confidence: 'low',
          explanation: 'Không thể xác minh phát biểu này.',
          references: []
        };
      }

      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      console.error('[KnowledgeRetriever] Lỗi xác minh:', error.message);
      throw new Error(`Không thể xác minh phát biểu: ${error.message}`);
    }
  }
}

module.exports = KnowledgeRetriever;
