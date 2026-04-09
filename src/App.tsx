import type { FormEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import Papa from 'papaparse';
import templateUrl from './Voucher ID Template TGH (1).png';

type View = 'dashboard' | 'generate' | 'bulk' | 'audit';
type Status = 'Active' | 'Redeemed';
type AuditStatus = 'Success' | 'Failure';

type Voucher = {
  id: string;
  orderId: string;
  voucherId: string;
  amount: string;
  issuedDate: string;
  expiryDate: string;
  status: Status;
  createdAt: string;
};

type AuditLog = {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  resource: string;
  status: AuditStatus;
};

type Draft = {
  orderId: string;
  voucherId: string;
  amount: string;
  issuedDate: string;
  expiryDate: string;
};

const STORAGE_KEY = 'the_good_health_vouchers';
const AUDIT_KEY = 'the_good_health_audit';
const RUPEE = '\u20b9';

const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
};

const today = () => new Date().toISOString().split('T')[0];
const inThirtyDays = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

const loadTemplate = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load voucher template.'));
    image.src = src;
  });

const drawVoucher = (canvas: HTMLCanvasElement, image: HTMLImageElement, data: Partial<Voucher | Draft>) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  canvas.width = image.width;
  canvas.height = image.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  if (data.voucherId) {
    ctx.font = 'bold 110px Inter, sans-serif';
    ctx.fillStyle = '#003321';
    ctx.fillText(data.voucherId, (canvas.width * 720) / 1200, (canvas.height * 258) / 400);
  }
  if (data.amount) {
    ctx.font = '900 160px Inter, sans-serif';
    ctx.fillStyle = 'rgba(254, 253, 225)';
    ctx.textAlign = 'center';
    ctx.fillText(data.amount, (canvas.width * 720) / 1200, (canvas.height * 180) / 400);
    ctx.textAlign = 'left';
  }
  ctx.font = 'bold 90px Inter, sans-serif';
  ctx.fillStyle = '#003321';
  if (data.issuedDate) ctx.fillText(data.issuedDate, (canvas.width * 720) / 1200, (canvas.height * 302) / 400);
  if (data.expiryDate) ctx.fillText(data.expiryDate, (canvas.width * 720) / 1200, (canvas.height * 335) / 400);
};

const badgeClass = (status: Status | AuditStatus) =>
  status === 'Active' || status === 'Success'
    ? 'status-badge status-badge-active'
    : 'status-badge status-badge-redeemed';

const buttonClass =
  'rounded-xl border border-[#003321]/10 bg-white px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-[#003321] transition hover:bg-[#FDFBF7]';

