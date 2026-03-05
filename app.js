/* ============================================================
   app.js – Dashboard EVNHANOI / Quản lý ThietBi
   Supabase + filters + pagination + charts + CSV export
   ============================================================ */

// ── 1. SUPABASE CONFIG ───────────────────────────────────────
const SUPABASE_URL = 'https://xqqmfmljwycpehfyknoy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhxcW1mbWxqd3ljcGVoZnlrbm95Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyODM4MDQsImV4cCI6MjA4Nzg1OTgwNH0.J_z0cFqq_Yet-n2X2L_VREdkcAqbkRFpYUp-ti3Fukc';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const TABLE_NAME = 'ThietBi';

// ── 2. CONSTANTS ─────────────────────────────────────────────
const CAP_MAP = { 0: '0.4kV', 1: '110kV', 2: '220kV', 3: '35kV', 4: '22kV', 6: '6kV', 9: '9kV' };
const PAGE_SIZE = 50;

const PALETTE = [
  '#3b82f6','#10b981','#f59e0b','#8b5cf6',
  '#06b6d4','#ef4444','#ec4899','#14b8a6',
  '#f97316','#84cc16','#a78bfa','#fb923c'
];

// ── 3. STATE ─────────────────────────────────────────────────
let allData = [];
let filteredData = [];
let currentPage = 1;
let sortCol = -1;
let sortAsc = true;
let barMode = 'cap';     // 'cap' | 'phanloai'
let deviceChart = null;
let typeChart   = null;
let tnChart     = null;

// ── 4. FETCH ALL DATA ────────────────────────────────────────
async function fetchData() {
  // Supabase free tier limits to 1000 rows per request – paginate
  let allRows = [];
  let from = 0;
  const batchSize = 1000;

  while (true) {
    const { data, error } = await supabaseClient
      .from(TABLE_NAME)
      .select('*')
      .range(from, from + batchSize - 1);

    if (error) { console.error('[Supabase Error]', error); return null; }
    if (!data || data.length === 0) break;
    allRows = allRows.concat(data);
    if (data.length < batchSize) break;
    from += batchSize;
  }
  return allRows;
}

// ── 5. POPULATE FILTER DROPDOWNS ────────────────────────────
function populateFilters(data) {
  const doi      = [...new Set(data.map(d => d.doi).filter(Boolean))].sort();
  const caps     = [...new Set(data.map(d => d.cap_dien_ap).filter(v => v !== null))].sort((a,b)=>a-b);
  const phanLoai = [...new Set(data.map(d => d.phan_loai).filter(Boolean))].sort();
  const trams    = [...new Set(data.map(d => d.tram).filter(Boolean))].sort();
  const namKH    = [...new Set(data.map(d => d.nam_ke_hoach).filter(Boolean))].sort((a,b)=>b-a);

  fillSelect('filterDoi',     doi,      v => v);
  fillSelect('filterCap',     caps,     v => `${CAP_MAP[v] || v} (cấp ${v})`);
  fillSelect('filterPhanLoai',phanLoai, v => v);
  fillSelect('filterTram',    trams,    v => v);
  fillSelect('filterNamKH',   namKH,    v => `Năm ${v}`);
}

function fillSelect(id, values, labelFn) {
  const sel = document.getElementById(id);
  const cur = sel.value;
  // keep first "Tất cả" option
  while (sel.options.length > 1) sel.remove(1);
  values.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = labelFn(v);
    sel.appendChild(opt);
  });
  sel.value = cur;
}

