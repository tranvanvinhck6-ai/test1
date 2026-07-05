'use strict';

/**
 * @fileoverview NotionSync - Đồng bộ dữ liệu với Notion
 * Quản lý workspace Notion cho MedAdapt: tạo databases,
 * đồng bộ tracker, bài kiểm tra, bài giảng và tiến độ.
 * Xử lý rate limit của Notion API (3 req/sec).
 */

/**
 * Thời gian chờ tối thiểu giữa các request (ms) - Notion rate limit: 3 req/sec
 * @constant
 */
const MIN_REQUEST_INTERVAL = 350;

/**
 * Số lần retry tối đa khi gặp rate limit
 * @constant
 */
const MAX_RETRIES = 3;

/**
 * Cấu trúc databases cần tạo trong Notion workspace
 * @constant
 */
const DATABASE_SCHEMAS = {
  tracker: {
    title: '📊 MedAdapt - Tracker',
    properties: {
      'Chuyên khoa': { type: 'title', title: {} },
      'Domain ID': { type: 'rich_text', rich_text: {} },
      'Điểm': { type: 'number', number: { format: 'percent' } },
      'Mức độ khó': { type: 'number', number: { format: 'number' } },
      'Tổng câu hỏi': { type: 'number', number: { format: 'number' } },
      'Câu đúng': { type: 'number', number: { format: 'number' } },
      'Lần ôn cuối': { type: 'date', date: {} },
      'Lần ôn tiếp': { type: 'date', date: {} },
      'Hệ số dễ (EF)': { type: 'number', number: { format: 'number' } },
      'Trạng thái': { type: 'select', select: { options: [
        { name: 'Tốt', color: 'green' },
        { name: 'Trung bình', color: 'yellow' },
        { name: 'Cần cải thiện', color: 'red' },
        { name: 'Chưa học', color: 'gray' }
      ]}}
    }
  },
  tests: {
    title: '📝 MedAdapt - Bài kiểm tra',
    properties: {
      'Tiêu đề': { type: 'title', title: {} },
      'Ngày': { type: 'date', date: {} },
      'Điểm': { type: 'number', number: { format: 'percent' } },
      'Chuyên khoa': { type: 'multi_select', multi_select: { options: [] } },
      'Mức độ khó': { type: 'number', number: { format: 'number' } },
      'Tổng câu': { type: 'number', number: { format: 'number' } },
      'Câu đúng': { type: 'number', number: { format: 'number' } },
      'Thời gian (phút)': { type: 'number', number: { format: 'number' } },
      'Bloom Level': { type: 'select', select: { options: [
        { name: 'Remember', color: 'gray' },
        { name: 'Understand', color: 'blue' },
        { name: 'Apply', color: 'green' },
        { name: 'Analyze', color: 'yellow' },
        { name: 'Evaluate', color: 'orange' },
        { name: 'Create', color: 'red' }
      ]}}
    }
  },
  lessons: {
    title: '📚 MedAdapt - Bài giảng',
    properties: {
      'Tiêu đề': { type: 'title', title: {} },
      'Chuyên khoa': { type: 'select', select: { options: [] } },
      'Phân ngành': { type: 'rich_text', rich_text: {} },
      'Mức độ': { type: 'number', number: { format: 'number' } },
      'Loại bài': { type: 'select', select: { options: [
        { name: 'Lý thuyết', color: 'blue' },
        { name: 'Ca lâm sàng', color: 'green' },
        { name: 'Ôn tập', color: 'yellow' },
        { name: 'Chuyên sâu', color: 'purple' }
      ]}},
      'Ngày tạo': { type: 'date', date: {} },
      'Đã học': { type: 'checkbox', checkbox: {} }
    }
  },
  progress: {
    title: '📈 MedAdapt - Tiến độ',
    properties: {
      'Ngày': { type: 'title', title: {} },
      'Điểm TB': { type: 'number', number: { format: 'percent' } },
      'Streak': { type: 'number', number: { format: 'number' } },
      'Số câu hỏi': { type: 'number', number: { format: 'number' } },
      'Thời gian học (phút)': { type: 'number', number: { format: 'number' } },
      'Chuyên khoa ôn': { type: 'multi_select', multi_select: { options: [] } },
      'Ghi chú': { type: 'rich_text', rich_text: {} }
    }
  }
};

