'use strict';

/**
 * @fileoverview RadarBuilder - Tạo biểu đồ radar cho Chart.js
 * Xây dựng cấu hình biểu đồ radar hiển thị năng lực các chuyên khoa,
 * hỗ trợ so sánh hiện tại vs trước đó với mã màu theo mức độ.
 */

/** Các chuyên khoa y khoa */
const DOMAINS = [
  { id: 'internal', name: 'Nội khoa (Internal Medicine)' },
  { id: 'surgery', name: 'Ngoại khoa & Chấn thương (Surgery & Trauma)' },
  { id: 'obgyn', name: 'Sản phụ khoa (OB/GYN)' },
  { id: 'pediatrics', name: 'Nhi khoa (Pediatrics)' },
  { id: 'emergency', name: 'Cấp cứu & Hồi sức (Emergency & Critical Care)' },
  { id: 'psychiatry', name: 'Tâm thần & Thần kinh (Psychiatry & Neurology)' },
  { id: 'pathology', name: 'Giải phẫu bệnh & Sinh lý bệnh (Pathology)' },
  { id: 'pharmacology', name: 'Dược lý lâm sàng (Pharmacology)' },
  { id: 'physiology', name: 'Sinh lý học y khoa (Medical Physiology)' },
  { id: 'microbiology', name: 'Vi sinh & Miễn dịch học (Microbiology & Immunology)' },
  { id: 'biochemistry', name: 'Hóa sinh & Di truyền y khoa (Biochemistry & Genetics)' },
  { id: 'community', name: 'Y học dự phòng, Thống kê & Y đức (Preventive, Biostats & Ethics)' },
  { id: 'diagnostics', name: 'Cận lâm sàng & Chẩn đoán hình ảnh (Diagnostics)' }
];

/** Ngưỡng màu sắc */
const COLOR_THRESHOLDS = {
  RED: 40,     // < 40: đỏ (yếu)
  YELLOW: 70   // 40-70: vàng (trung bình), > 70: xanh (tốt)
};

/** Bảng màu */
const COLORS = {
  red: { bg: 'rgba(255, 99, 132, 0.2)', border: 'rgba(255, 99, 132, 1)', point: 'rgba(255, 99, 132, 1)' },
  yellow: { bg: 'rgba(255, 206, 86, 0.2)', border: 'rgba(255, 206, 86, 1)', point: 'rgba(255, 206, 86, 1)' },
  green: { bg: 'rgba(75, 192, 192, 0.2)', border: 'rgba(75, 192, 192, 1)', point: 'rgba(75, 192, 192, 1)' },
  current: { bg: 'rgba(54, 162, 235, 0.2)', border: 'rgba(54, 162, 235, 1)', point: 'rgba(54, 162, 235, 1)' },
  previous: { bg: 'rgba(153, 102, 255, 0.1)', border: 'rgba(153, 102, 255, 0.6)', point: 'rgba(153, 102, 255, 0.6)' }
};

/**
 * Lớp xây dựng biểu đồ radar cho Chart.js
 * @class RadarBuilder
 */
