'use strict';

const fs = require('fs');
const path = require('path');

/**
 * @fileoverview AssessmentAgent - Agent quản lý kiểm tra và đánh giá năng lực y khoa.
 * Tạo bài kiểm tra chẩn đoán, kiểm tra hàng ngày, kiểm tra ôn tập,
 * và đánh giá kết quả bài làm.
 */

/**
 * Danh sách các domain y khoa
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

/**
 * Bloom's Taxonomy levels với trọng số chấm điểm
 * @constant {Object}
 */
const BLOOM_LEVELS = {
  remember: { weight: 1.0, label: 'Nhớ' },
  understand: { weight: 1.0, label: 'Hiểu' },
  apply: { weight: 1.5, label: 'Áp dụng' },
  analyze: { weight: 1.5, label: 'Phân tích' },
  evaluate: { weight: 2.0, label: 'Đánh giá' },
  create: { weight: 2.0, label: 'Sáng tạo' }
};

class AssessmentAgent {
  /**
   * Khởi tạo AssessmentAgent
   * @param {Object} params
   * @param {import('@anthropic-ai/sdk').default} params.claudeClient - Claude API client
   * @param {string} params.model - Model identifier (e.g., 'claude-sonnet-4-20250514')
   * @param {Object} params.db - Database connection object
   * @param {Object} params.skills - Skill instances
   * @param {import('../skills/mcq-generator')} params.skills.mcqGenerator - MCQ generation skill
   * @param {import('../skills/bloom-classifier')} params.skills.bloomClassifier - Bloom classification skill
   * @param {import('../skills/difficulty-calibrator')} params.skills.difficultyCalibrator - Difficulty calibration skill
   */
  constructor({ claudeClient, model, db, skills: { mcqGenerator, bloomClassifier, difficultyCalibrator } }) {
    this.claude = claudeClient;
    this.model = model;
    this.db = db;
    this.mcqGenerator = mcqGenerator;
    this.bloomClassifier = bloomClassifier;
    this.difficultyCalibrator = difficultyCalibrator;

    // Load system prompt
    const promptPath = path.join(__dirname, '..', 'prompts', 'assessment.md');
    this.systemPrompt = fs.readFileSync(promptPath, 'utf-8');

    console.log('[AssessmentAgent] Initialized successfully');
  }

  /**
   * Tạo bài kiểm tra chẩn đoán 40 câu, phủ tất cả domains.
   * Dùng khi user mới đăng ký để đánh giá năng lực ban đầu.
   *
   * @param {Object} userProfile - Thông tin người dùng
   * @param {string} userProfile.id - User ID
   * @param {string} userProfile.specialty - Chuyên ngành
   * @param {number} userProfile.experience_years - Số năm kinh nghiệm
   * @param {string} userProfile.level - Trình độ hiện tại
   * @returns {Promise<Object>} Session object với questions
   */
  async createDiagnosticTest(userProfile) {
    try {
      console.log(`[AssessmentAgent] Creating diagnostic test for user ${userProfile.id}`);

      // Tính số câu hỏi mỗi domain (40 câu / 9 domains, ưu tiên domain lớn)
      const distribution = this._calculateDiagnosticDistribution();

      // Calibrate difficulty dựa trên profile
      const calibratedLevel = await this.difficultyCalibrator.calibrate(userProfile, null);

      // Tạo câu hỏi cho tất cả domains trong 1 call duy nhất để không bị nghẽn API
      const allDomainIds = distribution.map(d => d.domainId);
      const totalCount = Math.min(distribution.reduce((sum, d) => sum + d.count, 0), 15) || 15;
      const allSubdomains = DOMAINS.flatMap(d => d.subdomains).slice(0, 10);

      const allQuestions = await this.mcqGenerator.generate({
        domains: allDomainIds,
        domain: allDomainIds[0],
        domainName: 'Đa chuyên khoa y khoa',
        subdomains: allSubdomains,
        focusAreas: allSubdomains,
        count: totalCount,
        difficulty: calibratedLevel?.difficulty || 3,
        bloomLevels: ['remember', 'understand', 'apply', 'analyze', 'evaluate'],
        context: `Bài kiểm tra chẩn đoán năng lực cho ${userProfile?.specialty || 'bác sĩ đa khoa'}, bao phủ các chuyên khoa: ${allDomainIds.join(', ')}`,
        systemPrompt: this.systemPrompt
      });

      // Đảm bảo các câu hỏi có trường bloom_level hợp lệ mà không cần gọi API phân loại lại
      const classifiedQuestions = allQuestions.map((q) => ({
        ...q,
        bloom_level: q.bloom_level || 'apply'
      }));

      // Tạo test session trong DB
      const session = await this._createTestSession({
        userId: userProfile.id,
        type: 'diagnostic',
        totalQuestions: classifiedQuestions.length,
        questions: classifiedQuestions
      });

      console.log(`[AssessmentAgent] Diagnostic test created: session ${session.id}, ${classifiedQuestions.length} questions`);
      return session;
    } catch (error) {
      console.error('[AssessmentAgent] Error creating diagnostic test:', error.message);
      throw new Error(`Không thể tạo bài kiểm tra chẩn đoán: ${error.message}`);
    }
  }