/**
 * Lớp đồng bộ dữ liệu MedAdapt với Notion
 * @class NotionSync
 */
class NotionSync {
  /**
   * Khởi tạo NotionSync
   * @param {import('@notionhq/client').Client} notionClient - Notion client instance
   */
  constructor(notionClient) {
    this.notion = notionClient;
    this._lastRequestTime = 0;
  }

  /**
   * Thiết lập workspace Notion với đầy đủ databases
   * @param {string} parentPageId - ID trang cha trong Notion
   * @returns {Promise<Object>} Thông tin các database đã tạo
   * @returns {string} return.tracker_db_id - ID database Tracker
   * @returns {string} return.tests_db_id - ID database Bài kiểm tra
   * @returns {string} return.lessons_db_id - ID database Bài giảng
   * @returns {string} return.progress_db_id - ID database Tiến độ
   */
  async setupWorkspace(parentPageId) {
    try {
      const result = {};

      for (const [key, schema] of Object.entries(DATABASE_SCHEMAS)) {
        await this._rateLimitWait();

        const database = await this._retryOnRateLimit(async () => {
          return await this.notion.databases.create({
            parent: {
              type: 'page_id',
              page_id: parentPageId
            },
            title: [
              {
                type: 'text',
                text: { content: schema.title }
              }
            ],
            properties: schema.properties
          });
        });

        result[`${key}_db_id`] = database.id;
        console.log(`[NotionSync] Đã tạo database: ${schema.title} (${database.id})`);
      }

      return result;
    } catch (error) {
      console.error('[NotionSync] Lỗi thiết lập workspace:', error.message);
      throw new Error(`Không thể thiết lập Notion workspace: ${error.message}`);
    }
  }

  /**
   * Đồng bộ dữ liệu tracker lên Notion
   * @param {Object[]} trackerData - Dữ liệu tracker
   * @param {string} trackerData[].domain_id - ID chuyên khoa
   * @param {string} trackerData[].domain_name - Tên chuyên khoa
   * @param {number} trackerData[].score - Điểm (0-100)
   * @param {number} [trackerData[].difficulty] - Mức độ khó
   * @param {number} [trackerData[].total_questions] - Tổng câu hỏi
   * @param {number} [trackerData[].correct_answers] - Câu đúng
   * @param {string} [trackerData[].last_review] - Lần ôn cuối
   * @param {string} [trackerData[].next_review_date] - Lần ôn tiếp
   * @param {number} [trackerData[].easiness_factor] - Hệ số dễ
   * @param {string} databaseId - ID database Notion
   * @returns {Promise<Object[]>} Kết quả đồng bộ
   */
  async syncTracker(trackerData, databaseId) {
    try {
      const results = [];

      for (const tracker of trackerData) {
        await this._rateLimitWait();

        // Tìm page hiện có dựa trên domain_id
        const existing = await this._findExistingPage(databaseId, tracker.domain_id);

        const properties = this._buildTrackerProperties(tracker);

        if (existing) {
          // Cập nhật page hiện có
          const updated = await this._retryOnRateLimit(async () => {
            return await this.notion.pages.update({
              page_id: existing.id,
              properties
            });
          });
          results.push({ domain_id: tracker.domain_id, action: 'updated', page_id: updated.id });
        } else {
          // Tạo page mới
          const created = await this._retryOnRateLimit(async () => {
            return await this.notion.pages.create({
              parent: { type: 'database_id', database_id: databaseId },
              properties
            });
          });
          results.push({ domain_id: tracker.domain_id, action: 'created', page_id: created.id });
        }
      }

      return results;
    } catch (error) {
      console.error('[NotionSync] Lỗi đồng bộ tracker:', error.message);
      throw new Error(`Không thể đồng bộ tracker: ${error.message}`);
    }
  }

