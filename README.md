# Điểm Danh – Ms. Nghi English (Cloudflare Workers + D1)

Trang điểm danh gọn, chạy trên Cloudflare. Không còn phần học phí / lương.

## Quy trình
1. **Trợ giảng** chọn ngày, bấm tên học sinh (danh sách lấy từ Web Trả Bài) → mỗi em có 1 phiếu:
   có mặt / trễ / vắng, giờ học, bài học, điểm thái độ & bài tập (1–10), nhận xét, dặn dò (có nút 🎤 nói).
   Mọi thay đổi **tự lưu**; mất mạng thì giữ trên máy và tự gửi lại.
2. Cuối ngày bấm **📨 Gửi giáo viên**. Trợ giảng vẫn sửa được cho tới khi giáo viên xác nhận.
3. **Giáo viên** (mật khẩu): tab *Duyệt theo ngày* → sửa / ghi chú → **✅ Xác nhận**.
   Tab *Tổng hợp theo tháng* → từng học sinh: các buổi, điểm TB, nhận xét cả tháng,
   **Copy gửi Zalo**, **In/PDF**, **Xuất Excel (CSV)** cả tháng.

## Cấu trúc
```
src/worker.js     API (Cloudflare Worker)
public/index.html Giao diện
schema.sql        Bảng D1
wrangler.toml     Cấu hình (D1 "diemdanh" đã tạo sẵn, link Web Trả Bài)
```

## Triển khai
Database D1 `diemdanh` đã được tạo và dựng bảng sẵn trên tài khoản Cloudflare.

**Cách A – tự động từ GitHub (khuyên dùng)**
1. Đẩy thư mục này lên một repo GitHub.
2. Cloudflare Dashboard → Workers & Pages → Create → *Import a repository* → chọn repo.
   Build command: để trống. Deploy command: `npx wrangler deploy`.
3. Từ đó mỗi lần push lên GitHub là Cloudflare tự cập nhật.

**Cách B – từ máy tính**
```
npm install
npx wrangler login
npx wrangler deploy
```

**Đặt mật khẩu giáo viên** (nên làm ngay, mặc định là 130213):
```
npx wrangler secret put TEACHER_PASS
```
Hoặc Dashboard → Worker `diemdanh` → Settings → Variables and Secrets → thêm Secret `TEACHER_PASS`.
Tùy chọn `TA_PIN`: mã trợ giảng phải nhập trước khi điểm danh.

## Web Trả Bài
Worker gọi `TRABAI_URL?api=classroom3d` để lấy học sinh (tên + lớp), nhớ 10 phút.
Đổi link trong `wrangler.toml` → `[vars] TRABAI_URL`.
