// Optional Supabase cloud connection credentials for multi-phone sync
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_KEY = 'YOUR_SUPABASE_ANON_KEY';

const STORAGE_KEY = 'tmn_uber_fleet_logs_v1';

// Format South African Rand
function formatZAR(amount) {
  return 'R ' + Number(amount || 0).toLocaleString('en-ZA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// Fetch all shift entries (with local storage fallback)
async function getLogs() {
  if (SUPABASE_URL !== 'YOUR_SUPABASE_URL' && window.supabase) {
    const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data, error } = await client.from('fleet_logs').select('*').order('shift_date', { ascending: false });
    if (!error && data) return data;
  }
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
}

// Save a new shift entry
async function saveLog(entry) {
  if (SUPABASE_URL !== 'YOUR_SUPABASE_URL' && window.supabase) {
    const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const { error } = await client.from('fleet_logs').insert([entry]);
    if (error) {
      alert('Error saving to cloud: ' + error.message);
      return false;
    }
    return true;
  }
  // Local fallback
  const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  entry.id = Date.now();
  existing.unshift(entry);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  return true;
}

// Filter logs by timeframe
function filterByTimeframe(logs, timeframe) {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  return logs.filter(item => {
    if (timeframe === 'all') return true;
    const itemDate = new Date(item.shift_date);
    if (timeframe === 'day') return item.shift_date === todayStr;
    if (timeframe === 'week') {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(now.getDate() - 7);
      return itemDate >= sevenDaysAgo;
    }
    if (timeframe === 'month') {
      return itemDate.getMonth() === now.getMonth() && itemDate.getFullYear() === now.getFullYear();
    }
    return true;
  });
}
