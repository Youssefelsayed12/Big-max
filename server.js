// server.js — سيرفر حقيقي بدون أي مكتبات خارجية (Node.js فقط)
// شغّله بـ: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const { db } = require('./db');
const auth = require('./lib/auth');
const { sendJSON, readBody, genCode } = require('./lib/util');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(PUBLIC_DIR, filePath);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // fallback: SPA-ish 404 -> serve index
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 - الصفحة غير موجودة');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// Auth middleware helper
// ---------------------------------------------------------------------------
function requireAdmin(req) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  return auth.verifyToken(token); // returns username or null
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------
const routes = [];
function route(method, pattern, handler) {
  // pattern like /api/admin/products/:id -> regex
  const keys = [];
  const regex = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  routes.push({ method, regex, keys, handler });
}

// ---- Public: products ----
route('GET', '/api/products', async (req, res) => {
  const rows = db.prepare('SELECT * FROM products WHERE active = 1').all();
  const products = rows.map(r => ({ ...r, features: JSON.parse(r.features || '[]') }));
  sendJSON(res, 200, products);
});

// ---- Public: settings ----
route('GET', '/api/settings', async (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  rows.forEach(r => settings[r.key] = r.value);
  sendJSON(res, 200, settings);
});

// ---- Public: create order (checkout) ----
route('POST', '/api/orders', async (req, res) => {
  const body = await readBody(req);
  const { customer_name, customer_email, customer_phone, items } = body;
  if (!customer_name || !customer_email || !Array.isArray(items) || items.length === 0) {
    return sendJSON(res, 400, { error: 'بيانات الطلب غير مكتملة' });
  }
  const ids = items.map(i => i.id);
  const placeholders = ids.map(() => '?').join(',');
  const products = db.prepare(`SELECT * FROM products WHERE id IN (${placeholders})`).all(...ids);
  if (products.length === 0) return sendJSON(res, 400, { error: 'منتجات غير صالحة' });

  const total = products.reduce((s, p) => s + p.price, 0);
  const order_number = genCode('ORD');
  const insertOrder = db.prepare(`INSERT INTO orders (order_number, customer_name, customer_email, customer_phone, total, status) VALUES (?,?,?,?,?,?)`);
  const result = insertOrder.run(order_number, customer_name, customer_email, customer_phone || '', total, 'pending');
  const orderId = result.lastInsertRowid;

  const insertItem = db.prepare(`INSERT INTO order_items (order_id, product_id, product_name, price) VALUES (?,?,?,?)`);
  for (const p of products) insertItem.run(orderId, p.id, p.name, p.price);

  sendJSON(res, 201, { order_number, total, status: 'pending' });
});

