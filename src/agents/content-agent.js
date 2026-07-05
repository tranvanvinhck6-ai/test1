'use strict';

const fs = require('fs');
const path = require('path');

/**
 * @fileoverview ContentAgent - Agent tạo nội dung bài học và ca lâm sàng.
 * Tạo bài học cá nhân hóa, case studies tương tác, và quản lý thư viện nội dung.
 */

/**
 * Danh sách domains y khoa
 * @constant {Array<Object>}
 */
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

class ContentAgent {
  /**
   * Khởi tạo ContentAgent
   * @param {Object} params
   * @param {import('@anthropic-ai/sdk').default} params.claudeClient - Claude API client
   * @param {string} params.model - Model identifier
   * @param {Object} params.db - Database connection
   * @param {Object} params.skills - Skill instances
   * @param {import('../skills/lesson-composer')} params.skills.lessonComposer - Lesson composition skill
   * @param {import('../skills/case-simulator')} params.skills.caseSimulator - Case simulation skill
   * @param {import('../skills/knowledge-retriever')} params.skills.knowledgeRetriever - Knowledge retrieval
   */
  constructor({ claudeClient, model, db, skills: { lessonComposer, caseSimulator, knowledgeRetriever } }) {
    this.claude = claudeClient;
    this.model = model;
    this.db = db;
    this.lessonComposer = lessonComposer;
    this.caseSimulator = caseSimulator;
    this.knowledgeRetriever = knowledgeRetriever;

    // Load system prompt
    const promptPath = path.join(__dirname, '..', 'prompts', 'content.md');
    this.systemPrompt = fs.readFileSync(promptPath, 'utf-8');

    console.log('[ContentAgent] Initialized successfully');
  }

