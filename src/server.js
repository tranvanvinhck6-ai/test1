'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const UniversalAIClient = require('./ai/ai-client');
const { Client: NotionClient } = require('@notionhq/client');

const MedAdaptDB = require('./db/database');
const apiRoutes = require('./routes/api');

// ═══════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'medadapt.db');

// ═══════════════════════════════════════════
// INITIALIZE SERVICES
// ═══════════════════════════════════════════
console.log('╔══════════════════════════════════════════╗');
console.log('║     🏥 MedAdapt - Adaptive Learning     ║');
console.log('║     Hệ thống học tập thích ứng y khoa   ║');
console.log('╚══════════════════════════════════════════╝');
console.log();

// Database
const db = new MedAdaptDB(DB_PATH);
console.log(`[Server] Database initialized at: ${DB_PATH}`);

// AI Client (Hỗ trợ Google Gemini và Anthropic Claude)
let claudeClient = null;
let claudeModel = process.env.GEMINI_MODEL || process.env.CLAUDE_MODEL || 'gemini-2.5-pro';

const aiClient = UniversalAIClient.createFromEnv();
if (aiClient) {
  claudeClient = aiClient;
  claudeModel = aiClient.model;
  console.log(`[Server] AI Engine initialized (${aiClient.provider.toUpperCase()} - model: ${claudeModel})`);
} else {
  console.warn('[Server] ⚠️  Chưa cấu hình API Key (GEMINI_API_KEY hoặc ANTHROPIC_API_KEY) - AI features disabled.');
}

// Notion Client
let notionClient = null;
if (process.env.NOTION_API_KEY && process.env.NOTION_API_KEY !== 'ntn_xxxxxxxxxxxxxxxxxxxx') {
  notionClient = new NotionClient({ auth: process.env.NOTION_API_KEY });
  console.log('[Server] Notion client initialized');
} else {
  console.warn('[Server] ⚠️  NOTION_API_KEY not set - Notion sync disabled. Set it in .env file.');
}

// ═══════════════════════════════════════════
// INITIALIZE SKILLS
// ═══════════════════════════════════════════
const MCQGenerator = require('./skills/mcq-generator');
const BloomClassifier = require('./skills/bloom-classifier');
const RadarBuilder = require('./skills/radar-builder');
const GapDetector = require('./skills/gap-detector');
const SM2Scheduler = require('./skills/sm2-scheduler');
const LessonComposer = require('./skills/lesson-composer');
const CaseSimulator = require('./skills/case-simulator');
const NotionSync = require('./skills/notion-sync');
const DailyBriefing = require('./skills/daily-briefing');
const StreakMotivator = require('./skills/streak-motivator');
const KnowledgeRetriever = require('./skills/knowledge-retriever');
const DifficultyCalibrator = require('./skills/difficulty-calibrator');

const skills = {
  mcqGenerator: new MCQGenerator(claudeClient, claudeModel),
  bloomClassifier: new BloomClassifier(claudeClient, claudeModel),
  radarBuilder: new RadarBuilder(),
  gapDetector: new GapDetector(),
  sm2Scheduler: new SM2Scheduler(),
  lessonComposer: new LessonComposer(claudeClient, claudeModel),
  caseSimulator: new CaseSimulator(claudeClient, claudeModel),
  notionSync: notionClient ? new NotionSync(notionClient) : null,
  dailyBriefing: new DailyBriefing(claudeClient, claudeModel),
  streakMotivator: new StreakMotivator(claudeClient, claudeModel),
  knowledgeRetriever: new KnowledgeRetriever(claudeClient, claudeModel),
  difficultyCalibrator: new DifficultyCalibrator(),
};
console.log('[Server] Skills initialized');

