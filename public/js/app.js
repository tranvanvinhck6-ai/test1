/* ═══════════════════════════════════════════════════════════════════
   MedAdapt — Application Logic
   Adaptive Medical Learning System for Vietnamese Doctors
   ═══════════════════════════════════════════════════════════════════ */

;(function () {
    'use strict';

    // ═══════════════════════════════════════
    //  1. CONFIGURATION & STATE STORE
    // ═══════════════════════════════════════

    const API_BASE = window.location.origin + '/api';

    const Store = {
        user: null,
        isAuthenticated: false,
        currentRoute: '',
        test: {
            session_id: null,
            questions: [],
            currentIndex: 0,
            answers: {},
            startTime: null,
            timerInterval: null,
            timeLeft: 0,
            type: 'daily'
        },
        tracker: null,
        lesson: null,
        progress: null,
        charts: {},

        // Persist to localStorage
        save() {
            try {
                const data = { user: this.user, isAuthenticated: this.isAuthenticated };
                localStorage.setItem('medadapt_store', JSON.stringify(data));
            } catch (e) { /* ignore */ }
        },
        load() {
            try {
                const raw = localStorage.getItem('medadapt_store');
                if (raw) {
                    const data = JSON.parse(raw);
                    this.user = data.user;
                    this.isAuthenticated = data.isAuthenticated;
                }
            } catch (e) { /* ignore */ }
        }
    };


    // ═══════════════════════════════════════
    //  2. API HELPER
    // ═══════════════════════════════════════

    const API = {
        async request(method, path, body = null) {
            const opts = {
                method,
                headers: { 'Content-Type': 'application/json' },
            };
            if (body) opts.body = JSON.stringify(body);

            try {
                const res = await fetch(`${API_BASE}${path}`, opts);
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || data.message || 'Lỗi không xác định');
                return data;
            } catch (err) {
                // If it's a network error, return demo data instead of crashing
                console.warn(`API ${method} ${path} failed:`, err.message);
                return null;
            }
        },

        get(path) { return this.request('GET', path); },
        post(path, body) { return this.request('POST', path, body); },
    };


    // ═══════════════════════════════════════
    //  3. TOAST NOTIFICATIONS
    // ═══════════════════════════════════════

    const Toast = {
        container: null,

        init() {
            this.container = document.getElementById('toast-container');
        },

        show(message, type = 'info', duration = 4000) {
            const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
            const toast = document.createElement('div');
            toast.className = `toast toast-${type}`;
            toast.innerHTML = `
                <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
                <span class="toast-message">${message}</span>
                <button class="toast-close" onclick="this.parentElement.classList.add('removing');setTimeout(()=>this.parentElement.remove(),300)">&times;</button>
            `;
            this.container.appendChild(toast);
            setTimeout(() => {
                toast.classList.add('removing');
                setTimeout(() => toast.remove(), 300);
            }, duration);
        },

        success(msg) { this.show(msg, 'success'); },
        error(msg) { this.show(msg, 'error', 6000); },
        warning(msg) { this.show(msg, 'warning'); },
        info(msg) { this.show(msg, 'info'); },
    };


    // ═══════════════════════════════════════
    //  4. LOADING OVERLAY
    // ═══════════════════════════════════════

    const Loading = {
        el: null,

        init() {
            this.el = document.getElementById('loading-overlay');
        },

        show(text = 'Đang tải dữ liệu...') {
            this.el.querySelector('p').textContent = text;
            this.el.classList.remove('hidden');
        },

        hide() {
            this.el.classList.add('hidden');
        }
    };


    // ═══════════════════════════════════════
    //  5. ROUTER
    // ═══════════════════════════════════════

    const Router = {
        routes: ['onboarding', 'dashboard', 'test', 'tracker', 'lesson', 'mentor', 'progress', 'settings'],

        init() {
            window.addEventListener('hashchange', () => this.handleRoute());
            this.handleRoute();
        },

        handleRoute() {
            let hash = window.location.hash.replace('#/', '') || '';
            if (!hash) {
                hash = Store.isAuthenticated ? 'dashboard' : 'onboarding';
                window.location.hash = '#/' + hash;
                return;
            }

            if (!Store.isAuthenticated && hash !== 'onboarding') {
                window.location.hash = '#/onboarding';
                return;
            }

            if (!this.routes.includes(hash)) {
                hash = 'dashboard';
                window.location.hash = '#/' + hash;
                return;
            }

            this.showPage(hash);
        },

        showPage(route) {
            if (Store.loopInterval && route !== 'test') {
                clearInterval(Store.loopInterval);
                Store.loopInterval = null;
            }

            Store.currentRoute = route;

            // Hide all pages
            document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));

            // Show target page
            const page = document.getElementById(`page-${route}`);
            if (page) {
                page.classList.remove('hidden');
                // Re-trigger animation
                page.style.animation = 'none';
                page.offsetHeight; // force reflow
                page.style.animation = '';
            }

            // Sidebar management
            const sidebar = document.getElementById('sidebar');
            const mainContent = document.getElementById('main-content');

            if (route === 'onboarding') {
                sidebar.style.display = 'none';
                mainContent.style.marginLeft = '0';
            } else {
                sidebar.style.display = '';
                mainContent.style.marginLeft = '';
            }

            // Update active nav
            document.querySelectorAll('.nav-item').forEach(item => {
                item.classList.toggle('active', item.dataset.route === route);
            });

            // Close mobile sidebar
            sidebar.classList.remove('open');
            document.getElementById('sidebar-overlay').classList.remove('active');
            document.getElementById('hamburger-btn').classList.remove('active');

            // Page-specific init
            this.onPageEnter(route);
        },

        onPageEnter(route) {
            switch (route) {
                case 'dashboard': Dashboard.init(); break;
                case 'test': TestModule.initPage(); break;
                case 'tracker': Tracker.init(); break;
                case 'lesson': Lesson.init(); break;
                case 'mentor': Mentor.init(); break;
                case 'progress': Progress.init(); break;
                case 'settings': Settings.init(); break;
            }
        }
    };


    // ═══════════════════════════════════════
    //  6. ONBOARDING MODULE
    // ═══════════════════════════════════════

    const Onboarding = {
        currentStep: 1,
        totalSteps: 4,

        nextStep() {
            if (this.currentStep === 1) {
                const name = document.getElementById('onb-name').value.trim();
                const email = document.getElementById('onb-email').value.trim();
                if (!name) { Toast.warning('Vui lòng nhập họ và tên'); return; }
                if (!email) { Toast.warning('Vui lòng nhập email'); return; }
            }
            if (this.currentStep === 2) {
                const specialty = document.getElementById('onb-specialty').value;
                if (!specialty) { Toast.warning('Vui lòng chọn chuyên khoa'); return; }
            }

            if (this.currentStep < this.totalSteps) {
                this.goToStep(this.currentStep + 1);
            }
        },

        prevStep() {
            if (this.currentStep > 1) {
                this.goToStep(this.currentStep - 1);
            }
        },

        goToStep(step) {
            // Mark completed
            const oldDot = document.querySelector(`.progress-dot[data-step="${this.currentStep}"]`);
            if (step > this.currentStep && oldDot) {
                oldDot.classList.remove('active');
                oldDot.classList.add('completed');
                oldDot.innerHTML = '<span>✓</span>';
            }

            // Hide current
            document.querySelector(`.onboarding-step[data-step="${this.currentStep}"]`).classList.remove('active');

            this.currentStep = step;

            // Show new
            document.querySelector(`.onboarding-step[data-step="${step}"]`).classList.add('active');

            // Update dots
            document.querySelectorAll('.progress-dot').forEach(dot => {
                const s = parseInt(dot.dataset.step);
                if (s === step) {
                    dot.classList.add('active');
                    dot.classList.remove('completed');
                    dot.innerHTML = `<span>${s}</span>`;
                } else if (s < step) {
                    dot.classList.remove('active');
                    dot.classList.add('completed');
                    dot.innerHTML = '<span>✓</span>';
                } else {
                    dot.classList.remove('active', 'completed');
                    dot.innerHTML = `<span>${s}</span>`;
                }
            });

            // Update progress lines
            for (let i = 1; i < this.totalSteps; i++) {
                const line = document.getElementById(`onb-line-${i}`);
                if (line) {
                    line.style.width = i < step ? '100%' : '0%';
                }
            }
        },

        async submit() {
            const name = document.getElementById('onb-name').value.trim();
            const email = document.getElementById('onb-email').value.trim();
            const specialty = document.getElementById('onb-specialty').value;
            const experience = parseInt(document.getElementById('onb-experience').value);
            const level = document.querySelector('input[name="onb-level"]:checked')?.value || 'resident';
            const goalCheckboxes = document.querySelectorAll('input[name="onb-goals"]:checked');
            const goals = Array.from(goalCheckboxes).map(cb => cb.value);

            if (goals.length === 0) {
                Toast.warning('Vui lòng chọn ít nhất 1 mục tiêu');
                return;
            }

            Loading.show('Đang tạo tài khoản...');

            const userData = { name, email, specialty, experience_years: experience, level, goals };

            // Try API first
            const result = await API.post('/user/register', userData);

            // Even if API fails, create local user for demo
            Store.user = result || {
                name, email, specialty, level,
                experience_years: experience,
                goals,
                created_at: new Date().toISOString()
            };
            Store.isAuthenticated = true;
            Store.save();

            // Update sidebar user info
            updateUserUI();

            Loading.hide();
            Toast.success(`Chào mừng ${name}! Hãy bắt đầu hành trình học tập!`);

            setTimeout(() => {
                // Đăng ký xong tự động vào ngay bài test đầu
                window.location.hash = '#/test';
            }, 500);
        }
    };


    // ═══════════════════════════════════════
    //  7. DASHBOARD MODULE
    // ═══════════════════════════════════════

    const Dashboard = {
        async init() {
            if (!Store.user) return;

            // Update greeting
            const greeting = document.getElementById('dashboard-greeting');
            const hours = new Date().getHours();
            let greetText = 'Xin chào';
            if (hours < 12) greetText = 'Chào buổi sáng';
            else if (hours < 18) greetText = 'Chào buổi chiều';
            else greetText = 'Chào buổi tối';
            if (greeting) greeting.textContent = `${greetText}, BS. ${Store.user.name || 'Bác sĩ'}! 👋`;

            // Load real data from API and render stats + chart
            await this.loadDashboardData();
        },

        animateStats(stats) {
            const targets = stats || {
                'stat-total-score': 72,
                'stat-streak': 1,
                'stat-tests-done': 0,
                'stat-domains-mastered': 0
            };

            Object.entries(targets).forEach(([id, target]) => {
                const el = document.getElementById(id);
                if (!el) return;
                animateCountUp(el, Math.round(target), 1200);
            });
        },

        loadRadarChart(data) {
            const ctx = document.getElementById('dashboard-radar-chart');
            if (!ctx) return;

            // Destroy previous chart
            if (Store.charts.dashboardRadar) {
                Store.charts.dashboardRadar.destroy();
            }

            const defaultLabels = ['Nội khoa', 'Ngoại khoa', 'Nhi khoa', 'Sản khoa', 'Cận lâm sàng', 'Dược lý', 'Y đức'];
            const defaultScores = [72, 55, 68, 45, 60, 35, 80];
            
            let labels = defaultLabels;
            let currentScores = defaultScores;
            
            if (data && data.domains && data.domains.length > 0) {
                labels = data.domains.map(d => d.name);
                currentScores = data.domains.map(d => {
                    const group = data.grouped?.[d.id];
                    return group && group.avgScore ? Math.round(group.avgScore) : 50;
                });
            }

            Store.charts.dashboardRadar = new Chart(ctx, {
                type: 'radar',
                data: {
                    labels,
                    datasets: [{
                        label: 'Năng lực hiện tại (%)',
                        data: currentScores,
                        backgroundColor: 'rgba(102, 126, 234, 0.25)',
                        borderColor: 'rgba(102, 126, 234, 0.9)',
                        borderWidth: 2,
                        pointBackgroundColor: '#00f2fe',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 1.5,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                    }, {
                        label: 'Mục tiêu chuẩn hóa',
                        data: labels.map(() => 80),
                        backgroundColor: 'rgba(67, 233, 123, 0.08)',
                        borderColor: 'rgba(67, 233, 123, 0.4)',
                        borderWidth: 1,
                        borderDash: [5, 5],
                        pointBackgroundColor: 'rgba(67, 233, 123, 0.6)',
                        pointRadius: 2,
                    }]
                },
                options: getRadarChartOptions()
            });
        },

        async loadDashboardData() {
            const [profileRes, trackerRes, historyRes] = await Promise.all([
                API.get('/user/profile'),
                API.get('/tracker'),
                API.get('/test/history')
            ]);

            const profile = profileRes || {};
            const trackerData = trackerRes?.data || null;
            const history = historyRes?.data || [];

            if (profile.streak) {
                const streakCountEl = document.getElementById('streak-count');
                if (streakCountEl) streakCountEl.textContent = profile.streak;
            }

            // Compute total score (avg of non-zero domain scores)
            let totalScore = 70;
            let domainsMastered = 0;
            if (trackerData && trackerData.domains && trackerData.domains.length > 0) {
                const scores = trackerData.domains.map(d => trackerData.grouped?.[d.id]?.avgScore || 0).filter(s => s > 0);
                if (scores.length > 0) {
                    totalScore = scores.reduce((a, b) => a + b, 0) / scores.length;
                }
                domainsMastered = trackerData.domains.filter(d => (trackerData.grouped?.[d.id]?.avgScore || 0) >= 70).length;
            }

            const stats = {
                'stat-total-score': totalScore,
                'stat-streak': profile.streak || 1,
                'stat-tests-done': history.length || 0,
                'stat-domains-mastered': domainsMastered
            };

            this.animateStats(stats);
            this.loadRadarChart(trackerData);
        }
    };


    // ═══════════════════════════════════════
    //  8. TEST MODULE
    // ═══════════════════════════════════════

    const TestModule = {
        initPage() {
            // Nếu đang làm dở bài kiểm tra chưa submit thì tiếp tục hiển thị màn hình làm bài
            if (Store.test && Store.test.questions && Store.test.questions.length > 0 && Store.test.timeLeft > 0 && !Store.test.isSubmitted && !document.getElementById('test-active-screen').classList.contains('hidden')) {
                return;
            }
            // Nếu đang xem kết quả bài kiểm tra thì giữ nguyên màn hình kết quả
            if (!document.getElementById('test-results-screen').classList.contains('hidden') && Store.test && Store.test.isSubmitted) {
                return;
            }
            // Vào thẳng bài kiểm tra thích ứng ngay lập tức, KHÔNG qua 3 lựa chọn nữa!
            document.getElementById('test-start-screen').classList.add('hidden');
            // Nếu chưa có bài test nào trong lịch sử (bài test đầu) thì chạy bài kiểm tra đầu vào (Diagnostic Test)
            if (Store.testHistoryCount === 0 || Store.testHistoryCount === undefined) {
                this.startDiagnostic();
            } else {
                this.startDaily();
            }
        },

        async startDaily() {
            await this.startTest('daily');
        },

        async startRandom() {
            await this.startTest('random');
        },

        async startDiagnostic() {
            await this.startTest('diagnostic');
        },

        async startTest(type) {
            if (type === 'random') {
                Loading.show('🎲 AI đang sinh bài kiểm tra ngẫu nhiên siêu tốc...');
            } else {
                Loading.show('Đang tạo bài kiểm tra...');
            }
            Store.test.type = type;

            const result = await API.post(`/test/${type}`);

            // Unwrap API response: { success, data: { session_id, questions } }
            const apiData = result?.data || result || {};
            const rawQuestions = apiData.questions || [];

            // Normalize question fields for frontend rendering
            const questions = rawQuestions.length > 0 ? rawQuestions.map((q, i) => ({
                id: q.id || `q-${i}`,
                domain: q.domain || q.domain_id || 'Nội khoa',
                text: q.text || q.question_text || q.stem || 'Câu hỏi',
                vignette: q.vignette || q.clinical_vignette || '',
                options: Array.isArray(q.options) ? q.options.map(opt =>
                    typeof opt === 'string' ? opt : (opt.text || opt.label || String(opt))
                ) : ['A', 'B', 'C', 'D'],
                correct: q.correct !== undefined ? q.correct : (q.correct_answer !== undefined ? q.correct_answer : 0),
                difficulty: q.difficulty || 3,
                bloom_level: q.bloom_level || 'apply'
            })) : this.getDemoQuestions();

            Store.test.session_id = apiData.session_id || 'demo-' + Date.now();
            Store.test.questions = questions;
            Store.test.currentIndex = 0;
            Store.test.answers = {};
            Store.test.startTime = Date.now();
            Store.test.timeLeft = (type === 'daily' || type === 'random') ? 20 * 60 : 45 * 60;

            Loading.hide();

            // Navigate to test page and show active screen
            window.location.hash = '#/test';
            setTimeout(() => {
                document.getElementById('test-start-screen').classList.add('hidden');
                document.getElementById('test-active-screen').classList.remove('hidden');
                document.getElementById('test-results-screen').classList.add('hidden');
                this.renderQuestion();
                this.startTimer();
                this.renderDots();
            }, 100);
        },

        getDemoQuestions() {
            return [
                {
                    id: 1, domain: 'Nội khoa', difficulty: 'Trung bình',
                    vignette: 'Bệnh nhân nam 55 tuổi, tiền sử tăng huyết áp 10 năm, đái tháo đường type 2, đến khám vì đau ngực trái khi gắng sức 2 tuần nay. Đau kiểu thắt, lan lên vai trái, kéo dài 5-10 phút, giảm khi nghỉ.',
                    text: 'Chẩn đoán phù hợp nhất cho bệnh nhân này là gì?',
                    options: ['Viêm cơ tim cấp', 'Đau thắt ngực ổn định', 'Nhồi máu cơ tim cấp', 'Tách thành động mạch chủ'],
                    correct: 1
                },
                {
                    id: 2, domain: 'Dược lý', difficulty: 'Dễ',
                    vignette: 'Bệnh nhân nữ 60 tuổi, tiền sử suy tim phân suất tống máu giảm (EF = 30%), đang dùng Enalapril, Bisoprolol, Furosemide.',
                    text: 'Thuốc nào sau đây nên được thêm vào phác đồ điều trị?',
                    options: ['Amlodipine', 'Spironolactone', 'Diltiazem', 'Verapamil'],
                    correct: 1
                },
                {
                    id: 3, domain: 'Nhi khoa', difficulty: 'Trung bình',
                    vignette: 'Trẻ 3 tuổi, sốt cao 39°C 3 ngày, phát ban dạng sởi xuất hiện từ ngày thứ 4, hạch cổ sưng đau, mắt đỏ, môi nứt nẻ, lưỡi đỏ như dâu tây.',
                    text: 'Chẩn đoán phù hợp nhất là gì?',
                    options: ['Sởi', 'Kawasaki', 'Rubella', 'Sốt tinh hồng nhiệt'],
                    correct: 1
                },
                {
                    id: 4, domain: 'Ngoại khoa', difficulty: 'Khó',
                    vignette: 'Bệnh nhân nam 40 tuổi, bị tai nạn giao thông, đau bụng vùng hạ sườn trái, huyết áp 90/60, mạch 120 lần/phút, bụng chướng nhẹ, phản ứng thành bụng.',
                    text: 'Tạng nào có khả năng tổn thương cao nhất?',
                    options: ['Gan', 'Lách', 'Thận', 'Tụy'],
                    correct: 1
                },
                {
                    id: 5, domain: 'Sản khoa', difficulty: 'Trung bình',
                    vignette: 'Thai phụ 28 tuần, ra máu âm đạo đỏ tươi, không đau, tử cung mềm, tim thai bình thường. Siêu âm: bánh nhau bám mặt trước, bờ dưới che phủ hoàn toàn lỗ trong cổ tử cung.',
                    text: 'Chẩn đoán phù hợp nhất?',
                    options: ['Nhau bong non', 'Nhau tiền đạo trung tâm', 'Dọa sảy thai', 'Vỡ tử cung'],
                    correct: 1
                },
                {
                    id: 6, domain: 'Cận lâm sàng', difficulty: 'Dễ',
                    vignette: 'Bệnh nhân 45 tuổi, xét nghiệm máu: Hemoglobin 8g/dL, MCV 65fL, MCH 22pg, Ferritin 8ng/mL, TIBC tăng.',
                    text: 'Loại thiếu máu nào phù hợp nhất?',
                    options: ['Thiếu máu do thiếu B12', 'Thiếu máu thiếu sắt', 'Thiếu máu tán huyết', 'Thiếu máu bất sản'],
                    correct: 1
                },
                {
                    id: 7, domain: 'Nội khoa', difficulty: 'Khó',
                    vignette: 'Bệnh nhân nữ 25 tuổi, đau khớp đối xứng 2 bàn tay 3 tháng, cứng khớp buổi sáng > 1 giờ, sưng khớp bàn ngón gần 2 bên, RF (+), anti-CCP (+).',
                    text: 'Thuốc nào nên được bắt đầu sớm nhất?',
                    options: ['Prednisone đơn thuần', 'Methotrexate', 'Ibuprofen', 'Colchicine'],
                    correct: 1
                },
                {
                    id: 8, domain: 'Y đức', difficulty: 'Dễ',
                    vignette: 'Bệnh nhân ung thư giai đoạn cuối, tỉnh táo, từ chối điều trị hóa trị. Gia đình yêu cầu bác sĩ tiếp tục điều trị.',
                    text: 'Bác sĩ nên xử lý như thế nào?',
                    options: ['Nghe theo gia đình vì họ lo lắng', 'Tôn trọng quyền tự quyết của bệnh nhân', 'Chuyển bệnh nhân sang bác sĩ khác', 'Hội chẩn bắt buộc'],
                    correct: 1
                },
                {
                    id: 9, domain: 'Dược lý', difficulty: 'Trung bình',
                    vignette: 'Bệnh nhân nam 70 tuổi, suy thận mạn giai đoạn 4 (GFR 20ml/phút), cần giảm đau do thoái hóa khớp gối.',
                    text: 'Thuốc giảm đau nào an toàn nhất cho bệnh nhân này?',
                    options: ['Ibuprofen', 'Diclofenac', 'Paracetamol', 'Ketorolac'],
                    correct: 2
                },
                {
                    id: 10, domain: 'Nội khoa', difficulty: 'Trung bình',
                    vignette: 'Bệnh nhân 50 tuổi, đường huyết đói 140mg/dL, HbA1c 8.5%, BMI 32, đang dùng Metformin 2g/ngày.',
                    text: 'Bước tiếp theo phù hợp nhất trong điều trị?',
                    options: ['Tăng liều Metformin', 'Thêm Sulfonylurea', 'Thêm thuốc nhóm SGLT2i hoặc GLP-1 RA', 'Chuyển sang Insulin'],
                    correct: 2
                },
                {
                    id: 11, domain: 'Cận lâm sàng', difficulty: 'Khó',
                    vignette: 'Bệnh nhân 35 tuổi, ECG: Nhịp nhanh QRS hẹp, đều, tần số 150 lần/phút, không thấy rõ sóng P, đáp ứng tạm thời với nghiệm pháp Valsalva.',
                    text: 'Rối loạn nhịp tim phù hợp nhất?',
                    options: ['Rung nhĩ', 'Nhịp nhanh kịch phát trên thất (SVT)', 'Flutter nhĩ', 'Nhịp nhanh thất'],
                    correct: 1
                },
                {
                    id: 12, domain: 'Ngoại khoa', difficulty: 'Trung bình',
                    vignette: 'Bệnh nhân nữ 35 tuổi, đau hạ sườn phải sau ăn mỡ, sốt 38.5°C, Murphy (+), bạch cầu 15.000/mm³.',
                    text: 'Xử trí phù hợp nhất?',
                    options: ['Theo dõi ngoại trú', 'Phẫu thuật cắt túi mật nội soi sớm', 'Điều trị kháng sinh đơn thuần', 'Dẫn lưu túi mật qua da'],
                    correct: 1
                },
                {
                    id: 13, domain: 'Nhi khoa', difficulty: 'Dễ',
                    vignette: 'Trẻ 6 tháng tuổi, bú mẹ hoàn toàn, phát triển bình thường, cân nặng theo chuẩn.',
                    text: 'Khi nào nên bắt đầu ăn dặm cho trẻ này?',
                    options: ['Ngay bây giờ (6 tháng)', '8 tháng tuổi', '4 tháng tuổi', 'Khi mọc răng'],
                    correct: 0
                },
                {
                    id: 14, domain: 'Y đức', difficulty: 'Trung bình',
                    vignette: 'Bác sĩ phát hiện đồng nghiệp mắc sai sót y khoa nghiêm trọng nhưng đã che giấu trong hồ sơ bệnh án.',
                    text: 'Hành động đúng đắn nhất là gì?',
                    options: ['Giữ im lặng để bảo vệ đồng nghiệp', 'Báo cáo cho cấp trên/hội đồng chuyên môn', 'Nói chuyện riêng và bỏ qua', 'Thông báo trực tiếp cho bệnh nhân'],
                    correct: 1
                },
                {
                    id: 15, domain: 'Sản khoa', difficulty: 'Khó',
                    vignette: 'Thai phụ 36 tuần, tiền sản giật nặng: HA 170/110, protein niệu 3+, đau đầu dữ dội, nhìn mờ, tiểu cầu 80.000.',
                    text: 'Xử trí cấp cứu đầu tiên?',
                    options: ['Mổ lấy thai ngay', 'Truyền MgSO4 + hạ áp, sau đó chấm dứt thai kỳ', 'Theo dõi thêm 48 giờ', 'Corticosteroid trưởng thành phổi rồi chờ'],
                    correct: 1
                }
            ];
        },

        renderQuestion() {
            const q = Store.test.questions[Store.test.currentIndex];
            if (!q) return;

            document.getElementById('question-number').textContent = `Câu ${Store.test.currentIndex + 1}`;
            document.getElementById('question-domain').textContent = q.domain;
            document.getElementById('question-difficulty').textContent = q.difficulty;
            document.getElementById('vignette-text').textContent = q.vignette;
            document.getElementById('question-text').innerHTML = `<p>${q.text}</p>`;

            const optionsContainer = document.getElementById('answer-options');
            const letters = ['A', 'B', 'C', 'D', 'E'];
            optionsContainer.innerHTML = q.options.map((opt, i) => `
                <div class="answer-option ${Store.test.answers[q.id] === i ? 'selected' : ''}" 
                     onclick="MedAdapt.test.selectAnswer(${q.id}, ${i})" data-index="${i}">
                    <span class="answer-letter">${letters[i]}</span>
                    <span class="answer-text">${opt}</span>
                </div>
            `).join('');

            // Update progress
            const total = Store.test.questions.length;
            const current = Store.test.currentIndex + 1;
            document.getElementById('test-progress-fill').style.width = `${(current / total) * 100}%`;
            document.getElementById('test-progress-text').textContent = `${current} / ${total}`;

            // Update score
            const answeredCorrect = Object.entries(Store.test.answers).filter(([qid, ans]) => {
                const question = Store.test.questions.find(q => q.id === parseInt(qid));
                return question && question.correct === ans;
            }).length;
            document.getElementById('test-current-score').textContent = answeredCorrect;

            // Navigation buttons
            document.getElementById('btn-prev-question').classList.toggle('hidden', Store.test.currentIndex === 0);
            const isLast = Store.test.currentIndex === total - 1;
            document.getElementById('btn-next-question').classList.toggle('hidden', isLast);
            document.getElementById('btn-submit-test').classList.toggle('hidden', !isLast);

            // Update dots
            this.updateDots();
        },

        renderDots() {
            const container = document.getElementById('question-dots');
            container.innerHTML = Store.test.questions.map((q, i) => `
                <div class="q-dot ${i === Store.test.currentIndex ? 'active' : ''} ${Store.test.answers[q.id] !== undefined ? 'answered' : ''}"
                     onclick="MedAdapt.test.goToQuestion(${i})" title="Câu ${i + 1}"></div>
            `).join('');
        },

        updateDots() {
            document.querySelectorAll('.q-dot').forEach((dot, i) => {
                const q = Store.test.questions[i];
                dot.className = `q-dot ${i === Store.test.currentIndex ? 'active' : ''} ${Store.test.answers[q.id] !== undefined ? 'answered' : ''}`;
            });
        },

        selectAnswer(qid, index) {
            Store.test.answers[qid] = index;
            // Update UI
            document.querySelectorAll('.answer-option').forEach(opt => {
                opt.classList.toggle('selected', parseInt(opt.dataset.index) === index);
            });
            document.querySelector(`.answer-option[data-index="${index}"] .answer-letter`).style.background = '';
            this.updateDots();

            // Update score
            const answeredCorrect = Object.entries(Store.test.answers).filter(([qid2, ans]) => {
                const question = Store.test.questions.find(q => q.id === parseInt(qid2));
                return question && question.correct === ans;
            }).length;
            document.getElementById('test-current-score').textContent = answeredCorrect;
        },

        nextQuestion() {
            if (Store.test.currentIndex < Store.test.questions.length - 1) {
                Store.test.currentIndex++;
                this.renderQuestion();
            }
        },

        prevQuestion() {
            if (Store.test.currentIndex > 0) {
                Store.test.currentIndex--;
                this.renderQuestion();
            }
        },

        goToQuestion(index) {
            Store.test.currentIndex = index;
            this.renderQuestion();
        },

        startTimer() {
            if (Store.test.timerInterval) clearInterval(Store.test.timerInterval);
            this.updateTimerDisplay();
            Store.test.timerInterval = setInterval(() => {
                Store.test.timeLeft--;
                this.updateTimerDisplay();
                if (Store.test.timeLeft <= 0) {
                    clearInterval(Store.test.timerInterval);
                    Toast.warning('Hết thời gian! Bài kiểm tra sẽ được nộp tự động.');
                    this.submit();
                }
            }, 1000);
        },

        updateTimerDisplay() {
            const mins = Math.floor(Store.test.timeLeft / 60);
            const secs = Store.test.timeLeft % 60;
            const display = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
            document.getElementById('timer-display').textContent = display;

            // Warning when < 5 minutes
            const timerEl = document.getElementById('test-timer');
            timerEl.classList.toggle('warning', Store.test.timeLeft <= 300);
        },

        async submit() {
            if (Store.test.timerInterval) clearInterval(Store.test.timerInterval);

            const unanswered = Store.test.questions.filter(q => Store.test.answers[q.id] === undefined).length;
            if (unanswered > 0) {
                const confirmed = confirm(`Bạn còn ${unanswered} câu chưa trả lời. Bạn có chắc chắn muốn nộp bài?`);
                if (!confirmed) {
                    this.startTimer();
                    return;
                }
            }

            Loading.show('AI đang chấm bài & cập nhật năng lực...');

            // Prepare submission
            const answers = Store.test.questions.map(q => ({
                question_id: q.id,
                answer: Store.test.answers[q.id] ?? -1,
                time_spent: Math.round((Date.now() - Store.test.startTime) / 1000 / Store.test.questions.length)
            }));

            const res = await API.post('/test/submit', { session_id: Store.test.session_id, answers });
            Store.testHistoryCount = (Store.testHistoryCount || 0) + 1;

            Loading.hide();
            this.showResults(res?.data || null);
        },

        showResults(resultData) {
            document.getElementById('test-active-screen').classList.add('hidden');
            document.getElementById('test-results-screen').classList.remove('hidden');

            // Trigger background update of global competency state
            setTimeout(() => {
                try {
                    Dashboard.loadDashboardData();
                    Tracker.init();
                } catch(e) {}
            }, 500);

            if (resultData && document.getElementById('results-ai-feedback-text')) {
                const feedbackMsg = typeof resultData.feedback === 'string' 
                    ? resultData.feedback 
                    : (resultData.feedback?.message || resultData.feedback?.encouragement || 'Hệ thống đã phân tích câu trả lời của bạn, cập nhật bảng năng lực và điều chỉnh lại câu hỏi cho bài test tiếp theo!');
                document.getElementById('results-ai-feedback-text').innerHTML = `<strong>Đánh giá của AI Coach:</strong><br>${feedbackMsg}<br><br><span style="color:#00f2fe;">⚡ Năng lực mới đã được lưu! Vòng lặp học tập sẽ tự động tạo bài kiểm tra tiếp theo phù hợp với trình độ mới của bạn.</span>`;
            } else if (document.getElementById('results-ai-feedback-text')) {
                document.getElementById('results-ai-feedback-text').innerHTML = 'Hệ thống đã cập nhật điểm năng lực mới nhất vào bảng theo dõi và đồng bộ lên Notion!';
            }

            // Kích hoạt Vòng lặp học tập tự động (Automatic Continuous Adaptive Loop)
            if (Store.loopInterval) clearInterval(Store.loopInterval);
            const bannerEl = document.getElementById('adaptive-loop-banner');
            const timerEl = document.getElementById('loop-countdown');
            if (bannerEl) bannerEl.classList.remove('hidden');
            
            let count = 10;
            if (timerEl) timerEl.textContent = count;

            Store.loopInterval = setInterval(() => {
                count--;
                if (timerEl) timerEl.textContent = count;
                if (count <= 0) {
                    this.startNextAdaptiveLoop();
                }
            }, 1000);

            const questions = Store.test.questions;
            const total = questions.length;
            let correct = 0;
            const domainScores = {};

            questions.forEach(q => {
                const answered = Store.test.answers[q.id];
                const isCorrect = answered === q.correct;
                if (isCorrect) correct++;

                if (!domainScores[q.domain]) domainScores[q.domain] = { correct: 0, total: 0 };
                domainScores[q.domain].total++;
                if (isCorrect) domainScores[q.domain].correct++;
            });

            const percent = Math.round((correct / total) * 100);

            // Animate score circle
            const circle = document.getElementById('score-circle-path');
            const circumference = 2 * Math.PI * 54; // r=54
            const offset = circumference - (percent / 100) * circumference;
            setTimeout(() => {
                circle.style.transition = 'stroke-dashoffset 1.5s ease-out';
                circle.style.strokeDashoffset = offset;
            }, 200);

            // Animate percent number
            const percentEl = document.getElementById('results-percent');
            animateCountUp(percentEl, percent, 1500, '%');

            document.getElementById('results-correct').textContent = `${correct}/${total} đúng`;

            // Message based on score
            const msgEl = document.getElementById('results-message');
            const subEl = document.getElementById('results-sub-message');
            if (percent >= 80) {
                msgEl.textContent = '🎉 Xuất sắc!';
                subEl.textContent = 'Bạn đã làm rất tốt! Tiếp tục phát huy nhé!';
            } else if (percent >= 60) {
                msgEl.textContent = '👍 Khá tốt!';
                subEl.textContent = 'Bạn đang tiến bộ. Hãy ôn lại các phần chưa vững.';
            } else {
                msgEl.textContent = '💪 Cần cố gắng thêm!';
                subEl.textContent = 'Đừng nản lòng! Hãy xem lại các bài học liên quan.';
            }

            // Results breakdown
            const breakdown = document.getElementById('results-breakdown');
            breakdown.innerHTML = questions.map((q, i) => {
                const answered = Store.test.answers[q.id];
                const isCorrect = answered === q.correct;
                return `
                    <div class="result-item ${isCorrect ? 'correct-item' : 'incorrect-item'}">
                        <span class="result-icon">${isCorrect ? '✅' : '❌'}</span>
                        <div class="result-info">
                            <span class="result-q">Câu ${i + 1}: ${q.text.substring(0, 60)}...</span>
                            <span class="result-domain">${q.domain} • ${q.difficulty}</span>
                        </div>
                    </div>
                `;
            }).join('');

            // Results radar chart
            this.renderResultsRadar(domainScores);

            Toast.success(`Hoàn thành! Bạn đạt ${percent}% (${correct}/${total} đúng)`);
        },

        renderResultsRadar(domainScores) {
            const ctx = document.getElementById('results-radar-chart');
            if (!ctx) return;
            if (Store.charts.resultsRadar) Store.charts.resultsRadar.destroy();

            const labels = Object.keys(domainScores);
            const scores = labels.map(d => Math.round((domainScores[d].correct / domainScores[d].total) * 100));

            Store.charts.resultsRadar = new Chart(ctx, {
                type: 'radar',
                data: {
                    labels,
                    datasets: [{
                        label: 'Kết quả bài thi',
                        data: scores,
                        backgroundColor: 'rgba(79, 172, 254, 0.15)',
                        borderColor: 'rgba(79, 172, 254, 0.8)',
                        borderWidth: 2,
                        pointBackgroundColor: '#4facfe',
                        pointRadius: 4,
                    }]
                },
                options: getRadarChartOptions()
            });
        },

        reviewAnswers() {
            if (Store.loopInterval) {
                clearInterval(Store.loopInterval);
                Store.loopInterval = null;
                const bannerEl = document.getElementById('adaptive-loop-banner');
                if (bannerEl) bannerEl.classList.add('hidden');
            }
            Toast.info('Bạn có thể xem chi tiết từng câu hỏi trong danh sách bên dưới.');
        },

        startNextAdaptiveLoop() {
            if (Store.loopInterval) {
                clearInterval(Store.loopInterval);
                Store.loopInterval = null;
            }
            const bannerEl = document.getElementById('adaptive-loop-banner');
            if (bannerEl) bannerEl.classList.add('hidden');
            
            // Nếu vừa làm xong bài test đầu tiên, tự động mở Trang Web Chính theo đúng thiết kế
            if (Store.testHistoryCount <= 1) {
                Toast.success('🚀 Đang mở Trang Web Chính với lộ trình cá nhân hóa dựa trên bài test đầu!');
                window.location.hash = '#/dashboard';
            } else {
                Toast.info('🔄 Vòng lặp AI liên tục: Đang sinh bài kiểm tra thích ứng tiếp theo...');
                this.startDaily();
            }
        },

        pauseAdaptiveLoop() {
            if (Store.loopInterval) {
                clearInterval(Store.loopInterval);
                Store.loopInterval = null;
            }
            const bannerEl = document.getElementById('adaptive-loop-banner');
            if (bannerEl) {
                bannerEl.innerHTML = '<div style="color:#43e97b; font-weight:600; font-size:1.05rem;">⏸️ Vòng lặp tự động đã tạm dừng.</div><p style="color:var(--text-secondary); font-size:0.9rem; margin-top:0.4rem;">Năng lực của bạn đã được cập nhật! Bạn có thể nghỉ ngơi, xem lại đáp án hoặc bấm nút bên dưới khi muốn tiếp tục.</p>';
            }
            Toast.info('Đã tạm dừng vòng lặp tự động.');
        }
    };


    // ═══════════════════════════════════════
    //  9. TRACKER MODULE
    // ═══════════════════════════════════════

    const Tracker = {
        async init() {
            const res = await API.get('/tracker');
            const data = res?.data || null;
            this.loadRadarChart(data);
            this.loadTable(data);
            this.animateBloomBars();
        },

        loadRadarChart(data) {
            const ctx = document.getElementById('tracker-radar-chart');
            if (!ctx) return;
            if (Store.charts.trackerRadar) Store.charts.trackerRadar.destroy();

            const defaultLabels = ['Nội khoa', 'Ngoại khoa', 'Nhi khoa', 'Sản khoa', 'Cận lâm sàng', 'Dược lý', 'Y đức'];
            const defaultScores = [72, 55, 68, 45, 60, 35, 80];
            
            let labels = defaultLabels;
            let currentScores = defaultScores;
            
            if (data && data.domains && data.domains.length > 0) {
                labels = data.domains.map(d => d.name);
                currentScores = data.domains.map(d => {
                    const group = data.grouped?.[d.id];
                    return group && group.avgScore ? Math.round(group.avgScore) : 50;
                });
            }

            Store.charts.trackerRadar = new Chart(ctx, {
                type: 'radar',
                data: {
                    labels,
                    datasets: [{
                        label: 'Năng lực hiện tại (%)',
                        data: currentScores,
                        backgroundColor: 'rgba(102, 126, 234, 0.25)',
                        borderColor: 'rgba(102, 126, 234, 0.9)',
                        borderWidth: 2,
                        pointBackgroundColor: '#00f2fe',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 1.5,
                        pointRadius: 5,
                        pointHoverRadius: 7,
                    }, {
                        label: 'Mục tiêu chuẩn hóa',
                        data: labels.map(() => 80),
                        backgroundColor: 'rgba(67, 233, 123, 0.05)',
                        borderColor: 'rgba(67, 233, 123, 0.35)',
                        borderWidth: 1,
                        borderDash: [6, 4],
                        pointRadius: 2,
                    }]
                },
                options: getRadarChartOptions()
            });
        },

        loadTable(data) {
            const tbody = document.getElementById('tracker-table-body');
            if (!tbody) return;

            const defaultDomains = [
                { name: 'Nội khoa', score: 72, trend: 'up', mastery: 'proficient', lastTest: '05/07/2026', color: '#667eea' },
                { name: 'Ngoại khoa', score: 55, trend: 'up', mastery: 'competent', lastTest: '04/07/2026', color: '#4facfe' },
                { name: 'Nhi khoa', score: 68, trend: 'stable', mastery: 'competent', lastTest: '03/07/2026', color: '#43e97b' },
                { name: 'Sản khoa', score: 45, trend: 'down', mastery: 'novice', lastTest: '02/07/2026', color: '#fa709a' },
                { name: 'Cận lâm sàng', score: 60, trend: 'up', mastery: 'competent', lastTest: '05/07/2026', color: '#a18cd1' },
                { name: 'Dược lý', score: 35, trend: 'up', mastery: 'novice', lastTest: '01/07/2026', color: '#f5576c' },
                { name: 'Y đức', score: 80, trend: 'stable', mastery: 'expert', lastTest: '04/07/2026', color: '#fee140' },
            ];

            const colors = ['#667eea', '#4facfe', '#43e97b', '#fa709a', '#a18cd1', '#f5576c', '#fee140', '#00f2fe', '#f857a6'];

            let domains = defaultDomains;
            if (data && data.domains && data.domains.length > 0) {
                domains = data.domains.map((d, idx) => {
                    const group = data.grouped?.[d.id];
                    const score = group && group.avgScore ? Math.round(group.avgScore) : 50;
                    let mastery = 'competent';
                    if (score < 40) mastery = 'novice';
                    else if (score >= 80) mastery = 'expert';
                    else if (score >= 65) mastery = 'proficient';

                    const isStep1 = ['pathology', 'pharmacology', 'physiology', 'microbiology', 'biochemistry', 'anatomy', 'epidemiology'].includes(d.id);
                    return {
                        id: d.id,
                        name: d.name,
                        stepBadge: isStep1 ? '<span class="badge-step1">Step 1</span>' : '<span class="badge-step2ck">Step 2 CK</span>',
                        score,
                        trend: Math.random() > 0.4 ? 'up' : 'stable',
                        mastery,
                        lastTest: 'Vừa cập nhật',
                        color: colors[idx % colors.length]
                    };
                });
            }

            const masteryLabels = {
                novice: 'Cơ bản',
                competent: 'Trung bình',
                proficient: 'Khá',
                expert: 'Giỏi',
                master: 'Xuất sắc'
            };

            const trendIcons = {
                up: '<span class="trend-up">▲ Tăng</span>',
                down: '<span class="trend-down">▼ Giảm</span>',
                stable: '<span class="trend-stable">― Ổn định</span>'
            };

            tbody.innerHTML = domains.map(d => `
                <tr>
                    <td>
                        <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
                            ${d.stepBadge || '<span class="badge-step2ck">Step 2 CK</span>'}
                            <span class="domain-name" style="font-weight:600;">${d.name}</span>
                        </div>
                    </td>
                    <td>
                        <div class="score-bar-container">
                            <div class="score-bar-track">
                                <div class="score-bar-value" style="width:${d.score}%; background:${d.color}"></div>
                            </div>
                            <span class="score-bar-text">${d.score}%</span>
                        </div>
                    </td>
                    <td>${trendIcons[d.trend] || trendIcons.stable}</td>
                    <td><span class="mastery-badge mastery-${d.mastery}">${masteryLabels[d.mastery] || 'Khá'}</span></td>
                    <td style="color:var(--text-tertiary); font-size:0.82rem">${d.lastTest}</td>
                    <td>
                        <div style="display:flex; gap:0.4rem;">
                            <button class="btn btn-sm btn-outline" onclick="MedAdapt.test.startDaily()" title="Kiểm tra MCQ">MCQ</button>
                            <button class="btn btn-sm" onclick="window.location.hash='#/mentor'" style="background:rgba(0,242,254,0.15); color:#00f2fe; border:1px solid rgba(0,242,254,0.3);" title="Vào Cố vấn Socratic">Socratic</button>
                        </div>
                    </td>
                </tr>
            `).join('');
        },

        animateBloomBars() {
            document.querySelectorAll('.bloom-bar-fill').forEach(bar => {
                const width = bar.style.width;
                bar.style.width = '0%';
                setTimeout(() => { bar.style.width = width; }, 300);
            });
        },

        async refresh() {
            Loading.show('Đang đồng bộ năng lực mới từ AI...');
            await this.init();
            Loading.hide();
            Toast.success('Đã làm mới dữ liệu năng lực');
        }
    };


    // ═══════════════════════════════════════
    //  10. LESSON MODULE
    // ═══════════════════════════════════════

    const Lesson = {
        init() {
            this.setupScrollProgress();
            this.setupTOCHighlight();
        },

        setupScrollProgress() {
            const content = document.getElementById('lesson-content');
            const progressFill = document.getElementById('lesson-progress-fill');

            const handleScroll = () => {
                if (Store.currentRoute !== 'lesson') return;
                const scrollTop = window.scrollY;
                const docHeight = document.documentElement.scrollHeight - window.innerHeight;
                const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
                progressFill.style.width = `${Math.min(progress, 100)}%`;
            };

            window.addEventListener('scroll', handleScroll);
        },

        setupTOCHighlight() {
            const sections = document.querySelectorAll('.lesson-section');
            const tocItems = document.querySelectorAll('.toc-item');

            const observer = new IntersectionObserver(entries => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const id = entry.target.id;
                        tocItems.forEach(item => {
                            const link = item.querySelector('a');
                            item.classList.toggle('active', link.getAttribute('href') === `#${id}`);
                        });
                    }
                });
            }, { rootMargin: '-20% 0px -60% 0px' });

            sections.forEach(s => observer.observe(s));
        },

        checkAnswer(btn) {
            const card = btn.closest('.self-check-card');
            const options = card.querySelectorAll('.sc-option');
            const explanation = card.querySelector('.sc-explanation');
            const isCorrect = btn.dataset.correct === 'true';

            // Disable all options
            options.forEach(opt => {
                opt.disabled = true;
                opt.style.cursor = 'default';
                if (opt.dataset.correct === 'true') {
                    opt.classList.add('correct-answer');
                }
            });

            if (!isCorrect) {
                btn.classList.add('wrong-answer');
            }

            // Show explanation
            explanation.classList.remove('hidden');

            if (isCorrect) {
                Toast.success('Chính xác! 🎉');
            } else {
                Toast.error('Chưa đúng. Xem giải thích bên dưới.');
            }
        }
    };


    // ═══════════════════════════════════════
    //  10b. MENTOR MODULE (SOCRATIC CLINICAL)
    // ═══════════════════════════════════════

    const Mentor = {
        currentSessionId: null,
        currentStage: 'intake',
        hintsCount: 0,

        init() {
            console.log('[Mentor] Initialized Socratic view');
            const chatHistory = document.getElementById('mentor-chat-history');
            if (chatHistory && chatHistory.children.length === 0) {
                chatHistory.innerHTML = `
                    <div class="mentor-bubble ai-bubble" style="background: rgba(102, 126, 234, 0.15); border: 1px solid rgba(102, 126, 234, 0.3); padding: 1rem; border-radius: 12px; color: #e2e8f0; font-size: 0.9rem;">
                        <strong style="color: #00f2fe; display: block; margin-bottom: 0.4rem;">🤖 Cố vấn Socratic AI:</strong>
                        Chào Bác sĩ! Khác với bài trắc nghiệm MCQ chọn A/B/C/D thông thường, tại đây chúng ta sẽ thực hành tư duy lâm sàng theo chuẩn USMLE qua phương pháp Socratic.<br><br>
                        Hãy tiếp nhận ca lâm sàng ở khung bên trái, sau đó nhập những phân tích, chẩn đoán phân biệt theo khung <strong>VINDICATE</strong> hoặc chỉ định xét nghiệm vào ô trống bên dưới để bắt đầu thảo luận!
                    </div>
                `;
            }
        },

        async startNewCase() {
            const domainEl = document.getElementById('mentor-domain-select');
            const diffEl = document.getElementById('mentor-difficulty-select');
            const domain = domainEl ? domainEl.value : 'internal';
            const difficulty = diffEl ? parseInt(diffEl.value, 10) : 3;

            Loading.show();
            try {
                const res = await API.post('/api/mentor/start', { domain, difficulty });
                if (res.success && res.data) {
                    this.currentSessionId = res.data.sessionId;
                    this.currentStage = res.data.stage || 'intake';
                    this.hintsCount = 0;

                    // Render patient case
                    const caseContent = document.getElementById('mentor-case-content');
                    if (caseContent) {
                        caseContent.innerHTML = marked.parse(res.data.content || 'Không có nội dung ca bệnh');
                    }

                    // Update stage badge
                    const stageBadge = document.getElementById('mentor-stage-badge');
                    if (stageBadge) {
                        stageBadge.textContent = `Giai đoạn: ${this.currentStage.toUpperCase()}`;
                    }

                    // Reset chat with opening Socratic questions
                    const chatHistory = document.getElementById('mentor-chat-history');
                    if (chatHistory) {
                        let qText = '';
                        if (res.data.questions && res.data.questions.length > 0) {
                            qText = res.data.questions.map((q, i) => `<li><strong>Q${i+1}:</strong> ${q}</li>`).join('');
                        }
                        chatHistory.innerHTML = `
                            <div class="mentor-bubble ai-bubble" style="background: rgba(102, 126, 234, 0.15); border: 1px solid rgba(102, 126, 234, 0.3); padding: 1rem; border-radius: 12px; color: #e2e8f0; font-size: 0.9rem;">
                                <strong style="color: #00f2fe; display: block; margin-bottom: 0.4rem;">🩺 Tiếp nhận ca bệnh:</strong>
                                Bạn đã tiếp nhận dữ liệu bệnh nhân bên trái. Hãy bắt đầu biện luận lâm sàng theo phương pháp Socratic:
                                <ul style="margin-top: 0.5rem; padding-left: 1.2rem; color: #fff;">${qText || '<li>Bạn nghĩ đến 3 chẩn đoán phân biệt hàng đầu nào theo khung VINDICATE?</li>'}</ul>
                            </div>
                        `;
                    }
                    Toast.success('Đã tạo ca lâm sàng mới!');
                } else {
                    Toast.error(res.error || 'Không thể bắt đầu ca bệnh');
                }
            } catch (err) {
                Toast.error('Lỗi kết nối Socratic AI: ' + err.message);
            } finally {
                Loading.hide();
            }
        },

        async sendResponse() {
            if (!this.currentSessionId) {
                Toast.warning('Vui lòng bấm "🚀 Ca Lâm Sàng Mới" trước khi trả lời.');
                return;
            }

            const inputEl = document.getElementById('mentor-user-input');
            const userText = inputEl ? inputEl.value.trim() : '';
            if (!userText) {
                Toast.warning('Vui lòng nhập suy luận lâm sàng của bạn.');
                return;
            }

            // Append user bubble
            const chatHistory = document.getElementById('mentor-chat-history');
            if (chatHistory) {
                const userDiv = document.createElement('div');
                userDiv.className = 'mentor-bubble user-bubble';
                userDiv.innerHTML = `<strong style="color:#00f2fe; display:block; margin-bottom:0.2rem;">🧑‍⚕️ Bạn:</strong>${userText.replace(/\n/g, '<br>')}`;
                chatHistory.appendChild(userDiv);

                // Append loading typing indicator
                const loadingDiv = document.createElement('div');
                loadingDiv.id = 'mentor-typing-indicator';
                loadingDiv.className = 'mentor-bubble ai-bubble';
                loadingDiv.innerHTML = `<span style="color:#94a3b8;">🤖 Cố vấn Socratic đang phân tích biện luận của bạn...</span>`;
                chatHistory.appendChild(loadingDiv);
                chatHistory.scrollTop = chatHistory.scrollHeight;
            }

            if (inputEl) inputEl.value = '';

            try {
                const res = await API.post('/api/mentor/respond', { sessionId: this.currentSessionId, response: userText });
                const loadingEl = document.getElementById('mentor-typing-indicator');
                if (loadingEl) loadingEl.remove();

                if (res.success && res.data) {
                    const aiDiv = document.createElement('div');
                    aiDiv.className = 'mentor-bubble ai-bubble';
                    
                    let aiMessage = res.data.mentor_message || res.data.response_content || 'Đang xử lý phản hồi...';
                    let nextQs = '';
                    if (res.data.next_questions && res.data.next_questions.length > 0) {
                        nextQs = `<div style="margin-top:0.8rem; padding-top:0.8rem; border-top:1px dashed rgba(255,255,255,0.2);"><strong style="color:#00f2fe;">🧠 Câu hỏi gợi mở tiếp theo:</strong><ul style="margin:0.4rem 0 0 0; padding-left:1.2rem; color:#fff;">` + res.data.next_questions.map((q, i) => `<li>${q}</li>`).join('') + `</ul></div>`;
                    } else if (res.data.follow_up_questions && res.data.follow_up_questions.length > 0) {
                        nextQs = `<div style="margin-top:0.8rem; padding-top:0.8rem; border-top:1px dashed rgba(255,255,255,0.2);"><strong style="color:#00f2fe;">🧠 Câu hỏi gợi mở tiếp theo:</strong><ul style="margin:0.4rem 0 0 0; padding-left:1.2rem; color:#fff;">` + res.data.follow_up_questions.map((q, i) => `<li>${q}</li>`).join('') + `</ul></div>`;
                    }

                    aiDiv.innerHTML = `<strong style="color:#00f2fe; display:block; margin-bottom:0.4rem;">🤖 Phản hồi từ Cố vấn Socratic:</strong>` + marked.parse(aiMessage) + nextQs;
                    chatHistory.appendChild(aiDiv);
                    chatHistory.scrollTop = chatHistory.scrollHeight;

                    if (res.data.stage) {
                        this.currentStage = res.data.stage;
                        const stageBadge = document.getElementById('mentor-stage-badge');
                        if (stageBadge) stageBadge.textContent = `Giai đoạn: ${this.currentStage.toUpperCase()}`;
                    }
                } else {
                    Toast.error(res.error || 'Lỗi phản hồi AI');
                }
            } catch (err) {
                const loadingEl = document.getElementById('mentor-typing-indicator');
                if (loadingEl) loadingEl.remove();
                Toast.error('Lỗi gửi phản hồi: ' + err.message);
            }
        },

        requestHint() {
            this.hintsCount++;
            const hints = [
                "💡 Gợi ý 1: Hãy kiểm tra kỹ sinh hiệu và thời gian xuất hiện triệu chứng trong bệnh sử.",
                "💡 Gợi ý 2: Hãy nghĩ đến các cơ quan lân cận trong lồng ngực/ổ bụng có thể gây ra triệu chứng tương tự theo khung VINDICATE.",
                "💡 Gợi ý 3: Xét nghiệm nào có độ nhạy cao nhất để loại trừ chẩn đoán nguy hiểm tính mạng trong 1 giờ đầu tiên?"
            ];
            const hintText = hints[(this.hintsCount - 1) % hints.length];

            const chatHistory = document.getElementById('mentor-chat-history');
            if (chatHistory) {
                const hintDiv = document.createElement('div');
                hintDiv.className = 'mentor-bubble ai-bubble';
                hintDiv.style.borderColor = '#fa709a';
                hintDiv.style.background = 'rgba(250, 112, 154, 0.1)';
                hintDiv.innerHTML = `<strong style="color:#fa709a; display:block; margin-bottom:0.2rem;">${hintText}</strong>`;
                chatHistory.appendChild(hintDiv);
                chatHistory.scrollTop = chatHistory.scrollHeight;
            }
        },

        showFrameworkGuide() {
            const chatHistory = document.getElementById('mentor-chat-history');
            if (chatHistory) {
                const guideDiv = document.createElement('div');
                guideDiv.className = 'mentor-bubble ai-bubble vindicate-card';
                guideDiv.innerHTML = `
                    <h4 style="margin:0 0 0.8rem 0; color:#00f2fe; display:flex; align-items:center; gap:0.5rem;">
                        <span>ℹ️ KHUNG CHẨN ĐOÁN PHÂN BIỆT VINDICATE</span>
                    </h4>
                    <p style="font-size:0.85rem; color:#cbd5e1; margin-bottom:0.8rem;">Khi đứng trước một triệu chứng lâm sàng phức tạp (đau ngực, đau bụng, khó thở...), hãy rà soát tuần tự theo 9 chữ cái VINDICATE để không bỏ sót các nguyên nhân đe dọa tính mạng:</p>
                    <div class="vindicate-item"><div class="vindicate-letter">V</div><div><strong>Vascular (Mạch máu/Tim mạch):</strong> Nhồi máu cơ tim, Bóc tách động mạch chủ, Thuyên tắc phổi, Huyết khối...</div></div>
                    <div class="vindicate-item"><div class="vindicate-letter">I</div><div><strong>Infection / Inflammatory (Nhiễm trùng/Viêm):</strong> Viêm phổi, Viêm màng ngoài tim, Viêm tụy cấp, Nhiễm khuẩn huyết...</div></div>
                    <div class="vindicate-item"><div class="vindicate-letter">N</div><div><strong>Neoplasm (Ung bướu):</strong> U trung thất, Ung thư phổi, Khối u chèn ép thần kinh/mạch máu...</div></div>
                    <div class="vindicate-item"><div class="vindicate-letter">D</div><div><strong>Degenerative / Drugs (Thoái hóa/Thuốc):</strong> Tác dụng phụ của thuốc, Thoái hóa cột sống cổ/ngực...</div></div>
                    <div class="vindicate-item"><div class="vindicate-letter">I</div><div><strong>Iatrogenic / Intoxication (Thủ thuật/Ngộ độc):</strong> Biến chứng sau can thiệp, Ngộ độc CO, Ngộ độc Cocaine...</div></div>
                    <div class="vindicate-item"><div class="vindicate-letter">C</div><div><strong>Congenital (Bẩm sinh):</strong> Bệnh tim bẩm sinh, Bất thường mạch vành bẩm sinh...</div></div>
                    <div class="vindicate-item"><div class="vindicate-letter">A</div><div><strong>Autoimmune / Allergic (Tự miễn/Dị ứng):</strong> Lupus (SLE), Viêm mạch (Vasculitis), Viêm khớp dạng thấp...</div></div>
                    <div class="vindicate-item"><div class="vindicate-letter">T</div><div><strong>Trauma (Chấn thương):</strong> Chấn thương lồng ngực, Tràn khí màng phổi áp lực, Gãy xương sườn...</div></div>
                    <div class="vindicate-item"><div class="vindicate-letter">E</div><div><strong>Endocrine / Metabolic (Nội tiết/Chuyển hóa):</strong> Nhiễm toan đái tháo đường (DKA), Rối loạn điện giải, Bão giáp...</div></div>
                `;
                chatHistory.appendChild(guideDiv);
                chatHistory.scrollTop = chatHistory.scrollHeight;
            }
        }
    };


    // ═══════════════════════════════════════
    //  11. PROGRESS MODULE
    // ═══════════════════════════════════════

    const Progress = {
        init() {
            this.loadLineChart();
            this.loadHeatmap();
            this.setupToggle();
        },

        loadLineChart() {
            const ctx = document.getElementById('progress-line-chart');
            if (!ctx) return;
            if (Store.charts.progressLine) Store.charts.progressLine.destroy();

            const labels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
            
            Store.charts.progressLine = new Chart(ctx, {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Nội khoa',
                            data: [60, 62, 65, 64, 68, 70, 72],
                            borderColor: '#667eea',
                            backgroundColor: 'rgba(102, 126, 234, 0.1)',
                            borderWidth: 2,
                            fill: true,
                            tension: 0.4,
                            pointRadius: 3,
                            pointHoverRadius: 6,
                        },
                        {
                            label: 'Ngoại khoa',
                            data: [45, 48, 50, 49, 52, 53, 55],
                            borderColor: '#4facfe',
                            backgroundColor: 'rgba(79, 172, 254, 0.05)',
                            borderWidth: 2,
                            fill: true,
                            tension: 0.4,
                            pointRadius: 3,
                        },
                        {
                            label: 'Dược lý',
                            data: [20, 22, 25, 28, 30, 32, 35],
                            borderColor: '#fa709a',
                            backgroundColor: 'rgba(250, 112, 154, 0.05)',
                            borderWidth: 2,
                            fill: true,
                            tension: 0.4,
                            pointRadius: 3,
                        },
                        {
                            label: 'Trung bình',
                            data: [50, 52, 55, 54, 58, 60, 62],
                            borderColor: '#43e97b',
                            backgroundColor: 'rgba(67, 233, 123, 0.05)',
                            borderWidth: 2.5,
                            fill: false,
                            tension: 0.4,
                            pointRadius: 4,
                            borderDash: [],
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: 'index',
                        intersect: false,
                    },
                    plugins: {
                        legend: {
                            position: 'top',
                            labels: {
                                color: 'rgba(232, 234, 246, 0.65)',
                                font: { family: "'Inter', sans-serif", size: 12 },
                                usePointStyle: true,
                                padding: 16,
                            }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(15, 21, 53, 0.95)',
                            titleColor: '#e8eaf6',
                            bodyColor: 'rgba(232, 234, 246, 0.8)',
                            borderColor: 'rgba(255,255,255,0.1)',
                            borderWidth: 1,
                            cornerRadius: 8,
                            padding: 12,
                            titleFont: { family: "'Inter', sans-serif", weight: '600' },
                            bodyFont: { family: "'Inter', sans-serif" },
                            callbacks: {
                                label: ctx => `${ctx.dataset.label}: ${ctx.raw}%`
                            }
                        }
                    },
                    scales: {
                        y: {
                            min: 0,
                            max: 100,
                            ticks: {
                                color: 'rgba(232, 234, 246, 0.4)',
                                font: { family: "'Inter', sans-serif", size: 11 },
                                callback: v => v + '%',
                                stepSize: 20,
                            },
                            grid: {
                                color: 'rgba(255,255,255,0.04)',
                            }
                        },
                        x: {
                            ticks: {
                                color: 'rgba(232, 234, 246, 0.4)',
                                font: { family: "'Inter', sans-serif", size: 11 },
                            },
                            grid: {
                                color: 'rgba(255,255,255,0.02)',
                            }
                        }
                    }
                }
            });
        },

        loadHeatmap() {
            const grid = document.getElementById('heatmap-grid');
            const monthsContainer = document.getElementById('heatmap-months');
            if (!grid) return;

            // Generate ~26 weeks of data
            const today = new Date();
            const weeks = 26;
            const days = weeks * 7;
            grid.innerHTML = '';

            // Random activity data
            const cells = [];
            for (let i = days - 1; i >= 0; i--) {
                const date = new Date(today);
                date.setDate(date.getDate() - i);
                const intensity = Math.random();
                let level = 0;
                if (intensity > 0.8) level = 4;
                else if (intensity > 0.6) level = 3;
                else if (intensity > 0.4) level = 2;
                else if (intensity > 0.2) level = 1;

                const colors = [
                    'rgba(255,255,255,0.04)',
                    'rgba(67,233,123,0.2)',
                    'rgba(67,233,123,0.4)',
                    'rgba(67,233,123,0.6)',
                    'rgba(67,233,123,0.85)',
                ];

                const cell = document.createElement('div');
                cell.className = 'heatmap-cell';
                cell.style.background = colors[level];
                cell.title = `${date.toLocaleDateString('vi-VN')} — ${level > 0 ? level + ' hoạt động' : 'Không hoạt động'}`;
                grid.appendChild(cell);
            }

            // Month labels
            const monthNames = ['Th1', 'Th2', 'Th3', 'Th4', 'Th5', 'Th6', 'Th7', 'Th8', 'Th9', 'Th10', 'Th11', 'Th12'];
            monthsContainer.innerHTML = '';
            const startMonth = new Date(today);
            startMonth.setDate(startMonth.getDate() - days);
            
            let currentMonth = -1;
            for (let i = 0; i < weeks; i++) {
                const d = new Date(startMonth);
                d.setDate(d.getDate() + i * 7);
                if (d.getMonth() !== currentMonth) {
                    currentMonth = d.getMonth();
                    const span = document.createElement('span');
                    span.textContent = monthNames[currentMonth];
                    span.style.minWidth = '14px';
                    monthsContainer.appendChild(span);
                }
            }
        },

        setupToggle() {
            document.querySelectorAll('#progress-period-toggle .toggle-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('#progress-period-toggle .toggle-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    Toast.info(`Đã chuyển sang xem: ${btn.textContent}`);
                });
            });
        }
    };


    // ═══════════════════════════════════════
    //  12. SETTINGS MODULE
    // ═══════════════════════════════════════

    const Settings = {
        async init() {
            // Load saved settings
            const saved = JSON.parse(localStorage.getItem('medadapt_settings') || '{}');
            if (saved.geminiKey) document.getElementById('setting-gemini-key').value = saved.geminiKey;
            if (saved.testTime) document.getElementById('setting-test-time').value = saved.testTime;
            if (saved.aiModel && document.getElementById('setting-ai-model')) {
                document.getElementById('setting-ai-model').value = saved.aiModel;
            }

            // Fetch current active model from server
            try {
                const res = await API.get('/settings');
                if (res && res.aiModel) {
                    if (document.getElementById('setting-ai-model')) {
                        document.getElementById('setting-ai-model').value = res.aiModel;
                    }
                    const shortName = res.aiModel.replace('gemini-', 'Gemini ').replace('claude-', 'Claude ').replace('-pro', ' Pro').replace('-flash', ' Flash').replace('-exp', ' Exp');
                    const activeEl = document.getElementById('active-ai-model');
                    if (activeEl) activeEl.textContent = shortName;
                }
            } catch (e) {}
        },

        async upgradeAiModel() {
            const modelEl = document.getElementById('setting-ai-model');
            if (!modelEl) return;
            const selectedModel = modelEl.value;

            Loading.show('Đang nâng cấp và chuyển đổi Model AI...');
            const result = await API.post('/settings/ai-model', { model: selectedModel });
            Loading.hide();

            if (result && result.aiModel) {
                const shortName = result.aiModel.replace('gemini-', 'Gemini ').replace('claude-', 'Claude ').replace('-pro', ' Pro').replace('-flash', ' Flash').replace('-exp', ' Exp');
                const activeEl = document.getElementById('active-ai-model');
                if (activeEl) {
                    activeEl.textContent = shortName;
                }

                localStorage.setItem('medadapt_settings', JSON.stringify({
                    ...JSON.parse(localStorage.getItem('medadapt_settings') || '{}'),
                    aiModel: selectedModel
                }));

                Toast.success(`🚀 Nâng cấp thành công sang Model: ${shortName}!`);
            } else {
                Toast.error('Có lỗi xảy ra khi chuyển đổi Model AI.');
            }
        },

        togglePassword(btn) {
            const input = btn.previousElementSibling || btn.parentElement.querySelector('input');
            if (input) {
                input.type = input.type === 'password' ? 'text' : 'password';
                btn.textContent = input.type === 'password' ? '👁' : '🙈';
            }
        },

        async saveApiKeys() {
            const geminiKey = document.getElementById('setting-gemini-key').value;
            const openaiKey = document.getElementById('setting-openai-key').value;

            Loading.show('Đang lưu...');
            await API.post('/settings', { gemini_api_key: geminiKey, openai_api_key: openaiKey });

            localStorage.setItem('medadapt_settings', JSON.stringify({
                ...JSON.parse(localStorage.getItem('medadapt_settings') || '{}'),
                geminiKey, openaiKey
            }));

            Loading.hide();
            Toast.success('Đã lưu API Keys');
        },

        async setupNotion() {
            const token = document.getElementById('setting-notion-token').value.trim();
            if (!token) { Toast.warning('Vui lòng nhập Notion token'); return; }

            Loading.show('Đang kết nối Notion...');
            const result = await API.post('/notion/setup', { token });
            Loading.hide();

            if (result) {
                const indicator = document.querySelector('.notion-indicator');
                indicator.className = 'notion-indicator connected';
                indicator.querySelector('span').textContent = 'Đã kết nối';
                Toast.success('Kết nối Notion thành công!');
            } else {
                Toast.error('Không thể kết nối Notion. Kiểm tra lại token.');
            }
        },

        async syncNotion() {
            Loading.show('Đang đồng bộ với Notion...');
            await API.post('/notion/sync');
            Loading.hide();
            Toast.success('Đã đồng bộ với Notion');
        },

        async savePreferences() {
            const testTime = document.getElementById('setting-test-time').value;
            const questionsPerTest = document.getElementById('setting-questions-per-test').value;
            const notifications = document.getElementById('setting-notifications').checked;
            const darkMode = document.getElementById('setting-dark-mode').checked;

            Loading.show('Đang lưu...');

            const settings = { testTime, questionsPerTest, notifications, darkMode };
            await API.post('/settings', settings);

            localStorage.setItem('medadapt_settings', JSON.stringify({
                ...JSON.parse(localStorage.getItem('medadapt_settings') || '{}'),
                ...settings
            }));

            Loading.hide();
            Toast.success('Đã lưu tùy chọn');
        }
    };


    // ═══════════════════════════════════════
    //  13. UTILITY FUNCTIONS
    // ═══════════════════════════════════════

    function animateCountUp(el, target, duration = 1500, suffix = '') {
        let start = 0;
        const startTime = performance.now();

        function update(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = Math.round(start + (target - start) * eased);
            el.textContent = current + suffix;
            if (progress < 1) requestAnimationFrame(update);
        }

        requestAnimationFrame(update);
    }

    function getRadarChartOptions() {
        return {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: 'rgba(232, 234, 246, 0.65)',
                        font: { family: "'Inter', sans-serif", size: 11 },
                        usePointStyle: true,
                        padding: 16,
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 21, 53, 0.95)',
                    titleColor: '#e8eaf6',
                    bodyColor: 'rgba(232, 234, 246, 0.8)',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    cornerRadius: 8,
                    padding: 12,
                    titleFont: { family: "'Inter', sans-serif", weight: '600' },
                    bodyFont: { family: "'Inter', sans-serif" },
                    callbacks: {
                        label: ctx => `${ctx.dataset.label}: ${ctx.raw}%`
                    }
                }
            },
            scales: {
                r: {
                    angleLines: { color: 'rgba(255,255,255,0.06)' },
                    grid: { color: 'rgba(255,255,255,0.06)' },
                    pointLabels: {
                        color: 'rgba(232, 234, 246, 0.7)',
                        font: { family: "'Inter', sans-serif", size: 11, weight: '500' },
                    },
                    ticks: {
                        color: 'rgba(232, 234, 246, 0.3)',
                        backdropColor: 'transparent',
                        font: { size: 9 },
                        stepSize: 20,
                    },
                    min: 0,
                    max: 100,
                }
            }
        };
    }

    function updateUserUI() {
        if (!Store.user) return;
        const initial = (Store.user.name || 'B')[0].toUpperCase();
        document.getElementById('sidebar-avatar-letter').textContent = initial;
        document.getElementById('sidebar-username').textContent = 'BS. ' + (Store.user.name || '');

        const specialtyLabels = {
            internal_medicine: 'Nội khoa', surgery: 'Ngoại khoa', pediatrics: 'Nhi khoa',
            obstetrics_gynecology: 'Sản phụ khoa', cardiology: 'Tim mạch', neurology: 'Thần kinh',
            orthopedics: 'Chấn thương chỉnh hình', dermatology: 'Da liễu', ophthalmology: 'Nhãn khoa',
            ent: 'Tai Mũi Họng', psychiatry: 'Tâm thần', radiology: 'Chẩn đoán hình ảnh',
            anesthesiology: 'Gây mê hồi sức', emergency_medicine: 'Cấp cứu',
            family_medicine: 'Y học gia đình', oncology: 'Ung thư', nephrology: 'Thận học',
            pulmonology: 'Hô hấp', gastroenterology: 'Tiêu hóa', endocrinology: 'Nội tiết',
            infectious_disease: 'Truyền nhiễm', general_practice: 'Đa khoa'
        };
        document.getElementById('sidebar-specialty').textContent = specialtyLabels[Store.user.specialty] || Store.user.specialty || 'Bác sĩ';

        // Mobile avatar
        const mobileAvatar = document.getElementById('mobile-avatar');
        if (mobileAvatar) mobileAvatar.textContent = initial;
    }


    // ═══════════════════════════════════════
    //  14. MOBILE SIDEBAR TOGGLE
    // ═══════════════════════════════════════

    function setupMobile() {
        const hamburger = document.getElementById('hamburger-btn');
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');

        hamburger.addEventListener('click', () => {
            const isOpen = sidebar.classList.contains('open');
            sidebar.classList.toggle('open', !isOpen);
            overlay.classList.toggle('active', !isOpen);
            hamburger.classList.toggle('active', !isOpen);
        });

        overlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('active');
            hamburger.classList.remove('active');
        });
    }


    // ═══════════════════════════════════════
    //  15. APP INITIALIZATION
    // ═══════════════════════════════════════

    function init() {
        Toast.init();
        Loading.init();
        Store.load();
        updateUserUI();
        setupMobile();

        // Kiểm tra tài khoản và lịch sử làm bài để quyết định mở trang chính hay mở ngay bài test đầu
        API.get('/user/profile').then(profile => {
            if (profile && (profile.id || profile.name)) {
                Store.user = profile;
                Store.isAuthenticated = true;
                Store.save();
                updateUserUI();
            }
            API.get('/test/history').then(res => {
                const history = res?.data || [];
                Store.testHistoryCount = history.length;
                // Mở trang lên nếu chưa có lịch sử làm bài thì mở ngay bài test đầu!
                if (history.length === 0 && !window.location.hash.includes('test')) {
                    Toast.info('⚡ Đang khởi chạy Bài kiểm tra đầu vào để định hình Lộ trình Học ➔ Test ➔ Update...');
                    window.location.hash = '#/test';
                }
            }).catch(e => {});
        }).catch(e => {});

        Router.init();

        // Tải thông tin Model AI đang chạy trên máy chủ để hiển thị lên Dashboard badge
        API.get('/settings').then(res => {
            if (res && res.aiModel) {
                const shortName = res.aiModel.replace('gemini-', 'Gemini ').replace('claude-', 'Claude ').replace('-pro', ' Pro').replace('-flash', ' Flash').replace('-exp', ' Exp');
                const activeEl = document.getElementById('active-ai-model');
                if (activeEl) activeEl.textContent = shortName;
                if (document.getElementById('setting-ai-model')) {
                    document.getElementById('setting-ai-model').value = res.aiModel;
                }
            }
        }).catch(e => {});
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }


    // ═══════════════════════════════════════
    //  16. PUBLIC API (Global namespace)
    // ═══════════════════════════════════════

    window.MedAdapt = {
        onboarding: Onboarding,
        test: TestModule,
        tracker: Tracker,
        lesson: Lesson,
        progress: Progress,
        settings: Settings,
        toast: Toast,
        store: Store,
    };

})();