// ---- Public: track order ----
route('GET', '/api/orders/track', async (req, res, query) => {
  const { order_number, email } = query;
  if (!order_number || !email) return sendJSON(res, 400, { error: 'رقم الطلب والبريد مطلوبان' });
  const order = db.prepare('SELECT * FROM orders WHERE order_number = ? AND customer_email = ?').get(order_number, email);
  if (!order) return sendJSON(res, 404, { error: 'لم يتم العثور على الطلب' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  sendJSON(res, 200, { order, items });
});

// ---- Public: support ticket create ----
route('POST', '/api/support', async (req, res) => {
  const body = await readBody(req);
  const { order_number, customer_name, customer_email, subject, message } = body;
  if (!customer_name || !customer_email || !subject || !message) {
    return sendJSON(res, 400, { error: 'برجاء تعبئة كل الحقول' });
  }
  const ticket_number = genCode('TCK');
  const result = db.prepare(`INSERT INTO support_tickets (ticket_number, order_number, customer_name, customer_email, subject) VALUES (?,?,?,?,?)`)
    .run(ticket_number, order_number || null, customer_name, customer_email, subject);
  db.prepare(`INSERT INTO support_messages (ticket_id, sender, message) VALUES (?,?,?)`).run(result.lastInsertRowid, 'customer', message);
  sendJSON(res, 201, { ticket_number });
});

// ---- Public: track support ticket ----
route('GET', '/api/support/track', async (req, res, query) => {
  const { ticket_number, email } = query;
  const ticket = db.prepare('SELECT * FROM support_tickets WHERE ticket_number = ? AND customer_email = ?').get(ticket_number, email);
  if (!ticket) return sendJSON(res, 404, { error: 'لم يتم العثور على التذكرة' });
  const messages = db.prepare('SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY id ASC').all(ticket.id);
  sendJSON(res, 200, { ticket, messages });
});

// ---- Public: customer reply on ticket ----
route('POST', '/api/support/:ticket_number/reply', async (req, res, query, params) => {
  const body = await readBody(req);
  const ticket = db.prepare('SELECT * FROM support_tickets WHERE ticket_number = ? AND customer_email = ?').get(params.ticket_number, body.email);
  if (!ticket) return sendJSON(res, 404, { error: 'التذكرة غير موجودة' });
  db.prepare(`INSERT INTO support_messages (ticket_id, sender, message) VALUES (?,?,?)`).run(ticket.id, 'customer', body.message);
  db.prepare(`UPDATE support_tickets SET status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(ticket.id);
  sendJSON(res, 200, { ok: true });
});

// ---- Admin: login ----
route('POST', '/api/admin/login', async (req, res) => {
  const { username, password } = await readBody(req);
  const token = auth.login(username, password);
  if (!token) return sendJSON(res, 401, { error: 'بيانات الدخول غير صحيحة' });
  sendJSON(res, 200, { token, username });
});

route('POST', '/api/admin/logout', async (req, res) => {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  auth.logout(token);
  sendJSON(res, 200, { ok: true });
});

route('POST', '/api/admin/change-password', async (req, res) => {
  const username = requireAdmin(req);
  if (!username) return sendJSON(res, 401, { error: 'غير مصرح' });
  const { new_password } = await readBody(req);
  if (!new_password || new_password.length < 6) return sendJSON(res, 400, { error: 'كلمة المرور قصيرة جداً' });
  auth.changePassword(username, new_password);
  sendJSON(res, 200, { ok: true });
});

// ---- Admin: dashboard stats ----
route('GET', '/api/admin/stats', async (req, res) => {
  if (!requireAdmin(req)) return sendJSON(res, 401, { error: 'غير مصرح' });
  const totalOrders = db.prepare('SELECT COUNT(*) c FROM orders').get().c;
  const pending = db.prepare(`SELECT COUNT(*) c FROM orders WHERE status = 'pending'`).get().c;
  const delivered = db.prepare(`SELECT COUNT(*) c FROM orders WHERE status = 'delivered'`).get().c;
  const revenue = db.prepare(`SELECT COALESCE(SUM(total),0) s FROM orders WHERE status != 'cancelled'`).get().s;
  const openTickets = db.prepare(`SELECT COUNT(*) c FROM support_tickets WHERE status = 'open'`).get().c;
  const productCount = db.prepare('SELECT COUNT(*) c FROM products').get().c;
  sendJSON(res, 200, { totalOrders, pending, delivered, revenue, openTickets, productCount });
});

// ---- Admin: products CRUD ----
route('GET', '/api/admin/products', async (req, res) => {
  if (!requireAdmin(req)) return sendJSON(res, 401, { error: 'غير مصرح' });
  const rows = db.prepare('SELECT * FROM products ORDER BY id DESC').all();
  sendJSON(res, 200, rows.map(r => ({ ...r, features: JSON.parse(r.features || '[]') })));
});

route('POST', '/api/admin/products', async (req, res) => {
  if (!requireAdmin(req)) return sendJSON(res, 401, { error: 'غير مصرح' });
  const p = await readBody(req);
  const result = db.prepare(`INSERT INTO products (name, category, price, oldPrice, rating, sales, badge, image, desc, features, active) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(p.name, p.category, p.price, p.oldPrice || null, p.rating || 5, p.sales || 0, p.badge || null, p.image || '', p.desc || '', JSON.stringify(p.features || []), 1);
  sendJSON(res, 201, { id: result.lastInsertRowid });
});

route('PUT', '/api/admin/products/:id', async (req, res, query, params) => {
  if (!requireAdmin(req)) return sendJSON(res, 401, { error: 'غير مصرح' });
  const p = await readBody(req);
  db.prepare(`UPDATE products SET name=?, category=?, price=?, oldPrice=?, rating=?, sales=?, badge=?, image=?, desc=?, features=?, active=? WHERE id=?`)
    .run(p.name, p.category, p.price, p.oldPrice || null, p.rating || 5, p.sales || 0, p.badge || null, p.image || '', p.desc || '', JSON.stringify(p.features || []), p.active === false ? 0 : 1, params.id);
  sendJSON(res, 200, { ok: true });
});

route('DELETE', '/api/admin/products/:id', async (req, res, query, params) => {
  if (!requireAdmin(req)) return sendJSON(res, 401, { error: 'غير مصرح' });
  db.prepare('DELETE FROM products WHERE id = ?').run(params.id);
  sendJSON(res, 200, { ok: true });
});

// ---- Admin: orders ----
route('GET', '/api/admin/orders', async (req, res, query) => {
  if (!requireAdmin(req)) return sendJSON(res, 401, { error: 'غير مصرح' });
  let rows;
  if (query.status) rows = db.prepare('SELECT * FROM orders WHERE status = ? ORDER BY id DESC').all(query.status);
  else rows = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
  sendJSON(res, 200, rows);
});

route('GET', '/api/admin/orders/:id', async (req, res, query, params) => {
  if (!requireAdmin(req)) return sendJSON(res, 401, { error: 'غير مصرح' });
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(params.id);
  if (!order) return sendJSON(res, 404, { error: 'الطلب غير موجود' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  sendJSON(res, 200, { order, items });
});

route('PUT', '/api/admin/orders/:id', async (req, res, query, params) => {
  if (!requireAdmin(req)) return sendJSON(res, 401, { error: 'غير مصرح' });
  const { status } = await readBody(req);
  const allowed = ['pending', 'processing', 'delivered', 'cancelled'];
  if (!allowed.includes(status)) return sendJSON(res, 400, { error: 'حالة غير صالحة' });
  db.prepare(`UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(status, params.id);
  sendJSON(res, 200, { ok: true });
});

route('PUT', '/api/admin/order-items/:id', async (req, res, query, params) => {
  if (!requireAdmin(req)) return sendJSON(res, 401, { error: 'غير مصرح' });
  const { download_url } = await readBody(req);
  db.prepare('UPDATE order_items SET download_url = ? WHERE id = ?').run(download_url || '', params.id);
  sendJSON(res, 200, { ok: true });
});

// ---- Admin: settings ----
route('PUT', '/api/admin/settings', async (req, res) => {
  if (!requireAdmin(req)) return sendJSON(res, 401, { error: 'غير مصرح' });
  const body = await readBody(req);
  const upsert = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  for (const [k, v] of Object.entries(body)) upsert.run(k, String(v));
  sendJSON(res, 200, { ok: true });
});

// ---- Admin: support tickets ----
route('GET', '/api/admin/support', async (req, res, query) => {
  if (!requireAdmin(req)) return sendJSON(res, 401, { error: 'غير مصرح' });
  let rows;
  if (query.status) rows = db.prepare('SELECT * FROM support_tickets WHERE status = ? ORDER BY id DESC').all(query.status);
  else rows = db.prepare('SELECT * FROM support_tickets ORDER BY id DESC').all();
  sendJSON(res, 200, rows);
});

route('GET', '/api/admin/support/:id', async (req, res, query, params) => {
  if (!requireAdmin(req)) return sendJSON(res, 401, { error: 'غير مصرح' });
  const ticket = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(params.id);
  if (!ticket) return sendJSON(res, 404, { error: 'غير موجود' });
  const messages = db.prepare('SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY id ASC').all(ticket.id);
  sendJSON(res, 200, { ticket, messages });
});

route('POST', '/api/admin/support/:id/reply', async (req, res, query, params) => {
  if (!requireAdmin(req)) return sendJSON(res, 401, { error: 'غير مصرح' });
  const { message } = await readBody(req);
  db.prepare(`INSERT INTO support_messages (ticket_id, sender, message) VALUES (?, 'admin', ?)`).run(params.id, message);
  db.prepare(`UPDATE support_tickets SET status = 'answered', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(params.id);
  sendJSON(res, 200, { ok: true });
});

route('PUT', '/api/admin/support/:id', async (req, res, query, params) => {
  if (!requireAdmin(req)) return sendJSON(res, 401, { error: 'غير مصرح' });
  const { status } = await readBody(req);
  db.prepare(`UPDATE support_tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(status, params.id);
  sendJSON(res, 200, { ok: true });
});

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);
  const query = Object.fromEntries(url.searchParams.entries());

  if (pathname.startsWith('/api/')) {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = pathname.match(r.regex);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => params[k] = m[i + 1]);
      try {
        return await r.handler(req, res, query, params);
      } catch (e) {
        console.error(e);
        return sendJSON(res, 500, { error: 'خطأ في السيرفر: ' + e.message });
      }
    }
    return sendJSON(res, 404, { error: 'المسار غير موجود' });
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`✔ السيرفر شغال على http://localhost:${PORT}`);
  console.log(`  المتجر:        http://localhost:${PORT}/`);
  console.log(`  لوحة التحكم:   http://localhost:${PORT}/admin.html  (admin / admin123)`);
  console.log(`  تتبع الطلب:    http://localhost:${PORT}/track.html`);
});
