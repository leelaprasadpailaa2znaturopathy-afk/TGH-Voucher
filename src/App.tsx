import type { FormEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import Papa from 'papaparse';
import templateUrl from './Voucher ID Template TGH (1).png';
import template1kUrl from './Voucher 1k.png';

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

type BulkFormat = 'png' | 'pdf';
type TemplateKey = 'default' | 'voucher1k';
type TemplateMap = Record<TemplateKey, HTMLImageElement>;
type VoucherTextStyle = {
  fontSize: number;
  fontWeight: string;
  fontFamily: string;
  color: string;
};
type VoucherLayout = {
  referenceWidth: number;
  referenceHeight: number;
  amountStyle: VoucherTextStyle;
  voucherIdStyle: VoucherTextStyle;
  dateStyle: VoucherTextStyle;
  amountX: number;
  amountY: number;
  voucherIdX: number;
  voucherIdY: number;
  issuedDateX: number;
  issuedDateY: number;
  expiryDateX: number;
  expiryDateY: number;
};

const STORAGE_KEY = 'the_good_health_vouchers';
const AUDIT_KEY = 'the_good_health_audit';
const RUPEE = '\u20b9';

// Manual text-position controls for each voucher template.
// If you want to fine-tune alignment, update only the numbers in `voucher1k`.
const VOUCHER_LAYOUTS: Record<TemplateKey, VoucherLayout> = {
  default: {
    referenceWidth: 1200,
    referenceHeight: 400,
    amountStyle: {
      fontSize: 32,
      fontWeight: '800',
      fontFamily: 'Inter, sans-serif',
      color: 'rgba(254, 253, 225, 1)',
    },
    voucherIdStyle: {
      fontSize: 30,
      fontWeight: 'bold',
      fontFamily: 'Inter, sans-serif',
      color: '#003321',
    },
    dateStyle: {
      fontSize: 22,
      fontWeight: 'bold',
      fontFamily: 'Inter, sans-serif',
      color: '#003321',
    },
    amountX: 720,
    amountY: 180,
    voucherIdX: 665,
    voucherIdY: 258,
    issuedDateX: 680,
    issuedDateY: 302,
    expiryDateX: 680,
    expiryDateY: 335,
  },
  voucher1k: {
    referenceWidth: 5500,
    referenceHeight: 3900,
    amountStyle: {
      fontSize: 200,
      fontWeight: '1000',
      fontFamily: 'Inter, sans-serif',
      color: 'rgb(255, 255, 255)',
    },
    voucherIdStyle: {
      fontSize: 180,
      fontWeight: 'bold',
      fontFamily: 'Inter, sans-serif',
      color: '#003321',
    },
    dateStyle: {
      fontSize: 125,
      fontWeight: 'bold',
      fontFamily: 'Inter, sans-serif',
      color: '#003321',
    },
    amountX: 2500,
    amountY: 2150,
    voucherIdX: 2485,
    voucherIdY: 2895,
    issuedDateX: 2160,
    issuedDateY: 3210,
    expiryDateX: 4345,
    expiryDateY: 3210,
  },
};

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

const getAmountValue = (amount?: string) => Number.parseFloat(amount ?? '') || 0;

const getTemplateKey = (amount?: string): TemplateKey => {
  const value = getAmountValue(amount);
  return value >= 1000 && value <= 9999 ? 'voucher1k' : 'default';
};

const getVoucherLayout = (templateKey: TemplateKey, image: HTMLImageElement): VoucherLayout => {
  const layout = VOUCHER_LAYOUTS[templateKey];
  const scaleX = image.width / layout.referenceWidth;
  const scaleY = image.height / layout.referenceHeight;
  return {
    ...layout,
    amountStyle: {
      ...layout.amountStyle,
      fontSize: layout.amountStyle.fontSize * scaleX,
    },
    voucherIdStyle: {
      ...layout.voucherIdStyle,
      fontSize: layout.voucherIdStyle.fontSize * scaleX,
    },
    dateStyle: {
      ...layout.dateStyle,
      fontSize: layout.dateStyle.fontSize * scaleX,
    },
    amountX: layout.amountX * scaleX,
    amountY: layout.amountY * scaleY,
    voucherIdX: layout.voucherIdX * scaleX,
    voucherIdY: layout.voucherIdY * scaleY,
    issuedDateX: layout.issuedDateX * scaleX,
    issuedDateY: layout.issuedDateY * scaleY,
    expiryDateX: layout.expiryDateX * scaleX,
    expiryDateY: layout.expiryDateY * scaleY,
  };
};

const drawVoucher = (
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  data: Partial<Voucher | Draft>,
  templateKey: TemplateKey,
  options?: { includeVoucherId?: boolean },
) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const layout = getVoucherLayout(templateKey, image);
  const includeVoucherId = options?.includeVoucherId ?? true;
  canvas.width = image.width;
  canvas.height = image.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  if (includeVoucherId && data.voucherId) {
    ctx.font = `${layout.voucherIdStyle.fontWeight} ${layout.voucherIdStyle.fontSize}px ${layout.voucherIdStyle.fontFamily}`;
    ctx.fillStyle = layout.voucherIdStyle.color;
    ctx.fillText(data.voucherId, layout.voucherIdX, layout.voucherIdY);
  }
  if (data.amount) {
    ctx.font = `${layout.amountStyle.fontWeight} ${layout.amountStyle.fontSize}px ${layout.amountStyle.fontFamily}`;
    ctx.fillStyle = layout.amountStyle.color;
    ctx.textAlign = 'center';
    ctx.fillText(data.amount, layout.amountX, layout.amountY);
    ctx.textAlign = 'left';
  }
  ctx.font = `${layout.dateStyle.fontWeight} ${layout.dateStyle.fontSize}px ${layout.dateStyle.fontFamily}`;
  ctx.fillStyle = layout.dateStyle.color;
  if (data.issuedDate) ctx.fillText(data.issuedDate, layout.issuedDateX, layout.issuedDateY);
  if (data.expiryDate) ctx.fillText(data.expiryDate, layout.expiryDateX, layout.expiryDateY);
};