// ── 6. APPLY FILTERS ────────────────────────────────────────
function applyFilters() {
  const doi      = document.getElementById('filterDoi').value;
  const cap      = document.getElementById('filterCap').value;
  const phanLoai = document.getElementById('filterPhanLoai').value;
  const tram     = document.getElementById('filterTram').value;
  const namKH    = document.getElementById('filterNamKH').value;
  const q        = document.getElementById('searchInput').value.trim().toLowerCase();

  filteredData = allData.filter(d => {
    if (doi      && d.doi          !== doi)                     return false;
    if (cap      && String(d.cap_dien_ap) !== String(cap))      return false;
    if (phanLoai && d.phan_loai    !== phanLoai)                return false;
    if (tram     && d.tram         !== tram)                    return false;
    if (namKH    && String(d.nam_ke_hoach) !== String(namKH))   return false;
    if (q) {
      const haystack = [d.tram, d.ten_thiet_bi, d.ngan_thiet_bi,
                        d.phan_loai, d.doi, d.hang_sx]
        .map(v => (v || '').toLowerCase()).join(' ');
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  currentPage = 1;
  renderStats(filteredData);
  renderTypeChips(filteredData);
  renderBarChart(filteredData);
  renderPieChart(filteredData);
  renderTNTimeline(filteredData);
  renderTable(filteredData);
  renderPagination();
  renderActiveFilters({ doi, cap, phanLoai, tram, namKH, q });
}

function resetFilters() {
  ['filterDoi','filterCap','filterPhanLoai','filterTram','filterNamKH'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('searchInput').value = '';
  applyFilters();
}

function renderActiveFilters({ doi, cap, phanLoai, tram, namKH, q }) {
  const row   = document.getElementById('activeFilterRow');
  const chips = document.getElementById('activeFilterChips');
  const filters = [];
  if (doi)      filters.push({ label: `Đội: ${doi}`, key: 'filterDoi' });
  if (cap)      filters.push({ label: `Cấp: ${CAP_MAP[cap] || cap}`, key: 'filterCap' });
  if (phanLoai) filters.push({ label: `Loại: ${phanLoai}`, key: 'filterPhanLoai' });
  if (tram)     filters.push({ label: `Trạm: ${tram}`, key: 'filterTram' });
  if (namKH)    filters.push({ label: `Năm KH: ${namKH}`, key: 'filterNamKH' });
  if (q)        filters.push({ label: `"${q}"`, key: 'searchInput' });

  if (!filters.length) { row.style.display = 'none'; return; }
  row.style.display = 'flex';
  chips.innerHTML = '';
  filters.forEach(f => {
    const chip = document.createElement('div');
    chip.className = 'active-chip';
    chip.innerHTML = `${f.label} <i class="fas fa-times"></i>`;
    chip.onclick = () => {
      const el = document.getElementById(f.key);
      if (el.tagName === 'SELECT') el.value = '';
      else el.value = '';
      applyFilters();
    };
    chips.appendChild(chip);
  });
}

// ── 7. RENDER STATS ──────────────────────────────────────────
function renderStats(data) {
  const stations = new Set(data.map(d => d.tram).filter(Boolean));
  const total    = data.reduce((s, d) => s + (Number(d.so_luong) || 0), 0);
  const ngan     = new Set(data.map(d => d.ngan_thiet_bi).filter(Boolean));
  const types    = new Set(data.map(d => d.phan_loai).filter(Boolean));

  const today    = new Date();
  const in3mo    = new Date(today); in3mo.setMonth(in3mo.getMonth() + 3);
  let overdue = 0, upcoming = 0;
  data.forEach(d => {
    if (!d.thoi_gian_tn_tiep_theo) return;
    const dt = new Date(d.thoi_gian_tn_tiep_theo);
    if (dt < today) overdue++;
    else if (dt <= in3mo) upcoming++;
  });

  setText('totalStations', stations.size);
  setText('totalDevices',  total.toLocaleString('vi-VN'));
  setText('totalNgan',     ngan.size);
  setText('totalTypes',    types.size);
  setText('totalOverdue',  overdue.toLocaleString('vi-VN'));
  setText('totalUpcoming', upcoming.toLocaleString('vi-VN'));
}

// ── 8. RENDER TYPE CHIPS ─────────────────────────────────────
function renderTypeChips(data) {
  const typeCounts = {};
  data.forEach(d => {
    if (d.phan_loai) typeCounts[d.phan_loai] = (typeCounts[d.phan_loai] || 0) + (Number(d.so_luong) || 0);
  });
  const container = document.getElementById('deviceByType');
  container.innerHTML = '';
  const total = Object.values(typeCounts).reduce((a,b)=>a+b,0);
  document.getElementById('typeChipsCount').textContent = `${total.toLocaleString('vi-VN')} thiết bị`;

  const currentPhanLoai = document.getElementById('filterPhanLoai').value;
  Object.entries(typeCounts).sort((a,b)=>b[1]-a[1]).forEach(([type, count]) => {
    const chip = document.createElement('div');
    chip.className = 'type-chip' + (currentPhanLoai === type ? ' active-filter' : '');
    chip.innerHTML = `<span class="chip-label">${type}</span><span class="chip-count">${count.toLocaleString('vi-VN')}</span>`;
    chip.onclick = () => {
      const sel = document.getElementById('filterPhanLoai');
      sel.value = sel.value === type ? '' : type;
      applyFilters();
    };
    container.appendChild(chip);
  });
}

// ── 9. BAR CHART ─────────────────────────────────────────────
function switchBarMode(mode) {
  barMode = mode;
  document.getElementById('btn-cap').classList.toggle('active', mode === 'cap');
  document.getElementById('btn-phanloai').classList.toggle('active', mode === 'phanloai');
  renderBarChart(filteredData);
}

function renderBarChart(data) {
  const stations = [...new Set(data.map(d => d.tram).filter(Boolean))].sort();
  const groupKey = barMode === 'cap' ? 'cap_dien_ap' : 'phan_loai';
  const groups   = [...new Set(data.map(d => d[groupKey]).filter(v => v !== null))].sort();

  const datasets = groups.map((grp, idx) => ({
    label: barMode === 'cap' ? (CAP_MAP[grp] || `Cấp ${grp}`) : grp,
    data: stations.map(st => {
      const rows = data.filter(d => d.tram === st && d[groupKey] === grp);
      return rows.reduce((s,d) => s + (Number(d.so_luong)||0), 0);
    }),
    backgroundColor: PALETTE[idx % PALETTE.length] + 'bb',
    borderColor:     PALETTE[idx % PALETTE.length],
    borderWidth: 1,
    borderRadius: 3,
  }));

  const ctx = document.getElementById('deviceChart').getContext('2d');
  if (deviceChart) deviceChart.destroy();
  deviceChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: stations, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#8fa3bd', font: { size: 10 }, boxWidth: 10, padding: 10 } },
        tooltip: chartTooltipOpts()
      },
      scales: {
        x: { stacked: true, ticks: { color: '#4d6480', font: { size: 9 }, maxRotation: 45 }, grid: { color: '#1a2332' } },
        y: { stacked: true, beginAtZero: true, ticks: { color: '#4d6480', font: { size: 9 } }, grid: { color: '#1a2332' } }
      }
    }
  });
}

