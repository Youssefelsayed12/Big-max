// db.js — قاعدة بيانات SQLite حقيقية باستخدام موديول node:sqlite المدمج في Node.js
// لا يحتاج أي تثبيت npm — يعمل فورًا بـ: node server.js
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const crypto = require('crypto');

const db = new DatabaseSync(path.join(__dirname, 'store.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price REAL NOT NULL,
  oldPrice REAL,
  rating REAL DEFAULT 5,
  sales INTEGER DEFAULT 0,
  badge TEXT,
  image TEXT,
  desc TEXT,
  features TEXT,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  total REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | processing | delivered | cancelled
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER,
  product_name TEXT NOT NULL,
  price REAL NOT NULL,
  download_url TEXT,
  FOREIGN KEY(order_id) REFERENCES orders(id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_number TEXT UNIQUE NOT NULL,
  order_number TEXT,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open | answered | closed
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS support_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  sender TEXT NOT NULL, -- customer | admin
  message TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(ticket_id) REFERENCES support_tickets(id)
);

CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`);

// ---------- Seed default admin user (admin / admin123) if none exists ----------
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

const adminCount = db.prepare('SELECT COUNT(*) as c FROM admin_users').get().c;
if (adminCount === 0) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword('admin123', salt);
  db.prepare('INSERT INTO admin_users (username, password_hash, salt) VALUES (?, ?, ?)')
    .run('admin', hash, salt);
  console.log('✔ تم إنشاء حساب أدمن افتراضي — username: admin / password: admin123 (غيّرها من صفحة الإعدادات)');
}

// ---------- Seed default settings ----------
const defaultSettings = {
  store_name: 'ديجيتال ستور',
  currency: 'ر.س',
  contact_email: 'support@digitalstore.com',
  contact_phone: '+966500000000',
  discount_code: 'LEARN40',
  discount_percent: '40',
  banner_text: 'خصم 40% على جميع الدورات',
};
const settingCount = db.prepare('SELECT COUNT(*) as c FROM settings').get().c;
if (settingCount === 0) {
  const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaultSettings)) insert.run(k, v);
}

// ---------- Seed default products (same catalog as the storefront) ----------
const productCount = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
if (productCount === 0) {
  const seed = [
    { name: "قالب متجر إلكتروني احترافي", category: "templates", price: 149, oldPrice: 299, rating: 4.9, sales: 342, badge: "hot", image: "https://picsum.photos/seed/ecommerce-store/600/400.jpg", desc: "قالب متجر إلكتروني متكامل بتصميم عصري يدعم جميع المتصفحات والأجهزة.", features: ["متجاوب بالكامل", "لوحة تحكم سهلة", "15 صفحة جاهزة", "دعم فني مجاني"] },
    { name: "دورة التسويق الرقمي الشاملة", category: "courses", price: 199, oldPrice: 499, rating: 4.8, sales: 528, badge: "best", image: "https://picsum.photos/seed/digital-marketing/600/400.jpg", desc: "دورة شاملة تغطي جميع جوانب التسويق الرقمي من SEO إلى إعلانات السوشيال ميديا.", features: ["+50 درس فيديو", "شهادة إتمام", "حالات دراسية حقيقية", "مجموعة خاصة"] },
    { name: "كتاب أسرار التصميم UI/UX", category: "ebooks", price: 49, oldPrice: 99, rating: 4.7, sales: 215, badge: "new", image: "https://picsum.photos/seed/uiux-book/600/400.jpg", desc: "كتاب إلكتروني شامل يغطي أساسيات ومتقدمات تصميم واجهات المستخدم وتجربة المستخدم.", features: ["350+ صفحة", "أمثلة عملية", "ملفات قابلة للتحميل", "تحديثات مجانية"] },
    { name: "حزمة أيقونات 3000+ أيقونة", category: "graphics", price: 79, oldPrice: 149, rating: 4.9, sales: 410, badge: "hot", image: "https://picsum.photos/seed/icons-pack/600/400.jpg", desc: "مكتبة ضخمة تحتوي على أكثر من 3000 أيقونة بتصاميم متنوعة وقابلة للتخصيص.", features: ["3000+ أيقونة", "SVG و PNG", "20 نمط مختلف", "رخصة تجارية"] },
    { name: "أداة إدارة المشاريع SaaS", category: "tools", price: 299, oldPrice: 599, rating: 4.6, sales: 128, badge: "new", image: "https://picsum.photos/seed/project-tool/600/400.jpg", desc: "أداة متكاملة لإدارة المشاريع مع لوحة تحكم ذكية وتقارير تفصيلية.", features: ["لوحة تحكم ذكية", "تقارير متقدمة", "تكامل مع Slack", "API مفتوح"] },
    { name: "قالب Landing Page عالي التحويل", category: "templates", price: 89, oldPrice: 179, rating: 4.8, sales: 675, badge: "best", image: "https://picsum.photos/seed/landing-page/600/400.jpg", desc: "قالب صفحة هبوط مصمم لتحقيق أعلى معدلات التحويل مع A/B Testing جاهز.", features: ["معدل تحويل عالي", "5 نماذج مختلفة", "متحرك وحديث", "SEO محسّن"] },
    { name: "باقة مؤثرات صوتية سينمائية", category: "audio", price: 59, oldPrice: 119, rating: 4.7, sales: 189, badge: null, image: "https://picsum.photos/seed/audio-cinematic/600/400.jpg", desc: "مجموعة من 200+ مؤثر صوتي سينمائي عالي الجودة بصيغة WAV.", features: ["200+ مؤثر صوتي", "جودة WAV", "ملفات مصنفة", "رخصة تجارية"] },
    { name: "دورة تطوير تطبيقات Flutter", category: "courses", price: 249, oldPrice: 499, rating: 4.9, sales: 387, badge: "hot", image: "https://picsum.photos/seed/flutter-course/600/400.jpg", desc: "تعلم تطوير تطبيقات الموبايل بـ Flutter من الصفر حتى الاحتراف مع مشاريع حقيقية.", features: ["+80 درس فيديو", "6 مشاريع كاملة", "شهادة معتمدة", "دعم مباشر"] },
    { name: "نظام إدارة المحتوى CMS", category: "software", price: 399, oldPrice: 799, rating: 4.5, sales: 94, badge: "new", image: "https://picsum.photos/seed/cms-software/600/400.jpg", desc: "نظام إدارة محتوى خفيف وسريع مع محرر مرئي متقدم ونظام قوالب مرن.", features: ["محرر مرئي", "نظام قوالب", "متعدد اللغات", "API REST"] },
  ];
  const insert = db.prepare(`INSERT INTO products (name, category, price, oldPrice, rating, sales, badge, image, desc, features) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  for (const p of seed) {
    insert.run(p.name, p.category, p.price, p.oldPrice, p.rating, p.sales, p.badge, p.image, p.desc, JSON.stringify(p.features));
  }
}

module.exports = { db, hashPassword };
