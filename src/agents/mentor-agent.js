'use strict';

const fs = require('fs');
const path = require('path');

/**
 * @fileoverview MentorAgent - Agent hướng dẫn lâm sàng theo phương pháp Socratic.
 * Dẫn dắt sinh viên qua các ca lâm sàng tương tác, phát triển tư duy lâm sàng,
 * và cung cấp feedback chi tiết.
 */

class MentorAgent {
  /**
   * Khởi tạo MentorAgent
   * @param {Object} params
   * @param {import('@anthropic-ai/sdk').default} params.claudeClient - Claude API client
   * @param {string} params.model - Model identifier
   * @param {Object} params.db - Database connection
   * @param {Object} params.skills - Skill instances
   * @param {import('../skills/case-simulator')} params.skills.caseSimulator - Case simulation skill
   * @param {import('../skills/knowledge-retriever')} params.skills.knowledgeRetriever - Knowledge retrieval
   * @param {import('../skills/lesson-composer')} params.skills.lessonComposer - Lesson composition skill
   */
  constructor({ claudeClient, model, db, skills: { caseSimulator, knowledgeRetriever, lessonComposer } }) {
    this.claude = claudeClient;
    this.model = model;
    this.db = db;
    this.caseSimulator = caseSimulator;
    this.knowledgeRetriever = knowledgeRetriever;
    this.lessonComposer = lessonComposer;

    // Load system prompt
    const promptPath = path.join(__dirname, '..', 'prompts', 'mentor.md');
    this.systemPrompt = fs.readFileSync(promptPath, 'utf-8');

    /**
     * In-memory store for active case sessions.
     * In production, move this to a persistent store (Redis, DB, etc.).
     * @type {Map<string, Object>}
     */
    this.activeSessions = new Map();

    console.log('[MentorAgent] Initialized successfully');
  }