// ── 10. PIE CHART ────────────────────────────────────────────
function renderPieChart(data) {
  const counts = {};
  data.forEach(d => {
    if (d.phan_loai) counts[d.phan_loai] = (counts[d.phan_loai] || 0) + (Number(d.so_luong)||0);
  });
  const labels = Object.keys(counts).sort((a,b)=>counts[b]-counts[a]);
  const values = labels.map(l => counts[l]);

  const ctx = document.getElementById('typeChart').getContext('2d');
  if (typeChart) typeChart.destroy();
  typeChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: PALETTE.slice(0, labels.length).map(c => c+'bb'),
        borderColor:     PALETTE.slice(0, labels.length),
        borderWidth: 2, hoverOffset: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: {
        legend: { position: 'bottom', labels: { color: '#8fa3bd', font: { size: 10 }, boxWidth: 8, padding: 8 } },
        tooltip: {
          ...chartTooltipOpts(),
          callbacks: {
            label: ctx => {
              const t = ctx.dataset.data.reduce((a,b)=>a+b,0);
              return ` ${ctx.label}: ${ctx.parsed.toLocaleString('vi-VN')} (${((ctx.parsed/t)*100).toFixed(1)}%)`;
            }
          }
        }
      }
    }
  });
}

// ── 11. TN TIMELINE CHART ────────────────────────────────────
function renderTNTimeline(data) {
  // Count devices by TN tiep theo month for next 24 months
  const today  = new Date();
  const months = [];
  const counts = {};
  for (let i = 0; i < 24; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    months.push(key);
    counts[key] = 0;
  }
  data.forEach(d => {
    if (!d.thoi_gian_tn_tiep_theo) return;
    const dt  = new Date(d.thoi_gian_tn_tiep_theo);
    const key = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
    if (counts[key] !== undefined) counts[key]++;
  });

  const ctx = document.getElementById('tnTimelineChart').getContext('2d');
  if (tnChart) tnChart.destroy();
  tnChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months.map(m => {
        const [y,mo] = m.split('-');
        return `T${mo}/${y.slice(2)}`;
      }),
      datasets: [{
        label: 'Số ngăn TN',
        data: months.map(m => counts[m]),
        backgroundColor: months.map(m => {
          const [y,mo] = m.split('-');
          const dt = new Date(Number(y), Number(mo)-1, 1);
          return dt < today ? 'rgba(239,68,68,0.6)' : 'rgba(59,130,246,0.6)';
        }),
        borderRadius: 3
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: chartTooltipOpts() },
      scales: {
        x: { ticks: { color: '#4d6480', font: { size: 9 } }, grid: { color: '#1a2332' } },
        y: { beginAtZero: true, ticks: { color: '#4d6480', font: { size: 9 } }, grid: { color: '#1a2332' } }
      }
    }
  });
}

