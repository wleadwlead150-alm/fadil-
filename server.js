const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'development-only-change-this-secret';
const UPLOAD_ROOT = path.join(__dirname, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
const ALLOWED_KINDS = new Set(['videos', 'images', 'files']);
const QUIZZES_FILE = path.resolve(__dirname, process.env.QUIZZES_FILE || 'data/quizzes.json');
const PUBLIC_QUIZZES_ENABLED = process.env.PUBLIC_QUIZZES_ENABLED === 'true';
const PUBLIC_NEWS_ENABLED = process.env.PUBLIC_NEWS_ENABLED !== 'false';
const FREE_COURSE = {
  title: 'كورس مجاني',
  description: 'مدخل مجاني لتعلّم أساسيات التداول وإدارة المخاطر.',
  published: true
};

fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
for (const folder of ALLOWED_KINDS) fs.mkdirSync(path.join(UPLOAD_ROOT, folder), { recursive: true });

app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: process.env.CLIENT_URL ? process.env.CLIENT_URL.split(',') : true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use('/uploads', express.static(UPLOAD_ROOT, { maxAge: '7d' }));

const userSchema = new mongoose.Schema({
  username: { type: String, trim: true, lowercase: true, required: true, unique: true },
  email: { type: String, trim: true, lowercase: true, sparse: true },
  password: { type: String, required: true, select: false },
  role: { type: String, enum: ['student', 'admin'], default: 'student' },
  activatedAt: Date,
  currentCourse: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' }
}, { timestamps: true });
const courseSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true }, description: String, imageUrl: String,
  published: { type: Boolean, default: false }, isPaid: { type: Boolean, default: false }, createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });
const lessonSchema = new mongoose.Schema({
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true }, title: { type: String, required: true },
  description: String, videoUrl: String, attachmentUrl: String, order: { type: Number, default: 0 }
}, { timestamps: true });
const progressSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, lesson: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson', required: true }, completedAt: { type: Date, default: Date.now }
}, { timestamps: true });
progressSchema.index({ student: 1, lesson: 1 }, { unique: true });
const quizSchema = new mongoose.Schema({
  title: { type: String, required: true }, course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
  questions: [{ text: { type: String, required: true }, options: [{ type: String, required: true }], correctAnswer: { type: Number, required: true } }]
}, { timestamps: true });
const attemptSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // quiz is retained only so historical database attempts can still be read.
  quiz: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz' },
  quizKey: String, quizTitle: String,
  answers: [{ question: String, selectedAnswer: Number, isCorrect: Boolean }],
  score: { type: Number, required: true }, total: { type: Number, required: true }, percentage: { type: Number, required: true }, completedAt: { type: Date, default: Date.now }
}, { timestamps: true });
const subscriptionSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, transferReference: { type: String, trim: true },
  amount: { type: Number, default: 100 }, status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }
}, { timestamps: true });
const ticketSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, subject: { type: String, required: true }, status: { type: String, enum: ['open', 'answered', 'closed'], default: 'open' },
  messages: [{ sender: { type: String, enum: ['student', 'admin'], required: true }, body: { type: String, required: true }, sentAt: { type: Date, default: Date.now } }]
}, { timestamps: true });
const contentSchema = new mongoose.Schema({ type: { type: String, enum: ['news', 'analysis', 'file'], required: true }, title: { type: String, required: true }, body: String, fileUrl: String, createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } }, { timestamps: true });

const User = mongoose.model('User', userSchema);
const Course = mongoose.model('Course', courseSchema);
const Lesson = mongoose.model('Lesson', lessonSchema);
const Progress = mongoose.model('Progress', progressSchema);
const Quiz = mongoose.model('Quiz', quizSchema);
const Attempt = mongoose.model('Attempt', attemptSchema);
const Subscription = mongoose.model('Subscription', subscriptionSchema);
const Ticket = mongoose.model('Ticket', ticketSchema);
const Content = mongoose.model('Content', contentSchema);