  /**
   * Bắt đầu phiên case lâm sàng tương tác.
   *
   * @param {string} userId - User ID
   * @param {string} domain - Domain ID
   * @param {number} difficulty - Độ khó (1-10)
   * @returns {Promise<Object>} Case session với initial presentation
   */
  async startCaseSession(userId, domain, difficulty) {
    try {
      console.log(`[MentorAgent] Starting case session for user ${userId}, domain: ${domain}, difficulty: ${difficulty}`);

      // Generate the case
      const caseData = await this.caseSimulator.simulate(domain, difficulty);

      // Get relevant medical knowledge for richer context
      const knowledge = await this.knowledgeRetriever.retrieve(
        `${domain} clinical case ${caseData?.diagnosis || ''}`
      );

      // Create session ID
      const sessionId = `case_${userId}_${Date.now()}`;

      // Use Claude to create the Socratic opening
      const response = await this.claude.messages.create({
        model: this.model,
        max_tokens: 2000,
        system: this.systemPrompt,
        messages: [{
          role: 'user',
          content: `Bắt đầu một ca lâm sàng tương tác theo phương pháp Socratic.
Chỉ trình bày GIAI ĐOẠN 1 (Tiếp nhận bệnh nhân). Đợi người học phản hồi trước khi tiếp tục.

Case data:
${JSON.stringify(caseData, null, 2)}

Kiến thức bổ sung:
${JSON.stringify(knowledge, null, 2)}

Trả về JSON:
{
  "stage": "intake",
  "content": "string (markdown formatted - phần trình bày bệnh nhân ban đầu, bao gồm lý do nhập viện, thông tin cơ bản)",
  "socratic_questions": ["string (2-3 câu hỏi gợi mở cho người học)"],
  "hints": ["string (3 gợi ý từ dễ đến khó, KHÔNG hiển thị ngay)"],
  "expected_answers": ["string (đáp án mong đợi, KHÔNG hiển thị cho người học)"],
  "key_concepts": ["string (khái niệm liên quan)"],
  "next_stage_trigger": "string (điều kiện để chuyển sang giai đoạn tiếp)"
}`
        }]
      });

      let presentation = {};
      try {
        const content = response.content[0].text;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          presentation = JSON.parse(jsonMatch[0]);
        }
      } catch (parseErr) {
        console.warn('[MentorAgent] Could not parse presentation JSON:', parseErr.message);
        presentation = {
          stage: 'intake',
          content: response.content[0].text,
          socratic_questions: ['Em nghĩ bệnh nhân này có thể mắc bệnh gì?'],
          hints: [],
          expected_answers: []
        };
      }

      // Store session data
      const sessionData = {
        sessionId,
        userId,
        domain,
        difficulty,
        caseData,
        knowledge,
        currentStage: 'intake',
        stageIndex: 0,
        stages: ['intake', 'examination', 'investigation', 'treatment', 'summary'],
        conversation: [
          { role: 'system', content: JSON.stringify(presentation), stage: 'intake' }
        ],
        hintsUsed: 0,
        score: { correct: 0, total: 0, reasoning: 0 },
        startedAt: new Date().toISOString()
      };

      this.activeSessions.set(sessionId, sessionData);

      console.log(`[MentorAgent] Case session started: ${sessionId}`);

      // Return only student-visible content
      return {
        sessionId,
        stage: presentation.stage,
        content: presentation.content,
        questions: presentation.socratic_questions,
        keyConceptsCount: presentation.key_concepts?.length || 0,
        totalStages: sessionData.stages.length,
        currentStageIndex: 0
      };
    } catch (error) {
      console.error('[MentorAgent] Error starting case session:', error.message);
      throw new Error(`Không thể bắt đầu ca lâm sàng: ${error.message}`);
    }
  }

  /**
   * Xử lý phản hồi của người học trong phiên case.
   *
   * @param {string} sessionId - Session ID
   * @param {string} userResponse - Câu trả lời/nhận xét của người học
   * @returns {Promise<Object>} Mentor's response
   */
  async processResponse(sessionId, userResponse) {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        throw new Error(`Không tìm thấy session: ${sessionId}`);
      }

      console.log(`[MentorAgent] Processing response for session ${sessionId}, stage: ${session.currentStage}`);

      // Add user response to conversation
      session.conversation.push({
        role: 'user',
        content: userResponse,
        stage: session.currentStage,
        timestamp: new Date().toISOString()
      });

      // Build conversation history for context
      const conversationContext = session.conversation.map(msg => {
        if (msg.role === 'system') {
          try {
            const parsed = JSON.parse(msg.content);
            return { role: 'assistant', content: parsed.content || msg.content };
          } catch {
            return { role: 'assistant', content: msg.content };
          }
        }
        return { role: msg.role, content: msg.content };
      });

      // Use Claude to generate Socratic response
      const response = await this.claude.messages.create({
        model: this.model,
        max_tokens: 2500,
        system: `${this.systemPrompt}\n\n--- CASE DATA (HIDDEN FROM STUDENT) ---\n${JSON.stringify(session.caseData, null, 2)}\n\nCurrent stage: ${session.currentStage}\nStage index: ${session.stageIndex} / ${session.stages.length - 1}\nHints used so far: ${session.hintsUsed}`,
        messages: [
          ...conversationContext,
          {
            role: 'user',
            content: `Người học vừa trả lời: "${userResponse}"

Hãy phản hồi theo phương pháp Socratic:
1. Đánh giá câu trả lời (đúng/sai/đúng một phần)
2. Nếu đúng: khen + bổ sung + hỏi câu tiếp hoặc chuyển giai đoạn
3. Nếu sai: gợi mở nhẹ nhàng (không cho đáp án trực tiếp)
4. Nếu nên chuyển sang giai đoạn tiếp: set should_advance = true

Trả về JSON:
{
  "evaluation": "correct|partially_correct|incorrect|needs_clarification",
  "response_content": "string (markdown - phản hồi Socratic)",
  "follow_up_questions": ["string (câu hỏi tiếp theo)"],
  "hints": ["string (gợi ý nếu cần)"],
  "should_advance": boolean,
  "next_stage": "string (nếu should_advance = true)",
  "new_information": "string (thông tin mới cung cấp nếu chuyển giai đoạn)",
  "reasoning_score": 0-10,
  "key_learning_point": "string (điểm học chính từ tương tác này)",
  "clinical_pearl": "string (Ngọc lâm sàng USMLE rút ra từ bước này)"
}`
          }
        ]
      });

      let mentorResponse = {};
      try {
        const content = response.content[0].text;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          mentorResponse = JSON.parse(jsonMatch[0]);
        }
      } catch (parseErr) {
        console.warn('[MentorAgent] Could not parse response JSON:', parseErr.message);
        mentorResponse = {
          evaluation: 'needs_clarification',
          response_content: response.content[0].text,
          follow_up_questions: ['Em có thể giải thích thêm không?'],
          should_advance: false,
          reasoning_score: 5
        };
      }

      // Update session state
      session.score.total++;
      if (mentorResponse.evaluation === 'correct') session.score.correct++;
      session.score.reasoning += mentorResponse.reasoning_score || 0;

      // Add mentor response to conversation
      session.conversation.push({
        role: 'system',
        content: JSON.stringify(mentorResponse),
        stage: session.currentStage,
        timestamp: new Date().toISOString()
      });

      // Advance stage if needed
      if (mentorResponse.should_advance) {
        session.stageIndex++;
        session.currentStage = session.stages[session.stageIndex] || 'summary';
        console.log(`[MentorAgent] Advancing to stage: ${session.currentStage}`);
      }

      // Check if case is complete
      const isComplete = session.currentStage === 'summary' || session.stageIndex >= session.stages.length - 1;

      this.activeSessions.set(sessionId, session);

      return {
        sessionId,
        evaluation: mentorResponse.evaluation,
        content: mentorResponse.response_content,
        questions: mentorResponse.follow_up_questions,
        newInformation: mentorResponse.new_information || null,
        clinicalPearl: mentorResponse.clinical_pearl || null,
        currentStage: session.currentStage,
        currentStageIndex: session.stageIndex,
        totalStages: session.stages.length,
        isComplete,
        learningPoint: mentorResponse.key_learning_point
      };
    } catch (error) {
      console.error('[MentorAgent] Error processing response:', error.message);
      throw new Error(`Không thể xử lý phản hồi: ${error.message}`);
    }
  }

  /**
   * Cung cấp gợi ý Socratic progressive (3 cấp độ) khi học viên yêu cầu hỗ trợ.
   *
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object>} Gợi ý Socratic theo cấp độ
   */
  async getHint(sessionId) {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        throw new Error(`Không tìm thấy session: ${sessionId}`);
      }

      session.hintsUsed = (session.hintsUsed || 0) + 1;
      const currentLevel = Math.min(3, session.hintsUsed);
      const hintTypes = {
        1: 'Bậc 1 (Gợi ý Sinh lý bệnh/Giải phẫu - Step 1 Foundation)',
        2: 'Bậc 2 (Gợi ý Chẩn đoán phân biệt VINDICATE / Loại trừ đáp án sai)',
        3: 'Bậc 3 (Gợi ý Tiêu chuẩn vàng / Phác đồ chuẩn AHA/GOLD/IDSA)'
      };

      console.log(`[MentorAgent] Providing progressive hint level ${currentLevel} for session ${sessionId}`);

      // Kiểm tra nếu tin nhắn system gần nhất đã có sẵn gợi ý
      const lastSystemMsg = [...session.conversation].reverse().find(m => m.role === 'system');
      if (lastSystemMsg) {
        try {
          const parsed = JSON.parse(lastSystemMsg.content);
          if (parsed.hints && parsed.hints[currentLevel - 1]) {
            return {
              sessionId,
              hintLevel: currentLevel,
              hintType: hintTypes[currentLevel],
              hintContent: parsed.hints[currentLevel - 1],
              totalHintsUsed: session.hintsUsed
            };
          }
        } catch { /* ignore */ }
      }

      // Nếu chưa có sẵn, dùng AI tạo gợi ý theo đúng cấp độ
      const response = await this.claude.messages.create({
        model: this.model,
        max_tokens: 500,
        system: this.systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Tạo một gợi ý Socratic ${hintTypes[currentLevel]} bằng tiếng Việt cho giai đoạn "${session.currentStage}" của ca bệnh:\n\nCase data: ${JSON.stringify(session.caseData)}\n\nChỉ trả về chuỗi gợi ý ngắn gọn (không nói đáp án trực tiếp).`
          }
        ]
      });

      const generatedHint = response.content[0].text;
      return {
        sessionId,
        hintLevel: currentLevel,
        hintType: hintTypes[currentLevel],
        hintContent: generatedHint,
        totalHintsUsed: session.hintsUsed
      };
    } catch (error) {
      console.error('[MentorAgent] Error providing hint:', error.message);
      throw new Error(`Không thể tạo gợi ý: ${error.message}`);
    }
  }

  /**
   * Cung cấp feedback chi tiết cuối phiên case.
   *
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object>} Feedback chi tiết
   */
  async provideFeedback(sessionId) {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        throw new Error(`Không tìm thấy session: ${sessionId}`);
      }

      console.log(`[MentorAgent] Providing feedback for session ${sessionId}`);

      // Compile all learning points from the conversation
      const learningPoints = session.conversation
        .filter(msg => msg.role === 'system')
        .map(msg => {
          try {
            const parsed = JSON.parse(msg.content);
            return parsed.key_learning_point;
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      // Calculate performance metrics
      const accuracy = session.score.total > 0
        ? Math.round((session.score.correct / session.score.total) * 100)
        : 0;
      const avgReasoning = session.score.total > 0
        ? Math.round(session.score.reasoning / session.score.total)
        : 0;

      // Generate comprehensive feedback with Claude
      const response = await this.claude.messages.create({
        model: this.model,
        max_tokens: 3000,
        system: this.systemPrompt,
        messages: [{
          role: 'user',
          content: `Tạo feedback tổng kết cho ca lâm sàng đã hoàn thành. Trả về JSON.

Domain: ${session.domain}
Difficulty: ${session.difficulty}/10
Accuracy: ${accuracy}% (${session.score.correct}/${session.score.total})
Average reasoning score: ${avgReasoning}/10
Hints used: ${session.hintsUsed}

Learning points đã thu thập:
${JSON.stringify(learningPoints, null, 2)}

Case data (chẩn đoán đúng):
${JSON.stringify(session.caseData, null, 2)}

Trả về JSON:
{
  "overall_grade": "A|B|C|D|F",
  "summary": "string (nhận xét tổng thể performance)",
  "clinical_reasoning_feedback": "string (nhận xét về tư duy lâm sàng)",
  "strengths": ["string (những điểm làm tốt)"],
  "areas_to_improve": ["string (điểm cần cải thiện)"],
  "key_takeaways": ["string (5-7 bài học chính)"],
  "clinical_pearls": ["string (3-5 pearls thực tế)"],
  "pitfalls_discussed": ["string (sai lầm cần tránh)"],
  "recommended_review": ["string (chủ đề nên ôn thêm)"],
  "encouragement": "string (lời khích lệ)",
  "next_case_suggestion": {
    "domain": "string",
    "difficulty": number,
    "focus": "string"
  }
}`
        }]
      });

      let feedback = {};
      try {
        const content = response.content[0].text;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          feedback = JSON.parse(jsonMatch[0]);
        }
      } catch (parseErr) {
        console.warn('[MentorAgent] Could not parse feedback JSON:', parseErr.message);
        feedback = {
          overall_grade: accuracy >= 80 ? 'A' : accuracy >= 60 ? 'B' : accuracy >= 40 ? 'C' : 'D',
          summary: `Accuracy: ${accuracy}%, reasoning: ${avgReasoning}/10`,
          key_takeaways: learningPoints,
          encouragement: 'Tiếp tục cố gắng!'
        };
      }

      // Add metrics to feedback
      feedback.metrics = {
        accuracy,
        avgReasoningScore: avgReasoning,
        hintsUsed: session.hintsUsed,
        totalInteractions: session.score.total,
        duration: this._calculateDuration(session.startedAt),
        domain: session.domain,
        difficulty: session.difficulty
      };

      // Cleanup session (or archive)
      this.activeSessions.delete(sessionId);

      console.log(`[MentorAgent] Feedback provided: grade ${feedback.overall_grade}, accuracy ${accuracy}%`);
      return feedback;
    } catch (error) {
      console.error('[MentorAgent] Error providing feedback:', error.message);
      throw new Error(`Không thể tạo feedback: ${error.message}`);
    }
  }

  // ===================== PRIVATE METHODS =====================

  /**
   * Tính thời gian phiên (phút)
   * @private
   * @param {string} startedAt - ISO timestamp
   * @returns {number} Duration in minutes
   */
  _calculateDuration(startedAt) {
    const start = new Date(startedAt);
    const now = new Date();
    return Math.round((now - start) / (1000 * 60));
  }
}

module.exports = MentorAgent;