// ── 12. TABLE ────────────────────────────────────────────────
function renderTable(data) {
  const tbody = document.getElementById('dashboard-tbody');
  const start = (currentPage - 1) * PAGE_SIZE;
  const page  = data.slice(start, start + PAGE_SIZE);
  const count = document.getElementById('tableCount');
  count.textContent = `${data.length.toLocaleString('vi-VN')} bản ghi`;

  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="no-data">Không có dữ liệu phù hợp</td></tr>';
    return;
  }

  const today = new Date();
  const in3mo = new Date(today); in3mo.setMonth(in3mo.getMonth() + 3);

  tbody.innerHTML = '';
  page.forEach(d => {
    const capLabel   = d.cap_dien_ap !== null ? (CAP_MAP[d.cap_dien_ap] || `Cấp ${d.cap_dien_ap}`) : '—';
    const tnGanNhat  = fmtDate(d.thoi_gian_tn_gan_nhat);
    const tnTiepTheo = fmtDate(d.thoi_gian_tn_tiep_theo);
    const lichDat    = fmtDate(d.lich_dat);
    const status     = getStatusBadge(d.thoi_gian_tn_tiep_theo, today, in3mo);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="station-name">${esc(d.tram)}</span></td>
      <td style="font-size:11px;color:var(--text-muted)">${esc(d.ngan_thiet_bi)}</td>
      <td>${esc(d.ten_thiet_bi)}</td>
      <td><span class="phan-loai-badge">${esc(d.phan_loai)}</span></td>
      <td><span class="cap-tag">${capLabel}</span></td>
      <td><span class="num-cell">${d.so_luong ?? '—'}</span> <small style="color:var(--text-muted)">${esc(d.don_vi)}</small></td>
      <td style="font-family:var(--font-mono);font-size:11px">${d.han_tn ? d.han_tn+' năm' : '—'}</td>
      <td><span class="date-cell">${tnGanNhat}</span></td>
      <td><span class="date-cell">${tnTiepTheo}</span></td>
      <td><span class="date-cell">${lichDat}</span></td>
      <td><span class="doi-badge">${esc(d.doi)}</span></td>
      <td>${status}</td>
    `;
    tbody.appendChild(tr);
  });
}

function getStatusBadge(dateStr, today, in3mo) {
  if (!dateStr) return `<span class="status-badge status-no-date">—</span>`;
  const dt = new Date(dateStr);
  if (dt < today)  return `<span class="status-badge status-overdue"><i class="fas fa-exclamation-circle"></i>Quá hạn</span>`;
  if (dt <= in3mo) return `<span class="status-badge status-upcoming"><i class="fas fa-clock"></i>Sắp đến</span>`;
  return `<span class="status-badge status-ok"><i class="fas fa-check-circle"></i>Bình thường</span>`;
}

// ── 13. SORT TABLE ───────────────────────────────────────────
function sortTable(col) {
  const keys = ['tram','ngan_thiet_bi','ten_thiet_bi','phan_loai',
                 'cap_dien_ap','so_luong','han_tn',
                 'thoi_gian_tn_gan_nhat','thoi_gian_tn_tiep_theo',
                 'lich_dat','doi'];
  if (col >= keys.length) return;
  if (sortCol === col) sortAsc = !sortAsc;
  else { sortCol = col; sortAsc = true; }
  const key = keys[col];
  filteredData.sort((a,b) => {
    const av = a[key] ?? '';
    const bv = b[key] ?? '';
    if (av < bv) return sortAsc ? -1 : 1;
    if (av > bv) return sortAsc ? 1 : -1;
    return 0;
  });
  currentPage = 1;
  renderTable(filteredData);
  renderPagination();
}

// ── 14. PAGINATION ───────────────────────────────────────────
function renderPagination() {
  const total = Math.ceil(filteredData.length / PAGE_SIZE);
  const pag   = document.getElementById('pagination');
  pag.innerHTML = '';
  if (total <= 1) return;

  const add = (label, page, disabled=false) => {
    const btn = document.createElement('button');
    btn.className = 'page-btn' + (page === currentPage ? ' active' : '');
    btn.textContent = label;
    btn.disabled = disabled;
    btn.onclick = () => { currentPage = page; renderTable(filteredData); renderPagination(); };
    pag.appendChild(btn);
  };

  add('«', 1, currentPage === 1);
  add('‹', currentPage - 1, currentPage === 1);

  let start = Math.max(1, currentPage - 2);
  let end   = Math.min(total, start + 4);
  if (end - start < 4) start = Math.max(1, end - 4);
  for (let i = start; i <= end; i++) add(i, i);

  add('›', currentPage + 1, currentPage === total);
  add('»', total, currentPage === total);
}

// ── 15. CSV EXPORT ───────────────────────────────────────────
function exportCSV() {
  const cols = ['tram','ngan_thiet_bi','ten_thiet_bi','phan_loai','cap_dien_ap',
                'so_luong','don_vi','han_tn','thoi_gian_tn_truoc','thoi_gian_tn_gan_nhat',
                'thoi_gian_tn_tiep_theo','lich_dat','doi','nam_ke_hoach','ghi_chu'];
  const hdrs = ['Trạm','Ngăn TB','Tên thiết bị','Phân loại','Cấp ĐA',
                'Số lượng','Đơn vị','Hạn TN','TN trước','TN gần nhất',
                'TN tiếp theo','Lịch đặt','Đội','Năm KH','Ghi chú'];

  const rows = [hdrs.join(',')];
  filteredData.forEach(d => {
    rows.push(cols.map(c => {
      let v = d[c] ?? '';
      if (c === 'cap_dien_ap' && v !== '') v = CAP_MAP[v] || v;
      return `"${String(v).replace(/"/g,'""')}"`;
    }).join(','));
  });

  const blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `thietbi_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── 16. UI HELPERS ───────────────────────────────────────────
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function esc(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function fmtDate(v) {
  if (!v) return '<span style="color:var(--text-muted)">—</span>';
  return v.slice(0, 10);
}

function chartTooltipOpts() {
  return {
    backgroundColor: '#1a2332',
    borderColor: '#1f2d3d',
    borderWidth: 1,
    titleColor: '#e2e8f0',
    bodyColor: '#8fa3bd',
    padding: 10,
  };
}

function setLoading(visible) {
  document.getElementById('loadingOverlay').classList.toggle('visible', visible);
  document.getElementById('refreshBtn').classList.toggle('loading', visible);
}

function setConnectionStatus(state) {
  const dot  = document.querySelector('.status-dot');
  const text = document.querySelector('.status-text');
  const map  = {
    online:     ['online', 'Đã kết nối'],
    error:      ['error',  'Lỗi kết nối'],
    connecting: ['',       'Đang kết nối...'],
  };
  const [cls, txt] = map[state] || map.connecting;
  dot.className  = 'status-dot' + (cls ? ' ' + cls : '');
  text.textContent = txt;
}

function updateTimestamp() {
  const fmt = new Date().toLocaleTimeString('vi-VN', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  document.getElementById('lastUpdate').textContent = `Cập nhật: ${fmt}`;
}

// ── 17. MAIN LOAD ────────────────────────────────────────────
const DASHBOARD_HTML = `
  <!-- FILTER PANEL -->
  <section class="filter-panel" id="filterPanel">
    <div class="filter-header">
      <span class="filter-title"><i class="fas fa-filter"></i> Bộ lọc</span>
      <button class="filter-reset-btn" onclick="resetFilters()">
        <i class="fas fa-times"></i> Xóa bộ lọc
      </button>
    </div>
    <div class="filter-row">
      <div class="filter-group">
        <label class="filter-label">Đội</label>
        <select id="filterDoi" class="filter-select" onchange="applyFilters()">
          <option value="">Tất cả</option>
        </select>
      </div>
      <div class="filter-group">
        <label class="filter-label">Cấp điện áp</label>
        <select id="filterCap" class="filter-select" onchange="applyFilters()">
          <option value="">Tất cả</option>
        </select>
      </div>
      <div class="filter-group">
        <label class="filter-label">Phân loại thiết bị</label>
        <select id="filterPhanLoai" class="filter-select" onchange="applyFilters()">
          <option value="">Tất cả</option>
        </select>
      </div>
      <div class="filter-group">
        <label class="filter-label">Trạm</label>
        <select id="filterTram" class="filter-select" onchange="applyFilters()">
          <option value="">Tất cả</option>
        </select>
      </div>
      <div class="filter-group">
        <label class="filter-label">Năm kế hoạch</label>
        <select id="filterNamKH" class="filter-select" onchange="applyFilters()">
          <option value="">Tất cả</option>
        </select>
      </div>
      <div class="filter-group filter-group-search">
        <label class="filter-label">Tìm kiếm</label>
        <div class="search-wrap">
          <i class="fas fa-search search-icon"></i>
          <input type="text" id="searchInput" class="search-box" placeholder="Tên thiết bị, trạm, ngăn..." oninput="applyFilters()">
        </div>
      </div>
    </div>
    <div class="filter-active-row" id="activeFilterRow" style="display:none">
      <span class="active-filter-label">Đang lọc:</span>
      <div class="active-filter-chips" id="activeFilterChips"></div>
    </div>
  </section>

  <!-- STAT CARDS -->
  <section class="stats-grid" id="statsGrid">
    <div class="stat-card">
      <div class="stat-icon blue"><i class="fas fa-building"></i></div>
      <div class="stat-info">
        <span class="stat-label">Số lượng trạm</span>
        <span class="stat-value" id="totalStations">—</span>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon green"><i class="fas fa-microchip"></i></div>
      <div class="stat-info">
        <span class="stat-label">Tổng số thiết bị</span>
        <span class="stat-value" id="totalDevices">—</span>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon orange"><i class="fas fa-layer-group"></i></div>
      <div class="stat-info">
        <span class="stat-label">Tổng số ngăn</span>
        <span class="stat-value" id="totalNgan">—</span>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon purple"><i class="fas fa-tags"></i></div>
      <div class="stat-info">
        <span class="stat-label">Số loại thiết bị</span>
        <span class="stat-value" id="totalTypes">—</span>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon red"><i class="fas fa-clock"></i></div>
      <div class="stat-info">
        <span class="stat-label">Quá hạn TN</span>
        <span class="stat-value" id="totalOverdue">—</span>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon cyan"><i class="fas fa-calendar-check"></i></div>
      <div class="stat-info">
        <span class="stat-label">TN trong 3 tháng</span>
        <span class="stat-value" id="totalUpcoming">—</span>
      </div>
    </div>
  </section>

  <!-- TYPE CHIPS -->
  <section class="section-block">
    <div class="section-header">
      <h2><i class="fas fa-tags"></i> Phân loại thiết bị</h2>
      <span class="section-count" id="typeChipsCount"></span>
    </div>
    <div class="type-chips" id="deviceByType"></div>
  </section>

  <!-- CHARTS ROW -->
  <section class="charts-row">
    <div class="chart-block wide">
      <div class="section-header">
        <h2><i class="fas fa-chart-bar"></i> Số lượng thiết bị theo trạm</h2>
        <div class="chart-toggle-btns">
          <button class="chart-toggle active" onclick="switchBarMode('cap')" id="btn-cap">Theo cấp ĐA</button>
          <button class="chart-toggle" onclick="switchBarMode('phanloai')" id="btn-phanloai">Theo phân loại</button>
        </div>
      </div>
      <div class="chart-wrapper"><canvas id="deviceChart"></canvas></div>
    </div>
    <div class="chart-block narrow">
      <div class="section-header">
        <h2><i class="fas fa-chart-pie"></i> Tỷ lệ phân loại</h2>
      </div>
      <div class="chart-wrapper"><canvas id="typeChart"></canvas></div>
    </div>
  </section>

  <!-- TN TIMELINE -->
  <section class="section-block">
    <div class="section-header">
      <h2><i class="fas fa-calendar-alt"></i> Lịch thử nghiệm theo tháng</h2>
      <span class="section-sub">Thời gian TN tiếp theo</span>
    </div>
    <div class="chart-wrapper" style="height:200px">
      <canvas id="tnTimelineChart"></canvas>
    </div>
  </section>

  <!-- DATA TABLE -->
  <section class="section-block">
    <div class="section-header">
      <h2><i class="fas fa-table"></i> Danh sách thiết bị</h2>
      <div style="display:flex;gap:10px;align-items:center">
        <span class="table-count" id="tableCount"></span>
        <button class="export-btn" onclick="exportCSV()">
          <i class="fas fa-download"></i> Xuất CSV
        </button>
      </div>
    </div>
    <div class="table-container">
      <table class="data-table" id="dashboard-table">
        <thead>
          <tr>
            <th onclick="sortTable(0)">Trạm <i class="fas fa-sort"></i></th>
            <th onclick="sortTable(1)">Ngăn TB <i class="fas fa-sort"></i></th>
            <th onclick="sortTable(2)">Tên thiết bị <i class="fas fa-sort"></i></th>
            <th onclick="sortTable(3)">Phân loại <i class="fas fa-sort"></i></th>
            <th onclick="sortTable(4)">Cấp ĐA <i class="fas fa-sort"></i></th>
            <th onclick="sortTable(5)">SL <i class="fas fa-sort"></i></th>
            <th onclick="sortTable(6)">Hạn TN</th>
            <th onclick="sortTable(7)">TN gần nhất <i class="fas fa-sort"></i></th>
            <th onclick="sortTable(8)">TN tiếp theo <i class="fas fa-sort"></i></th>
            <th onclick="sortTable(9)">Lịch đặt <i class="fas fa-sort"></i></th>
            <th onclick="sortTable(10)">Đội <i class="fas fa-sort"></i></th>
            <th>Trạng thái</th>
          </tr>
        </thead>
        <tbody id="dashboard-tbody">
          <tr><td colspan="12" class="no-data">Đang tải...</td></tr>
        </tbody>
      </table>
    </div>
    <div class="pagination" id="pagination"></div>
  </section>