  /**
   * Tạo bài kiểm tra hàng ngày 12 câu, tập trung vào vùng yếu.
   *
   * @param {string} userId - User ID
   * @param {Array<Object>} tracker - Dữ liệu tracker năng lực hiện tại
   * @returns {Promise<Object>} Session object với questions
   */
  async createDailyTest(userId, tracker) {
    try {
      console.log(`[AssessmentAgent] Creating daily test for user ${userId}`);

      // Xác định domains yếu cần tập trung
      const weakDomains = this._identifyWeakDomains(tracker);
      const distribution = this._calculateDailyDistribution(weakDomains);

      // Lấy user profile để calibrate difficulty
      const user = await this.db.get('SELECT * FROM users WHERE id = ?', [userId]);
      const calibratedLevel = await this.difficultyCalibrator.calibrate(user, {
        tracker,
        weakDomains
      });

      // Tạo câu hỏi trong 1 call duy nhất để tối ưu tốc độ và tránh lỗi API Quota
      const weakDomainIds = distribution.map(d => d.domainId);
      const totalCount = distribution.reduce((sum, d) => sum + d.count, 0) || 15;
      const targetSubdomains = weakDomains.flatMap(d => {
        const dom = DOMAINS.find(dm => dm.id === (d.domain_id || d.id));
        return dom ? dom.subdomains : [];
      }).slice(0, 6);

      const allQuestions = await this.mcqGenerator.generate({
        domains: weakDomainIds.length > 0 ? weakDomainIds : ['cardiology', 'pulmonology'],
        domain: weakDomainIds[0] || 'cardiology',
        domainName: 'Chuyên khoa trọng tâm USMLE',
        subdomains: targetSubdomains,
        focusAreas: targetSubdomains,
        count: totalCount,
        difficulty: calibratedLevel?.difficulty || 3,
        bloomLevels: ['apply', 'analyze', 'evaluate'],
        context: `Bài kiểm tra hàng ngày (vòng lặp thích ứng USMLE Step 1 & 2), tập trung sâu vào các chuyên khoa yếu: ${weakDomainIds.join(', ')}. Mastery hiện tại đã được hiệu chỉnh.`,
        systemPrompt: this.systemPrompt
      });

      // Shuffle câu hỏi
      const shuffledQuestions = this._shuffleArray(allQuestions);

      // Tạo test session
      const session = await this._createTestSession({
        userId,
        type: 'daily',
        totalQuestions: shuffledQuestions.length,
        questions: shuffledQuestions
      });

      console.log(`[AssessmentAgent] Daily test created: session ${session.id}, ${shuffledQuestions.length} questions`);
      return session;
    } catch (error) {
      console.error('[AssessmentAgent] Error creating daily test:', error.message);
      throw new Error(`Không thể tạo bài kiểm tra hàng ngày: ${error.message}`);
    }
  }