  /**
   * Tạo bài học cá nhân hóa dựa trên curriculum plan.
   *
   * @param {Object} plan - Kế hoạch bài học từ CurriculumAgent
   * @param {string} plan.domain_id - Domain ID
   * @param {string} plan.title - Tiêu đề bài học
   * @param {number} plan.difficulty - Độ khó (1-10)
   * @param {string} plan.bloom_target - Target Bloom level
   * @param {string} plan.reason - Lý do chọn bài học này
   * @param {string} [plan.userId] - User ID (optional)
   * @param {Array<Object>} [plan.gaps] - Relevant gaps (optional)
   * @returns {Promise<Object>} Bài học hoàn chỉnh
   */
  async createLesson(plan) {
    try {
      console.log(`[ContentAgent] Creating lesson: ${plan.title || plan.domain_id}`);

      const domain = DOMAINS.find(d => d.id === plan.domain_id);
      if (!domain) {
        throw new Error(`Không tìm thấy domain: ${plan.domain_id}`);
      }

      // Retrieve relevant knowledge for the topic
      const knowledge = await this.knowledgeRetriever.retrieve(
        `${domain.name} ${plan.title || ''} y khoa Việt Nam`
      );

      // Compose lesson using skill
      const composedLesson = await this.lessonComposer.compose(
        plan.title || domain.name,
        plan.bloom_target || 'apply',
        plan.gaps || []
      );

      // Enhance with Claude for personalization
      const response = await this.claude.messages.create({
        model: this.model,
        max_tokens: 5000,
        system: this.systemPrompt,
        messages: [{
          role: 'user',
          content: `Tạo bài học y khoa hoàn chỉnh bằng tiếng Việt. Trả về JSON.

Domain: ${domain.name} (${domain.id})
Subdomains: ${domain.subdomains.join(', ')}
Chủ đề: ${plan.title || domain.name}
Độ khó: ${plan.difficulty || 5}/10
Bloom target: ${plan.bloom_target || 'apply'}
Lý do học: ${plan.reason || 'Theo kế hoạch học tập'}

Nội dung tham khảo từ skill:
${JSON.stringify(composedLesson, null, 2)}

Kiến thức bổ sung:
${JSON.stringify(knowledge, null, 2)}

Trả về JSON theo format chuẩn USMLE Masterclass:
{
  "title": "string (Tiêu đề bài giảng Masterclass)",
  "domain_id": "${plan.domain_id}",
  "subdomain": "string",
  "difficulty": ${plan.difficulty || 5},
  "bloom_level": "${plan.bloom_target || 'apply'}",
  "estimated_time_minutes": number,
  "objectives": ["string (3-5 mục tiêu SMART)"],
  "core_pathophysiology": "string (markdown - Cơ chế khoa học cơ bản Step 1)",
  "management_algorithms": "string (markdown - Sơ đồ xử trí lâm sàng Step 2 CK)",
  "core_knowledge": "string (markdown formatted, chi tiết tổng hợp)",
  "key_points": ["string (5-7 điểm then chốt)"],
  "clinical_cases": [
    {
      "title": "string",
      "vignette": "string",
      "questions": ["string"],
      "teaching_points": ["string"]
    }
  ],
  "clinical_pearls": ["string (3-5 tips thực tế USMLE)"],
  "usmle_pitfalls": ["string (cạm bẫy thi cử & sai lầm lâm sàng)"],
  "memory_aids": ["string (mnemonics, sơ đồ)"],
  "self_check": [
    { "question": "string", "answer": "string" }
  ],
  "further_reading": ["string"],
  "connections": ["string (liên kết liên chuyên khoa)"]
}`
        }]
      });

      let lesson = {};
      try {
        const content = response.content[0].text;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          lesson = JSON.parse(jsonMatch[0]);
        }
      } catch (parseErr) {
        console.warn('[ContentAgent] Could not parse lesson JSON, using composed lesson:', parseErr.message);
        lesson = {
          title: plan.title || domain.name,
          domain_id: plan.domain_id,
          difficulty: plan.difficulty || 5,
          bloom_level: plan.bloom_target || 'apply',
          core_pathophysiology: composedLesson.core_pathophysiology || '',
          management_algorithms: composedLesson.management_algorithms || '',
          core_knowledge: composedLesson.core_content || composedLesson.content || 'Nội dung đang được cập nhật.',
          key_points: composedLesson.key_points || composedLesson.keyPoints || [],
          clinical_pearls: composedLesson.clinical_pearls || [],
          usmle_pitfalls: composedLesson.usmle_pitfalls || [],
          self_check: composedLesson.self_check_questions || []
        };
      }

      // Save to database
      const dbResult = await this.db.run(
        `INSERT INTO lessons (user_id, domain_id, title, content, difficulty, type, created_at)
         VALUES (?, ?, ?, ?, ?, 'lesson', datetime('now'))`,
        [plan.userId || null, plan.domain_id, lesson.title, JSON.stringify(lesson), lesson.difficulty]
      );

      lesson.id = dbResult.lastID;
      lesson.createdAt = new Date().toISOString();

      console.log(`[ContentAgent] Lesson created: "${lesson.title}" (ID: ${lesson.id})`);
      return lesson;
    } catch (error) {
      console.error('[ContentAgent] Error creating lesson:', error.message);
      throw new Error(`Không thể tạo bài học: ${error.message}`);
    }
  }

  /**
   * Tạo ca lâm sàng tương tác (case study).
   *
   * @param {string} domain - Domain ID
   * @param {number} difficulty - Độ khó (1-10)
   * @returns {Promise<Object>} Case study object
   */
  async createCaseStudy(domain, difficulty) {
    try {
      console.log(`[ContentAgent] Creating case study: ${domain}, difficulty ${difficulty}`);

      const domainInfo = DOMAINS.find(d => d.id === domain);
      if (!domainInfo) {
        throw new Error(`Không tìm thấy domain: ${domain}`);
      }

      // Use case simulator skill
      const simulatedCase = await this.caseSimulator.simulate(domain, difficulty);

      // Enhance with Claude
      const response = await this.claude.messages.create({
        model: this.model,
        max_tokens: 4000,
        system: this.systemPrompt,
        messages: [{
          role: 'user',
          content: `Tạo ca lâm sàng tương tác cho domain "${domainInfo.name}" với độ khó ${difficulty}/10.
Bối cảnh Việt Nam. Trả về JSON.

Case từ skill:
${JSON.stringify(simulatedCase, null, 2)}

Trả về JSON:
{
  "case_id": "string",
  "title": "string",
  "domain_id": "${domain}",
  "difficulty": ${difficulty},
  "patient": {
    "age": number,
    "gender": "string",
    "occupation": "string",
    "chief_complaint": "string"
  },
  "stages": [
    {
      "stage": "intake|history|examination|investigation|diagnosis|treatment",
      "content": "string (markdown)",
      "available_actions": ["string"],
      "critical_findings": ["string"]
    }
  ],
  "final_diagnosis": "string",
  "learning_objectives": ["string"],
  "key_takeaways": ["string"],
  "pitfalls": ["string"]
}`
        }]
      });

      let caseStudy = {};
      try {
        const content = response.content[0].text;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          caseStudy = JSON.parse(jsonMatch[0]);
        }
      } catch (parseErr) {
        console.warn('[ContentAgent] Could not parse case study JSON:', parseErr.message);
        caseStudy = {
          title: `Ca lâm sàng ${domainInfo.name}`,
          domain_id: domain,
          difficulty,
          stages: simulatedCase?.stages || [],
          learning_objectives: []
        };
      }

      // Save to database
      const dbResult = await this.db.run(
        `INSERT INTO lessons (domain_id, title, content, difficulty, type, created_at)
         VALUES (?, ?, ?, ?, 'case_study', datetime('now'))`,
        [domain, caseStudy.title, JSON.stringify(caseStudy), difficulty]
      );

      caseStudy.id = dbResult.lastID;
      caseStudy.createdAt = new Date().toISOString();

      console.log(`[ContentAgent] Case study created: "${caseStudy.title}" (ID: ${caseStudy.id})`);
      return caseStudy;
    } catch (error) {
      console.error('[ContentAgent] Error creating case study:', error.message);
      throw new Error(`Không thể tạo ca lâm sàng: ${error.message}`);
    }
  }

  /**
   * Lấy hoặc tạo bài học cho ngày hôm nay.
   *
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Today's lesson
   */
  async getTodayLesson(userId) {
    try {
      console.log(`[ContentAgent] Getting today's lesson for user ${userId}`);

      const today = new Date().toISOString().split('T')[0];

      // Check if lesson already exists for today
      const existingLesson = await this.db.get(
        `SELECT * FROM lessons WHERE user_id = ? AND date(created_at) = ? AND type = 'lesson' ORDER BY created_at DESC LIMIT 1`,
        [userId, today]
      );

      if (existingLesson) {
        console.log(`[ContentAgent] Found existing lesson for today: ${existingLesson.id}`);
        let lessonContent = {};
        try {
          lessonContent = JSON.parse(existingLesson.content);
        } catch {
          lessonContent = { title: existingLesson.title, core_knowledge: existingLesson.content };
        }
        return {
          ...lessonContent,
          id: existingLesson.id,
          isNew: false
        };
      }

      // No lesson exists - create one based on tracker
      const tracker = await this.db.all(
        'SELECT * FROM tracker WHERE user_id = ? ORDER BY score ASC',
        [userId]
      );

      // Pick weakest domain for today's lesson
      const weakestDomain = tracker.length > 0 ? tracker[0] : { domain_id: 'internal', score: 0 };
      const domainInfo = DOMAINS.find(d => d.id === weakestDomain.domain_id) || DOMAINS[0];

      const lesson = await this.createLesson({
        userId,
        domain_id: weakestDomain.domain_id,
        title: `Bài học: ${domainInfo.name}`,
        difficulty: this._scoreToInitialDifficulty(weakestDomain.score || 0),
        bloom_target: weakestDomain.bloom_level || 'understand',
        reason: `Domain yếu nhất, score hiện tại: ${weakestDomain.score || 0}%`
      });

      lesson.isNew = true;
      return lesson;
    } catch (error) {
      console.error('[ContentAgent] Error getting today lesson:', error.message);
      throw new Error(`Không thể lấy bài học hôm nay: ${error.message}`);
    }
  }

  /**
   * Lấy bài học theo ID.
   *
   * @param {string|number} lessonId - Lesson ID
   * @returns {Promise<Object|null>} Lesson object or null
   */
  async getLessonById(lessonId) {
    try {
      const lesson = await this.db.get('SELECT * FROM lessons WHERE id = ?', [lessonId]);
      if (!lesson) {
        console.log(`[ContentAgent] Lesson ${lessonId} not found`);
        return null;
      }

      let lessonContent = {};
      try {
        lessonContent = JSON.parse(lesson.content);
      } catch {
        lessonContent = { title: lesson.title, core_knowledge: lesson.content };
      }

      return {
        ...lessonContent,
        id: lesson.id,
        userId: lesson.user_id,
        domainId: lesson.domain_id,
        type: lesson.type,
        createdAt: lesson.created_at
      };
    } catch (error) {
      console.error('[ContentAgent] Error getting lesson by ID:', error.message);
      throw new Error(`Không thể lấy bài học: ${error.message}`);
    }
  }

  // ===================== PRIVATE METHODS =====================

  /**
   * Chuyển đổi score sang difficulty ban đầu phù hợp
   * @private
   * @param {number} score
   * @returns {number}
   */
  _scoreToInitialDifficulty(score) {
    if (score < 30) return 3;
    if (score < 50) return 4;
    if (score < 65) return 5;
    if (score < 80) return 7;
    return 8;
  }
}

module.exports = ContentAgent;
