import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error('MONGODB_URI is required. Use the database configured in the QR backend project.');
}
const DEFAULT_ADMIN = {
  username: process.env.ADMIN_USERNAME || 'admin',
  password: process.env.ADMIN_PASSWORD || 'admin123',
};

const adminSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
  },
  { collection: 'admins' }
);

const qrSchema = new mongoose.Schema(
  {
    codeId: { type: String, required: true, unique: true },
    productName: { type: String, required: true },
    destinationUrl: { type: String, required: true },
    maxScanThreshold: { type: Number, default: 5 },
    allowedCountries: [{ type: String }],
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'qrcodes' }
);

const scanLogSchema = new mongoose.Schema(
  {
    scannedAt: { type: Date, default: Date.now },
    qrCodeId: { type: String, required: true },
    ipAddress: { type: String, default: 'Unknown' },
    city: { type: String, default: 'Unknown' },
    country: { type: String, default: 'Unknown' },
    status: { type: String, default: 'VALID' },
  },
  { collection: 'scanlogs' }
);

const Admin = mongoose.model('Admin', adminSchema);
const QRCode = mongoose.model('QRCode', qrSchema);
const ScanLog = mongoose.model('ScanLog', scanLogSchema);

async function connectMongo() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    await Admin.findOneAndUpdate(
      { username: DEFAULT_ADMIN.username },
      { username: DEFAULT_ADMIN.username, password: DEFAULT_ADMIN.password },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    process.exit(1);
  }
}

app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', async (req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    return res.json({ ok: true, database: 'MongoDB connected' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};

  const admin = await Admin.findOne({ username, password }).lean();
  if (admin) {
    return res.json({ success: true, message: 'Login successful' });
  }

  if (username === DEFAULT_ADMIN.username && password === DEFAULT_ADMIN.password) {
    await Admin.findOneAndUpdate(
      { username: DEFAULT_ADMIN.username },
      { username: DEFAULT_ADMIN.username, password: DEFAULT_ADMIN.password },
      { upsert: true, new: true }
    );
    return res.json({ success: true, message: 'Login successful' });
  }

  return res.status(401).json({ error: 'Invalid username or password.' });
});

app.get('/api/analytics', async (req, res) => {
  try {
    const [qrs, recentLogs, totalQrs, totalScans, suspiciousScans] = await Promise.all([
      QRCode.find({}).sort({ createdAt: -1 }).lean(),
      ScanLog.find({}).sort({ scannedAt: -1 }).limit(10).lean(),
      QRCode.countDocuments(),
      ScanLog.countDocuments(),
      ScanLog.countDocuments({ status: { $ne: 'VALID' } }),
    ]);

    return res.json({
      summary: {
        totalQrs,
        totalScans,
        suspiciousScans,
      },
      qrs,
      recentLogs,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/create', async (req, res) => {
  const { codeId, productName, destinationUrl, maxScanThreshold, allowedCountries } = req.body || {};

  if (!codeId || !productName || !destinationUrl) {
    return res.status(400).json({ error: 'QR code ID, product name, and destination URL are required.' });
  }

  try {
    const existing = await QRCode.findOne({ codeId });
    if (existing) {
      return res.status(400).json({ error: 'QR code ID already exists.' });
    }

    const qr = await QRCode.create({
      codeId,
      productName,
      destinationUrl,
      maxScanThreshold: Number(maxScanThreshold) || 5,
      allowedCountries: allowedCountries
        ? allowedCountries
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : [],
      createdAt: new Date(),
    });

    return res.status(201).json({ success: true, qr });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.delete('/api/delete/:codeId', async (req, res) => {
  const { codeId } = req.params;

  try {
    const qrResult = await QRCode.deleteOne({ codeId });
    const logResult = await ScanLog.deleteMany({ qrCodeId: codeId });

    if (qrResult.deletedCount === 0) {
      return res.status(404).json({ error: 'QR code not found.' });
    }

    return res.json({ success: true, deletedLogs: logResult.deletedCount });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/export-csv', async (req, res) => {
  try {
    const rows = await ScanLog.find({}).sort({ scannedAt: -1 }).lean();
    const headers = ['scannedAt', 'qrCodeId', 'ipAddress', 'city', 'country', 'status'];

    const csv = [headers.join(',')]
      .concat(
        rows.map((row) =>
          headers.map((header) => JSON.stringify(row[header] ?? '')).join(',')
        )
      )
      .join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="qr_scan_log.csv"');
    return res.send(csv);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/scan', async (req, res) => {
  const { qrCodeId, ipAddress, city, country, status } = req.body || {};

  if (!qrCodeId) {
    return res.status(400).json({ error: 'QR code ID is required.' });
  }

  try {
    const qr = await QRCode.findOne({ codeId: qrCodeId }).lean();
    if (!qr) {
      return res.status(404).json({ error: 'Invalid QR code.' });
    }

    const log = await ScanLog.create({
      qrCodeId,
      ipAddress: ipAddress || 'Unknown',
      city: city || 'Unknown',
      country: country || 'Unknown',
      status: status || 'VALID',
      scannedAt: new Date(),
    });

    return res.status(201).json({ success: true, log });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

connectMongo()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Backend running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