function signUser(user) { return jwt.sign({ id: user._id, role: user.role, username: user.username }, JWT_SECRET, { expiresIn: '7d' }); }
function publicUser(user) { return { id: user._id, username: user.username, email: user.email, role: user.role, activatedAt: user.activatedAt }; }
function auth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'يلزم تسجيل الدخول.' });
  try { req.user = jwt.verify(token, JWT_SECRET); return next(); } catch (_) { return res.status(401).json({ error: 'جلسة الدخول غير صالحة أو منتهية.' }); }
}
function admin(req, res, next) { if (req.user.role !== 'admin') return res.status(403).json({ error: 'هذه العملية خاصة بالإدارة.' }); next(); }
function validId(value) { return mongoose.isValidObjectId(value); }
function unavailableFeature(res) { return res.status(423).json({ error: 'هذا القسم متوقف مؤقتاً.' }); }
function quizAccess(req, res, next) {
  if (PUBLIC_QUIZZES_ENABLED || req.user?.role === 'admin') return next();
  return unavailableFeature(res);
}
function validateQuizCatalog(catalog) {
  if (!catalog || !Array.isArray(catalog.quizzes)) throw new Error('ملف الاختبارات يجب أن يحتوي على مصفوفة quizzes.');
  const ids = new Set();
  catalog.quizzes.forEach((quiz, quizIndex) => {
    if (!quiz || !/^[a-z0-9-]+$/i.test(quiz.id || '') || ids.has(quiz.id) || !quiz.title || !Array.isArray(quiz.questions) || !quiz.questions.length) {
      throw new Error(`اختبار غير صالح في الموضع ${quizIndex + 1}.`);
    }
    ids.add(quiz.id);
    const questionIds = new Set();
    quiz.questions.forEach((question, questionIndex) => {
      if (!question || !/^[a-z0-9-]+$/i.test(question.id || '') || questionIds.has(question.id) || !question.text || !Array.isArray(question.options) || question.options.length < 2 || !Number.isInteger(question.correctAnswer) || question.correctAnswer < 0 || question.correctAnswer >= question.options.length) {
        throw new Error(`سؤال غير صالح في الاختبار ${quiz.id} (السؤال ${questionIndex + 1}).`);
      }
      questionIds.add(question.id);
    });
  });
  return catalog.quizzes;
}
async function loadQuizzesFromFile() {
  let raw;
  try { raw = await fs.promises.readFile(QUIZZES_FILE, 'utf8'); } catch (error) { throw new Error(`تعذر قراءة ملف الاختبارات (${QUIZZES_FILE}): ${error.message}`); }
  try { return validateQuizCatalog(JSON.parse(raw)); } catch (error) { throw new Error(`ملف الاختبارات غير صالح: ${error.message}`); }
}
function publicQuiz(quiz) {
  return { ...quiz, questions: quiz.questions.map(({ correctAnswer, ...question }) => question) };
}
function unlinkUpload(url) {
  if (!url || !url.startsWith('/uploads/')) return;
  const local = path.resolve(__dirname, `.${url}`);
  if (local.startsWith(UPLOAD_ROOT + path.sep)) fs.unlink(local, () => {});
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => { const kind = ALLOWED_KINDS.has(req.body.kind) ? req.body.kind : (file.mimetype.startsWith('video/') ? 'videos' : file.mimetype.startsWith('image/') ? 'images' : 'files'); cb(null, path.join(UPLOAD_ROOT, kind)); },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
});
const allowedMime = /^(video\/(mp4|webm|quicktime)|image\/(jpeg|png|webp|gif)|application\/(pdf|zip|vnd\.openxmlformats-officedocument\..+)|text\/plain)$/;
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024, files: 2 }, fileFilter: (req, file, cb) => allowedMime.test(file.mimetype) ? cb(null, true) : cb(new Error('نوع الملف غير مسموح.')) });
const quizUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => path.extname(file.originalname).toLowerCase() === '.json' ? cb(null, true) : cb(new Error('ارفع ملف JSON للاختبارات فقط.'))
});