  /**
   * Tạo trang bài kiểm tra trên Notion
   * @param {Object} testData - Dữ liệu bài kiểm tra
   * @param {string} testData.title - Tiêu đề
   * @param {string} testData.date - Ngày kiểm tra
   * @param {number} testData.score - Điểm (0-1)
   * @param {string[]} testData.domains - Chuyên khoa
   * @param {number} testData.difficulty - Mức độ khó
   * @param {number} testData.total_questions - Tổng câu
   * @param {number} testData.correct_answers - Câu đúng
   * @param {number} [testData.duration_minutes] - Thời gian
   * @param {string} [testData.bloom_level] - Bloom level chính
   * @param {string} [testData.content] - Nội dung chi tiết (markdown)
   * @param {string} databaseId - ID database Notion
   * @returns {Promise<Object>} Trang đã tạo
   */
  async createTestPage(testData, databaseId) {
    try {
      await this._rateLimitWait();

      const properties = {
        'Tiêu đề': { title: [{ text: { content: testData.title || 'Bài kiểm tra' } }] },
        'Ngày': { date: { start: testData.date || new Date().toISOString().split('T')[0] } },
        'Điểm': { number: testData.score || 0 },
        'Tổng câu': { number: testData.total_questions || 0 },
        'Câu đúng': { number: testData.correct_answers || 0 },
        'Mức độ khó': { number: testData.difficulty || 2 }
      };

      if (testData.domains && testData.domains.length > 0) {
        properties['Chuyên khoa'] = {
          multi_select: testData.domains.map(d => ({ name: d }))
        };
      }

      if (testData.duration_minutes) {
        properties['Thời gian (phút)'] = { number: testData.duration_minutes };
      }

      if (testData.bloom_level) {
        properties['Bloom Level'] = { select: { name: testData.bloom_level } };
      }

      // Xây dựng nội dung trang (children blocks)
      const children = this._buildTestPageContent(testData);

      const page = await this._retryOnRateLimit(async () => {
        return await this.notion.pages.create({
          parent: { type: 'database_id', database_id: databaseId },
          properties,
          children
        });
      });

      return { page_id: page.id, url: page.url };
    } catch (error) {
      console.error('[NotionSync] Lỗi tạo trang bài kiểm tra:', error.message);
      throw new Error(`Không thể tạo trang bài kiểm tra: ${error.message}`);
    }
  }

  /**
   * Tạo trang bài giảng trên Notion
   * @param {Object} lessonData - Dữ liệu bài giảng
   * @param {string} lessonData.title - Tiêu đề
   * @param {string} [lessonData.domain_name] - Chuyên khoa
   * @param {string} [lessonData.subdomain] - Phân ngành
   * @param {number} [lessonData.difficulty] - Mức độ
   * @param {string} [lessonData.lesson_type] - Loại bài
   * @param {string} [lessonData.core_content] - Nội dung chính
   * @param {string[]} [lessonData.key_points] - Điểm chính
   * @param {string[]} [lessonData.clinical_pearls] - Clinical pearls
   * @param {string} databaseId - ID database Notion
   * @returns {Promise<Object>} Trang đã tạo
   */
  async createLessonPage(lessonData, databaseId) {
    try {
      await this._rateLimitWait();

      const lessonTypeMap = {
        theory: 'Lý thuyết',
        case_based: 'Ca lâm sàng',
        review: 'Ôn tập',
        deep_dive: 'Chuyên sâu'
      };

      const properties = {
        'Tiêu đề': { title: [{ text: { content: lessonData.title || 'Bài giảng' } }] },
        'Mức độ': { number: lessonData.difficulty || 2 },
        'Ngày tạo': { date: { start: new Date().toISOString().split('T')[0] } },
        'Đã học': { checkbox: false }
      };

      if (lessonData.domain_name) {
        properties['Chuyên khoa'] = { select: { name: lessonData.domain_name } };
      }

      if (lessonData.subdomain) {
        properties['Phân ngành'] = { rich_text: [{ text: { content: lessonData.subdomain } }] };
      }

      if (lessonData.lesson_type) {
        const typeName = lessonTypeMap[lessonData.lesson_type] || lessonData.lesson_type;
        properties['Loại bài'] = { select: { name: typeName } };
      }

      // Xây dựng nội dung trang
      const children = this._buildLessonPageContent(lessonData);

      const page = await this._retryOnRateLimit(async () => {
        return await this.notion.pages.create({
          parent: { type: 'database_id', database_id: databaseId },
          properties,
          children
        });
      });

      return { page_id: page.id, url: page.url };
    } catch (error) {
      console.error('[NotionSync] Lỗi tạo trang bài giảng:', error.message);
      throw new Error(`Không thể tạo trang bài giảng: ${error.message}`);
    }
  }