  /**
   * Tạo bài kiểm tra ngẫu nhiên liên tục (AI Continuous Random Test).
   * Tạo 15 câu hỏi trong 1 lần gọi duy nhất với các domains và subdomains xáo trộn linh hoạt.
   */
  async createRandomTest(userId, tracker) {
    try {
      console.log(`[AssessmentAgent] Creating continuous random test for user ${userId}`);

      // Chọn ngẫu nhiên 4 - 5 domains trong tất cả DOMAINS để xoay vòng
      const shuffledDomains = this._shuffleArray(DOMAINS);
      const selectedDomains = shuffledDomains.slice(0, 5);
      const domainIds = selectedDomains.map(d => d.id);

      // Thu thập một số tiểu mục ngẫu nhiên để chỉ đạo AI
      const randomSubdomains = [];
      selectedDomains.forEach(d => {
        const subs = this._shuffleArray(d.subdomains || []).slice(0, 2);
        randomSubdomains.push(...subs);
      });

      // Lấy user để calibrate độ khó cơ bản
      const user = await this.db.get('SELECT * FROM users WHERE id = ?', [userId]);
      const baseDiff = user?.level === 'specialist' ? 4 : (user?.level === 'resident' ? 3 : 2);
      const randomSeed = Math.floor(Math.random() * 9999999);

      // Gọi 1 lần duy nhất tới AI để tạo 15 câu hỏi cực nhanh và linh hoạt
      const questions = await this.mcqGenerator.generate({
        domains: domainIds,
        domain: domainIds[0],
        count: 15,
        difficulty: baseDiff,
        bloomLevels: ['understand', 'apply', 'analyze', 'evaluate'],
        subdomains: randomSubdomains,
        focusAreas: randomSubdomains,
        context: `BÀI KIỂM TRA NGẪU NHIÊN LIÊN TỤC (Mã xoay vòng #${randomSeed}). YÊU CẦU ĐẶC BIỆT: Đây là bài test linh hoạt giúp làm phong phú toàn bộ bảng theo dõi (Tracker). Hãy tạo 15 câu hỏi xáo trộn giữa các chuyên khoa được yêu cầu (${selectedDomains.map(d => d.name).join(', ')}), với tình huống lâm sàng hoàn toàn bất ngờ, không trùng lặp, độ khó dao động linh hoạt từ 2 đến 5!`,
        systemPrompt: this.systemPrompt
      });

      const shuffledQuestions = this._shuffleArray(questions);

      const session = await this._createTestSession({
        userId,
        type: 'custom',
        totalQuestions: shuffledQuestions.length,
        questions: shuffledQuestions
      });

      console.log(`[AssessmentAgent] Continuous random test created: session ${session.id}, ${shuffledQuestions.length} questions`);
      return session;
    } catch (error) {
      console.error('[AssessmentAgent] Error creating random test:', error.message);
      throw new Error(`Không thể tạo bài kiểm tra ngẫu nhiên: ${error.message}`);
    }
  }

