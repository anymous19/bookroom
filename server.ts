import express from 'express';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Initialize Supabase Client
// Note: Ensure SUPABASE_URL and SUPABASE_KEY are set in your environment variables
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();
const PORT = 3000;

app.use(express.json());

// API Routes

// Auth
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  
  const { data: user, error } = await supabase
    .from('users')
    .select('id, username, role')
    .eq('username', username)
    .eq('password', password)
    .single();
  
  if (error || !user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  res.json(user);
});

// Rooms
app.get('/api/rooms', async (req, res) => {
  const { data: rooms, error } = await supabase
    .from('rooms')
    .select('*')
    .order('name');
    
  if (error) return res.status(500).json({ error: error.message });
  res.json(rooms);
});

app.post('/api/rooms', async (req, res) => {
  const { name, capacity, description, image_url, equipment } = req.body;
  if (!name || !capacity) return res.status(400).json({ error: 'Missing required fields' });
  
  const { data, error } = await supabase
    .from('rooms')
    .insert([{ name, capacity, description, image_url, equipment }])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ id: data.id });
});

app.put('/api/rooms/:id', async (req, res) => {
  const { name, capacity, description, image_url, equipment } = req.body;
  const { id } = req.params;

  const { error } = await supabase
    .from('rooms')
    .update({ name, capacity, description, image_url, equipment })
    .eq('id', id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.delete('/api/rooms/:id', async (req, res) => {
  const { id } = req.params;
  
  // Check for bookings
  const { count, error: countError } = await supabase
    .from('bookings')
    .select('*', { count: 'exact', head: true })
    .eq('room_id', id);

  if (countError) return res.status(500).json({ error: countError.message });
  if (count && count > 0) {
    return res.status(400).json({ error: 'Cannot delete room with existing bookings' });
  }
  
  const { error } = await supabase.from('rooms').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  
  res.json({ success: true });
});

// Bookings
app.get('/api/bookings', async (req, res) => {
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('*, rooms(name)')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  
  // Flatten room_name for frontend compatibility
  const formattedBookings = bookings.map(b => ({
    ...b,
    room_name: b.rooms?.name
  }));
  
  res.json(formattedBookings);
});

// Get active bookings for viewer
app.get('/api/bookings/active', async (req, res) => {
  const now = new Date().toISOString();
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('*, rooms(name)')
    .eq('status', 'approved')
    .gte('end_time', now)
    .lte('start_time', nextWeek.toISOString())
    .order('start_time', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  const formattedBookings = bookings.map(b => ({
    ...b,
    room_name: b.rooms?.name
  }));

  res.json(formattedBookings);
});

app.post('/api/bookings', async (req, res) => {
  const { room_id, user_name, title, start_time, end_time, attendees, applicant, whatsapp, description } = req.body;
  
  if (!room_id || !user_name || !start_time || !end_time || !title) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Check conflicts
  // (start_time < req_end AND end_time > req_start)
  const { count, error: conflictError } = await supabase
    .from('bookings')
    .select('*', { count: 'exact', head: true })
    .eq('room_id', room_id)
    .neq('status', 'rejected')
    .lt('start_time', end_time)
    .gt('end_time', start_time);

  if (conflictError) return res.status(500).json({ error: conflictError.message });
  if (count && count > 0) {
    return res.status(409).json({ error: 'Room is already booked for this time slot.' });
  }

  const { data, error } = await supabase
    .from('bookings')
    .insert([{
      room_id, 
      user_name, 
      title, 
      start_time, 
      end_time, 
      attendees: attendees || 0, 
      applicant: applicant || '', 
      whatsapp: whatsapp || '', 
      description: description || '', 
      purpose: title, // Legacy fallback
      status: 'pending'
    }])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ id: data.id, status: 'pending' });
});

app.put('/api/bookings/:id', async (req, res) => {
  const { room_id, user_name, title, start_time, end_time, attendees, applicant, whatsapp, description, status } = req.body;
  const { id } = req.params;

  // Check conflicts excluding current booking
  const { count, error: conflictError } = await supabase
    .from('bookings')
    .select('*', { count: 'exact', head: true })
    .eq('room_id', room_id)
    .neq('id', id)
    .neq('status', 'rejected')
    .lt('start_time', end_time)
    .gt('end_time', start_time);

  if (conflictError) return res.status(500).json({ error: conflictError.message });
  if (count && count > 0) {
    return res.status(409).json({ error: 'Room is already booked for this time slot.' });
  }

  const { error } = await supabase
    .from('bookings')
    .update({
      room_id, user_name, title, start_time, end_time, attendees, applicant, whatsapp, description, status
    })
    .eq('id', id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.patch('/api/bookings/:id/status', async (req, res) => {
  const { status } = req.body;
  const { id } = req.params;

  if (!['approved', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const { error } = await supabase
    .from('bookings')
    .update({ status })
    .eq('id', id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// Ads
app.get('/api/ads', async (req, res) => {
  const { data: ads, error } = await supabase
    .from('ads')
    .select('*')
    .eq('active', true);

  if (error) return res.status(500).json({ error: error.message });
  res.json(ads);
});

app.post('/api/ads', async (req, res) => {
  const { type, url, duration } = req.body;
  if (!type || !url) return res.status(400).json({ error: 'Missing fields' });
  
  const { data, error } = await supabase
    .from('ads')
    .insert([{ type, url, duration: duration || 10 }])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ id: data.id });
});

app.delete('/api/ads/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('ads').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// Settings
app.get('/api/settings/running-text', async (req, res) => {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'running_text')
    .single();

  // If error (e.g. not found), return empty
  res.json({ text: data ? data.value : '' });
});

app.post('/api/settings/running-text', async (req, res) => {
  const { text } = req.body;
  const { error } = await supabase
    .from('settings')
    .upsert({ key: 'running_text', value: text });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// Reports - Aggregated in JS for simplicity
app.get('/api/reports', async (req, res) => {
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('*, rooms(name)')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const firstDayOfWeek = new Date(now.setDate(now.getDate() - now.getDay())).toISOString().split('T')[0];
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const firstDayOfYear = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];

  // Helper to check date
  const isDate = (dateStr: string, target: string) => dateStr.startsWith(target);
  const isAfter = (dateStr: string, target: string) => dateStr >= target;

  const stats = {
    today: { count: bookings.filter(b => isDate(b.created_at, today)).length },
    week: { count: bookings.filter(b => isAfter(b.created_at, firstDayOfWeek)).length },
    month: { count: bookings.filter(b => isAfter(b.created_at, firstDayOfMonth)).length },
    year: { count: bookings.filter(b => isAfter(b.created_at, firstDayOfYear)).length },
    by_room: [] as any[],
    by_status: [] as any[],
    history: bookings.map(b => ({ ...b, room_name: b.rooms?.name }))
  };

  // Aggregate by room
  const roomCounts: Record<string, number> = {};
  bookings.forEach(b => {
    const name = b.rooms?.name || 'Unknown';
    roomCounts[name] = (roomCounts[name] || 0) + 1;
  });
  stats.by_room = Object.entries(roomCounts).map(([name, count]) => ({ name, count }));

  // Aggregate by status
  const statusCounts: Record<string, number> = {};
  bookings.forEach(b => {
    statusCounts[b.status] = (statusCounts[b.status] || 0) + 1;
  });
  stats.by_status = Object.entries(statusCounts).map(([status, count]) => ({ status, count }));

  res.json(stats);
});

// Users
app.get('/api/users', async (req, res) => {
  const { data: users, error } = await supabase
    .from('users')
    .select('id, username, role');
    
  if (error) return res.status(500).json({ error: error.message });
  res.json(users);
});

app.post('/api/users', async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) return res.status(400).json({ error: 'Missing fields' });
  
  const { data, error } = await supabase
    .from('users')
    .insert([{ username, password, role }])
    .select()
    .single();

  if (error) {
    if (error.code === '23505') { // Unique violation
      return res.status(409).json({ error: 'Username already exists' });
    }
    return res.status(500).json({ error: error.message });
  }
  res.json({ id: data.id });
});

app.delete('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  
  // Prevent deleting main admins
  const { data: user } = await supabase.from('users').select('username').eq('id', id).single();
  if (user && (user.username === 'admin' || user.username === 'superadmin')) {
    return res.status(403).json({ error: 'Cannot delete the main admin users' });
  }
  
  const { error } = await supabase.from('users').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  
  res.json({ success: true });
});

// Start Server Logic
if (process.env.NODE_ENV !== 'production') {
  // Dev mode with Vite
  (async () => {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })();
} else {
  // Production mode
  app.use(express.static('dist'));
  
  if (!process.env.VERCEL) {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

export default app;
