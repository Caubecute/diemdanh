/**
 * ĐIỂM DANH – Cloudflare Worker
 * API cho trang public/index.html. Dữ liệu lưu trong D1 (binding DB).
 * Quy trình: Trợ giảng nhập theo ngày (nháp) -> cuối ngày "Gửi giáo viên" -> Giáo viên xác nhận,
 * xem tổng hợp theo học sinh / theo tháng. Danh sách học sinh lấy từ Web Trả Bài (TRABAI_URL?api=classroom3d).
 */
const STATUSES = ['present', 'late', 'excused', 'absent'];
const STUDENT_CACHE_MS = 10 * 60 * 1000;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const fail = (message, status = 400) => json({ ok: false, message }, status);
const now = () => Date.now();
const str = (v, max = 2000) => String(v == null ? '' : v).trim().slice(0, max);
const score = v => { const n = Math.round(Number(v)); return v === '' || v == null || !Number.isFinite(n) ? null : Math.min(10, Math.max(0, n)); };
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isMonth = s => /^\d{4}-\d{2}$/.test(s);

function teacherPass(env) { return String(env.TEACHER_PASS || '130213'); }
function safeEqual(a, b) {
  a = String(a || ''); b = String(b || '');
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
const isTeacher = (req, env) => safeEqual(req.headers.get('x-teacher-pass'), teacherPass(env));
function taAllowed(req, env) { return !env.TA_PIN || safeEqual(req.headers.get('x-ta-pin'), env.TA_PIN) || isTeacher(req, env); }

function cleanRecord(r) {
  return {
    id: str(r.id, 80),
    date: str(r.date, 10),
    student: str(r.student, 120),
    grade: str(r.grade, 60),
    ta: str(r.ta, 80),
    slot: str(r.slot, 80),
    status: STATUSES.includes(r.status) ? r.status : 'present',
    att: score(r.att),
    hw: score(r.hw),
    lesson: str(r.lesson, 300),
    note: str(r.note),
    todo: str(r.todo),
    teacher_note: str(r.teacher_note)
  };
}

// ---------- Học sinh từ Web Trả Bài ----------
async function getStudents(env, refresh) {
  const cached = await env.DB.prepare('SELECT v, updated_at FROM meta WHERE k = ?').bind('students').first();
  if (cached && !refresh && now() - cached.updated_at < STUDENT_CACHE_MS) return { students: JSON.parse(cached.v), updatedAt: cached.updated_at, cached: true };
  try {
    if (!env.TRABAI_URL) throw new Error('Chưa đặt TRABAI_URL');
    const url = env.TRABAI_URL + (env.TRABAI_URL.includes('?') ? '&' : '?') + 'api=classroom3d';
    const res = await fetch(url, { redirect: 'follow', cf: { cacheTtl: 0 } });
    if (!res.ok) throw new Error('Web Trả Bài trả về mã ' + res.status);
    const data = await res.json();
    const seen = new Set(), students = [];
    for (const s of data.students || []) {
      const name = str(s && s.name, 120).replace(/\s+/g, ' ');
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      students.push({ name, grade: str(s.grade, 60) || 'Khác' });
    }
    if (!students.length) throw new Error('Web Trả Bài chưa có học sinh nào');
    await env.DB.prepare('INSERT INTO meta (k, v, updated_at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at')
      .bind('students', JSON.stringify(students), now()).run();
    return { students, updatedAt: now(), cached: false };
  } catch (e) {
    if (cached) return { students: JSON.parse(cached.v), updatedAt: cached.updated_at, cached: true, warning: 'Dùng danh sách đã lưu: ' + e.message };
    return { students: [], updatedAt: 0, warning: 'Chưa lấy được học sinh từ Web Trả Bài: ' + e.message };
  }
}

// ---------- Lưu bản ghi (cả loạt) ----------
async function saveRecords(env, list, teacher) {
  const results = [];
  const stmts = [];
  for (const raw of (Array.isArray(list) ? list : []).slice(0, 200)) {
    const r = cleanRecord(raw || {});
    if (!r.id || !isDate(r.date) || !r.student) { results.push({ id: r.id, ok: false, message: 'Thiếu ngày hoặc tên học sinh' }); continue; }
    const old = await env.DB.prepare('SELECT state, teacher_note FROM records WHERE id = ?').bind(r.id).first();
    if (old && old.state === 'final' && !teacher) { results.push({ id: r.id, ok: false, locked: true, message: r.student + ': giáo viên đã xác nhận, trợ giảng không sửa được nữa.' }); continue; }
    const state = teacher && raw.state && ['draft', 'sent', 'final'].includes(raw.state) ? raw.state : (old ? old.state : 'draft');
    const tNote = teacher ? r.teacher_note : (old ? old.teacher_note : '');
    stmts.push(env.DB.prepare(`INSERT INTO records (id, date, student, grade, ta, slot, status, att, hw, lesson, note, todo, teacher_note, state, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET date=excluded.date, student=excluded.student, grade=excluded.grade, ta=excluded.ta, slot=excluded.slot,
        status=excluded.status, att=excluded.att, hw=excluded.hw, lesson=excluded.lesson, note=excluded.note, todo=excluded.todo,
        teacher_note=excluded.teacher_note, state=excluded.state, updated_at=excluded.updated_at`)
      .bind(r.id, r.date, r.student, r.grade, r.ta, r.slot, r.status, r.att, r.hw, r.lesson, r.note, r.todo, tNote, state, now()));
    results.push({ id: r.id, ok: true, state });
  }
  if (stmts.length) await env.DB.batch(stmts);
  return results;
}

// ---------- Router ----------
async function api(req, env, url) {
  const path = url.pathname.replace(/\/+$/, '');
  const method = req.method;
  const body = method === 'POST' ? await req.json().catch(() => ({})) : {};
  const teacher = isTeacher(req, env);

  if (path === '/api/students' && method === 'GET') return json({ ok: true, ...(await getStudents(env, url.searchParams.get('refresh') === '1')) });

  if (path === '/api/teacher/login' && method === 'POST')
    return safeEqual(body.pass, teacherPass(env)) ? json({ ok: true }) : fail('Sai mật khẩu giáo viên', 401);

  if (path.startsWith('/api/teacher/') && !teacher) return fail('Cần đăng nhập giáo viên', 401);
  if (!taAllowed(req, env)) return fail('Sai mã trợ giảng', 401);

  // Trợ giảng: các bản ghi của 1 ngày
  if (path === '/api/day' && method === 'GET') {
    const date = url.searchParams.get('date');
    if (!isDate(date)) return fail('Ngày không hợp lệ');
    const { results } = await env.DB.prepare('SELECT * FROM records WHERE date = ? ORDER BY updated_at').bind(date).all();
    return json({ ok: true, records: results });
  }
  if (path === '/api/records' && method === 'POST') return json({ ok: true, results: await saveRecords(env, body.records, teacher) });

  if (path.startsWith('/api/records/') && method === 'DELETE') {
    const id = decodeURIComponent(path.slice('/api/records/'.length));
    const row = await env.DB.prepare('SELECT state FROM records WHERE id = ?').bind(id).first();
    if (!row) return json({ ok: true });
    if (!teacher && row.state !== 'draft') return fail('Bản này đã gửi giáo viên, chỉ giáo viên mới xóa được.', 403);
    await env.DB.prepare('DELETE FROM records WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }
  // Cuối ngày: gửi tất cả bản nháp của ngày cho giáo viên
  if (path === '/api/day/send' && method === 'POST') {
    if (!isDate(body.date)) return fail('Ngày không hợp lệ');
    const r = await env.DB.prepare("UPDATE records SET state = 'sent', updated_at = ? WHERE date = ? AND state = 'draft'").bind(now(), body.date).run();
    return json({ ok: true, count: r.meta.changes });
  }

  // ----- Giáo viên -----
  if (path === '/api/teacher/month' && method === 'GET') {
    const month = url.searchParams.get('month');
    if (!isMonth(month)) return fail('Tháng không hợp lệ');
    const [recs, evals] = await env.DB.batch([
      env.DB.prepare("SELECT * FROM records WHERE date LIKE ? ORDER BY date, student").bind(month + '-%'),
      env.DB.prepare('SELECT student, text FROM month_evals WHERE month = ?').bind(month)
    ]);
    return json({ ok: true, records: recs.results, evals: evals.results });
  }
  if (path === '/api/teacher/confirm' && method === 'POST') {
    const ids = (body.ids || []).map(x => str(x, 80)).filter(Boolean).slice(0, 500);
    if (!ids.length) return json({ ok: true, count: 0 });
    const stmts = ids.map(id => env.DB.prepare("UPDATE records SET state = 'final', updated_at = ? WHERE id = ? AND state != 'final'").bind(now(), id));
    const res = await env.DB.batch(stmts);
    return json({ ok: true, count: res.reduce((s, r) => s + r.meta.changes, 0) });
  }
  if (path === '/api/teacher/eval' && method === 'POST') {
    const month = str(body.month, 7), student = str(body.student, 120);
    if (!isMonth(month) || !student) return fail('Thiếu tháng hoặc học sinh');
    await env.DB.prepare('INSERT INTO month_evals (month, student, text, updated_at) VALUES (?,?,?,?) ON CONFLICT(month, student) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at')
      .bind(month, student, str(body.text, 4000), now()).run();
    return json({ ok: true });
  }
  if (path === '/api/teacher/evals' && method === 'POST') {
    const month = str(body.month, 7);
    const items = (body.items || []).map(x => ({ student: str(x && x.student, 120), text: str(x && x.text, 4000) })).filter(x => x.student).slice(0, 300);
    if (!isMonth(month)) return fail('Tháng không hợp lệ');
    if (items.length) await env.DB.batch(items.map(x => env.DB.prepare('INSERT INTO month_evals (month, student, text, updated_at) VALUES (?,?,?,?) ON CONFLICT(month, student) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at').bind(month, x.student, x.text, now())));
    return json({ ok: true, count: items.length });
  }
  return fail('Không có chức năng này', 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await api(req, env, url); }
      catch (e) { return fail('Lỗi máy chủ: ' + (e && e.message || e), 500); }
    }
    return env.ASSETS.fetch(req);
  }
};