  /**
   * Cập nhật tiến độ học tập trên Notion
   * @param {Object} progressData - Dữ liệu tiến độ
   * @param {string} progressData.date - Ngày
   * @param {number} progressData.average_score - Điểm TB
   * @param {number} progressData.streak - Streak hiện tại
   * @param {number} [progressData.questions_done] - Số câu hỏi đã làm
   * @param {number} [progressData.study_minutes] - Thời gian học
   * @param {string[]} [progressData.domains_reviewed] - Chuyên khoa đã ôn
   * @param {string} [progressData.notes] - Ghi chú
   * @param {string} databaseId - ID database Notion
   * @returns {Promise<Object>} Kết quả cập nhật
   */
  async updateProgress(progressData, databaseId) {
    try {
      await this._rateLimitWait();

      const dateStr = progressData.date || new Date().toISOString().split('T')[0];

      const properties = {
        'Ngày': { title: [{ text: { content: dateStr } }] },
        'Điểm TB': { number: progressData.average_score || 0 },
        'Streak': { number: progressData.streak || 0 }
      };

      if (progressData.questions_done !== undefined) {
        properties['Số câu hỏi'] = { number: progressData.questions_done };
      }

      if (progressData.study_minutes !== undefined) {
        properties['Thời gian học (phút)'] = { number: progressData.study_minutes };
      }

      if (progressData.domains_reviewed && progressData.domains_reviewed.length > 0) {
        properties['Chuyên khoa ôn'] = {
          multi_select: progressData.domains_reviewed.map(d => ({ name: d }))
        };
      }

      if (progressData.notes) {
        properties['Ghi chú'] = {
          rich_text: [{ text: { content: progressData.notes.substring(0, 2000) } }]
        };
      }

      const page = await this._retryOnRateLimit(async () => {
        return await this.notion.pages.create({
          parent: { type: 'database_id', database_id: databaseId },
          properties
        });
      });

      return { page_id: page.id, action: 'created', date: dateStr };
    } catch (error) {
      console.error('[NotionSync] Lỗi cập nhật tiến độ:', error.message);
      throw new Error(`Không thể cập nhật tiến độ: ${error.message}`);
    }
  }

  // ==================== PRIVATE METHODS ====================

  /**
   * Chờ để tuân thủ rate limit (3 req/sec)
   * @private
   */
  async _rateLimitWait() {
    const now = Date.now();
    const elapsed = now - this._lastRequestTime;

    if (elapsed < MIN_REQUEST_INTERVAL) {
      await new Promise(resolve =>
        setTimeout(resolve, MIN_REQUEST_INTERVAL - elapsed)
      );
    }

    this._lastRequestTime = Date.now();
  }