class RadarBuilder {
  /**
   * Xây dựng cấu hình biểu đồ radar từ dữ liệu tracker
   * @param {Object[]} trackerData - Dữ liệu tracker các chuyên khoa
   * @param {string} trackerData[].domain_id - ID chuyên khoa
   * @param {number} trackerData[].score - Điểm (0-100)
   * @param {string} [trackerData[].domain_name] - Tên chuyên khoa
   * @returns {Object} Cấu hình Chart.js radar
   * @returns {string[]} return.labels - Nhãn các trục
   * @returns {Object[]} return.datasets - Dữ liệu biểu đồ
   * @returns {Object} return.options - Tùy chọn Chart.js
   */
  build(trackerData = []) {
    try {
      // Tạo nhãn từ DOMAINS, giữ thứ tự cố định
      const labels = DOMAINS.map(d => d.name);

      // Map điểm số cho mỗi chuyên khoa
      const scores = DOMAINS.map(d => {
        const tracker = trackerData.find(t => t.domain_id === d.id);
        return tracker ? Math.round(tracker.score * 100) / 100 : 0;
      });

      // Tính điểm trung bình
      const avgScore = scores.reduce((s, v) => s + v, 0) / scores.length;

      // Xác định màu dựa trên điểm trung bình
      const colorScheme = this._getColorScheme(avgScore);

      // Tạo mảng màu cho từng điểm (point-level coloring)
      const pointColors = scores.map(s => this._getPointColor(s));

      const datasets = [{
        label: 'Năng lực hiện tại',
        data: scores,
        backgroundColor: colorScheme.bg,
        borderColor: colorScheme.border,
        pointBackgroundColor: pointColors,
        pointBorderColor: pointColors,
        pointRadius: 5,
        pointHoverRadius: 7,
        borderWidth: 2,
        fill: true
      }];

      const options = this._buildOptions(avgScore);

      return {
        labels,
        datasets,
        options,
        metadata: {
          average_score: Math.round(avgScore * 100) / 100,
          strongest: this._findStrongest(scores, labels),
          weakest: this._findWeakest(scores, labels),
          generated_at: new Date().toISOString()
        }
      };
    } catch (error) {
      console.error('[RadarBuilder] Lỗi xây dựng biểu đồ:', error.message);
      return this._emptyChart();
    }
  }

  /**
   * Xây dựng biểu đồ so sánh hiện tại vs trước đó
   * @param {Object[]} current - Dữ liệu tracker hiện tại
   * @param {Object[]} previous - Dữ liệu tracker trước đó
   * @returns {Object} Cấu hình Chart.js radar với 2 datasets
   */
  buildComparison(current = [], previous = []) {
    try {
      const labels = DOMAINS.map(d => d.name);

      const currentScores = DOMAINS.map(d => {
        const tracker = current.find(t => t.domain_id === d.id);
        return tracker ? Math.round(tracker.score * 100) / 100 : 0;
      });

      const previousScores = DOMAINS.map(d => {
        const tracker = previous.find(t => t.domain_id === d.id);
        return tracker ? Math.round(tracker.score * 100) / 100 : 0;
      });

      // Tính sự thay đổi cho mỗi chuyên khoa
      const changes = currentScores.map((c, i) => ({
        domain: labels[i],
        current: c,
        previous: previousScores[i],
        change: Math.round((c - previousScores[i]) * 100) / 100,
        improved: c > previousScores[i]
      }));

      const datasets = [
        {
          label: 'Hiện tại',
          data: currentScores,
          backgroundColor: COLORS.current.bg,
          borderColor: COLORS.current.border,
          pointBackgroundColor: COLORS.current.point,
          pointBorderColor: COLORS.current.point,
          pointRadius: 5,
          pointHoverRadius: 7,
          borderWidth: 2,
          fill: true
        },
        {
          label: 'Lần trước',
          data: previousScores,
          backgroundColor: COLORS.previous.bg,
          borderColor: COLORS.previous.border,
          pointBackgroundColor: COLORS.previous.point,
          pointBorderColor: COLORS.previous.point,
          pointRadius: 4,
          pointHoverRadius: 6,
          borderWidth: 1.5,
          borderDash: [5, 5],
          fill: true
        }
      ];

      const avgCurrent = currentScores.reduce((s, v) => s + v, 0) / currentScores.length;
      const avgPrevious = previousScores.reduce((s, v) => s + v, 0) / previousScores.length;

      const options = this._buildOptions(avgCurrent);

      return {
        labels,
        datasets,
        options,
        metadata: {
          current_average: Math.round(avgCurrent * 100) / 100,
          previous_average: Math.round(avgPrevious * 100) / 100,
          overall_change: Math.round((avgCurrent - avgPrevious) * 100) / 100,
          changes,
          most_improved: changes.sort((a, b) => b.change - a.change)[0],
          most_declined: changes.sort((a, b) => a.change - b.change)[0],
          generated_at: new Date().toISOString()
        }
      };
    } catch (error) {
      console.error('[RadarBuilder] Lỗi xây dựng biểu đồ so sánh:', error.message);
      return this._emptyChart();
    }
  }