  /**
   * Tạo bài kiểm tra ôn tập từ SM-2 review queue.
   *
   * @param {string} userId - User ID
   * @param {Array<Object>} reviewQueue - Danh sách domains cần ôn tập từ SM-2
   * @returns {Promise<Object>} Session object với questions
   */
  async createReviewTest(userId, reviewQueue) {
    try {
      console.log(`[AssessmentAgent] Creating review test for user ${userId}, ${reviewQueue.length} domains in queue`);

      if (!reviewQueue || reviewQueue.length === 0) {
        console.log('[AssessmentAgent] No items in review queue');
        return null;
      }

      const user = await this.db.get('SELECT * FROM users WHERE id = ?', [userId]);

      // Phân bổ câu hỏi dựa trên review queue
      const questionsPerDomain = Math.max(2, Math.floor(12 / reviewQueue.length));
      const allQuestions = [];

      for (const reviewItem of reviewQueue) {
        const domain = DOMAINS.find(d => d.id === reviewItem.domain_id);
        if (!domain) continue;

        // Tăng difficulty nhẹ so với lần trước để thử thách
        const targetDifficulty = Math.min(10, (reviewItem.lastDifficulty || 5) + 1);

        const randomSubdomains = this._shuffleArray(domain.subdomains).slice(0, 3);
        const questions = await this.mcqGenerator.generate({
          domains: [reviewItem.domain_id],
          domain: reviewItem.domain_id,
          domainName: domain.name,
          subdomains: randomSubdomains,
          focusAreas: randomSubdomains,
          count: questionsPerDomain,
          difficulty: targetDifficulty,
          bloomLevels: this._getReviewBloomLevels(reviewItem),
          context: `Bài ôn tập SM-2, lần ôn thứ ${reviewItem.repetition || 1}. EF: ${reviewItem.easiness_factor || 2.5}. Tập trung vào: ${randomSubdomains.join(', ')}`,
          systemPrompt: this.systemPrompt
        });
        allQuestions.push(...questions);
      }

      const session = await this._createTestSession({
        userId,
        type: 'review',
        totalQuestions: allQuestions.length,
        questions: this._shuffleArray(allQuestions)
      });

      console.log(`[AssessmentAgent] Review test created: session ${session.id}, ${allQuestions.length} questions`);
      return session;
    } catch (error) {
      console.error('[AssessmentAgent] Error creating review test:', error.message);
      throw new Error(`Không thể tạo bài ôn tập: ${error.message}`);
    }
  }

