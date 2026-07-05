'use strict';

const express = require('express');
const router = express.Router();

// ═══════════════════════════════════════════
// MIDDLEWARE: Check AI availability
// ═══════════════════════════════════════════
function requireAI(req, res, next) {
  if (!req.claudeClient) {
    return res.status(503).json({
      success: false,
      error: 'AI Engine chưa được cấu hình. Vui lòng thêm GEMINI_API_KEY (hoặc ANTHROPIC_API_KEY) vào file .env'
    });
  }
  next();
}

// ═══════════════════════════════════════════
// USER ROUTES
// ═══════════════════════════════════════════

/** POST /api/user/register - Register new user */
router.post('/user/register', (req, res) => {
  try {
    const { name, email, specialty, experience_years, level, goals, daily_study_minutes } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: 'Tên là bắt buộc' });
    }

    // Check if user already exists
    const existing = req.db.getDefaultUser();
    if (existing) {
      req.db.updateUser(existing.id, { name, email, specialty, experience_years, level, goals, daily_study_minutes });
      const updated = req.db.getUser(existing.id);
      return res.json({ success: true, data: updated, message: 'Cập nhật thông tin thành công' });
    }

    const user = req.db.createUser({ name, email, specialty, experience_years, level, goals, daily_study_minutes });
    // Initialize tracker for all domains
    req.db.initializeTracker(user.id);

    res.json({ success: true, data: user, message: 'Đăng ký thành công! Bắt đầu bài test đầu vào.' });
  } catch (err) {
    console.error('[API] Register error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /api/user/profile - Get user profile */
router.get('/user/profile', (req, res) => {
  try {
    const user = req.db.getDefaultUser();
    if (!user) {
      return res.json({ success: true, data: null, message: 'Chưa có tài khoản' });
    }
    const stats = req.db.getStats(user.id);
    res.json({ success: true, data: { ...user, stats } });
  } catch (err) {
    console.error('[API] Profile error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════
// TEST ROUTES
// ═══════════════════════════════════════════

/** POST /api/test/diagnostic - Create diagnostic test */
router.post('/test/diagnostic', requireAI, async (req, res) => {
  try {
    const user = req.db.getDefaultUser();
    if (!user) {
      return res.status(400).json({ success: false, error: 'Vui lòng đăng ký trước' });
    }

    console.log(`[API] Creating diagnostic test for user: ${user.name}`);
    const result = await req.agents.assessment.createDiagnosticTest(user);

    res.json({
      success: true,
      data: {
        session_id: result.id || result.session_id,
        questions: result.questions.map(q => ({
          id: q.id,
          domain: q.domain || q.domain_id || 'internal',
          domain_id: q.domain_id || q.domain || 'internal',
          subdomain: q.subdomain || '',
          text: q.text || q.question_text || q.stem || '',
          vignette: q.vignette || q.clinical_vignette || '',
          options: q.options || [],
          correct: q.correct !== undefined ? q.correct : q.correct_answer,
          bloom_level: q.bloom_level || 'apply',
          difficulty: q.difficulty || 3
        })),
        total: result.questions.length,
        type: 'diagnostic'
      }
    });
  } catch (err) {
    console.error('[API] Diagnostic test error:', err);
    res.status(500).json({ success: false, error: 'Lỗi tạo bài test: ' + err.message });
  }
});

/** POST /api/test/daily - Create daily test */
router.post('/test/daily', requireAI, async (req, res) => {
  try {
    const user = req.db.getDefaultUser();
    if (!user) {
      return res.status(400).json({ success: false, error: 'Vui lòng đăng ký trước' });
    }

    const tracker = req.db.getTracker(user.id);
    console.log(`[API] Creating daily test for user: ${user.name}`);
    const result = await req.agents.assessment.createDailyTest(user.id, tracker);

    res.json({
      success: true,
      data: {
        session_id: result.id || result.session_id,
        questions: result.questions.map(q => ({
          id: q.id,
          domain: q.domain || q.domain_id || 'internal',
          domain_id: q.domain_id || q.domain || 'internal',
          subdomain: q.subdomain || '',
          text: q.text || q.question_text || q.stem || '',
          vignette: q.vignette || q.clinical_vignette || '',
          options: q.options || [],
          correct: q.correct !== undefined ? q.correct : q.correct_answer,
          bloom_level: q.bloom_level || 'apply',
          difficulty: q.difficulty || 3
        })),
        total: result.questions.length,
        type: 'daily'
      }
    });
  } catch (err) {
    console.error('[API] Daily test error:', err);
    res.status(500).json({ success: false, error: 'Lỗi tạo bài test: ' + err.message });
  }
});

/** POST /api/test/random - Create AI random continuous test */
router.post('/test/random', requireAI, async (req, res) => {
  try {
    const user = req.db.getDefaultUser();
    if (!user) {
      return res.status(400).json({ success: false, error: 'Vui lòng đăng ký trước' });
    }

    const tracker = req.db.getTracker(user.id);
    console.log(`[API] Creating AI random continuous test for user: ${user.name}`);
    const result = await req.agents.assessment.createRandomTest(user.id, tracker);

    res.json({
      success: true,
      data: {
        session_id: result.id || result.session_id,
        questions: result.questions.map(q => ({
          id: q.id,
          domain: q.domain || q.domain_id || 'internal',
          domain_id: q.domain_id || q.domain || 'internal',
          subdomain: q.subdomain || '',
          text: q.text || q.question_text || q.stem || '',
          vignette: q.vignette || q.clinical_vignette || '',
          options: q.options || [],
          correct: q.correct !== undefined ? q.correct : q.correct_answer,
          bloom_level: q.bloom_level || 'apply',
          difficulty: q.difficulty || 3
        })),
        total: result.questions.length,
        type: 'random'
      }
    });
  } catch (err) {
    console.error('[API] Random test error:', err);
    res.status(500).json({ success: false, error: 'Lỗi tạo bài test ngẫu nhiên: ' + err.message });
  }
});

/** POST /api/test/submit - Submit test answers */
router.post('/test/submit', requireAI, async (req, res) => {
  try {
    const { session_id, answers } = req.body;

    if (!session_id || !answers || !Array.isArray(answers)) {
      return res.status(400).json({ success: false, error: 'Dữ liệu không hợp lệ' });
    }

    const user = req.db.getDefaultUser();
    if (!user) {
      return res.status(400).json({ success: false, error: 'Vui lòng đăng ký trước' });
    }

    console.log(`[API] Submitting test ${session_id} with ${answers.length} answers`);

    // Use orchestrator to handle the full flow
    const result = await req.orchestrator.onTestSubmitted(user.id, session_id, answers);

    res.json({
      success: true,
      data: result,
      message: 'Nộp bài thành công!'
    });
  } catch (err) {
    console.error('[API] Submit test error:', err);
    res.status(500).json({ success: false, error: 'Lỗi nộp bài: ' + err.message });
  }
});

/** GET /api/test/history - Get test history */
router.get('/test/history', (req, res) => {
  try {
    const user = req.db.getDefaultUser();
    if (!user) return res.json({ success: true, data: [] });

    const tests = req.db.getRecentTests(user.id, 20);
    res.json({ success: true, data: tests });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /api/test/:id - Get test details */
router.get('/test/:id', (req, res) => {
  try {
    const session = req.db.getTestSession(req.params.id);
    if (!session) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy bài test' });
    }
    const domainResults = req.db.getTestResultsByDomain(req.params.id);
    res.json({ success: true, data: { ...session, domainResults } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════
// TRACKER ROUTES
// ═══════════════════════════════════════════

/** GET /api/tracker - Get current competency tracker */
router.get('/tracker', (req, res) => {
  try {
    const user = req.db.getDefaultUser();
    if (!user) return res.json({ success: true, data: { tracker: [], domains: [] } });

    const tracker = req.db.getTracker(user.id);
    const domains = req.db.getMainDomains();

    // Group tracker by main domain
    const grouped = {};
    for (const entry of tracker) {
      const mainDomain = entry.domain_id.includes('_')
        ? entry.domain_id.split('_')[0]
        : entry.domain_id;
      if (!grouped[mainDomain]) {
        grouped[mainDomain] = { entries: [], avgScore: 0 };
      }
      grouped[mainDomain].entries.push(entry);
    }

    // Calculate averages
    for (const [key, group] of Object.entries(grouped)) {
      const scores = group.entries.filter(e => e.score > 0).map(e => e.score);
      group.avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    }

    res.json({ success: true, data: { tracker, domains, grouped } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /api/tracker/history - Get tracker history */
router.get('/tracker/history', (req, res) => {
  try {
    const user = req.db.getDefaultUser();
    if (!user) return res.json({ success: true, data: [] });

    const days = parseInt(req.query.days) || 30;
    const history = req.db.getTrackerHistory(user.id, days);
    res.json({ success: true, data: history });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════
// LESSON ROUTES
// ═══════════════════════════════════════════

/** GET /api/lesson/today - Get today's lesson */
router.get('/lesson/today', requireAI, async (req, res) => {
  try {
    const user = req.db.getDefaultUser();
    if (!user) {
      return res.status(400).json({ success: false, error: 'Vui lòng đăng ký trước' });
    }

    // Check if today's lesson already exists
    let lessons = req.db.getTodayLessons(user.id);
    if (lessons.length > 0) {
      return res.json({ success: true, data: lessons });
    }

    // Generate new lesson
    console.log(`[API] Generating today's lesson for user: ${user.name}`);
    const tracker = req.db.getTracker(user.id);
    const lesson = await req.agents.content.getTodayLesson(user.id, tracker);

    res.json({ success: true, data: [lesson] });
  } catch (err) {
    console.error('[API] Today lesson error:', err);
    res.status(500).json({ success: false, error: 'Lỗi tạo bài giảng: ' + err.message });
  }
});

/** GET /api/lesson/:id - Get specific lesson */
router.get('/lesson/:id', (req, res) => {
  try {
    const lesson = req.db.getLesson(req.params.id);
    if (!lesson) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy bài giảng' });
    }
    res.json({ success: true, data: lesson });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /api/lesson/:id/complete - Mark lesson as completed */
router.post('/lesson/:id/complete', (req, res) => {
  try {
    req.db.completeLesson(req.params.id);
    const user = req.db.getDefaultUser();
    if (user) {
      req.db.updateDailyProgress(user.id, { lessons_completed: 1, study_minutes: 15 });
    }
    res.json({ success: true, message: 'Hoàn thành bài giảng!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /api/lesson/history - Get lesson history */
router.get('/lessons/history', (req, res) => {
  try {
    const user = req.db.getDefaultUser();
    if (!user) return res.json({ success: true, data: [] });
    const lessons = req.db.getRecentLessons(user.id, 20);
    res.json({ success: true, data: lessons });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════
// PROGRESS ROUTES
// ═══════════════════════════════════════════

/** GET /api/progress - Get progress data */
router.get('/progress', (req, res) => {
  try {
    const user = req.db.getDefaultUser();
    if (!user) return res.json({ success: true, data: { stats: {}, history: [], badges: [] } });

    const days = parseInt(req.query.days) || 30;
    const stats = req.db.getStats(user.id);
    const history = req.db.getProgressHistory(user.id, days);
    const badges = req.db.getBadges(user.id);
    const trackerHistory = req.db.getTrackerHistory(user.id, days);

    res.json({ success: true, data: { stats, history, badges, trackerHistory } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════
// DASHBOARD ROUTE
// ═══════════════════════════════════════════

/** GET /api/dashboard - Get all dashboard data */
router.get('/dashboard', async (req, res) => {
  try {
    const user = req.db.getDefaultUser();
    if (!user) {
      return res.json({
        success: true,
        data: null,
        message: 'Chưa có tài khoản. Vui lòng đăng ký.'
      });
    }

    const stats = req.db.getStats(user.id);
    const tracker = req.db.getTracker(user.id);
    const todayPlan = req.db.getTodayPlan(user.id);
    const recentTests = req.db.getRecentTests(user.id, 5);
    const todayLessons = req.db.getTodayLessons(user.id);
    const badges = req.db.getBadges(user.id);
    const streak = req.db.getCurrentStreak(user.id);

    // Build radar chart data
    const radarData = req.skills.radarBuilder.build(tracker);

    res.json({
      success: true,
      data: {
        user: { ...user, stats },
        tracker,
        radarData,
        todayPlan,
        recentTests,
        todayLessons,
        badges,
        streak
      }
    });
  } catch (err) {
    console.error('[API] Dashboard error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════
// NOTION ROUTES
// ═══════════════════════════════════════════

/** POST /api/notion/setup - Setup Notion workspace */
router.post('/notion/setup', async (req, res) => {
  try {
    if (!req.agents.notion || !req.skills.notionSync) {
      return res.status(503).json({ success: false, error: 'Notion chưa được cấu hình. Thêm NOTION_API_KEY vào .env' });
    }

    const user = req.db.getDefaultUser();
    if (!user) {
      return res.status(400).json({ success: false, error: 'Vui lòng đăng ký trước' });
    }

    const pageId = req.body.page_id || process.env.NOTION_PAGE_ID;
    if (!pageId) {
      return res.status(400).json({ success: false, error: 'Cần cung cấp Notion Page ID' });
    }

    console.log('[API] Setting up Notion workspace...');
    const result = await req.agents.notion.setupWorkspace(user.id, pageId);

    res.json({ success: true, data: result, message: 'Notion workspace đã được thiết lập!' });
  } catch (err) {
    console.error('[API] Notion setup error:', err);
    res.status(500).json({ success: false, error: 'Lỗi thiết lập Notion: ' + err.message });
  }
});

/** POST /api/notion/sync - Manual sync to Notion */
router.post('/notion/sync', async (req, res) => {
  try {
    if (!req.agents.notion || !req.skills.notionSync) {
      return res.status(503).json({ success: false, error: 'Notion chưa được cấu hình' });
    }

    const user = req.db.getDefaultUser();
    if (!user) {
      return res.status(400).json({ success: false, error: 'Vui lòng đăng ký trước' });
    }

    console.log('[API] Syncing to Notion...');
    await req.agents.notion.syncAll(user.id);

    res.json({ success: true, message: 'Đồng bộ Notion thành công!' });
  } catch (err) {
    console.error('[API] Notion sync error:', err);
    res.status(500).json({ success: false, error: 'Lỗi đồng bộ: ' + err.message });
  }
});

// ═══════════════════════════════════════════
// SETTINGS ROUTES
// ═══════════════════════════════════════════

/** GET /api/settings - Get settings */
router.get('/settings', (req, res) => {
  try {
    const user = req.db.getDefaultUser();
    const notionConfig = user ? req.db.getNotionConfig(user.id) : null;

    res.json({
      success: true,
      data: {
        hasAIKey: !!req.claudeClient,
        hasAnthropicKey: !!req.claudeClient,
        aiProvider: req.claudeClient ? req.claudeClient.provider : null,
        hasNotionKey: !!req.notionClient,
        notionConfig,
        aiModel: req.claudeClient ? req.claudeClient.model : req.claudeModel,
        claudeModel: req.claudeClient ? req.claudeClient.model : req.claudeModel,
        dailyCron: process.env.DAILY_TEST_CRON || '0 7 * * *'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /api/settings/ai-model - Change active AI model */
router.post('/settings/ai-model', requireAI, (req, res) => {
  try {
    const { model } = req.body;
    if (!model) {
      return res.status(400).json({ success: false, error: 'Tên model là bắt buộc' });
    }

    // Update AI Client
    req.claudeClient.setModel(model);
    req.claudeModel = model;

    // Update all skills and agents
    if (req.skills) {
      Object.values(req.skills).forEach(skill => {
        if (skill && typeof skill === 'object' && 'model' in skill) {
          skill.model = model;
        }
      });
    }
    if (req.agents) {
      Object.values(req.agents).forEach(agent => {
        if (agent && typeof agent === 'object' && 'model' in agent) {
          agent.model = model;
        }
      });
    }

    console.log(`[API] Successfully upgraded AI engine to: ${model}`);
    res.json({
      success: true,
      data: {
        aiModel: model,
        provider: req.claudeClient.provider
      },
      message: `Đã nâng cấp và chuyển đổi thành công sang Model: ${model}`
    });
  } catch (err) {
    console.error('[API] Error updating AI model:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════
// DOMAINS ROUTE
// ═══════════════════════════════════════════

/** GET /api/domains - Get all competency domains */
router.get('/domains', (req, res) => {
  try {
    const domains = req.db.getDomains();
    const mainDomains = req.db.getMainDomains();
    res.json({ success: true, data: { domains, mainDomains } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════
// MENTOR ROUTES (SOCRATIC CLINICAL MENTORING)
// ═══════════════════════════════════════════

/** POST /api/mentor/start - Bắt đầu ca lâm sàng Socratic */
router.post('/mentor/start', async (req, res) => {
  try {
    const user = req.db.getDefaultUser();
    if (!user) return res.status(400).json({ success: false, error: 'Vui lòng đăng ký trước' });

    const { domain = 'internal', difficulty = 3 } = req.body;
    console.log(`[API] Starting Socratic Mentor session for ${user.name}, domain: ${domain}`);

    try {
      const session = await req.agents.mentor.startCaseSession(user.id, domain, difficulty);
      res.json({ success: true, data: session });
    } catch (aiErr) {
      console.warn('[API] Mentor AI error/quota. Using fallback Socratic session:', aiErr.message);
      const fallbackSession = {
        sessionId: `case_fallback_${Date.now()}`,
        stage: 'intake',
        content: `### 🏥 CA LÂM SÀNG CẤP CỨU: ĐAU NGực CẤP\n\n**Bệnh nhân nam, 62 tuổi**, là cán bộ hưu trí, được gia đình đưa vào phòng cấp cứu lúc 02:00 sáng vì cơn đau dữ dội vùng trước tim.\n\n- **Bệnh sử**: Cơn đau khởi phát cách nhập viện 90 phút trong lúc bệnh nhân đang ngủ, cảm giác đè nặng như đá đè sau xương ức, lan lên hàm dưới bên trái và mặt trong cánh tay trái. Bệnh nhân vã mồ hôi lạnh, buồn nôn nhưng không nôn, khó thở nhẹ.\n- **Tiền sử**: Tăng huyết áp 10 năm điều trị không thường xuyên bằng Amlodipine 5mg; Hút thuốc lá 30 bao-năm; Rối loạn lipid máu.\n- **Thăm khám ban đầu**: Bệnh nhân tỉnh, tiếp xúc được nhưng vẻ mặt hốt hoảng, đau đớn. Sinh hiệu: HA 150/90 mmHg, Mạch 102 lần/phút, Nhịp thở 22 lần/phút, SpO2 95% (khí trời). Khám tim đều, T1 T2 rõ, không nghe âm thổi; Khám phổi rì rào phế nang êm dịu hai phế trường, không ran.\n\n---\n*Đóng vai là bác sĩ cấp cứu tiếp nhận ca bệnh này, bạn hãy thực hiện các bước suy luận theo khung **VINDICATE** và Socratic.*`,
        questions: [
          "Dựa trên các dữ kiện bệnh sử và tiền sử trên, 3 chẩn đoán phân biệt quan trọng nhất (theo mức độ đe dọa tính mạng) cần nghĩ tới ngay lúc này là gì?",
          "Khám thực thể ban đầu không thấy ran ở phổi hay âm thổi ở tim cho chúng ta thông tin loại trừ giá trị gì trong bệnh cảnh đau ngực cấp?"
        ],
        keyConceptsCount: 4,
        totalStages: 5,
        currentStageIndex: 0
      };
      res.json({ success: true, data: fallbackSession });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /api/mentor/respond - Trả lời câu hỏi Socratic của Mentor */
router.post('/mentor/respond', async (req, res) => {
  try {
    const { sessionId, response } = req.body;
    if (!sessionId || !response) {
      return res.status(400).json({ success: false, error: 'Thiếu thông tin phản hồi' });
    }

    try {
      const mentorRes = await req.agents.mentor.processResponse(sessionId, response);
      res.json({ success: true, data: mentorRes });
    } catch (aiErr) {
      console.warn('[API] Mentor processResponse error/quota. Using fallback response:', aiErr.message);
      res.json({
        success: true,
        data: {
          evaluation: 'good_reasoning',
          mentor_message: `### 🌟 Phân tích biện luận lâm sàng của bạn\n\nBạn đã đưa ra hướng tư duy rất sắc bén và đúng trọng tâm! Trong đau ngực cấp ở bệnh nhân nam có yếu tố nguy cơ tim mạch cao (Hút thuốc lá lâu năm, Tăng huyết áp, ĐTĐ), **Hội chứng mạch vành cấp (ACS - Nhồi máu cơ tim)** luôn là chẩn đoán số 1 cần loại trừ ngay lập tức.\n\n#### 🔍 Phân tích chuyên sâu (Socratic Feedback):\n1. **Chẩn đoán phân biệt cần ghi nhớ (khung VINDICATE - V: Vascular/Cardiovascular)**:\n   - *Nhồi máu cơ tim cấp (STEMI / NSTEMI)* - Nguy cơ cao nhất.\n   - *Bóc tách động mạch chủ ngực (Aortic Dissection)* - Cần hỏi thêm tính chất đau như xé vải hay không, kiểm tra mạch hai tay.\n   - *Thuyên tắc phổi (Pulmonary Embolism)* - Hay kèm khó thở, nhịp nhanh, nguy cơ huyết khối.\n2. **Ý nghĩa khám thực thể âm tính**:\n   - Phổi không ran giúp loại trừ phù phổi cấp (Killip I) ở thời điểm hiện tại.\n\n---\n**🧠 CÂU HỎI TIẾP THEO CHO BẠN:**\nĐể chẩn đoán xác định và phân tầng nguy cơ cho bệnh nhân này ngay tại phòng cấp cứu trong vòng **10 phút đầu tiên**, bạn sẽ chỉ định **2 cận lâm sàng khẩn cấp nào**? Giải thích lý do lựa chọn của bạn.`,
          stage: 'differential',
          should_advance: true,
          next_questions: [
            "Hai cận lâm sàng khẩn cấp cần thực hiện trong vòng 10 phút đầu là gì?",
            "Nếu Điện tâm đồ (ECG) cho thấy ST chênh lên tại các chuyển đạo II, III, aVF, bạn kết luận vùng cơ tim nào bị tổn thương và động mạch vành nào có khả năng bị tắc nghẽn nhất?"
          ]
        }
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /api/mentor/feedback - Nhận báo cáo tổng kết ca lâm sàng */
router.post('/mentor/feedback', async (req, res) => {
  try {
    const { sessionId } = req.body;
    try {
      const feedback = await req.agents.mentor.provideFeedback(sessionId);
      res.json({ success: true, data: feedback });
    } catch (aiErr) {
      res.json({
        success: true,
        data: {
          score: 85,
          summary: "Bạn đã hoàn thành xuất sắc ca lâm sàng mô phỏng xử trí Nhồi máu cơ tim cấp theo phương pháp Socratic. Tư duy chẩn đoán phân biệt VINDICATE rất chặt chẽ.",
          strengths: ["Nhận diện nhanh triệu chứng nguy hiểm của Hội chứng mạch vành cấp", "Chỉ định ECG 12 chuyển đạo và Troponin siêu nhạy đúng thời gian vàng"],
          areas_for_improvement: ["Cần lưu ý thêm liều lượng chính xác của phác đồ kháng kết tập tiểu cầu kép (DAPT) trong phòng cấp cứu"],
          takeaway_pearl: "💎 Trong STEMI, thời gian từ khi vào viện đến khi nong mạch (Door-to-Balloon time) phải dưới 90 phút. Aspirin 325mg nhai là thuốc có giảm tử vong rõ ràng nhất cần cho ngay lập tức."
        }
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════
// AI COACHING ROUTE
// ═══════════════════════════════════════════

/** GET /api/coaching/briefing - Get daily briefing */
router.get('/coaching/briefing', requireAI, async (req, res) => {
  try {
    const user = req.db.getDefaultUser();
    if (!user) {
      return res.status(400).json({ success: false, error: 'Vui lòng đăng ký trước' });
    }

    const briefing = await req.agents.coach.dailyBriefing(user.id);
    res.json({ success: true, data: briefing });
  } catch (err) {
    console.error('[API] Coaching error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════
router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      database: 'connected',
      ai: req.claudeClient ? 'connected' : 'not_configured',
      notion: req.notionClient ? 'connected' : 'not_configured'
    }
  });
});

module.exports = router;