  /**
   * Xác định bộ màu dựa trên điểm trung bình
   * @private
   * @param {number} avgScore - Điểm trung bình
   * @returns {Object} Bộ màu {bg, border}
   */
  _getColorScheme(avgScore) {
    if (avgScore < COLOR_THRESHOLDS.RED) return COLORS.red;
    if (avgScore < COLOR_THRESHOLDS.YELLOW) return COLORS.yellow;
    return COLORS.green;
  }

  /**
   * Xác định màu cho từng điểm dữ liệu
   * @private
   * @param {number} score - Điểm
   * @returns {string} Màu CSS
   */
  _getPointColor(score) {
    if (score < COLOR_THRESHOLDS.RED) return COLORS.red.point;
    if (score < COLOR_THRESHOLDS.YELLOW) return COLORS.yellow.point;
    return COLORS.green.point;
  }

  /**
   * Xây dựng tùy chọn Chart.js
   * @private
   * @param {number} avgScore - Điểm trung bình (để tùy chỉnh hiển thị)
   * @returns {Object} Tùy chọn Chart.js
   */
  _buildOptions(avgScore) {
    return {
      responsive: true,
      maintainAspectRatio: true,
      scales: {
        r: {
          angleLines: {
            display: true,
            color: 'rgba(0, 0, 0, 0.1)'
          },
          grid: {
            color: 'rgba(0, 0, 0, 0.1)'
          },
          pointLabels: {
            font: {
              size: 12,
              family: "'Segoe UI', 'Roboto', sans-serif"
            },
            color: '#333'
          },
          suggestedMin: 0,
          suggestedMax: 100,
          ticks: {
            stepSize: 20,
            backdropColor: 'transparent',
            font: { size: 10 },
            callback: (value) => `${value}%`
          }
        }
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            font: { size: 13 },
            usePointStyle: true,
            padding: 20
          }
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const value = context.raw;
              let status = '';
              if (value < COLOR_THRESHOLDS.RED) status = ' ⚠️ Cần cải thiện';
              else if (value < COLOR_THRESHOLDS.YELLOW) status = ' 📊 Trung bình';
              else status = ' ✅ Tốt';
              return `${context.dataset.label}: ${value}%${status}`;
            }
          }
        },
        title: {
          display: true,
          text: `Biểu đồ năng lực y khoa (TB: ${Math.round(avgScore)}%)`,
          font: { size: 16, weight: 'bold' },
          padding: { bottom: 20 }
        }
      },
      elements: {
        line: {
          tension: 0.1
        }
      }
    };
  }

  /**
   * Tìm chuyên khoa mạnh nhất
   * @private
   * @param {number[]} scores - Mảng điểm
   * @param {string[]} labels - Nhãn chuyên khoa
   * @returns {Object} {domain, score}
   */
  _findStrongest(scores, labels) {
    const maxIdx = scores.indexOf(Math.max(...scores));
    return { domain: labels[maxIdx], score: scores[maxIdx] };
  }

  /**
   * Tìm chuyên khoa yếu nhất
   * @private
   * @param {number[]} scores - Mảng điểm
   * @param {string[]} labels - Nhãn chuyên khoa
   * @returns {Object} {domain, score}
   */
  _findWeakest(scores, labels) {
    const nonZeroScores = scores.map((s, i) => ({ score: s, idx: i })).filter(s => s.score > 0);
    if (nonZeroScores.length === 0) {
      return { domain: labels[0], score: 0 };
    }
    nonZeroScores.sort((a, b) => a.score - b.score);
    return { domain: labels[nonZeroScores[0].idx], score: nonZeroScores[0].score };
  }

  /**
   * Trả về biểu đồ rỗng (fallback khi lỗi)
   * @private
   * @returns {Object} Cấu hình biểu đồ rỗng
   */
  _emptyChart() {
    return {
      labels: DOMAINS.map(d => d.name),
      datasets: [{
        label: 'Chưa có dữ liệu',
        data: new Array(DOMAINS.length).fill(0),
        backgroundColor: 'rgba(200, 200, 200, 0.2)',
        borderColor: 'rgba(200, 200, 200, 0.5)',
        borderWidth: 1,
        fill: true
      }],
      options: this._buildOptions(0),
      metadata: {
        average_score: 0,
        generated_at: new Date().toISOString()
      }
    };
  }
}

module.exports = RadarBuilder;
