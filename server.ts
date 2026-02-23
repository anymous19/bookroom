import express from 'express';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

const db = new Database('booking.db');
db.pragma('journal_mode = WAL');

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    capacity INTEGER NOT NULL,
    description TEXT,
    image_url TEXT,
    equipment TEXT
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    user_name TEXT NOT NULL, -- Nama
    title TEXT, -- Judul acara
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    attendees INTEGER, -- Jumlah peserta
    applicant TEXT, -- Pemohon
    whatsapp TEXT, -- Nomor WA
    description TEXT, -- Keterangan
    purpose TEXT, -- Legacy field, can be used for internal notes or merged
    status TEXT DEFAULT 'pending', -- pending, approved, rejected
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms (id)
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL -- admin, user, viewer
  );

  CREATE TABLE IF NOT EXISTS ads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL, -- image, video
    url TEXT NOT NULL,
    duration INTEGER DEFAULT 10, -- seconds
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Seed settings if empty
const runningTextRow = db.prepare("SELECT value FROM settings WHERE key = 'running_text'").get() as { value: string };
if (!runningTextRow) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('running_text', 'Selamat Datang di RoomBook - Sistem Manajemen Ruang Meeting Modern')").run();
}

// Add equipment column if it doesn't exist (migration for existing db)
try {
  db.exec("ALTER TABLE rooms ADD COLUMN equipment TEXT");
} catch (e) {
  // Column likely already exists, ignore
}

// Add new columns to bookings if they don't exist (migration)
const columnsToAdd = ['title', 'attendees', 'applicant', 'whatsapp', 'description'];
columnsToAdd.forEach(col => {
  try {
    db.exec(`ALTER TABLE bookings ADD COLUMN ${col} ${col === 'attendees' ? 'INTEGER' : 'TEXT'}`);
  } catch (e) {
    // Column likely already exists
  }
});

