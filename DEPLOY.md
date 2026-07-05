# Chạy MedAdapt liên tục 24/7 (Deploy lên Cloud)

Mục tiêu: backend `src/` chạy **không nghỉ**, để `scheduler.js` (node-cron) tự sinh bài giảng + test adaptive lúc **07:00 mỗi ngày** — kể cả khi máy tính của bạn tắt.

> Tóm tắt nhanh: đẩy code lên GitHub → tạo service trên Render hoặc Railway → khai báo biến môi trường (API key, `HOST=0.0.0.0`, `TZ=Asia/Ho_Chi_Minh`) → deploy. Xong.

---

## 0. Trước khi bắt đầu

- Tài khoản **GitHub** (miễn phí).
- Tài khoản **Render** (render.com) hoặc **Railway** (railway.app).
- **Không bao giờ commit file `.env`** lên GitHub (đã có trong `.gitignore`). Key sẽ được nhập trên trang cloud.

Ba điểm kỹ thuật bắt buộc lưu ý (guide đã xử lý bằng biến môi trường, không cần sửa code):

1. **`HOST=0.0.0.0`** — server mặc định bind `localhost`; trên cloud phải bind `0.0.0.0` mới nhận được lưu lượng.
2. **`TZ=Asia/Ho_Chi_Minh`** — cron chạy theo giờ server (UTC); không set thì "07:00" sẽ là 07:00 UTC = 14:00 giờ VN.
3. **Free tier hay "ngủ"** — web service miễn phí ngủ sau ~15 phút không truy cập, khiến cron không bắn đúng giờ. Xem mục 4 để chọn cách chạy không ngủ.

---

## 1. Đẩy code lên GitHub

```bash
cd "đường-dẫn/test"
git init
git add .
git commit -m "MedAdapt backend"
# tạo repo trống trên github.com rồi:
git remote add origin https://github.com/<tên-bạn>/medadapt.git
git branch -M main
git push -u origin main
```

Kiểm tra: `.env` **không** xuất hiện trên GitHub (chỉ có `.env.example`).

---

## 2. Deploy lên Render (khuyến nghị)

1. Vào **dashboard.render.com** → **New +** → **Web Service**.
2. Kết nối GitHub, chọn repo `medadapt`.
3. Cấu hình:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** *Starter* ($7/tháng, **không ngủ** — nên chọn để cron 07:00 chạy chuẩn) hoặc *Free* (xem mục 4).
4. Mục **Environment** → thêm các biến (mục 3).
5. **Create Web Service** → chờ build → nhận URL dạng `https://medadapt-xxxx.onrender.com`.
6. (Tùy chọn nhưng nên) **Disks** → thêm 1 disk 1GB mount tại `/data`, rồi đặt `DB_PATH=/data/medadapt.db` để **dữ liệu không mất khi redeploy**.

---

## 3. Biến môi trường cần khai báo (trên trang cloud, KHÔNG commit)

| Biến | Giá trị | Ghi chú |
| --- | --- | --- |
| `GEMINI_API_KEY` | *(key của bạn)* | Hoặc dùng `ANTHROPIC_API_KEY` |
| `GEMINI_MODEL` | `gemini-2.5-pro` | Tùy chọn |
| `NOTION_API_KEY` | *(integration token)* | Để đồng bộ Notion |
| `NOTION_PAGE_ID` | *(id trang Hub)* | Trang cha để tạo bài |
| `HOST` | `0.0.0.0` | **Bắt buộc** trên cloud |
| `TZ` | `Asia/Ho_Chi_Minh` | **Bắt buộc** để cron đúng 07:00 VN |
| `DAILY_TEST_CRON` | `0 7 * * *` | 07:00 hằng ngày |
| `DB_PATH` | `/data/medadapt.db` | Nếu có gắn disk |
| `AI_PROMPT_CACHE` | `true` | Giảm chi phí (Claude) |

> `PORT` do nền tảng tự cấp — server đã đọc `process.env.PORT`, không cần khai báo.

---

## 4. Xử lý "ngủ" của free tier (nếu không dùng gói trả phí)

Cron `node-cron` chỉ bắn khi tiến trình còn thức. Trên **Free Web Service** (ngủ khi rảnh), chọn một trong ba:

- **A. Dùng gói Starter (không ngủ)** — đơn giản và chắc chắn nhất.
- **B. Ping giữ thức** — tạo lịch ping URL mỗi 10 phút bằng **cron-job.org** hoặc **UptimeRobot** (miễn phí). Giữ service thức để cron 07:00 chạy.
- **C. Dùng Cron Job của nền tảng** — Render/ Railway có "Scheduled Job" riêng: đặt chạy `node src/jobs/daily.js` (hoặc gọi API endpoint kích hoạt vòng adaptive) lúc 07:00. Đáng tin cậy nhất trên free tier vì không phụ thuộc tiến trình web luôn thức.

---

## 5. Deploy lên Railway (thay thế)

1. **railway.app** → **New Project** → **Deploy from GitHub repo** → chọn `medadapt`.
2. **Variables** → dán các biến ở mục 3.
3. Railway tự chạy `npm install` + `npm start`. Mặc định **không ngủ** khi có usage.
4. **Settings → Networking → Generate Domain** để lấy URL public.

---

## 6. Kiểm tra sau deploy

Mở tab **Logs** của service, tìm các dòng:

```
[Server] AI Engine initialized (GEMINI - model: gemini-2.5-pro)
[Server] Notion client initialized
🚀 MedAdapt server running at: http://0.0.0.0:<port>
  AI Engine: ✅ Connected (GEMINI - gemini-2.5-pro)
  Scheduler: ✅ Active (0 7 * * *)
```

Nếu thấy đủ dòng trên → hệ thống **đang chạy liên tục**, và mỗi 07:00 (giờ VN) sẽ tự sinh bài giảng + test adaptive theo trình độ mới nhất của bạn, đẩy lên Notion.

Mở URL public → giao diện dashboard; làm bài → câu hỏi do AI sinh.

---

## 7. Sự cố thường gặp

| Triệu chứng | Nguyên nhân | Cách xử lý |
| --- | --- | --- |
| Trang không mở được | Server bind `localhost` | Đặt `HOST=0.0.0.0` |
| Cron chạy sai giờ | Thiếu timezone | Đặt `TZ=Asia/Ho_Chi_Minh` |
| `❌ AI Engine Not configured` | Sai/thiếu key | Kiểm tra `GEMINI_API_KEY` (không có dấu nháy/space) |
| Dữ liệu mất sau redeploy | SQLite trên ổ tạm | Gắn disk + `DB_PATH=/data/...` |
| Cron không bắn (free) | Service ngủ | Dùng gói không ngủ, ping giữ thức, hoặc Scheduled Job |
| Lỗi build `better-sqlite3` | Thiếu build tool | Render/Railway Linux tự biên dịch được; thử lại build |

---

*Ghi chú: vòng lặp Notion 07:00 bạn đang dùng qua Cowork chạy khi app mở; deploy cloud ở đây là bản chạy độc lập 24/7, không phụ thuộc app hay máy của bạn.*
