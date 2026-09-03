import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/$/, '');
const TRACKING_URL = (import.meta.env.VITE_TRACKING_URL || API_URL).replace(/\/$/, '');

const emptyForm = {
  codeId: '',
  productName: '',
  destinationUrl: '',
  maxScanThreshold: '5',
  allowedCountries: '',
};

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [metrics, setMetrics] = useState({ totalQrs: 0, totalScans: 0, suspiciousScans: 0 });
  const [qrs, setQrs] = useState([]);
  const [logs, setLogs] = useState([]);
  const [statusMessage, setStatusMessage] = useState('');
  const [statusType, setStatusType] = useState('');
  const [loading, setLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState('');

  const apiFetch = (path, options = {}) => {
    const credentials = localStorage.getItem('qrAdminCredentials');
    const headers = new Headers(options.headers || {});
    if (credentials) headers.set('Authorization', `Basic ${credentials}`);
    return fetch(`${API_URL}${path}`, { ...options, headers });
  };

  useEffect(() => {
    const session = localStorage.getItem('qrAdminAuth');
    if (session === 'true' && localStorage.getItem('qrAdminCredentials')) {
      setIsAuthenticated(true);
    }
  }, []);

  const fetchAnalytics = async () => {
    try {
      setAnalyticsError('');
      const res = await apiFetch('/analytics');
      if (!res.ok) throw new Error('Unauthorized');

      const data = await res.json();
      setMetrics(data.summary ?? { totalQrs: 0, totalScans: 0, suspiciousScans: 0 });
      setQrs(data.qrs ?? []);
      setLogs(data.recentLogs ?? []);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
      setAnalyticsError('Unable to connect to the QR backend. Make sure the backend is running and VITE_API_URL is correct.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return undefined;

    fetchAnalytics();
    const interval = setInterval(fetchAnalytics, 10000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  const handleLoginChange = (event) => {
    const { name, value } = event.target;
    setLoginForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleLoginSubmit = async (event) => {
    event.preventDefault();

    try {
      const credentials = btoa(`${loginForm.username}:${loginForm.password}`);
      const response = await fetch(`${API_URL}/analytics`, {
        headers: { Authorization: `Basic ${credentials}` },
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Invalid username or password.');
      }

      localStorage.setItem('qrAdminCredentials', credentials);
      localStorage.setItem('qrAdminAuth', 'true');
      setLoginError('');
      setIsAuthenticated(true);
    } catch (error) {
      setLoginError(error.message || 'Invalid username or password.');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('qrAdminAuth');
    localStorage.removeItem('qrAdminCredentials');
    setIsAuthenticated(false);
    setLoginForm({ username: '', password: '' });
  };

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    try {
      setStatusMessage('Creating QR code...');
      setStatusType('info');

      const response = await apiFetch('/qrcodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to create QR code');
      }

      setStatusMessage('QR code created successfully.');
      setStatusType('success');
      setForm({ ...emptyForm, maxScanThreshold: '5' });
      fetchAnalytics();
    } catch (error) {
      setStatusMessage(error.message);
      setStatusType('error');
    }
  };

  const downloadCsv = async () => {
    try {
      const response = await apiFetch('/export-csv');
      if (!response.ok) throw new Error('Failed to export scan logs');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'scan_logs.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert(error.message);
    }
  };

  const handleDelete = async (codeId) => {
    if (!window.confirm(`Delete QR code: ${codeId}?`)) return;

    try {
      const response = await apiFetch(`/qrcodes/${encodeURIComponent(codeId)}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Delete failed');
      fetchAnalytics();
    } catch (error) {
      alert(error.message);
    }
  };

  const renderQrCode = async (qr, setImageSrc) => {
    if (qr.qrImageBase64) {
      setImageSrc(`data:image/png;base64,${qr.qrImageBase64}`);
      return;
    }

    const trackingUrl = `${TRACKING_URL}/qrcodes/${encodeURIComponent(qr.codeId)}/scan`;
    try {
      const dataUrl = await QRCode.toDataURL(trackingUrl, { width: 180 });
      setImageSrc(dataUrl);
    } catch (error) {
      console.error('QR generation failed:', error);
    }
  };

  const openPreview = (qr, imageSrc) => {
    const trackingUrl = `${TRACKING_URL}/qrcodes/${encodeURIComponent(qr.codeId)}/scan`;
    const previewWindow = window.open('', '_blank', 'width=420,height=420');

    if (!previewWindow) return;

    previewWindow.document.write(`
      <html>
        <body style="font-family:sans-serif; display:flex; align-items:center; justify-content:center; flex-direction:column; gap:12px; padding:20px; text-align:center;">
          <h3>${qr.productName}</h3>
          <img src="${imageSrc || ''}" alt="${qr.productName}" style="width:260px; height:260px; border:1px solid #ddd; padding:10px; border-radius:8px;" />
          <div>Tracking URL: ${trackingUrl}</div>
        </body>
      </html>
    `);
  };

  const hasRecords = qrs.length > 0;

  if (!isAuthenticated) {
    return (
      <div className="login-shell">
        <form className="login-card" onSubmit={handleLoginSubmit}>
          <h1>Admin Login</h1>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              name="username"
              type="text"
              value={loginForm.username}
              onChange={handleLoginChange}
              placeholder="admin"
              autoComplete="username"
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              value={loginForm.password}
              onChange={handleLoginChange}
              placeholder="admin123"
              autoComplete="current-password"
            />
          </div>

          {loginError && <p className="login-error">{loginError}</p>}

          <button type="submit" className="btn login-btn">Login</button>
          <p className="login-hint">Use admin / admin123</p>
        </form>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="page-header">
        <h1>QR Code Security Dashboard</h1>
        <button type="button" className="btn" onClick={downloadCsv}>Export CSV Log</button>
      </div>

      <div className="toolbar" style={{ margin: '20px 0' }}>
        <h2 style={{ margin: 0 }}>Create New QR Code</h2>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-dark" onClick={() => window.location.reload()}>Home</button>
          <button type="button" className="btn btn-danger" onClick={handleLogout}>Logout</button>
        </div>
      </div>

      <form className="create-form" onSubmit={handleSubmit}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="codeId">QR Code ID</label>
            <input id="codeId" name="codeId" required value={form.codeId} onChange={handleChange} />
          </div>

          <div className="field">
            <label htmlFor="productName">Product Name</label>
            <input id="productName" name="productName" required value={form.productName} onChange={handleChange} />
          </div>

          <div className="field">
            <label htmlFor="destinationUrl">Destination URL</label>
            <input id="destinationUrl" name="destinationUrl" type="url" required value={form.destinationUrl} onChange={handleChange} />
          </div>

          <div className="field">
            <label htmlFor="maxScanThreshold">Max Scan Threshold</label>
            <input id="maxScanThreshold" name="maxScanThreshold" type="number" min="1" value={form.maxScanThreshold} onChange={handleChange} />
          </div>

          <div className="field">
            <label htmlFor="allowedCountries">Allowed Countries</label>
            <input id="allowedCountries" name="allowedCountries" placeholder="US,BD,CA" value={form.allowedCountries} onChange={handleChange} />
          </div>
        </div>

        <div className="form-actions">
          <button type="submit" className="btn">Create QR Code</button>
          {statusMessage && (
            <span style={{ color: statusType === 'error' ? '#d9534f' : '#2d3748' }}>{statusMessage}</span>
          )}
        </div>
      </form>

      <div className="metrics">
        <div className="card">
          <h3>Active QR Codes</h3>
          <div className="value">{metrics.totalQrs}</div>
        </div>
        <div className="card">
          <h3>Total Scans</h3>
          <div className="value">{metrics.totalScans}</div>
        </div>
        <div className="card">
          <h3>Flagged / Counterfeit Alerts</h3>
          <div className="value alert-val">{metrics.suspiciousScans}</div>
        </div>
      </div>

      <h2>Generated QR Codes</h2>
      {!loading && !hasRecords ? (
        <div className="empty-state">No QR codes created yet.</div>
      ) : (
        <div className="qr-gallery">
          {qrs.map((qr) => (
            <QrCard
              key={qr.codeId}
              qr={qr}
              renderQrCode={renderQrCode}
              openPreview={openPreview}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      <h2>Recent Scan Activity</h2>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>QR ID</th>
            <th>IP Address</th>
            <th>Location</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan="5">Loading analytics...</td>
            </tr>
          ) : analyticsError ? (
            <tr>
              <td colSpan="5">{analyticsError}</td>
            </tr>
          ) : logs.length === 0 ? (
            <tr>
              <td colSpan="5">No scan activity recorded yet.</td>
            </tr>
          ) : (
            logs.map((log) => (
              <tr key={`${log.qrCodeId}-${log.scannedAt}-${log.ipAddress}`}>
                <td>{new Date(log.scannedAt).toLocaleString()}</td>
                <td><b>{log.qrCodeId}</b></td>
                <td>{log.ipAddress}</td>
                <td>{`${log.city || ''}${log.city && log.country ? ', ' : ''}${log.country || ''}`}</td>
                <td>
                  <span className={`status status-${log.status}`}>{log.status}</span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function QrCard({ qr, renderQrCode, openPreview, onDelete }) {
  const [imageSrc, setImageSrc] = useState('');

  useEffect(() => {
    renderQrCode(qr, setImageSrc);
  }, [qr, renderQrCode]);

  const trackingUrl = `${TRACKING_URL}/qrcodes/${encodeURIComponent(qr.codeId)}/scan`;

  return (
    <div className="qr-card">
      <div className="qr-title">{qr.productName}</div>
      <div className="qr-id">ID: {qr.codeId}</div>
      <img src={imageSrc} alt={qr.productName} />
      <div className="qr-actions">
        <button type="button" className="action-btn preview" onClick={() => openPreview(qr, imageSrc)}>Preview QR</button>
        <a href={imageSrc || trackingUrl} download={`${qr.codeId}.png`} className="action-btn download">Download QR</a>
        <button type="button" className="action-btn delete" onClick={() => onDelete(qr.codeId)}>Delete QR</button>
      </div>
      <a href={trackingUrl} target="_blank" rel="noopener noreferrer" className="action-link">Open link</a>
    </div>
  );
}

export default App;