  /**
   * Chấm điểm và phân tích bài làm.
   *
   * @param {string} sessionId - Test session ID
   * @param {Array<Object>} answers - Danh sách câu trả lời
   * @param {string} answers[].questionId - Question ID
   * @param {string} answers[].userAnswer - Đáp án user chọn (A/B/C/D)
   * @param {number} answers[].timeSpent - Thời gian trả lời (giây)
   * @returns {Promise<Object>} Kết quả đánh giá chi tiết
   */
  async evaluateAnswers(sessionId, answers) {
    try {
      console.log(`[AssessmentAgent] Evaluating answers for session ${sessionId}`);

      // Lấy session và questions từ DB
      const session = await this.db.get('SELECT * FROM test_sessions WHERE id = ?', [sessionId]);
      if (!session) {
        throw new Error(`Không tìm thấy session ${sessionId}`);
      }

      const questions = await this.db.all(
        'SELECT * FROM test_questions WHERE session_id = ?',
        [sessionId]
      );

      // Chấm từng câu
      let correctCount = 0;
      const domainResults = {};
      const answerDetails = [];

      for (const answer of answers) {
        // Normalize field names from frontend (question_id/answer) vs legacy (questionId/userAnswer)
        const qId = answer.question_id || answer.questionId;
        const userAnswer = answer.answer !== undefined ? String(answer.answer) : (answer.userAnswer !== undefined ? String(answer.userAnswer) : '-1');
        const timeSpent = answer.time_spent || answer.timeSpent || 0;

        const question = questions.find(q => String(q.id) === String(qId));
        if (!question) continue;

        // Normalize comparison: both sides to string for reliable matching
        const isCorrect = String(userAnswer) === String(question.correct_answer);
        if (isCorrect) correctCount++;

        // Lưu kết quả vào DB (bao gồm user_id theo schema)
        try {
          this.db.run(
            `INSERT INTO test_answers (question_id, session_id, user_id, user_answer, is_correct, time_spent)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [qId, sessionId, session.user_id, userAnswer, isCorrect ? 1 : 0, timeSpent]
          );
        } catch (dbErr) {
          console.warn(`[AssessmentAgent] Lỗi lưu answer cho question ${qId}:`, dbErr.message);
        }

        // Tổng hợp theo domain
        const domainId = question.domain_id;
        if (!domainResults[domainId]) {
          domainResults[domainId] = {
            domain_id: domainId,
            total: 0,
            correct: 0,
            bloom_results: {},
            total_time: 0,
            questions: []
          };
        }
        domainResults[domainId].total++;
        if (isCorrect) domainResults[domainId].correct++;
        domainResults[domainId].total_time += timeSpent;

        // Tổng hợp theo bloom level
        const bloomLevel = question.bloom_level || 'apply';
        if (!domainResults[domainId].bloom_results[bloomLevel]) {
          domainResults[domainId].bloom_results[bloomLevel] = { total: 0, correct: 0 };
        }
        domainResults[domainId].bloom_results[bloomLevel].total++;
        if (isCorrect) domainResults[domainId].bloom_results[bloomLevel].correct++;

        domainResults[domainId].questions.push({
          questionId: question.id,
          bloomLevel,
          difficulty: question.difficulty,
          isCorrect,
          timeSpent
        });

        answerDetails.push({
          questionId: question.id,
          domainId,
          bloomLevel,
          difficulty: question.difficulty,
          isCorrect,
          userAnswer,
          correctAnswer: question.correct_answer,
          timeSpent
        });
      }

      // Tính weighted scores
      const domainScores = Object.values(domainResults).map(dr => {
        let weightedCorrect = 0;
        let totalWeight = 0;
        for (const [level, result] of Object.entries(dr.bloom_results)) {
          const weight = BLOOM_LEVELS[level]?.weight || 1.0;
          weightedCorrect += result.correct * weight;
          totalWeight += result.total * weight;
        }
        return {
          ...dr,
          score: dr.total > 0 ? Math.round((dr.correct / dr.total) * 100) : 0,
          weighted_score: totalWeight > 0 ? Math.round((weightedCorrect / totalWeight) * 100) : 0,
          avg_time: dr.total > 0 ? Math.round(dr.total_time / dr.total) : 0
        };
      });

      // Tính tổng điểm
      const overallScore = answers.length > 0
        ? Math.round((correctCount / answers.length) * 100)
        : 0;

      // Update session trong DB
      await this.db.run(
        `UPDATE test_sessions SET correct_count = ?, score = ? WHERE id = ?`,
        [correctCount, overallScore, sessionId]
      );

      // Sử dụng Claude để phân tích sâu
      const analysisResponse = await this.claude.messages.create({
        model: this.model,
        max_tokens: 2000,
        system: this.systemPrompt,
        messages: [{
          role: 'user',
          content: `Phân tích kết quả bài kiểm tra sau và đưa ra nhận xét ngắn gọn bằng tiếng Việt.

Loại bài kiểm tra: ${session.type}
Tổng điểm: ${overallScore}% (${correctCount}/${answers.length})

Kết quả theo domain:
${JSON.stringify(domainScores, null, 2)}

Hãy trả về JSON với format:
{
  "summary": "string (nhận xét tổng thể)",
  "strong_domains": ["string (tên domain mạnh)"],
  "weak_domains": ["string (tên domain yếu)"],
  "bloom_analysis": "string (nhận xét về tư duy)",
  "recommendations": ["string (khuyến nghị)"]
}`
        }]
      });

      let aiAnalysis = {};
      try {
        const content = analysisResponse.content[0].text;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          aiAnalysis = JSON.parse(jsonMatch[0]);
        }
      } catch (parseErr) {
        console.warn('[AssessmentAgent] Could not parse AI analysis:', parseErr.message);
        aiAnalysis = { summary: 'Phân tích đang được cập nhật.' };
      }

      const result = {
        sessionId,
        type: session.type,
        overallScore,
        correctCount,
        totalQuestions: answers.length,
        domainScores,
        answerDetails,
        aiAnalysis,
        completedAt: new Date().toISOString()
      };

      console.log(`[AssessmentAgent] Evaluation complete: ${overallScore}% (${correctCount}/${answers.length})`);
      return result;
    } catch (error) {
      console.error('[AssessmentAgent] Error evaluating answers:', error.message);
      throw new Error(`Không thể đánh giá bài làm: ${error.message}`);
    }
  }

  // ===================== PRIVATE METHODS =====================

  /**
   * Phân bổ câu hỏi cho bài kiểm tra chẩn đoán (40 câu)
   * @private
   * @returns {Array<Object>} Distribution plan
   */
  _calculateDiagnosticDistribution() {
    // Phân bổ 40 câu hỏi chẩn đoán theo chuẩn USMLE Step 1 (16 câu) & Step 2 CK (24 câu)
    const weights = {
      // Step 2 CK - Clinical Specialties (24 câu)
      internal: 6,
      surgery: 4,
      obgyn: 3,
      pediatrics: 3,
      emergency: 4,
      psychiatry: 4,
      // Step 1 - Foundational Sciences (16 câu)
      pathology: 3,
      pharmacology: 3,
      physiology: 3,
      microbiology: 3,
      biochemistry: 2,
      community: 1,
      diagnostics: 1
    };

    return Object.entries(weights).map(([domainId, count]) => ({
      domainId,
      count
    }));
  }

  /**
   * Xác định domains yếu từ tracker với trọng số độ tự tin USMLE
   * @private
   * @param {Array<Object>} tracker
   * @returns {Array<Object>} Sorted weak domains
   */
  _identifyWeakDomains(tracker) {
    if (!tracker || tracker.length === 0) return DOMAINS.map(d => ({ domainId: d.id, score: 0 }));

    return tracker
      .map(t => {
        // Nếu độ tự tin thấp hoặc chưa từng test, giảm điểm để ưu tiên xuất hiện trước
        let effectiveScore = t.score || 0;
        if (t.confidence === 'low' || !t.last_tested) effectiveScore -= 15;
        return {
          domainId: t.domain_id,
          score: effectiveScore,
          rawScore: t.score || 0,
          bloomLevel: t.bloom_level,
          masteryLevel: t.mastery_level
        };
      })
      .sort((a, b) => a.score - b.score);
  }

  /**
   * Phân bổ câu hỏi cho bài kiểm tra hàng ngày (12 câu - USMLE Blended Strategy)
   * Trộn 50% câu hỏi lâm sàng Step 2 CK vùng yếu + 25% khoa học cơ bản Step 1 bổ trợ + 25% ôn tập rộng
   * @private
   * @param {Array<Object>} weakDomains
   * @returns {Array<Object>} Distribution plan
   */
  _calculateDailyDistribution(weakDomains) {
    const distribution = [];
    const totalQuestions = 12;

    // 1. Chọn 2 domains yếu nhất làm trọng tâm lâm sàng (6 câu - 50%)
    const weakCount = Math.min(2, weakDomains.length);
    const weakQuestions = Math.floor(totalQuestions * 0.5);
    const questionsPerWeak = Math.floor(weakQuestions / Math.max(1, weakCount));

    for (let i = 0; i < weakCount; i++) {
      distribution.push({
        domainId: weakDomains[i].domainId,
        count: questionsPerWeak,
        targetBloom: this._getTargetBloom(weakDomains[i]),
        targetDifficulty: this._getTargetDifficulty(weakDomains[i])
      });
    }

    // 2. Trộn đề Khoa học Cơ bản Step 1 bổ trợ cho vùng yếu lâm sàng (3 câu - 25%)
    // (Ví dụ: Nếu yếu Tim mạch Nội khoa, kiểm tra kèm Dược lý lâm sàng & Sinh lý bệnh)
    const step1SupportDomains = ['pharmacology', 'pathology', 'physiology', 'microbiology'];
    const selectedStep1 = this._shuffleArray(step1SupportDomains).slice(0, 2);
    selectedStep1.forEach(step1Id => {
      distribution.push({
        domainId: step1Id,
        count: 1, // 1-2 câu Step 1
        targetBloom: ['analyze', 'evaluate'],
        targetDifficulty: 3
      });
    });

    // 3. Phân bổ câu hỏi còn lại xoay vòng ngẫu nhiên cho CÁC DOMAINS KHÁC (25%)
    const currentDistributed = distribution.reduce((sum, d) => sum + d.count, 0);
    const remainingQuestions = totalQuestions - currentDistributed;
    const otherDomains = this._shuffleArray(weakDomains.slice(weakCount));
    
    if (otherDomains.length > 0 && remainingQuestions > 0) {
      const perOther = Math.max(1, Math.floor(remainingQuestions / Math.min(otherDomains.length, remainingQuestions)));
      let remaining = remainingQuestions;
      for (const od of otherDomains) {
        if (remaining <= 0) break;
        const count = Math.min(perOther, remaining);
        distribution.push({
          domainId: od.domainId,
          count,
          targetBloom: this._getTargetBloom(od),
          targetDifficulty: this._getTargetDifficulty(od)
        });
        remaining -= count;
      }
    }

    return distribution;
  }

  /**
   * Xác định Bloom levels phù hợp cho review
   * @private
   * @param {Object} reviewItem
   * @returns {Array<string>}
   */
  _getReviewBloomLevels(reviewItem) {
    const currentBloom = reviewItem.bloom_level || 'remember';
    const levels = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];
    const currentIndex = levels.indexOf(currentBloom);
    // Review ở level hiện tại và level trên
    return levels.slice(Math.max(0, currentIndex), Math.min(levels.length, currentIndex + 2));
  }

  /**
   * Xác định target Bloom levels cho domain yếu
   * @private
   * @param {Object} domainData
   * @returns {Array<string>}
   */
  _getTargetBloom(domainData) {
    if (!domainData.bloomLevel || domainData.score < 40) {
      return ['remember', 'understand'];
    } else if (domainData.score < 60) {
      return ['understand', 'apply'];
    } else if (domainData.score < 80) {
      return ['apply', 'analyze'];
    }
    return ['analyze', 'evaluate'];
  }

  /**
   * Xác định target difficulty cho domain
   * @private
   * @param {Object} domainData
   * @returns {number}
   */
  _getTargetDifficulty(domainData) {
    if (domainData.score < 40) return 3;
    if (domainData.score < 60) return 5;
    if (domainData.score < 80) return 7;
    return 8;
  }

  /**
   * Tạo test session và lưu questions vào DB
   * @private
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async _createTestSession({ userId, type, totalQuestions, questions }) {
    const { v4: uuidv4 } = require('uuid');
    const sessionId = uuidv4();

    this.db.run(
      `INSERT INTO test_sessions (id, user_id, type, total_questions, correct_count, score, created_at)
       VALUES (?, ?, ?, ?, 0, 0, datetime('now'))`,
      [sessionId, userId, type, totalQuestions]
    );

    // Lưu từng question với UUID riêng
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const questionId = uuidv4();
      this.db.run(
        `INSERT INTO test_questions (id, session_id, domain_id, question_text, options, correct_answer, bloom_level, difficulty, order_index)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          questionId,
          sessionId,
          q.domain_id || q.domain || 'internal',
          q.stem || q.question_text || q.text || 'Câu hỏi',
          JSON.stringify(q.options || []),
          typeof q.correct_answer !== 'undefined' ? String(q.correct_answer) : '0',
          q.bloom_level || 'apply',
          q.difficulty || 3,
          i
        ]
      );
      // Gán ID vào question object để trả về cho frontend
      q.id = questionId;
    }

    return {
      id: sessionId,
      session_id: sessionId,
      userId,
      type,
      totalQuestions,
      questions: questions.map((q, i) => ({
        id: q.id,
        domain: q.domain_id || q.domain || 'internal',
        domain_id: q.domain_id || q.domain || 'internal',
        text: q.stem || q.question_text || q.text || 'Câu hỏi',
        vignette: q.clinical_vignette || q.vignette || '',
        options: q.options || [],
        correct: typeof q.correct_answer !== 'undefined' ? q.correct_answer : 0,
        difficulty: q.difficulty || 3,
        bloom_level: q.bloom_level || 'apply',
        order: i
      })),
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Shuffle mảng (Fisher-Yates algorithm)
   * @private
   * @param {Array} array
   * @returns {Array}
   */
  _shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
}

module.exports = AssessmentAgent;