app.get('/api/health', async (req, res) => {
  try {
    await connectDatabase();
    res.json({ ok: true, database: 'connected', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ ok: false, database: 'disconnected', error: error.message, timestamp: new Date().toISOString() });
  }
});
// Vercel imports this app instead of running start(), so each API invocation
// waits for the cached MongoDB connection before accessing models.
app.use('/api', async (req, res, next) => {
  try { await connectDatabase(); next(); } catch (error) { next(error); }
});
app.post('/api/auth/register', async (req, res, next) => {
  try { const { username, email, password } = req.body; if (!username || !password || password.length < 6) return res.status(400).json({ error: 'اسم المستخدم وكلمة مرور من 6 أحرف مطلوبة.' });
    const exists = await User.exists({ $or: [{ username: username.toLowerCase() }, ...(email ? [{ email: email.toLowerCase() }] : [])] }); if (exists) return res.status(409).json({ error: 'اسم المستخدم أو البريد مستخدم مسبقاً.' });
    const freeCourse = await ensureFreeCourse();
    const user = await User.create({ username, email, password: await bcrypt.hash(password, 12), activatedAt: new Date(), currentCourse: freeCourse._id }); return res.status(201).json({ token: signUser(user), user: publicUser(user) });
  } catch (e) { next(e); }
});
app.post('/api/auth/login', async (req, res, next) => { try { const identity = String(req.body.identity || req.body.username || '').toLowerCase(); const user = await User.findOne({ $or: [{ username: identity }, { email: identity }] }).select('+password'); if (!user || !(await bcrypt.compare(req.body.password || '', user.password))) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة.' }); return res.json({ token: signUser(user), user: publicUser(user) }); } catch (e) { next(e); } });
app.get('/api/auth/me', auth, async (req, res, next) => { try { const user = await User.findById(req.user.id); if (!user) return res.status(404).json({ error: 'المستخدم غير موجود.' }); res.json({ user: publicUser(user) }); } catch (e) { next(e); } });

async function hasPaidAccess(studentId) { return Boolean(await Subscription.exists({ student: studentId, status: 'approved' })); }
async function canAccessCourse(user, course) { return user.role === 'admin' || (course.published && (!course.isPaid || await hasPaidAccess(user.id))); }
app.get('/api/courses', auth, async (req, res, next) => { try {
  const paidAccess = req.user.role === 'admin' || await hasPaidAccess(req.user.id);
  const courses = await Course.find({ published: true }).sort('-createdAt').lean();
  res.json(courses.map(course => ({ ...course, locked: Boolean(course.isPaid && !paidAccess) })));
} catch (e) { next(e); } });
app.get('/api/courses/:id', auth, async (req, res, next) => { try { if (!validId(req.params.id)) return res.status(400).json({ error: 'معرّف كورس غير صالح.' }); const course = await Course.findById(req.params.id); if (!course) return res.status(404).json({ error: 'الكورس غير موجود.' }); if (!await canAccessCourse(req.user, course)) return res.status(403).json({ error: 'هذا كورس مدفوع. أرسل طلب الاشتراك ثم انتظر موافقة الإدارة.' }); const lessons = await Lesson.find({ course: course._id }).sort('order'); res.json({ course, lessons }); } catch (e) { next(e); } });
app.post('/api/progress/:lessonId', auth, async (req, res, next) => { try { if (!validId(req.params.lessonId)) return res.status(400).json({ error: 'معرّف درس غير صالح.' }); const lesson = await Lesson.findById(req.params.lessonId); if (!lesson) return res.status(404).json({ error: 'الدرس غير موجود.' }); const course = await Course.findById(lesson.course); if (!course || !await canAccessCourse(req.user, course)) return res.status(403).json({ error: 'لا تملك صلاحية الوصول إلى هذا الدرس.' }); await Progress.updateOne({ student: req.user.id, lesson: lesson._id }, { $setOnInsert: { completedAt: new Date() } }, { upsert: true }); await User.findByIdAndUpdate(req.user.id, { currentCourse: lesson.course }); res.json({ ok: true }); } catch (e) { next(e); } });

// The catalog is read from data/quizzes.json for every request; it is never hard-coded in this server.
app.get('/api/quizzes', auth, quizAccess, async (req, res, next) => { try {
  const quizzes = await loadQuizzesFromFile();
  res.json(quizzes.map(({ questions, ...quiz }) => ({ ...quiz, questionCount: questions.length })));
} catch (e) { next(e); } });
app.post('/api/quizzes/submit', auth, quizAccess, async (req, res, next) => { try {
  const { quizId, answers } = req.body; if (typeof quizId !== 'string' || !Array.isArray(answers)) return res.status(400).json({ error: 'quizId والإجابات بصيغة صحيحة مطلوبان.' });
  const quiz = (await loadQuizzesFromFile()).find(item => item.id === quizId); if (!quiz) return res.status(404).json({ error: 'الاختبار غير موجود.' });
  const normalized = new Map(answers.map(a => [String(a.questionId || a.question), Number(a.selectedAnswer ?? a.answer)]));
  const scored = quiz.questions.map(question => { const selectedAnswer = normalized.get(question.id); return { question: question.id, selectedAnswer: Number.isInteger(selectedAnswer) ? selectedAnswer : -1, isCorrect: selectedAnswer === question.correctAnswer }; });
  const score = scored.filter(a => a.isCorrect).length; const total = quiz.questions.length; const percentage = total ? Math.round((score / total) * 10000) / 100 : 0;
  const attempt = await Attempt.create({ student: req.user.id, quizKey: quiz.id, quizTitle: quiz.title, answers: scored, score, total, percentage });
  res.status(200).json({ ok: true, message: 'تم حفظ النتيجة بنجاح.', attemptId: attempt._id, score, total, percentage, completedAt: attempt.completedAt });
} catch (e) { next(e); } });
app.get('/api/quizzes/:id', auth, quizAccess, async (req, res, next) => { try { const quiz = (await loadQuizzesFromFile()).find(item => item.id === req.params.id); if (!quiz) return res.status(404).json({ error: 'الاختبار غير موجود.' }); res.json(publicQuiz(quiz)); } catch (e) { next(e); } });

app.post('/api/subscriptions', auth, async (req, res, next) => { try { const item = await Subscription.create({ student: req.user.id, transferReference: req.body.transferReference, amount: 100 }); res.status(201).json({ ok: true, subscription: item, amount: 100, currency: 'USD', paymentMethod: 'MasterCard' }); } catch (e) { next(e); } });
app.get('/api/subscriptions/payment-info', (req, res) => res.json({ amount: 100, currency: 'USD', paymentMethod: 'MasterCard' }));
app.get('/api/news', async (req, res, next) => { try { if (!PUBLIC_NEWS_ENABLED) return unavailableFeature(res); res.json(await Content.find({ type: 'news' }).select('title body fileUrl createdAt').sort('-createdAt')); } catch (e) { next(e); } });
app.get('/api/news/:id/download', async (req, res, next) => { try { if (!PUBLIC_NEWS_ENABLED) return unavailableFeature(res); if (!validId(req.params.id)) return res.status(400).json({ error: 'معرّف خبر غير صالح.' }); const news = await Content.findOne({ _id: req.params.id, type: 'news' }); if (!news?.fileUrl) return res.status(404).json({ error: 'لا يوجد ملف قابل للتنزيل لهذا الخبر.' }); if (news.fileUrl.startsWith('/uploads/')) { const local = path.resolve(__dirname, `.${news.fileUrl}`); if (!local.startsWith(UPLOAD_ROOT + path.sep)) return res.status(400).json({ error: 'رابط الملف غير صالح.' }); return res.download(local); } if (/^https:\/\//i.test(news.fileUrl)) return res.redirect(news.fileUrl); return res.status(400).json({ error: 'رابط الملف غير صالح.' }); } catch (e) { next(e); } });
app.post('/api/tickets', auth, async (req, res, next) => { try { const { subject, message } = req.body; if (!subject || !message) return res.status(400).json({ error: 'العنوان والرسالة مطلوبان.' }); const ticket = await Ticket.create({ student: req.user.id, subject, messages: [{ sender: 'student', body: message }] }); res.status(201).json(ticket); } catch (e) { next(e); } });
app.get('/api/tickets/mine', auth, async (req, res, next) => { try { res.json(await Ticket.find({ student: req.user.id }).sort('-updatedAt')); } catch (e) { next(e); } });

app.post('/api/admin/upload', auth, admin, upload.array('files', 2), (req, res) => res.status(201).json({ ok: true, files: req.files.map(f => ({ name: f.originalname, url: `/uploads/${path.basename(path.dirname(f.path))}/${f.filename}`, size: f.size })) }));
app.post('/api/admin/quizzes/upload', auth, admin, quizUpload.single('quizFile'), async (req, res, next) => { try {
  if (!req.file) return res.status(400).json({ error: 'ملف الاختبارات مطلوب.' });
  const raw = req.file.buffer.toString('utf8');
  let quizzes;
  try { quizzes = validateQuizCatalog(JSON.parse(raw)); } catch (error) { return res.status(400).json({ error: `ملف الاختبارات غير صالح: ${error.message}` }); }
  await fs.promises.mkdir(path.dirname(QUIZZES_FILE), { recursive: true });
  const temporaryFile = path.join(path.dirname(QUIZZES_FILE), `.quizzes-${crypto.randomUUID()}.tmp`);
  await fs.promises.writeFile(temporaryFile, raw, { encoding: 'utf8', mode: 0o600 });
  await fs.promises.rename(temporaryFile, QUIZZES_FILE);
  res.status(201).json({ ok: true, message: 'تم استبدال ملف الاختبارات بنجاح.', quizzes: quizzes.length, questions: quizzes.reduce((count, quiz) => count + quiz.questions.length, 0) });
} catch (e) { next(e); } });
app.get('/api/admin/students', auth, admin, async (req, res, next) => { try { const students = await User.find({ role: 'student' }).populate('currentCourse', 'title').lean(); const ids = students.map(s => s._id); const counts = await Progress.aggregate([{ $match: { student: { $in: ids } } }, { $group: { _id: '$student', completedLessons: { $sum: 1 } } }]); const byStudent = new Map(counts.map(c => [String(c._id), c.completedLessons])); res.json(students.map(s => ({ id: s._id, username: s.username, activatedAt: s.activatedAt || s.createdAt, currentCourse: s.currentCourse?.title || 'لم يختر كورساً', completedLessons: byStudent.get(String(s._id)) || 0 }))); } catch (e) { next(e); } });
app.get('/api/admin/subscriptions', auth, admin, async (req, res, next) => { try { res.json({ amount: 100, currency: 'USD', paymentMethod: 'MasterCard', requests: await Subscription.find().populate('student', 'username email').sort('-createdAt') }); } catch (e) { next(e); } });
app.patch('/api/admin/subscriptions/:id', auth, admin, async (req, res, next) => { try { if (!['approved', 'rejected'].includes(req.body.status)) return res.status(400).json({ error: 'حالة غير صحيحة.' }); const item = await Subscription.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true }); if (!item) return res.status(404).json({ error: 'الطلب غير موجود.' }); res.json(item); } catch (e) { next(e); } });
app.get('/api/admin/attempts', auth, admin, async (req, res, next) => { try { const attempts = await Attempt.find().populate('student', 'username').populate('quiz', 'title').sort('-completedAt'); res.json(attempts.map(a => ({ id: a._id, student: a.student?.username || 'طالب محذوف', quiz: a.quizTitle || a.quiz?.title || 'اختبار محذوف', score: a.score, total: a.total, percentage: a.percentage, status: 'مكتمل', completedAt: a.completedAt }))); } catch (e) { next(e); } });
app.get('/api/admin/tickets', auth, admin, async (req, res, next) => { try { res.json(await Ticket.find().populate('student', 'username email').sort('-updatedAt')); } catch (e) { next(e); } });
app.post('/api/admin/tickets/:id/reply', auth, admin, async (req, res, next) => { try { if (!req.body.message?.trim()) return res.status(400).json({ error: 'نص الرد مطلوب.' }); const ticket = await Ticket.findByIdAndUpdate(req.params.id, { $push: { messages: { sender: 'admin', body: req.body.message.trim(), sentAt: new Date() } }, $set: { status: 'answered' } }, { new: true }); if (!ticket) return res.status(404).json({ error: 'التذكرة غير موجودة.' }); res.json(ticket); } catch (e) { next(e); } });
app.post('/api/admin/courses', auth, admin, async (req, res, next) => { try { const course = await Course.create({ ...req.body, createdBy: req.user.id }); res.status(201).json(course); } catch (e) { next(e); } });
app.get('/api/admin/courses', auth, admin, async (req, res, next) => { try { const courses = await Course.find().sort('-createdAt').lean(); const lessons = await Lesson.find({ course: { $in: courses.map(c => c._id) } }).sort('order').lean(); const byCourse = new Map(courses.map(c => [String(c._id), []])); lessons.forEach(lesson => byCourse.get(String(lesson.course))?.push(lesson)); res.json(courses.map(course => ({ ...course, lessons: byCourse.get(String(course._id)) || [] }))); } catch (e) { next(e); } });
app.patch('/api/admin/courses/:id', auth, admin, async (req, res, next) => { try { if (!validId(req.params.id)) return res.status(400).json({ error: 'معرّف كورس غير صالح.' }); const fields = (({ title, description, imageUrl, published, isPaid }) => ({ title, description, imageUrl, published, isPaid }))(req.body); Object.keys(fields).forEach(key => fields[key] === undefined && delete fields[key]); const course = await Course.findByIdAndUpdate(req.params.id, fields, { new: true, runValidators: true }); if (!course) return res.status(404).json({ error: 'الكورس غير موجود.' }); res.json(course); } catch (e) { next(e); } });
app.post('/api/admin/courses/:id/lessons', auth, admin, async (req, res, next) => { try { if (!await Course.exists({ _id: req.params.id })) return res.status(404).json({ error: 'الكورس غير موجود.' }); const lesson = await Lesson.create({ ...req.body, course: req.params.id }); res.status(201).json(lesson); } catch (e) { next(e); } });
app.patch('/api/admin/lessons/:id', auth, admin, async (req, res, next) => { try { if (!validId(req.params.id)) return res.status(400).json({ error: 'معرّف درس غير صالح.' }); const fields = (({ title, description, videoUrl, attachmentUrl, order }) => ({ title, description, videoUrl, attachmentUrl, order }))(req.body); Object.keys(fields).forEach(key => fields[key] === undefined && delete fields[key]); const lesson = await Lesson.findByIdAndUpdate(req.params.id, fields, { new: true, runValidators: true }); if (!lesson) return res.status(404).json({ error: 'الدرس غير موجود.' }); res.json(lesson); } catch (e) { next(e); } });
app.post('/api/admin/content', auth, admin, async (req, res, next) => { try { const content = await Content.create({ ...req.body, createdBy: req.user.id }); res.status(201).json(content); } catch (e) { next(e); } });
app.get('/api/admin/content', auth, admin, async (req, res, next) => { try { res.json(await Content.find().sort('-createdAt')); } catch (e) { next(e); } });
async function deleteCourse(id) { const lessons = await Lesson.find({ course: id }); lessons.forEach(l => { unlinkUpload(l.videoUrl); unlinkUpload(l.attachmentUrl); }); await Progress.deleteMany({ lesson: { $in: lessons.map(l => l._id) } }); await Lesson.deleteMany({ course: id }); await Quiz.deleteMany({ course: id }); return Course.findByIdAndDelete(id); }
app.delete('/api/admin/courses/:id', auth, admin, async (req, res, next) => { try { const item = await deleteCourse(req.params.id); if (!item) return res.status(404).json({ error: 'الكورس غير موجود.' }); unlinkUpload(item.imageUrl); res.json({ ok: true }); } catch (e) { next(e); } });
app.delete('/api/admin/lessons/:id', auth, admin, async (req, res, next) => { try { const lesson = await Lesson.findByIdAndDelete(req.params.id); if (!lesson) return res.status(404).json({ error: 'المقطع غير موجود.' }); await Progress.deleteMany({ lesson: lesson._id }); unlinkUpload(lesson.videoUrl); unlinkUpload(lesson.attachmentUrl); res.json({ ok: true }); } catch (e) { next(e); } });
app.delete('/api/admin/content/:id', auth, admin, async (req, res, next) => { try { const item = await Content.findByIdAndDelete(req.params.id); if (!item) return res.status(404).json({ error: 'المحتوى غير موجود.' }); unlinkUpload(item.fileUrl); res.json({ ok: true }); } catch (e) { next(e); } });
app.delete('/api/admin/uploads/:kind/:filename', auth, admin, (req, res) => { const { kind, filename } = req.params; if (!ALLOWED_KINDS.has(kind) || path.basename(filename) !== filename) return res.status(400).json({ error: 'مسار ملف غير صالح.' }); const file = path.join(UPLOAD_ROOT, kind, filename); fs.unlink(file, err => err ? res.status(err.code === 'ENOENT' ? 404 : 500).json({ error: 'تعذر حذف الملف.' }) : res.json({ ok: true })); });

// Explicit root route prevents a 404 when Vercel forwards `/` to this function.
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.use(express.static(PUBLIC_DIR));
app.get('*', (req, res, next) => req.path.startsWith('/api/') ? next() : res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.use((err, req, res, next) => { if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'حجم الملف يتجاوز الحد المسموح (500MB).' }); if (err) { console.error(err); return res.status(500).json({ error: err.message || 'حدث خطأ غير متوقع.' }); } next(); });

async function seedAdmin() { const username = (process.env.ADMIN_USERNAME || 'admin').toLowerCase(); if (await User.exists({ username })) return; const password = process.env.ADMIN_PASSWORD || '123456'; await User.create({ username, email: username === 'admin' ? 'admin' : undefined, password: await bcrypt.hash(password, 12), role: 'admin', activatedAt: new Date() }); console.log(`Default administrator '${username}' created.`); }
async function ensureFreeCourse() {
  const course = await Course.findOneAndUpdate(
    { title: FREE_COURSE.title },
    { $setOnInsert: FREE_COURSE },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return course;
}
let databaseConnectionPromise;
async function connectDatabase() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (databaseConnectionPromise) return databaseConnectionPromise;
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGO_URI is required. Set it in .env before starting the server.');
  databaseConnectionPromise = mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 })
    .then(async connection => { console.log('MongoDB connected'); await Promise.all([seedAdmin(), ensureFreeCourse()]); return connection; })
    .catch(error => { databaseConnectionPromise = undefined; throw error; });
  return databaseConnectionPromise;
}
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
async function seedDefaultAdmin() {
  await Promise.all([seedAdmin(), ensureFreeCourse()]);
}
async function startServer() {
  try {
    if (MONGO_URI) {
      await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 30000 });
      console.log('✓ MongoDB connected');
      await seedDefaultAdmin();
    } else {
      console.warn('⚠ MONGO_URI is not set. The interface will run, but database features require configuration.');
    }
  } catch (error) {
    console.warn(`⚠ MongoDB connection error: ${error.message}`);
  }

  app.listen(PORT, () => console.log(`✓ FADIL TRADING is running at http://localhost:${PORT}`));
}

if (require.main === module) startServer();
module.exports = app;