  /**
   * Retry logic khi gặp rate limit (HTTP 429)
   * @private
   * @param {Function} fn - Hàm cần thực thi
   * @param {number} [retries=0] - Số lần đã retry
   * @returns {Promise<*>} Kết quả
   */
  async _retryOnRateLimit(fn, retries = 0) {
    try {
      return await fn();
    } catch (error) {
      if (error.status === 429 && retries < MAX_RETRIES) {
        // Notion trả về retry-after header, đợi thêm thời gian
        const waitTime = Math.pow(2, retries + 1) * 1000; // Exponential backoff
        console.warn(`[NotionSync] Rate limited, đợi ${waitTime}ms (retry ${retries + 1}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return this._retryOnRateLimit(fn, retries + 1);
      }
      throw error;
    }
  }

  /**
   * Tìm page hiện có trong database dựa trên domain_id
   * @private
   * @param {string} databaseId - ID database
   * @param {string} domainId - ID chuyên khoa
   * @returns {Promise<Object|null>} Page tìm được hoặc null
   */
  async _findExistingPage(databaseId, domainId) {
    try {
      await this._rateLimitWait();

      const response = await this.notion.databases.query({
        database_id: databaseId,
        filter: {
          property: 'Domain ID',
          rich_text: {
            equals: domainId
          }
        },
        page_size: 1
      });

      return response.results.length > 0 ? response.results[0] : null;
    } catch (error) {
      console.error(`[NotionSync] Lỗi tìm page cho ${domainId}:`, error.message);
      return null;
    }
  }

  /**
   * Xây dựng properties cho tracker page
   * @private
   * @param {Object} tracker - Dữ liệu tracker
   * @returns {Object} Notion properties
   */
  _buildTrackerProperties(tracker) {
    const score = tracker.score || 0;
    let status = 'Chưa học';
    if (score >= 70) status = 'Tốt';
    else if (score >= 40) status = 'Trung bình';
    else if (score > 0) status = 'Cần cải thiện';

    const properties = {
      'Chuyên khoa': { title: [{ text: { content: tracker.domain_name || tracker.domain_id } }] },
      'Domain ID': { rich_text: [{ text: { content: tracker.domain_id } }] },
      'Điểm': { number: score / 100 }, // Notion percent format expects 0-1
      'Trạng thái': { select: { name: status } }
    };

    if (tracker.difficulty !== undefined) {
      properties['Mức độ khó'] = { number: tracker.difficulty };
    }
    if (tracker.total_questions !== undefined) {
      properties['Tổng câu hỏi'] = { number: tracker.total_questions };
    }
    if (tracker.correct_answers !== undefined) {
      properties['Câu đúng'] = { number: tracker.correct_answers };
    }
    if (tracker.last_review) {
      properties['Lần ôn cuối'] = { date: { start: tracker.last_review.split('T')[0] } };
    }
    if (tracker.next_review_date) {
      properties['Lần ôn tiếp'] = { date: { start: tracker.next_review_date.split('T')[0] } };
    }
    if (tracker.easiness_factor !== undefined) {
      properties['Hệ số dễ (EF)'] = { number: tracker.easiness_factor };
    }

    return properties;
  }

  /**
   * Xây dựng nội dung trang bài kiểm tra
   * @private
   * @param {Object} testData - Dữ liệu bài kiểm tra
   * @returns {Object[]} Notion blocks
   */
  _buildTestPageContent(testData) {
    const children = [];

    if (testData.content) {
      // Chia nội dung thành các đoạn (Notion giới hạn 2000 ký tự/block)
      const chunks = this._chunkText(testData.content, 1900);
      for (const chunk of chunks) {
        children.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: chunk } }]
          }
        });
      }
    }

    return children;
  }

  /**
   * Xây dựng nội dung trang bài giảng
   * @private
   * @param {Object} lessonData - Dữ liệu bài giảng
   * @returns {Object[]} Notion blocks
   */
  _buildLessonPageContent(lessonData) {
    const children = [];

    // Key points
    if (lessonData.key_points && lessonData.key_points.length > 0) {
      children.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: '📌 Điểm chính' } }]
        }
      });
      for (const point of lessonData.key_points) {
        children.push({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [{ type: 'text', text: { content: point } }]
          }
        });
      }
    }

    // Clinical pearls
    if (lessonData.clinical_pearls && lessonData.clinical_pearls.length > 0) {
      children.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: '💎 Clinical Pearls' } }]
        }
      });
      for (const pearl of lessonData.clinical_pearls) {
        children.push({
          object: 'block',
          type: 'callout',
          callout: {
            rich_text: [{ type: 'text', text: { content: pearl } }],
            icon: { emoji: '💎' }
          }
        });
      }
    }

    // Core content
    if (lessonData.core_content) {
      children.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: '📖 Nội dung bài giảng' } }]
        }
      });
      const chunks = this._chunkText(lessonData.core_content, 1900);
      for (const chunk of chunks) {
        children.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: chunk } }]
          }
        });
      }
    }

    return children;
  }

  /**
   * Chia text thành các đoạn nhỏ hơn giới hạn Notion
   * @private
   * @param {string} text - Text cần chia
   * @param {number} maxLength - Độ dài tối đa mỗi đoạn
   * @returns {string[]} Mảng các đoạn text
   */
  _chunkText(text, maxLength) {
    if (text.length <= maxLength) return [text];

    const chunks = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // Tìm vị trí xuống dòng gần nhất để cắt tự nhiên
      let cutAt = remaining.lastIndexOf('\n', maxLength);
      if (cutAt === -1 || cutAt < maxLength * 0.5) {
        // Nếu không tìm thấy, cắt tại khoảng trắng
        cutAt = remaining.lastIndexOf(' ', maxLength);
      }
      if (cutAt === -1) {
        cutAt = maxLength;
      }

      chunks.push(remaining.substring(0, cutAt));
      remaining = remaining.substring(cutAt).trimStart();
    }

    return chunks;
  }
}

module.exports = NotionSync;