export default function App() {
  const [view, setView] = useState<View>('dashboard');
  const [query, setQuery] = useState('');
  const [previewZoom, setPreviewZoom] = useState(100);
  const [vouchers, setVouchers] = useState<Voucher[]>(() => readJson(STORAGE_KEY, []));
  const [logs, setLogs] = useState<AuditLog[]>(() => readJson(AUDIT_KEY, []));
  const [template, setTemplate] = useState<HTMLImageElement | null>(null);
  const [templateError, setTemplateError] = useState('');
  const [amountError, setAmountError] = useState('');
  const [lastGenerated, setLastGenerated] = useState('');
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => void } | null>(null);
  const [bulk, setBulk] = useState({ visible: false, processed: 0, total: 0, percent: 0, status: 'Preparing...' });
  const [draft, setDraft] = useState<Draft>({
    orderId: '',
    voucherId: '',
    amount: '',
    issuedDate: today(),
    expiryDate: inThirtyDays(),
  });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(vouchers));
  }, [vouchers]);

  useEffect(() => {
    window.localStorage.setItem(AUDIT_KEY, JSON.stringify(logs));
  }, [logs]);

  useEffect(() => {
    let active = true;
    loadTemplate(templateUrl)
      .then((image) => {
        if (active) setTemplate(image);
      })
      .catch((error: Error) => {
        if (active) setTemplateError(error.message);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (template && canvasRef.current) drawVoucher(canvasRef.current, template, draft);
  }, [draft, template]);

  const addLog = (action: string, resource: string, status: AuditStatus = 'Success') => {
    setLogs((current) => [
      ...current,
      { id: crypto.randomUUID(), timestamp: new Date().toISOString(), actor: 'System', action, resource, status },
    ]);
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = vouchers.slice().reverse();
    if (!needle) return list;
    return list.filter((voucher) =>
      [voucher.orderId, voucher.voucherId, voucher.amount, voucher.issuedDate, voucher.expiryDate]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [query, vouchers]);

  const stats = useMemo(() => {
    const redeemed = vouchers.filter((voucher) => voucher.status === 'Redeemed').length;
    const totalValue = vouchers.reduce((sum, voucher) => sum + (Number.parseFloat(voucher.amount) || 0), 0);
    return { total: vouchers.length, redeemed, active: vouchers.length - redeemed, totalValue };
  }, [vouchers]);

  const makeCanvas = (data: Partial<Voucher | Draft>) => {
    if (!template) return null;
    const canvas = document.createElement('canvas');
    drawVoucher(canvas, template, data);
    return canvas;
  };

  const downloadCanvas = (canvas: HTMLCanvasElement, fileName: string, format: 'png' | 'pdf') => {
    if (format === 'png') {
      const link = document.createElement('a');
      link.download = fileName;
      link.href = canvas.toDataURL('image/png');
      link.click();
      return;
    }
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [canvas.width, canvas.height] });
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
    pdf.save(fileName);
  };

  const generateVoucher = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.amount || Number.parseFloat(draft.amount) <= 0) {
      setAmountError('Please enter a valid positive amount');
      return;
    }
    const voucher: Voucher = {
      id: crypto.randomUUID(),
      orderId: draft.orderId,
      voucherId: draft.voucherId,
      amount: draft.amount,
      issuedDate: draft.issuedDate,
      expiryDate: draft.expiryDate,
      status: 'Active',
      createdAt: new Date().toISOString(),
    };
    setAmountError('');
    setVouchers((current) => [...current, voucher]);
    setLastGenerated(voucher.id);
    addLog('Generate Voucher', voucher.voucherId);
  };

  const downloadVoucher = (voucher: Voucher, format: 'png' | 'pdf') => {
    const canvas = makeCanvas(voucher);
    if (!canvas) return;
    downloadCanvas(canvas, `${voucher.orderId}.${format}`, format);
    addLog(`Download ${format.toUpperCase()}`, voucher.voucherId);
  };

  const downloadCurrent = (format: 'png' | 'pdf') => {
    const voucher = vouchers.find((item) => item.id === lastGenerated);
    if (voucher) downloadVoucher(voucher, format);
  };

  const exportCsv = () => {
    const blob = new Blob([Papa.unparse(vouchers)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `vouchers_export_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadCsvTemplate = () => {
    const csv =
      'Voucher ID,Amount,Order ID,Issued Date,Expiry Date\nVCH-001,500,ORD-101,2026-04-07,2026-05-07\nVCH-002,1000,ORD-102,2026-04-07,2026-05-07';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'voucher_template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const bulkUpload = async (file: File) => {
    if (!template) return;
    setBulk({ visible: true, processed: 0, total: 0, percent: 0, status: 'Reading CSV...' });
    const parsed = await new Promise<Papa.ParseResult<Record<string, string>>>((resolve, reject) => {
      Papa.parse<Record<string, string>>(file, { header: true, skipEmptyLines: true, complete: resolve, error: reject });
    });
    const rows = parsed.data;
    const zip = new JSZip();
    const generated: Voucher[] = [];
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const voucher: Voucher = {
        id: crypto.randomUUID(),
        voucherId: row['Voucher ID'] || row.voucherId || `VCH-${Date.now()}-${i}`,
        amount: row.Amount || row.amount || '0',
        orderId: row['Order ID'] || row.orderId || `ORD-${i + 1}`,
        issuedDate: row['Issued Date'] || row.issuedDate || today(),
        expiryDate: row['Expiry Date'] || row.expiryDate || inThirtyDays(),
        status: 'Active',
        createdAt: new Date().toISOString(),
      };
      generated.push(voucher);
      const canvas = document.createElement('canvas');
      drawVoucher(canvas, template, voucher);
      zip.file(`${voucher.orderId}.png`, canvas.toDataURL('image/png').split(',')[1], { base64: true });
      const processed = i + 1;
      setBulk({
        visible: true,
        processed,
        total: rows.length,
        percent: rows.length ? Math.round((processed / rows.length) * 100) : 0,
        status: 'Generating vouchers...',
      });
      if (i % 10 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    setVouchers((current) => [...current, ...generated]);
    addLog('Bulk Generate', `${generated.length} Vouchers`);
    setBulk((current) => ({ ...current, status: 'Packaging ZIP...' }));
    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = url;
    link.download = `vouchers_batch_${Date.now()}.zip`;
    link.click();
    URL.revokeObjectURL(url);
    setBulk({ visible: true, processed: rows.length, total: rows.length, percent: 100, status: 'Batch complete!' });
    window.setTimeout(() => setBulk((current) => ({ ...current, visible: false })), 3000);
  };

  const nav = [
    ['dashboard', 'Dashboard'],
    ['generate', 'Single Generation'],
    ['bulk', 'Bulk Operations'],
    ['audit', 'Audit Logs'],
  ] as const;

  return (
    <div className="flex min-h-dvh overflow-x-hidden bg-[#FDFBF7] text-[#003321]">
      <aside className="hidden w-72 flex-col border-r border-[#003321]/10 bg-white md:flex">
        <div className="border-b border-[#003321]/10 px-8 py-6">
          <div className="text-lg font-bold tracking-tight">THE GOOD HEALTH</div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#D30000]">A2Z Naturopathy</div>
        </div>
        <nav className="flex-1 space-y-1 px-4 py-6">
          {nav.map(([key, label]) => (
            <button
              key={key}
              className={`nav-item w-full rounded-xl px-4 py-3 text-left text-sm font-medium ${view === key ? 'active' : ''}`}
              onClick={() => setView(key)}
              type="button"
            >
              {label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-auto min-h-20 flex-wrap items-center justify-between gap-4 border-b border-[#003321]/10 bg-white px-6 py-4 md:px-10">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold">{view.charAt(0).toUpperCase() + view.slice(1)}</h1>
            <div className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700">System Online</div>
          </div>
          <input
            className="h-10 w-full rounded-full border border-[#003321]/10 bg-[#FDFBF7] px-4 text-sm outline-none sm:max-w-xs lg:w-64"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search vouchers..."
            type="text"
            value={query}
          />
        </header>
        <div className="border-b border-[#003321]/10 bg-white/80 px-4 py-3 md:hidden">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {nav.map(([key, label]) => (
              <button
                key={key}
                className={`shrink-0 rounded-full border px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition ${
                  view === key
                    ? 'border-[#003321] bg-[#003321] text-white'
                    : 'border-[#003321]/10 bg-[#FDFBF7] text-[#003321]/70'
                }`}
                onClick={() => setView(key)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 md:p-8 xl:p-10">
          {view === 'dashboard' ? (
            <div className="space-y-10">
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <Card title="Total Issued" value={String(stats.total)} foot="+100% this week" />
                <Card title="Total Value" value={`${RUPEE}${stats.totalValue.toLocaleString()}`} foot="Across all campaigns" />
                <Card title="Redeemed" value={String(stats.redeemed)} progress={stats.total ? (stats.redeemed / stats.total) * 100 : 0} />
                <Card title="Active" value={String(stats.active)} foot="Ready for use" />
              </div>
              <section className="slider-surface overflow-hidden rounded-2xl border border-[#003321]/10 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#003321]/10 bg-[#FDFBF7]/30 px-6 py-5">
                  <h2 className="text-sm font-bold uppercase tracking-widest">Recent Vouchers</h2>
                  <div className="flex gap-3">
                    <button
                      className={`${buttonClass} border-[#D30000]/20 text-[#D30000] hover:bg-red-50`}
                      onClick={() =>
                        setConfirm({
                          title: 'Clear All Vouchers',
                          message: 'Are you sure you want to delete all vouchers? This action cannot be undone.',
                          action: () => {
                            setVouchers([]);
                            addLog('Clear All Vouchers', 'All');
                          },
                        })
                      }
                      type="button"
                    >
                      Clear All
                    </button>
                    <button className="rounded-xl bg-[#003321] px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white" onClick={exportCsv} type="button">
                      Export CSV
                    </button>
                  </div>
                </div>
                {filtered.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="rounded-full bg-[#FDFBF7] px-6 py-4 text-sm font-bold text-[#003321]/40">No vouchers yet</div>
                    <button className="mt-6 text-[10px] font-bold uppercase tracking-widest text-[#D30000]" onClick={() => setView('generate')} type="button">
                      Start Generating
                    </button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-[#003321]/5 bg-[#FDFBF7]/10">
                          {['Order ID', 'Voucher ID', 'Amount', 'Issued', 'Expiry', 'Status', 'Actions'].map((item) => (
                            <th key={item} className={`px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#003321]/40 ${item === 'Actions' ? 'text-right' : ''}`}>{item}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#003321]/5">
                        {filtered.map((voucher) => (
                          <tr key={voucher.id} className="hover:bg-[#FDFBF7]/50">
                            <td className="px-6 py-4 text-xs font-bold">{voucher.orderId}</td>
                            <td className="px-6 py-4 text-xs font-mono text-[#003321]/60">{voucher.voucherId}</td>
                            <td className="px-6 py-4 text-xs font-black text-[#D30000]">{RUPEE}{voucher.amount}</td>
                            <td className="px-6 py-4 text-xs text-[#003321]/60">{voucher.issuedDate}</td>
                            <td className="px-6 py-4 text-xs text-[#003321]/60">{voucher.expiryDate}</td>
                            <td className="px-6 py-4"><span className={badgeClass(voucher.status)}>{voucher.status}</span></td>
                            <td className="px-6 py-4 text-right">
                              <div className="flex justify-end gap-2">
                                <MiniButton label="PNG" onClick={() => downloadVoucher(voucher, 'png')} />
                                <MiniButton label="PDF" onClick={() => downloadVoucher(voucher, 'pdf')} />
                                <MiniButton
                                  label="Delete"
                                  onClick={() =>
                                    setConfirm({
                                      title: 'Delete Voucher',
                                      message: `Are you sure you want to delete voucher ${voucher.voucherId}?`,
                                      action: () => {
                                        setVouchers((current) => current.filter((item) => item.id !== voucher.id));
                                        addLog('Delete Voucher', voucher.voucherId);
                                      },
                                    })
                                  }
                                />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          ) : null}
          {view === 'generate' ? (
            <div className="mx-auto grid max-w-[1500px] grid-cols-1 gap-6 xl:grid-cols-[minmax(360px,430px)_minmax(0,1fr)] xl:items-start">
              <div className="order-1 space-y-5 xl:sticky xl:top-6">
                <div className="slider-surface rounded-[28px] border border-[#003321]/10 bg-white p-5 shadow-xl md:p-6 xl:min-h-[calc(100vh-10rem)]">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h2 className="text-3xl font-black tracking-tight">Live Preview</h2>
                      <p className="mt-2 text-sm text-[#003321]/60">The preview now stays in a wide landscape frame so the rectangular voucher is easier to edit.</p>
                    </div>
                    <div className="min-w-[220px] flex-1 md:max-w-xs">
                      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-[#003321]/50">
                        <span>Zoom</span>
                        <span>{previewZoom}%</span>
                      </div>
                      <input
                        className="preview-slider mt-3 w-full"
                        max="180"
                        min="80"
                        onChange={(event) => setPreviewZoom(Number(event.target.value))}
                        type="range"
                        value={previewZoom}
                      />
                    </div>
                  </div>
                  <div className="relative mt-6 aspect-[12/4] min-h-[240px] w-full overflow-auto rounded-[24px] border border-[#003321]/10 bg-[linear-gradient(135deg,rgba(211,0,0,0.05),rgba(0,51,33,0.04))] p-3 md:min-h-[320px] lg:min-h-[380px] xl:min-h-[460px]">
                    <div className="flex h-full min-h-full min-w-full items-center justify-center">
                      <canvas
                        ref={canvasRef}
                        className="mx-auto block h-auto max-w-none rounded-2xl shadow-2xl"
                        style={{ width: `${previewZoom}%`, minWidth: '100%', maxWidth: '1400px' }}
                      />
                    </div>
                    {!template ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/80 text-[10px] font-bold uppercase tracking-widest text-[#003321]/40">
                        Loading Template...
                      </div>
                    ) : null}
                  </div>
                  {templateError ? <p className="mt-4 text-sm text-[#D30000]">{templateError}</p> : null}
                  <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <button className={`${buttonClass} ${lastGenerated ? '' : 'cursor-not-allowed opacity-50'}`} disabled={!lastGenerated} onClick={() => downloadCurrent('png')} type="button">Download PNG</button>
                    <button className={`${buttonClass} ${lastGenerated ? '' : 'cursor-not-allowed opacity-50'}`} disabled={!lastGenerated} onClick={() => downloadCurrent('pdf')} type="button">Download PDF</button>
                  </div>
                </div>
              </div>
              <form className="order-2 space-y-6 rounded-3xl border border-[#003321]/10 bg-white p-8 shadow-sm" onSubmit={generateVoucher}>
                <div>
                  <h2 className="text-3xl font-black tracking-tight">Single Generation</h2>
                  <p className="mt-2 text-sm text-[#003321]/60">Create a branded voucher with preview and export support that adapts cleanly across mobile and desktop.</p>
                </div>
                <Field label="Order ID" value={draft.orderId} onChange={(value) => setDraft((current) => ({ ...current, orderId: value }))} />
                <Field label="Voucher ID" value={draft.voucherId} onChange={(value) => setDraft((current) => ({ ...current, voucherId: value }))} />
                <Field label={`Amount (${RUPEE})`} type="number" value={draft.amount} onChange={(value) => { setDraft((current) => ({ ...current, amount: value })); setAmountError(''); }} />
                {amountError ? <p className="text-[10px] font-bold uppercase tracking-widest text-[#D30000]">{amountError}</p> : null}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Issued Date" type="date" value={draft.issuedDate} onChange={(value) => setDraft((current) => ({ ...current, issuedDate: value }))} />
                  <Field label="Expiry Date" type="date" value={draft.expiryDate} onChange={(value) => setDraft((current) => ({ ...current, expiryDate: value }))} />
                </div>
                <div className="flex gap-4">
                  <button className="flex-1 rounded-xl bg-[#003321] px-6 py-4 text-xs font-bold uppercase tracking-widest text-white" type="submit">Generate Voucher</button>
                  <button className={buttonClass} onClick={() => template && canvasRef.current && drawVoucher(canvasRef.current, template, draft)} type="button">Preview</button>
                </div>
              </form>
            </div>
          ) : null}
          {view === 'bulk' ? (
            <div className="mx-auto max-w-4xl space-y-10">
              <div>
                <h2 className="text-3xl font-black tracking-tight">Bulk Operations</h2>
                <p className="mt-2 text-sm text-[#003321]/60">Upload a CSV file to generate vouchers and package them into a ZIP.</p>
              </div>
              <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                <div className="space-y-6 lg:col-span-2">
                  <label className="slider-surface flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed border-[#003321]/10 bg-white p-10 text-center hover:border-[#D30000]/40 hover:bg-[#FDFBF7]/50 md:p-16">
                    <span className="rounded-full bg-[#FDFBF7] px-6 py-4 text-xs font-bold uppercase tracking-widest text-[#003321]/40">Upload CSV</span>
                    <span className="mt-8 text-sm font-bold uppercase tracking-widest">Choose CSV File</span>
                    <span className="mt-2 text-xs uppercase tracking-widest text-[#003321]/40">Voucher ID, Amount, Order ID</span>
                    <input accept=".csv" className="sr-only" onChange={(event) => event.target.files?.[0] && void bulkUpload(event.target.files[0])} type="file" />
                  </label>
                  {bulk.visible ? (
                    <div className="slider-surface space-y-4 rounded-3xl border border-[#003321]/10 bg-white p-8 shadow-sm">
                      <div className="flex justify-between">
                        <p className="text-xs font-bold uppercase tracking-widest">{bulk.status}</p>
                        <p className="text-xs font-black">{bulk.percent}%</p>
                      </div>
                      <div className="h-2 w-full rounded-full bg-[#FDFBF7]">
                        <div className="slider-fill h-2 rounded-full bg-[#003321]" style={{ width: `${bulk.percent}%` }} />
                      </div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#003321]/40">{bulk.processed} / {bulk.total} Vouchers</p>
                    </div>
                  ) : null}
                </div>
                <div className="slider-surface rounded-3xl border border-[#003321]/10 bg-white p-8 shadow-sm">
                  <h3 className="text-[10px] font-bold uppercase tracking-widest">Instructions</h3>
                  <ul className="mt-6 space-y-4 text-xs text-[#003321]/60">
                    <li>1. Use headers: Voucher ID, Amount, Order ID.</li>
                    <li>2. Issued and expiry dates are optional.</li>
                    <li>3. A ZIP of PNG files downloads automatically.</li>
                  </ul>
                  <button className={`${buttonClass} mt-8 w-full`} onClick={downloadCsvTemplate} type="button">Download CSV Template</button>
                </div>
              </div>
            </div>
          ) : null}
          {view === 'audit' ? (
            <div className="space-y-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-3xl font-black tracking-tight">Audit Logs</h2>
                  <p className="mt-2 text-sm text-[#003321]/60">Immutable record of voucher operations and system changes.</p>
                </div>
                <button
                  className={`${buttonClass} border-[#D30000]/20 text-[#D30000] hover:bg-red-50`}
                  onClick={() => setConfirm({ title: 'Clear Audit Logs', message: 'Are you sure you want to clear all audit logs?', action: () => setLogs([]) })}
                  type="button"
                >
                  Clear Logs
                </button>
              </div>
              <div className="slider-surface overflow-hidden rounded-2xl border border-[#003321]/10 bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-[#003321]/5 bg-[#FDFBF7]/10">
                        {['Timestamp', 'Actor', 'Action', 'Resource', 'Status'].map((item) => (
                          <th key={item} className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#003321]/40">{item}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#003321]/5">
                      {logs.slice().reverse().map((log) => (
                        <tr key={log.id} className="hover:bg-[#FDFBF7]/50">
                          <td className="px-6 py-4 text-[10px] font-mono text-[#003321]/40">{new Date(log.timestamp).toLocaleString()}</td>
                          <td className="px-6 py-4 text-xs font-bold">{log.actor}</td>
                          <td className="px-6 py-4 text-xs">{log.action}</td>
                          <td className="px-6 py-4 text-xs font-mono text-[#003321]/60">{log.resource}</td>
                          <td className="px-6 py-4"><span className={badgeClass(log.status)}>{log.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </main>
      {confirm ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#003321]/40 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-10 shadow-2xl">
            <h3 className="text-2xl font-black tracking-tight">{confirm.title}</h3>
            <p className="mt-4 text-sm leading-relaxed text-[#003321]/60">{confirm.message}</p>
            <div className="mt-10 flex gap-4">
              <button className={`${buttonClass} flex-1`} onClick={() => setConfirm(null)} type="button">Cancel</button>
              <button
                className="flex-1 rounded-xl bg-[#D30000] py-2 text-xs font-bold uppercase tracking-widest text-white"
                onClick={() => {
                  confirm.action();
                  setConfirm(null);
                }}
                type="button"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Card({ title, value, foot, progress }: { title: string; value: string; foot?: string; progress?: number }) {
  return (
    <div className="rounded-2xl border border-[#003321]/10 bg-white p-8 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-widest text-[#003321]/40">{title}</p>
      <p className="mt-4 text-4xl font-black tracking-tight">{value}</p>
      {typeof progress === 'number' ? (
        <div className="mt-4 h-1.5 w-full rounded-full bg-[#FDFBF7]">
          <div className="h-1.5 rounded-full bg-[#003321]" style={{ width: `${progress}%` }} />
        </div>
      ) : (
        <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-[#003321]/40">{foot}</p>
      )}
    </div>
  );
}

function Field({
  label,
  onChange,
  type = 'text',
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  type?: string;
  value: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-[10px] font-bold uppercase tracking-widest text-[#003321]/60">{label}</span>
      <input className="w-full rounded-xl border border-[#003321]/10 bg-[#FDFBF7]/50 px-4 py-3 text-sm outline-none" onChange={(event) => onChange(event.target.value)} type={type} value={value} />
    </label>
  );
}

function MiniButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="rounded-lg border border-[#003321]/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#003321]/70 hover:border-[#D30000]/20 hover:text-[#D30000]" onClick={onClick} type="button">
      {label}
    </button>
  );
}