`;

async function loadDashboard() {
  // Khôi phục HTML dashboard nếu bị thay bởi placeholder
  const mainEl = document.getElementById('mainSections');
  if (mainEl && !document.getElementById('filterPanel')) {
    mainEl.innerHTML = DASHBOARD_HTML;
    // Reset chart instances vì canvas mới được tạo
    deviceChart = null;
    typeChart   = null;
    tnChart     = null;
  }

  setLoading(true);
  setConnectionStatus('connecting');
  try {
    const data = await fetchData();
    if (!data) {
      setConnectionStatus('error');
      const tbody = document.getElementById('dashboard-tbody');
      if (tbody) tbody.innerHTML =
        '<tr><td colspan="12" class="no-data">Không thể tải dữ liệu. Kiểm tra kết nối Supabase.</td></tr>';
      return;
    }

    allData = data;
    filteredData = [...allData];

    populateFilters(allData);
    renderStats(allData);
    renderTypeChips(allData);
    renderBarChart(allData);
    renderPieChart(allData);
    renderTNTimeline(allData);
    renderTable(allData);
    renderPagination();
    updateTimestamp();
    setConnectionStatus('online');
  } catch (err) {
    console.error('[loadDashboard Error]', err);
    setConnectionStatus('error');
  } finally {
    setLoading(false);
  }
}

// ── 18. ROUTER / NAV ─────────────────────────────────────────
const PAGES = {
  dashboard: {
    title: 'Quản lý Thiết Bị',
    sub:   'Tổng quan dữ liệu thời gian thực',
    render: () => loadDashboard()
  },
  congtac: {
    title: 'Công tác',
    sub:   'Quản lý lệnh công tác và phiếu công tác',
    render: () => renderPlaceholder('congtac')
  },
  kehoachsx: {
    title: 'Kế hoạch sản xuất',
    sub:   'Kế hoạch sản xuất và vận hành',
    render: () => renderPlaceholder('kehoachsx')
  },
  maycattrungthe: {
    title: 'Máy cắt trung thế',
    sub:   'Danh sách và trạng thái máy cắt trung thế',
    render: () => renderPlaceholder('maycattrungthe')
  },
  suco: {
    title: 'Sự cố',
    sub:   'Quản lý và theo dõi sự cố',
    render: () => renderPlaceholder('suco')
  },
  kehoachtn: {
    title: 'Kế hoạch TN',
    sub:   'Lập và theo dõi kế hoạch thử nghiệm',
    render: () => renderPlaceholder('kehoachtn')
  },
  lichsutn: {
    title: 'Lịch sử TN',
    sub:   'Tra cứu lịch sử thử nghiệm thiết bị',
    render: () => renderPlaceholder('lichsutn')
  }
};

// Nội dung placeholder cho các trang chưa xây dựng
function renderPlaceholder(pageId) {
  const page    = PAGES[pageId];
  const mainEl  = document.getElementById('mainSections');
  if (!mainEl) return;

  const icons = {
    congtac:        { icon: 'fa-tools',            color: '#3b82f6', desc: 'Tạo và quản lý lệnh công tác, phân công nhân viên, theo dõi tiến độ thực hiện.' },
    kehoachsx:      { icon: 'fa-calendar-alt',     color: '#10b981', desc: 'Lập kế hoạch sản xuất theo tháng/quý/năm, theo dõi tiến độ vận hành.' },
    maycattrungthe: { icon: 'fa-bolt',             color: '#f59e0b', desc: 'Danh sách toàn bộ máy cắt trung thế, trạng thái vận hành, lịch bảo dưỡng.' },
    suco:           { icon: 'fa-exclamation-triangle', color: '#ef4444', desc: 'Ghi nhận, phân loại và theo dõi xử lý sự cố lưới điện.' },
    kehoachtn:      { icon: 'fa-file-alt',         color: '#8b5cf6', desc: 'Lập kế hoạch thử nghiệm định kỳ, phân công đội thực hiện, đặt lịch.' },
    lichsutn:       { icon: 'fa-history',          color: '#06b6d4', desc: 'Xem toàn bộ lịch sử thử nghiệm: ngày thực hiện, kết quả, biên bản.' },
  };
  const info = icons[pageId] || { icon: 'fa-cog', color: '#64748b', desc: '' };

  mainEl.innerHTML = `
    <div class="placeholder-page">
      <div class="ph-icon" style="background:${info.color}22;color:${info.color}">
        <i class="fas ${info.icon}"></i>
      </div>
      <h2 class="ph-title">${page.title}</h2>
      <p class="ph-desc">${info.desc}</p>
      <div class="ph-badge">
        <i class="fas fa-hammer"></i> Tính năng đang được phát triển
      </div>
      <button class="ph-back-btn" onclick="navigateTo('dashboard')">
        <i class="fas fa-arrow-left"></i> Quay lại Dashboard
      </button>
    </div>
  `;
}

function navigateTo(pageId) {
  const page = PAGES[pageId];
  if (!page) return;

  // Cập nhật active state sidebar
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === pageId);
  });

  // Cập nhật tiêu đề
  const titleEl = document.querySelector('.page-title');
  const subEl   = document.querySelector('.page-sub');
  if (titleEl) titleEl.textContent = page.title;
  if (subEl)   subEl.textContent   = page.sub;

  // Ẩn/hiện nút Làm mới (chỉ hiện ở dashboard)
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) refreshBtn.style.display = pageId === 'dashboard' ? 'flex' : 'none';

  // Render trang
  page.render();
}

// ── 19. INIT ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Gắn data-page cho từng nav-item
  const navMap = {
    'Dashboard':           'dashboard',
    'Công tác':            'congtac',
    'Kế hoạch sản xuất':  'kehoachsx',
    'Máy cắt trung thế':  'maycattrungthe',
    'Sự cố':              'suco',
    'Kế hoạch TN':        'kehoachtn',
    'Lịch sử TN':         'lichsutn',
  };

  document.querySelectorAll('.nav-item').forEach(el => {
    const text = el.querySelector('span')?.textContent?.trim();
    const pageId = navMap[text];
    if (pageId) {
      el.dataset.page = pageId;
      el.addEventListener('click', e => {
        e.preventDefault();
        navigateTo(pageId);
      });
    }
  });

  // Load dashboard ban đầu (không auto-refresh)
  loadDashboard();
});