const triggerDownload = (url: string, fileName: string) => {
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => link.remove(), 0);
};

const downloadTextFile = (fileName: string, text: string) => {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, fileName);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const buildVoucherPdf = (
  canvas: HTMLCanvasElement,
  voucherData?: Partial<Voucher | Draft>,
  layout?: VoucherLayout,
) => {
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'px',
    format: [canvas.width, canvas.height],
  });
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
  if (voucherData?.voucherId && layout) {
    pdf.setTextColor(0, 51, 33);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(layout.voucherIdStyle.fontSize);
    pdf.text(voucherData.voucherId, layout.voucherIdX, layout.voucherIdY, {
      baseline: 'middle',
    });
  }
  return pdf;
};

const badgeClass = (status: Status | AuditStatus) =>
  status === 'Active' || status === 'Success'
    ? 'status-badge status-badge-active'
    : 'status-badge status-badge-redeemed';

const buttonClass =
  'rounded-xl border border-[#003321]/10 bg-white px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-[#003321] transition hover:bg-[#FDFBF7]';
const primaryButtonClass =
  'rounded-xl border border-[#D30000] bg-[#D30000] px-4 py-3 text-[11px] font-black uppercase tracking-widest text-white shadow-[0_16px_40px_rgba(211,0,0,0.22)] transition hover:border-[#b10000] hover:bg-[#b10000] disabled:cursor-not-allowed disabled:opacity-50';

const createDefaultDraft = (): Draft => ({
  orderId: '',
  voucherId: '',
  amount: '',
  issuedDate: today(),
  expiryDate: inThirtyDays(),
});