// ═══════════════════════════════════════════
// INITIALIZE AGENTS
// ═══════════════════════════════════════════
const AssessmentAgent = require('./agents/assessment-agent');
const AnalystAgent = require('./agents/analyst-agent');
const CurriculumAgent = require('./agents/curriculum-agent');
const ContentAgent = require('./agents/content-agent');
const MentorAgent = require('./agents/mentor-agent');
const NotionAgent = require('./agents/notion-agent');
const CoachAgent = require('./agents/coach-agent');
const AdaptiveOrchestrator = require('./agents/orchestrator');

const agents = {
  assessment: new AssessmentAgent({ claudeClient, model: claudeModel, db, skills: { mcqGenerator: skills.mcqGenerator, bloomClassifier: skills.bloomClassifier, difficultyCalibrator: skills.difficultyCalibrator } }),
  analyst: new AnalystAgent({ claudeClient, model: claudeModel, db, skills: { radarBuilder: skills.radarBuilder, gapDetector: skills.gapDetector, knowledgeRetriever: skills.knowledgeRetriever } }),
  curriculum: new CurriculumAgent({ claudeClient, model: claudeModel, db, skills: { gapDetector: skills.gapDetector, sm2Scheduler: skills.sm2Scheduler, difficultyCalibrator: skills.difficultyCalibrator } }),
  content: new ContentAgent({ claudeClient, model: claudeModel, db, skills: { lessonComposer: skills.lessonComposer, caseSimulator: skills.caseSimulator, knowledgeRetriever: skills.knowledgeRetriever } }),
  mentor: new MentorAgent({ claudeClient, model: claudeModel, db, skills: { caseSimulator: skills.caseSimulator, knowledgeRetriever: skills.knowledgeRetriever, lessonComposer: skills.lessonComposer } }),
  notion: new NotionAgent({ db, skills: { notionSync: skills.notionSync } }),
  coach: new CoachAgent({ claudeClient, model: claudeModel, db, skills: { streakMotivator: skills.streakMotivator, radarBuilder: skills.radarBuilder, dailyBriefing: skills.dailyBriefing } }),
};

const orchestrator = new AdaptiveOrchestrator({ db, agents });
console.log('[Server] Agents initialized');

// ═══════════════════════════════════════════
// SETUP EXPRESS
// ═══════════════════════════════════════════
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Inject dependencies into routes
app.use((req, res, next) => {
  req.db = db;
  req.claudeClient = claudeClient;
  req.claudeModel = claudeModel;
  req.notionClient = notionClient;
  req.skills = skills;
  req.agents = agents;
  req.orchestrator = orchestrator;
  next();
});

// API Routes
app.use('/api', apiRoutes);

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[Server] Error:', err.message);
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: 'Lỗi hệ thống. Vui lòng thử lại.',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ═══════════════════════════════════════════
// SETUP SCHEDULER (Daily Cron Jobs)
// ═══════════════════════════════════════════
const Scheduler = require('./core/scheduler');
const scheduler = new Scheduler({ db, orchestrator, cronExpression: process.env.DAILY_TEST_CRON || '0 7 * * *' });
scheduler.start();

// ═══════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════
app.listen(PORT, HOST, () => {
  console.log();
  console.log(`🚀 MedAdapt server running at: http://${HOST}:${PORT}`);
  console.log(`📊 API available at: http://${HOST}:${PORT}/api`);
  console.log(`🎯 Dashboard: http://${HOST}:${PORT}`);
  console.log();
  console.log('Status:');
  console.log(`  AI Engine: ${claudeClient ? '✅ Connected (' + claudeClient.provider.toUpperCase() + ' - ' + claudeModel + ')' : '❌ Not configured'}`);
  console.log(`  Notion:    ${notionClient ? '✅ Connected' : '❌ Not configured'}`);
  console.log(`  Database:  ✅ Ready`);
  console.log(`  Scheduler: ✅ Active (${process.env.DAILY_TEST_CRON || '0 7 * * *'})`);
  console.log();
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  scheduler.stop();
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  scheduler.stop();
  db.close();
  process.exit(0);
});

module.exports = app;
