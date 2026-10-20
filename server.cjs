// ==========================================
// ?? BTA INVENTORY SCANNER SERVER (Node.js)
// Zero-dependency, lightweight, high performance
// ==========================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const url = require('url');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'inventory.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Ensure data folder and file
if (!fs.existsSync(path.dirname(DATA_FILE))) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
}
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, '[]', 'utf8');
}

function readRecords() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (err) {
    console.error('Error reading records:', err);
    return [];
  }
}

function saveRecords(records) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(records, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving records:', err);
    return false;
  }
}

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254')) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  // CORS & Security headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // --- API: Network Info & QR Link ---
  if (pathname === '/api/info' && req.method === 'GET') {
    const localIp = getLocalIp();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ip: localIp,
      port: PORT,
      accessUrl: 'http://' + localIp + ':' + PORT,
      serverTime: new Date().toISOString()
    }));
    return;
  }

  // --- API: Get Records ---
  if (pathname === '/api/records' && req.method === 'GET') {
    const records = readRecords();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(records));
    return;
  }

  // --- API: Save Record ---
  if (pathname === '/api/records' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const item = JSON.parse(body);
        const records = readRecords();

        const now = new Date();
        const dateStr = now.toLocaleDateString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit' });
        const timeStr = now.toLocaleTimeString('th-TH', { hour12: false });

        const gross = parseFloat(item.grossWeight) || 0;
        const tare = parseFloat(item.tareWeight) || 0;
        const net = parseFloat((gross - tare).toFixed(2));

        const newRecord = {
          id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5),
          runNo: parseInt(item.runNo, 10) || (records.length + 1),
          department: item.department || 'BTA-DEFAULT',
          barcode: (item.barcode || '').trim().toUpperCase(),
          grossWeight: gross,
          tareWeight: tare,
          netWeight: net,
          tareType: item.tareType || '',
          operator: (item.operator || '').trim(),
          note: (item.note || '').trim(),
          date: dateStr,
          time: timeStr,
          timestamp: now.toISOString()
        };

        records.unshift(newRecord); // newest first
        saveRecords(records);

        res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, record: newRecord, total: records.length }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON body' }));
      }
    });
    return;
  }

  // --- API: Delete Record ---
  if (pathname.startsWith('/api/records/') && req.method === 'DELETE') {
    const id = pathname.replace('/api/records/', '');
    let records = readRecords();
    const initialLen = records.length;
    records = records.filter(r => r.id !== id);
    if (records.length !== initialLen) {
      saveRecords(records);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, count: records.length }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'Record not found' }));
    }
    return;
  }

  // --- API: Summary / Stats ---
  if (pathname === '/api/stats' && req.method === 'GET') {
    const records = readRecords();
    let totalGross = 0;
    let totalTare = 0;
    let totalNet = 0;
    const byDept = {};

    records.forEach(r => {
      totalGross += r.grossWeight || 0;
      totalTare += r.tareWeight || 0;
      totalNet += r.netWeight || 0;

      const dept = r.department || 'BTA-DEFAULT';
      if (!byDept[dept]) {
        byDept[dept] = { count: 0, gross: 0, tare: 0, net: 0 };
      }
      byDept[dept].count += 1;
      byDept[dept].gross += r.grossWeight || 0;
      byDept[dept].tare += r.tareWeight || 0;
      byDept[dept].net += r.netWeight || 0;
    });

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      totalCount: records.length,
      totalGross: parseFloat(totalGross.toFixed(2)),
      totalTare: parseFloat(totalTare.toFixed(2)),
      totalNet: parseFloat(totalNet.toFixed(2)),
      departments: byDept
    }));
    return;
  }

  // --- API: Export CSV with UTF-8 BOM ---
  if (pathname === '/api/export-csv' && req.method === 'GET') {
    const records = readRecords();
    const headers = [
      '????? (Run No.)',
      '??????',
      '????',
      '???? (Department)',
      '???? Barcode',
      '?????????? (Gross kg)',
      '????????? (Tare Type)',
      '?????????? (Tare kg)',
      '???????????? (Net kg)',
      '????????? (Operator)',
      '????????'
    ];

    const rows = records.slice().reverse().map(r => [
      r.runNo,
      '"' + (r.date || '') + '"',
      '"' + (r.time || '') + '"',
      '"' + (r.department || '').replace(/"/g, '""') + '"',
      '"' + (r.barcode || '').replace(/"/g, '""') + '"',
      (r.grossWeight || 0).toFixed(2),
      '"' + (r.tareType || '').replace(/"/g, '""') + '"',
      (r.tareWeight || 0).toFixed(2),
      (r.netWeight || 0).toFixed(2),
      '"' + (r.operator || '').replace(/"/g, '""') + '"',
      '"' + (r.note || '').replace(/"/g, '""') + '"'
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(row => row.join(','))].join('\r\n');
    const filename = 'inventory_bta_' + new Date().toISOString().slice(0, 10) + '.csv';
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="' + filename + '"'
    });
    res.end(csvContent);
    return;
  }

  // --- Static Files ---
  let reqPath = pathname === '/' ? '/index.html' : pathname;
  let filePath = path.join(PUBLIC_DIR, reqPath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Access Denied');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File Not Found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIp();
  console.log('=====================================================');
  console.log('  ?? BTA PLANT INVENTORY SCANNER SERVER STARTED ??   ');
  console.log('=====================================================');
  console.log('  - PC Access:      http://localhost:' + PORT);
  console.log('  - Mobile Access:  http://' + localIp + ':' + PORT);
  console.log('=====================================================');
  console.log('  Point your mobile camera at the QR code to open!');
});