export default function App() {
  const [view, setView] = useState<View>('dashboard');
  const [query, setQuery] = useState('');
  const [previewZoom, setPreviewZoom] = useState(135);
  const [vouchers, setVouchers] = useState<Voucher[]>(() => readJson(STORAGE_KEY, []));
  const [logs, setLogs] = useState<AuditLog[]>(() => readJson(AUDIT_KEY, []));
  const [templates, setTemplates] = useState<TemplateMap | null>(null);
  const [templateError, setTemplateError] = useState('');
  const [amountError, setAmountError] = useState('');
  const [lastGenerated, setLastGenerated] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [bulkFormat, setBulkFormat] = useState<BulkFormat>('png');
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => void } | null>(null);
  const [bulk, setBulk] = useState({ visible: false, processed: 0, total: 0, percent: 0, status: 'Preparing...' });
  const [draft, setDraft] = useState<Draft>(createDefaultDraft);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const activePreviewTemplateKey = getTemplateKey(draft.amount);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(vouchers));
  }, [vouchers]);

  useEffect(() => {
    window.localStorage.setItem(AUDIT_KEY, JSON.stringify(logs));
  }, [logs]);

  useEffect(() => {
    let active = true;
    Promise.all([loadTemplate(templateUrl), loadTemplate(template1kUrl)])
      .then(([defaultTemplate, voucher1kTemplate]) => {
        if (active) {
          setTemplates({
            default: defaultTemplate,
            voucher1k: voucher1kTemplate,
          });
        }
      })
      .catch((error: Error) => {
        if (active) setTemplateError(error.message);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!templates || !canvasRef.current) return;
    drawVoucher(canvasRef.current, templates[activePreviewTemplateKey], draft, activePreviewTemplateKey);
  }, [draft, templates]);

  useEffect(() => {
    const viewport = previewViewportRef.current;
    if (!viewport || view !== 'generate') return;

    const frame = window.requestAnimationFrame(() => {
      const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      if (!maxScrollLeft) return;
      viewport.scrollTo({
        left: Math.min(maxScrollLeft, maxScrollLeft * 0.55),
        behavior: 'auto',
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activePreviewTemplateKey, templates, view]);

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

  const getTemplateForAmount = (amount?: string) => (templates ? templates[getTemplateKey(amount)] : null);
  const previewCanvasWidth = useMemo(() => {
    const baseWidth = activePreviewTemplateKey === 'voucher1k' ? 1050 : 1200;
    return Math.round((baseWidth * previewZoom) / 100);
  }, [activePreviewTemplateKey, previewZoom]);

  const makeCanvas = (data: Partial<Voucher | Draft>, options?: { includeVoucherId?: boolean }) => {
    const templateKey = getTemplateKey(data.amount);
    const template = getTemplateForAmount(data.amount);
    if (!template) return null;
    const canvas = document.createElement('canvas');
    drawVoucher(canvas, template, data, templateKey, options);
    return canvas;
  };

  const copyVoucherIds = async (voucherIds: string[]) => {
    if (!voucherIds.length || !navigator.clipboard?.writeText) return false;
    try {
      await navigator.clipboard.writeText(voucherIds.join('\n'));
      setCopyStatus(voucherIds.length === 1 ? `Voucher ID copied: ${voucherIds[0]}` : `${voucherIds.length} voucher IDs copied`);
      window.setTimeout(() => setCopyStatus(''), 2500);
      return true;
    } catch {
      setCopyStatus('Voucher ID copy was blocked by the browser');
      window.setTimeout(() => setCopyStatus(''), 3000);
      return false;
    }
  };

  const downloadCanvas = async (
    canvas: HTMLCanvasElement,
    fileName: string,
    format: 'png' | 'pdf',
    voucherIds: string[] = [],
    voucherData?: Partial<Voucher | Draft>,
  ) => {
    if (format === 'png') {
      await copyVoucherIds(voucherIds);
      triggerDownload(canvas.toDataURL('image/png'), fileName);
      return;
    }
    await copyVoucherIds(voucherIds);
    const template = voucherData ? getTemplateForAmount(voucherData.amount) : null;
    const templateKey = voucherData ? getTemplateKey(voucherData.amount) : null;
    const layout = template && templateKey ? getVoucherLayout(templateKey, template) : undefined;
    const pdf = buildVoucherPdf(canvas, voucherData, layout);
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

  const resetDraft = () => {
    setDraft(createDefaultDraft());
    setAmountError('');
  };

  const downloadVoucher = async (voucher: Voucher, format: 'png' | 'pdf') => {
    const canvas = makeCanvas(voucher, { includeVoucherId: format !== 'pdf' });
    if (!canvas) return;
    await downloadCanvas(canvas, `${voucher.orderId}.${format}`, format, [voucher.voucherId], voucher);
    addLog(`Download ${format.toUpperCase()}`, voucher.voucherId);
  };

  const downloadCurrent = async (format: 'png' | 'pdf') => {
    const voucher = vouchers.find((item) => item.id === lastGenerated);
    if (voucher) await downloadVoucher(voucher, format);
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

  const bulkUpload = async (file: File, format: BulkFormat) => {
    if (!templates) return;
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
      const templateKey = getTemplateKey(voucher.amount);
      const template = getTemplateForAmount(voucher.amount);
      if (!template) continue;
      const canvas = document.createElement('canvas');
      drawVoucher(canvas, template, voucher, templateKey, { includeVoucherId: format !== 'pdf' });
      if (format === 'png') {
        zip.file(`${voucher.orderId}.png`, canvas.toDataURL('image/png').split(',')[1], { base64: true });
        zip.file(`${voucher.orderId}-voucher-id.txt`, `Voucher ID: ${voucher.voucherId}`);
      } else {
        const layout = getVoucherLayout(templateKey, template);
        const pdf = buildVoucherPdf(canvas, voucher, layout);
        zip.file(`${voucher.orderId}.pdf`, pdf.output('arraybuffer'));
      }
      const processed = i + 1;
      setBulk({
        visible: true,
        processed,
        total: rows.length,
        percent: rows.length ? Math.round((processed / rows.length) * 100) : 0,
        status: `Generating ${format.toUpperCase()} vouchers...`,
      });
      if (i % 10 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    setVouchers((current) => [...current, ...generated]);
    addLog(`Bulk Generate ${format.toUpperCase()}`, `${generated.length} Vouchers`);
    setBulk((current) => ({ ...current, status: 'Packaging ZIP...' }));
    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = url;
    link.download = `vouchers_batch_${format}_${Date.now()}.zip`;
    link.click();
    URL.revokeObjectURL(url);
    await copyVoucherIds(generated.map((voucher) => voucher.voucherId));
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
                className={`shrink-0 rounded-full border px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition ${view === key
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
            <div className="mx-auto grid max-w-[1800px] grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(380px,0.85fr)] xl:items-start">
              <div className="order-1 space-y-5 xl:sticky xl:top-6">
                <div className="slider-surface rounded-[28px] border border-[#003321]/10 bg-white p-5 shadow-xl md:p-6 xl:min-h-[calc(100vh-10rem)]">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h2 className="text-3xl font-black tracking-tight">Live Preview</h2>
                    </div>
                    <div className="min-w-[220px] flex-1 md:max-w-xs">
                      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-[#003321]/50">
                        <span>Zoom</span>
                        <span>{previewZoom}%</span>
                      </div>
                      <input
                        className="preview-slider mt-3 w-full"
                        max="220"
                        min="100"
                        onChange={(event) => setPreviewZoom(Number(event.target.value))}
                        type="range"
                        value={previewZoom}
                      />
                    </div>
                  </div>
                  <div
                    ref={previewViewportRef}
                    className="relative mt-6 aspect-[12/4] min-h-[300px] w-full overflow-x-auto overflow-y-auto rounded-[24px] border border-[#003321]/10 bg-[linear-gradient(135deg,rgba(211,0,0,0.05),rgba(0,51,33,0.04))] p-4 md:min-h-[420px] lg:min-h-[520px] xl:min-h-[640px]"
                  >
                    <div className="flex min-h-full min-w-max items-center justify-center">
                      <canvas
                        ref={canvasRef}
                        className="mx-auto block h-auto max-w-none rounded-2xl shadow-2xl"
                        style={{ width: `${previewCanvasWidth}px`, minWidth: `${previewCanvasWidth}px`, maxWidth: 'none' }}
                      />
                    </div>
                    {!templates ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/80 text-[10px] font-bold uppercase tracking-widest text-[#003321]/40">
                        Loading Template...
                      </div>
                    ) : null}
                  </div>
                  {templateError ? <p className="mt-4 text-sm text-[#D30000]">{templateError}</p> : null}
                  {copyStatus ? <p className="mt-4 text-[11px] font-bold uppercase tracking-widest text-[#003321]/60">{copyStatus}</p> : null}
                  <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <button className={primaryButtonClass} disabled={!lastGenerated} onClick={() => downloadCurrent('png')} type="button">Download PNG</button>
                    <button className={primaryButtonClass} disabled={!lastGenerated} onClick={() => downloadCurrent('pdf')} type="button">Download PDF</button>
                  </div>
                </div>
              </div>
              <form className="order-2 space-y-6 rounded-3xl border border-[#003321]/10 bg-white p-8 shadow-sm" onSubmit={generateVoucher}>
                <div>
                  <h2 className="text-3xl font-black tracking-tight">Single Generation</h2>
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
                  <button className={buttonClass} onClick={resetDraft} type="button">Reset</button>
                </div>
              </form>
            </div>
          ) : null}
          {view === 'bulk' ? (
            <div className="mx-auto max-w-4xl space-y-10">
              <div>
                <h2 className="text-3xl font-black tracking-tight">Bulk Operations</h2>
                <p className="mt-2 text-sm text-[#003321]/60">Upload a CSV file, choose PNG or PDF, and download a ZIP while copying the voucher IDs automatically.</p>
              </div>
              <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                <div className="space-y-6 lg:col-span-2">
                  <div className="rounded-3xl border border-[#003321]/10 bg-white p-4 shadow-sm">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#003321]/40">Bulk Download Format</p>
                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <button
                        className={`rounded-xl border px-4 py-3 text-xs font-bold uppercase tracking-widest transition ${bulkFormat === 'png'
                            ? 'border-[#003321] bg-[#003321] text-white'
                            : 'border-[#003321]/10 bg-white text-[#003321] hover:bg-[#FDFBF7]'
                          }`}
                        onClick={() => setBulkFormat('png')}
                        type="button"
                      >
                        ZIP as PNG
                      </button>
                      <button
                        className={`rounded-xl border px-4 py-3 text-xs font-bold uppercase tracking-widest transition ${bulkFormat === 'pdf'
                            ? 'border-[#003321] bg-[#003321] text-white'
                            : 'border-[#003321]/10 bg-white text-[#003321] hover:bg-[#FDFBF7]'
                          }`}
                        onClick={() => setBulkFormat('pdf')}
                        type="button"
                      >
                        ZIP as PDF
                      </button>
                    </div>
                  </div>
                  <label className="slider-surface flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed border-[#003321]/10 bg-white p-10 text-center hover:border-[#D30000]/40 hover:bg-[#FDFBF7]/50 md:p-16">
                    <span className="rounded-full bg-[#FDFBF7] px-6 py-4 text-xs font-bold uppercase tracking-widest text-[#003321]/40">Upload CSV</span>
                    <span className="mt-8 text-sm font-bold uppercase tracking-widest">Choose CSV File</span>
                    <span className="mt-2 text-xs uppercase tracking-widest text-[#003321]/40">Voucher ID, Amount, Order ID, then download as {bulkFormat.toUpperCase()}</span>
                    <input accept=".csv" className="sr-only" onChange={(event) => event.target.files?.[0] && void bulkUpload(event.target.files[0], bulkFormat)} type="file" />
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
                    <li>3. Choose PNG or PDF before uploading the CSV.</li>
                    <li>4. The generated voucher IDs are copied after export.</li>
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