// Seed data if empty
const roomCount = db.prepare('SELECT count(*) as count FROM rooms').get() as { count: number };
if (roomCount.count === 0) {
  const insertRoom = db.prepare('INSERT INTO rooms (name, capacity, description, image_url, equipment) VALUES (?, ?, ?, ?, ?)');
  insertRoom.run('Conference Room A', 12, 'Large conference room with projector and whiteboard.', 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&q=80&w=1000', 'Projector, Whiteboard, Video Conf');
  insertRoom.run('Meeting Room B', 6, 'Small meeting room for quick syncs.', 'https://images.unsplash.com/photo-1517502884422-41e157d44301?auto=format&fit=crop&q=80&w=1000', 'TV, Whiteboard');
  insertRoom.run('Focus Pod 1', 1, 'Soundproof pod for individual work.', 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&q=80&w=1000', 'Desk, Chair, Power Outlet');
  insertRoom.run('Creative Lab', 8, 'Open space with bean bags and creative tools.', 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&q=80&w=1000', 'Whiteboard, Bean Bags, TV');
}

const userCount = db.prepare('SELECT count(*) as count FROM users').get() as { count: number };
if (userCount.count === 0) {
  const insertUser = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)');
  insertUser.run('superadmin', 'super123', 'super_admin');
  insertUser.run('admin', 'admin123', 'admin');
  insertUser.run('user', 'user123', 'user');
  insertUser.run('viewer', 'viewer123', 'viewer');
} else {
  // Ensure superadmin exists for existing databases
  const superAdmin = db.prepare("SELECT * FROM users WHERE role = 'super_admin'").get();
  if (!superAdmin) {
     db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run('superadmin', 'super123', 'super_admin');
  }
}

const adCount = db.prepare('SELECT count(*) as count FROM ads').get() as { count: number };
if (adCount.count === 0) {
  const insertAd = db.prepare('INSERT INTO ads (type, url, duration) VALUES (?, ?, ?)');
  insertAd.run('image', 'https://images.unsplash.com/photo-1542744173-8e7e53415bb0?auto=format&fit=crop&q=80&w=1000', 10);
  insertAd.run('image', 'https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&q=80&w=1000', 10);
}

const app = express();
const PORT = 3000;

app.use(express.json());
app.use('/uploads', express.static('uploads'));

// API Routes
  
  // File Upload
  app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const url = `/uploads/${req.file.filename}`;
    res.json({ url });
  });
  
  // Auth
  app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare('SELECT id, username, role FROM users WHERE username = ? AND password = ?').get(username, password);
    
    if (user) {
      res.json(user);
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  });

  // Rooms
  app.get('/api/rooms', (req, res) => {
    const rooms = db.prepare('SELECT * FROM rooms').all();
    res.json(rooms);
  });

  app.post('/api/rooms', (req, res) => {
    const { name, capacity, description, image_url, equipment } = req.body;
    if (!name || !capacity) return res.status(400).json({ error: 'Missing required fields' });
    
    const stmt = db.prepare('INSERT INTO rooms (name, capacity, description, image_url, equipment) VALUES (?, ?, ?, ?, ?)');
    const info = stmt.run(name, capacity, description || '', image_url || '', equipment || '');
    res.json({ id: info.lastInsertRowid });
  });

  app.put('/api/rooms/:id', (req, res) => {
    const { name, capacity, description, image_url, equipment } = req.body;
    const { id } = req.params;

    const stmt = db.prepare(`
      UPDATE rooms 
      SET name = ?, capacity = ?, description = ?, image_url = ?, equipment = ?
      WHERE id = ?
    `);
    
    const info = stmt.run(name, capacity, description, image_url, equipment, id);

    if (info.changes === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    res.json({ success: true });
  });

  app.delete('/api/rooms/:id', (req, res) => {
    const { id } = req.params;
    // Check if room has bookings
    const bookings = db.prepare('SELECT count(*) as count FROM bookings WHERE room_id = ?').get(id) as { count: number };
    if (bookings.count > 0) {
      return res.status(400).json({ error: 'Cannot delete room with existing bookings' });
    }
    
    db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
    res.json({ success: true });
  });

  // Bookings
  app.get('/api/bookings', (req, res) => {
    const bookings = db.prepare(`
      SELECT b.*, r.name as room_name 
      FROM bookings b 
      JOIN rooms r ON b.room_id = r.id 
      ORDER BY b.created_at DESC
    `).all();
    res.json(bookings);
  });

  // Get active bookings for viewer (next 7 days)
  app.get('/api/bookings/active', (req, res) => {
    const now = new Date().toISOString();
    // Get bookings that are currently happening or upcoming in the next 7 days
    const bookings = db.prepare(`
      SELECT b.*, r.name as room_name 
      FROM bookings b 
      JOIN rooms r ON b.room_id = r.id 
      WHERE b.status = 'approved' 
      AND b.end_time >= ?
      AND b.start_time <= datetime(?, '+7 days')
      ORDER BY b.start_time ASC
    `).all(now, now);
    res.json(bookings);
  });

  app.post('/api/bookings', (req, res) => {
    const { room_id, user_name, title, start_time, end_time, attendees, applicant, whatsapp, description } = req.body;
    
    // Simple validation
    if (!room_id || !user_name || !start_time || !end_time || !title) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check for conflicts
    const conflict = db.prepare(`
      SELECT count(*) as count FROM bookings 
      WHERE room_id = ? 
      AND status != 'rejected'
      AND (
        (start_time < ? AND end_time > ?)
      )
    `).get(room_id, end_time, start_time) as { count: number };

    if (conflict.count > 0) {
      return res.status(409).json({ error: 'Room is already booked for this time slot.' });
    }

    const stmt = db.prepare(`
      INSERT INTO bookings (room_id, user_name, title, start_time, end_time, attendees, applicant, whatsapp, description, purpose) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(room_id, user_name, title, start_time, end_time, attendees || 0, applicant || '', whatsapp || '', description || '', title); // Use title as purpose fallback
    
    res.json({ id: info.lastInsertRowid, status: 'pending' });
  });

  app.put('/api/bookings/:id', (req, res) => {
    const { room_id, user_name, title, start_time, end_time, attendees, applicant, whatsapp, description, status } = req.body;
    const { id } = req.params;

    // Check for conflicts excluding current booking
    const conflict = db.prepare(`
      SELECT count(*) as count FROM bookings 
      WHERE room_id = ? 
      AND id != ?
      AND status != 'rejected'
      AND (
        (start_time < ? AND end_time > ?)
      )
    `).get(room_id, id, end_time, start_time) as { count: number };

    if (conflict.count > 0) {
      return res.status(409).json({ error: 'Room is already booked for this time slot.' });
    }

    const stmt = db.prepare(`
      UPDATE bookings 
      SET room_id = ?, user_name = ?, title = ?, start_time = ?, end_time = ?, attendees = ?, applicant = ?, whatsapp = ?, description = ?, status = ?
      WHERE id = ?
    `);
    
    const info = stmt.run(room_id, user_name, title, start_time, end_time, attendees, applicant, whatsapp, description, status, id);

    if (info.changes === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    res.json({ success: true });
  });

  app.patch('/api/bookings/:id/status', (req, res) => {
    const { status } = req.body;
    const { id } = req.params;

    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const stmt = db.prepare('UPDATE bookings SET status = ? WHERE id = ?');
    const info = stmt.run(status, id);

    if (info.changes === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    res.json({ success: true });
  });

  // Ads
  app.get('/api/ads', (req, res) => {
    const ads = db.prepare('SELECT * FROM ads WHERE active = 1').all();
    res.json(ads);
  });

  app.post('/api/ads', (req, res) => {
    const { type, url, duration } = req.body;
    if (!type || !url) return res.status(400).json({ error: 'Missing fields' });
    
    const stmt = db.prepare('INSERT INTO ads (type, url, duration) VALUES (?, ?, ?)');
    const info = stmt.run(type, url, duration || 10);
    res.json({ id: info.lastInsertRowid });
  });

  app.delete('/api/ads/:id', (req, res) => {
    const { id } = req.params;
    db.prepare('DELETE FROM ads WHERE id = ?').run(id);
    res.json({ success: true });
  });

  // Settings / Running Text
  app.get('/api/settings/running-text', (req, res) => {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'running_text'").get() as { value: string };
    res.json({ text: row ? row.value : '' });
  });

  app.post('/api/settings/running-text', (req, res) => {
    const { text } = req.body;
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('running_text', ?)").run(text);
    res.json({ success: true });
  });

  // Reports
  app.get('/api/reports', (req, res) => {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const firstDayOfWeek = new Date(now.setDate(now.getDate() - now.getDay())).toISOString().split('T')[0];
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const firstDayOfYear = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];

    const stats = {
      today: db.prepare("SELECT count(*) as count FROM bookings WHERE date(created_at) = date(?)").get(today) as { count: number },
      week: db.prepare("SELECT count(*) as count FROM bookings WHERE date(created_at) >= date(?)").get(firstDayOfWeek) as { count: number },
      month: db.prepare("SELECT count(*) as count FROM bookings WHERE date(created_at) >= date(?)").get(firstDayOfMonth) as { count: number },
      year: db.prepare("SELECT count(*) as count FROM bookings WHERE date(created_at) >= date(?)").get(firstDayOfYear) as { count: number },
      by_room: db.prepare(`
        SELECT r.name, count(b.id) as count 
        FROM rooms r 
        LEFT JOIN bookings b ON r.id = b.room_id 
        GROUP BY r.id
      `).all(),
      by_status: db.prepare(`
        SELECT status, count(*) as count 
        FROM bookings 
        GROUP BY status
      `).all(),
      history: db.prepare(`
        SELECT b.*, r.name as room_name 
        FROM bookings b 
        JOIN rooms r ON b.room_id = r.id 
        ORDER BY b.created_at DESC
      `).all()
    };
    
    res.json(stats);
  });
  // Users
  app.get('/api/users', (req, res) => {
    const users = db.prepare('SELECT id, username, role FROM users').all();
    res.json(users);
  });

  app.post('/api/users', (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password || !role) return res.status(400).json({ error: 'Missing fields' });
    
    try {
      const stmt = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)');
      const info = stmt.run(username, password, role);
      res.json({ id: info.lastInsertRowid });
    } catch (err: any) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ error: 'Username already exists' });
      }
      res.status(500).json({ error: 'Failed to create user' });
    }
  });

  app.delete('/api/users/:id', (req, res) => {
    const { id } = req.params;
    // Prevent deleting the main superadmin or admin
    const user = db.prepare('SELECT username FROM users WHERE id = ?').get(id) as { username: string };
    if (user && (user.username === 'admin' || user.username === 'superadmin')) {
      return res.status(403).json({ error: 'Cannot delete the main admin users' });
    }
    
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ success: true });
  });

// Vite middleware
if (process.env.NODE_ENV !== 'production') {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static('dist'));
}

// Export app for Vercel
export default app;

// Only listen if running directly
if (process.env.NODE_ENV !== 'production' && import.meta.url === `file://${process.argv[1]}`) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
