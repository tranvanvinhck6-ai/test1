'use strict';

const cron = require('node-cron');

/**
 * MedAdapt Scheduler
 * Manages cron jobs for daily adaptive learning loops
 */
class Scheduler {
  /**
   * @param {Object} params
   * @param {import('../db/database')} params.db
   * @param {import('../agents/orchestrator')} params.orchestrator
   * @param {string} params.cronExpression - Cron expression for daily job (default: '0 7 * * *' = 7:00 AM)
   */
  constructor({ db, orchestrator, cronExpression = '0 7 * * *' }) {
    this.db = db;
    this.orchestrator = orchestrator;
    this.cronExpression = cronExpression;
    this.job = null;
    this.isRunning = false;
  }

  /**
   * Start the scheduler
   */
  start() {
    if (this.job) {
      console.log('[Scheduler] Already running');
      return;
    }

    if (!cron.validate(this.cronExpression)) {
      console.error(`[Scheduler] Invalid cron expression: ${this.cronExpression}`);
      return;
    }

    this.job = cron.schedule(this.cronExpression, async () => {
      await this.runDailyJob();
    }, {
      timezone: 'Asia/Ho_Chi_Minh'
    });

    console.log(`[Scheduler] Started with cron: ${this.cronExpression} (Asia/Ho_Chi_Minh)`);
    console.log(`[Scheduler] Next run: ${this._getNextRun()}`);
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (this.job) {
      this.job.stop();
      this.job = null;
      console.log('[Scheduler] Stopped');
    }
  }

  /**
   * Run the daily adaptive learning job
   */
  async runDailyJob() {
    if (this.isRunning) {
      console.log('[Scheduler] Daily job already in progress, skipping');
      return;
    }

    this.isRunning = true;
    console.log('╔══════════════════════════════════════════╗');
    console.log('║  🔄 Daily Adaptive Learning Loop Start   ║');
    console.log(`║  ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }).padEnd(39)}║`);
    console.log('╚══════════════════════════════════════════╝');

    try {
      // Get all active users
      const users = this.db.db.prepare('SELECT id, name FROM users').all();

      if (users.length === 0) {
        console.log('[Scheduler] No users found, skipping daily job');
        return;
      }

      console.log(`[Scheduler] Processing ${users.length} user(s)...`);

      for (const user of users) {
        try {
          console.log(`\n[Scheduler] Processing user: ${user.name} (${user.id})`);

          // Save tracker snapshot for history
          this.db.saveTrackerSnapshot(user.id);

          // Run the full daily loop
          const result = await this.orchestrator.runDailyLoop(user.id);

          if (result.success !== false) {
            console.log(`[Scheduler] ✅ User ${user.name}: Daily loop completed`);
          } else {
            console.log(`[Scheduler] ⚠️ User ${user.name}: ${result.error || 'Unknown error'}`);
          }

          // Delay between users to avoid API rate limits
          if (users.length > 1) {
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
        } catch (userError) {
          console.error(`[Scheduler] ❌ Error for user ${user.name}:`, userError.message);
        }
      }

      console.log('\n[Scheduler] Daily job completed');
      console.log(`[Scheduler] Next run: ${this._getNextRun()}`);
    } catch (error) {
      console.error('[Scheduler] Daily job failed:', error.message);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Manually trigger the daily job
   * @returns {Promise}
   */
  async triggerManual() {
    console.log('[Scheduler] Manual trigger requested');
    return this.runDailyJob();
  }

  /**
   * Get estimated next run time
   * @returns {string}
   */
  _getNextRun() {
    try {
      const parts = this.cronExpression.split(' ');
      const minute = parts[0] === '*' ? '00' : parts[0].padStart(2, '0');
      const hour = parts[1] === '*' ? 'every hour' : parts[1].padStart(2, '0');

      if (hour !== 'every hour') {
        const now = new Date();
        const next = new Date();
        next.setHours(parseInt(hour), parseInt(minute), 0, 0);
        if (next <= now) {
          next.setDate(next.getDate() + 1);
        }
        return next.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      }
      return `Every hour at :${minute}`;
    } catch {
      return 'Unknown';
    }
  }

  /**
   * Get scheduler status
   * @returns {Object}
   */
  getStatus() {
    return {
      isActive: !!this.job,
      isRunning: this.isRunning,
      cronExpression: this.cronExpression,
      nextRun: this._getNextRun()
    };
  }
}

module.exports = Scheduler;
