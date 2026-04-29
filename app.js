/* ============================================================
   app.js – Dashboard EVNHANOI / Quản lý TongHopThietBi
   Supabase + filters + pagination + charts + CSV export
   ============================================================ */

// ── 1. SUPABASE CONFIG ───────────────────────────────────────
const SUPABASE_URL = 'https://xqqmfmljwycpehfyknoy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhxcW1mbWxqd3ljcGVoZnlrbm95Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyODM4MDQsImV4cCI6MjA4Nzg1OTgwNH0.J_z0cFqq_Yet-n2X2L_VREdkcAqbkRFpYUp-ti3Fukc';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const TABLE_NAME = 'TongHopThietBi';

// ── 2. CONSTANTS ─────────────────────────────────────────────
const CAP_MAP = { 0: 'TT (0.4kV)', 1: '110kV', 2: '220kV', 3: '35kV', 4: '22kV', 6: '6kV', 9: '10kV' };
const CAP_LABEL = { 0: 'TT', 1: '110kV', 2: '220kV', 3: '35kV', 4: '22kV', 6: '6kV', 9: '10kV' };
const PAGE_SIZE = 50;

const PALETTE = [
  '#3b82f6','#10b981','#f59e0b','#8b5cf6',
  '#06b6d4','#ef4444','#ec4899','#14b8a6',
  '#f97316','#84cc16','#a78bfa','#fb923c'
];

// Phân loại thiết bị loại trừ khỏi tổng số thiết bị
// (THM, RL, TIchânsứ, HTTĐ, Dầu – theo yêu cầu)
const EXCLUDED_PHANLOAI = ['THM', 'RL', 'HTTĐ'];
// Hàm kiểm tra loại trừ thiết bị (dùng cho totalDevices)
function isExcludedDevice(pl) {
  if (!pl) return true;
  const n = pl.trim().toUpperCase().replace(/\s+/g,'').normalize('NFC');
  if (n === 'THM')  return true;
  if (n === 'RL')   return true;
  if (n === 'DẦU' || n === 'DAU' || n.startsWith('DẦU') || n.startsWith('DAU')) return true;
  if (n.startsWith('TICHAN') || n.includes('TICHÂN') || n.includes('TICHANSỨ')) return true;
  if (n === 'HTTĐ' || n === 'HTTD' || n.startsWith('HTTD')) return true;
  return false;
}
// Phân loại thiết bị loại trừ khỏi CHIPS (không hiển thị)
const EXCLUDED_CHIPS_PHANLOAI = new Set(['TIchânsứ', 'HTTĐ']);
// Cap điện áp hiển thị trong CHIPS filter
const CHIP_CAP_VALS = [2, 1, 3, 4, 9, 6, 0];
// Thứ tự cấp ĐA giảm dần + màu nhất quán
const CAP_ORDER  = ['2','1','3','4','9','6','0'];
const CAP_COLORS = {'2':'#1565c0','1':'#18ffff','3':'#00e676','4':'#e040fb','9':'#00e676','6':'#00e676','0':'#18ffff'};
// Màu công nghệ TBA
const TECH_COLORS = {AIS:'#00c8ff', GIS:'#b388ff', HGIS:'#18ffff', HGIS_AIS:'#ff9100', GIS_KCK:'#ff9100', KCK:'#00e676'};

// Helper chuẩn hoá giá trị Loai_ngan_lo — xử lý encoding khác nhau trong DB
function normNganLoai(v) {
  if (!v) return '';
  // Bước 1: strip dấu tiếng Việt → ASCII, lowercase, bỏ space
  const n = String(v).trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/\s+/g, '')
    .toLowerCase();
  return n;
}
// Kiểm tra một row thuộc ngăn nào (dùng normNganLoai để match mọi encoding)
function matchLoaiNgan(v, target) {
  // target: 'dz'|'mba'|'xt'|'ll'|'tbn'|'td'|'khang'
  const n = normNganLoai(v);
  switch (target) {
    case 'dz':    return n === 'ngandz' || n === 'nganduongday' || n === 'dz';
    case 'mba':   return n === 'nganmba';
    case 'xt':    return n === 'nganxt' || n === 'nganxuattuyen';
    case 'll':    return n === 'nganll' || n === 'nganlienlac';
    case 'tbn':   return n === 'ngantbn' || n === 'ngantubun' || n === 'ngantbu';
    case 'td':    return n === 'ngantd'  || n === 'ngantudung';
    case 'khang': return n === 'ngankhang';
    default:      return false;
  }
}
let allData = [];
let filteredData = [];
let currentPage = 1;
let sortCol = -1;
let sortAsc = true;
let selectedChartTram = ''; // '' = tất cả, else tên trạm cụ thể
let deviceChart = null;
let typeChart   = null;
let tnChart     = null;

// Chip filter selections
let selectedPhanLoai = new Set();
let selectedCap = new Set();
let selectedDoi = new Set();

// Filter theo Loai_ngan_lo khi click stat card ngăn
let selectedLoaiNgan = '';

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
  const doi      = [...new Set(data.map(d => d.Doi).filter(Boolean))].sort();
  const caps     = [...new Set(data.map(d => d.Cap_dien_ap).filter(v => v !== null && v !== undefined))].sort((a,b)=>a-b);
  const phanLoai = [...new Set(data.map(d => d.Phan_loai_thiet_bi).filter(Boolean))].sort();
  const trams    = [...new Set(data.map(d => d.Tram).filter(Boolean))].sort();

  fillSelect('filterDoi',     doi,      v => v);
  fillSelect('filterCap',     caps,     v => `${CAP_LABEL[v] || v} (cấp ${v})`);
  fillSelect('filterPhanLoai',phanLoai, v => v);
  fillSelect('filterTram',    trams,    v => v);
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
// Lọc theo Loai_ngan_lo khi click stat card ngăn
function filterByLoaiNgan(loai) {
  // Toggle: click lại thì bỏ lọc
  selectedLoaiNgan = selectedLoaiNgan === loai ? '' : loai;
  // Highlight card đang active
  document.querySelectorAll('.stat-card-ngan').forEach(el => {
    el.classList.toggle('stat-card-active', el.dataset.ngan === selectedLoaiNgan);
  });
  applyFilters();
  // Cuộn xuống bảng
  if (selectedLoaiNgan) {
    setTimeout(() => {
      const tbl = document.querySelector('.data-table');
      if (tbl) tbl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
  }
}

function applyFilters() {
  const doi      = document.getElementById('filterDoi').value;
  const cap      = document.getElementById('filterCap').value;
  const phanLoai = document.getElementById('filterPhanLoai').value;
  const tram     = document.getElementById('filterTram').value;
  const q        = document.getElementById('searchInput').value.trim().toLowerCase();

  filteredData = allData.filter(d => {
    if (doi      && d.Doi !== doi)                              return false;
    if (cap      && String(d.Cap_dien_ap) !== String(cap))     return false;
    if (phanLoai && d.Phan_loai_thiet_bi !== phanLoai)        return false;
    if (tram     && d.Tram !== tram)                           return false;
    // Chip filter: phân loại thiết bị
    if (selectedPhanLoai.size > 0) {
      const pl = (d.Phan_loai_thiet_bi || '').trim();
      if (!selectedPhanLoai.has(pl)) return false;
    }
    // Filter ngăn theo Loai_ngan_lo (click từ stat card)
    if (selectedLoaiNgan) {
      if (normNganLoai(d.Loai_ngan_lo) !== normNganLoai(selectedLoaiNgan)) return false;
    }
    if (q) {
      const haystack = [d.Tram, d.Ten_thiet_bi, d.Ngan_thiet_bi,
                        d.Phan_loai_thiet_bi, d.Doi, d.Hang_san_xuat]
        .map(v => (v || '').toLowerCase()).join(' ');
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  currentPage = 1;
  renderStats(filteredData);
  renderTypeChips();
  populateChartTramSelect(filteredData);
  renderBarChart(filteredData);
  renderPieChart(filteredData);
  renderTNTimeline(filteredData);
  renderTable(filteredData);
  renderPagination();
  renderActiveFilters({ doi, cap, phanLoai, tram, q });
}

function resetFilters() {
  ['filterDoi','filterCap','filterPhanLoai','filterTram'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('searchInput').value = '';
  selectedPhanLoai.clear();
  selectedLoaiNgan = '';
  document.querySelectorAll('.stat-card-ngan').forEach(el => el.classList.remove('stat-card-active'));
  applyFilters();
}

function renderActiveFilters({ doi, cap, phanLoai, tram, q }) {
  const row   = document.getElementById('activeFilterRow');
  const chips = document.getElementById('activeFilterChips');
  const filters = [];
  if (doi)             filters.push({ label: `Đội: ${doi}`, key: 'filterDoi' });
  if (cap)             filters.push({ label: `Cấp: ${CAP_LABEL[cap] || cap}`, key: 'filterCap' });
  if (phanLoai)        filters.push({ label: `Loại: ${phanLoai}`, key: 'filterPhanLoai' });
  if (tram)            filters.push({ label: `Trạm: ${tram}`, key: 'filterTram' });
  if (q)               filters.push({ label: `"${q}"`, key: 'searchInput' });
  if (selectedLoaiNgan) filters.push({ label: `Ngăn: ${selectedLoaiNgan}`, key: '_loaiNgan' });

  if (!filters.length) { row.style.display = 'none'; return; }
  row.style.display = 'flex';
  chips.innerHTML = '';
  filters.forEach(f => {
    const chip = document.createElement('div');
    chip.className = 'active-chip';
    chip.innerHTML = `${f.label} <i class="fas fa-times"></i>`;
    chip.onclick = () => {
      if (f.key === '_loaiNgan') {
        selectedLoaiNgan = '';
        document.querySelectorAll('.stat-card-ngan').forEach(el => el.classList.remove('stat-card-active'));
        applyFilters();
      } else {
        const el = document.getElementById(f.key);
        if (el) el.value = '';
        applyFilters();
      }
    };
    chips.appendChild(chip);
  });
}

// ── 7. RENDER STATS ──────────────────────────────────────────
function renderStats(data) {
  const tf = d => d.Tram || '';

  // ── TBA counts ──
  // Dùng allData để xác định maxCap của từng trạm:
  // Thiết bị 110kV ở trạm 220kV vẫn tính là trạm 220kV
  const capPrioR = {'2':0,'1':1,'3':2,'4':3,'9':4,'6':5,'0':6};
  const tramMaxCapR = {};
  allData.forEach(d => {
    const tram = tf(d); if (!tram) return;
    const cap = String(d.Cap_dien_ap);
    if (!tramMaxCapR[tram] || (capPrioR[cap]??99) < (capPrioR[tramMaxCapR[tram]]??99))
      tramMaxCapR[tram] = cap;
  });

  // Tập hợp các trạm xuất hiện trong data (filteredData hoặc allData)
  const filteredTrams = new Set(data.map(tf).filter(Boolean));
  const totalTBA = filteredTrams.size;
  const n220 = [...filteredTrams].filter(t => tramMaxCapR[t] === '2').length;
  const n110 = [...filteredTrams].filter(t => tramMaxCapR[t] === '1').length;

  // ── Tổng số thiết bị: sum So_luong, bỏ THM, RL, TIchânsứ, HTTĐ, Dầu ──
  const totalDevices = data
    .filter(d => !isExcludedDevice(d.Phan_loai_thiet_bi))
    .reduce((s, d) => s + (Number(d.So_luong) || 0), 0);

  // ── Tổng công suất: chỉ Phan_loai_thiet_bi = 'MBA' exact (bỏ MBATD, MBA,, MBA  ...) ──
  const tongCongSuat = data
    .filter(d => (d.Phan_loai_thiet_bi || '').trim().replace(/\W/g, '').toUpperCase() === 'MBA')
    .reduce((s, d) => s + (Number(d.Cong_suat) || 0), 0);

  // ── Tổng số ngăn: đếm Ngan_thiet_bi unique theo Tram, KHÔNG tính HTTĐ ──
  const nganSet = new Set();
  data.forEach(d => {
    if (d.Ngan_thiet_bi && d.Tram) {
      // Loại HTTĐ ra khỏi đếm ngăn
      const pl = (d.Phan_loai_thiet_bi || '').trim().toUpperCase().replace(/\s+/g,'').normalize('NFC');
      if (pl === 'HTTĐ' || pl === 'HTTD' || pl.startsWith('HTTD')) return;
      nganSet.add(`${d.Tram}|||${d.Ngan_thiet_bi}`);
    }
  });
  const totalNgan = nganSet.size;

  // ── Ngăn đường dây ──
  const nganDLSet = new Set();
  data.filter(d => matchLoaiNgan(d.Loai_ngan_lo, 'dz'))
      .forEach(d => { if (d.Tram && d.Ngan_thiet_bi) nganDLSet.add(`${d.Tram}|||${d.Ngan_thiet_bi}`); });
  const nganDuongDay = nganDLSet.size;

  // ── Ngăn MBA: đếm unique Ngan_thiet_bi có Phan_loai_thiet_bi = 'MBA' exact ──
  const nganMBASet = new Set();
  data.filter(d => (d.Phan_loai_thiet_bi || '').trim() === 'MBA')
      .forEach(d => { if (d.Tram && d.Ngan_thiet_bi) nganMBASet.add(`${d.Tram}|||${d.Ngan_thiet_bi}`); });
  const nganMBA = nganMBASet.size;

  // ── Ngăn XT ──
  const nganXTSet = new Set();
  data.filter(d => matchLoaiNgan(d.Loai_ngan_lo, 'xt'))
      .forEach(d => { if (d.Tram && d.Ngan_thiet_bi) nganXTSet.add(`${d.Tram}|||${d.Ngan_thiet_bi}`); });
  const nganXT = nganXTSet.size;

  // ── Ngăn liên lạc ──
  const nganLLSet = new Set();
  data.filter(d => matchLoaiNgan(d.Loai_ngan_lo, 'll'))
      .forEach(d => { if (d.Tram && d.Ngan_thiet_bi) nganLLSet.add(`${d.Tram}|||${d.Ngan_thiet_bi}`); });
  const nganLL = nganLLSet.size;

  // ── Ngăn tụ bù ──
  const nganTBNSet = new Set();
  data.filter(d => matchLoaiNgan(d.Loai_ngan_lo, 'tbn'))
      .forEach(d => { if (d.Tram && d.Ngan_thiet_bi) nganTBNSet.add(`${d.Tram}|||${d.Ngan_thiet_bi}`); });
  const nganTBN = nganTBNSet.size;

  // ── Ngăn tự dùng ──
  const nganTDSet = new Set();
  data.filter(d => matchLoaiNgan(d.Loai_ngan_lo, 'td'))
      .forEach(d => { if (d.Tram && d.Ngan_thiet_bi) nganTDSet.add(`${d.Tram}|||${d.Ngan_thiet_bi}`); });
  const nganTD = nganTDSet.size;

  // ── Ngăn kháng ──
  const nganKhangSet = new Set();
  data.filter(d => matchLoaiNgan(d.Loai_ngan_lo, 'khang'))
      .forEach(d => { if (d.Tram && d.Ngan_thiet_bi) nganKhangSet.add(`${d.Tram}|||${d.Ngan_thiet_bi}`); });
  const nganKhang = nganKhangSet.size;

  // ── Công nghệ TBA ──
  // Bước 1: Thu thập tất cả Phan_loai_thiet_bi theo từng trạm và cấp điện áp
  // tramCapTypes[tram][cap] = Set of Phan_loai_thiet_bi
  const tramCapTypes = {};
  data.forEach(d => {
    const tram = tf(d);
    const cap  = String(d.Cap_dien_ap);
    const pl   = (d.Phan_loai_thiet_bi || '').trim().toUpperCase();
    if (!tram || !pl) return;
    if (!tramCapTypes[tram]) tramCapTypes[tram] = {};
    if (!tramCapTypes[tram][cap]) tramCapTypes[tram][cap] = new Set();
    tramCapTypes[tram][cap].add(pl);
  });

  // Bước 2: Với mỗi trạm có cap 1 hoặc 2 → xác định cấp hiệu lực (220 > 110)
  // rồi phân loại công nghệ dựa vào Phan_loai_thiet_bi của cấp hiệu lực đó
  // Quy tắc phân loại (1 trạm = 1 TBA):
  //   - có HGIS + MC/AIS trong cùng cấp → HGIS-AIS (hỗn hợp)
  //   - chỉ có HGIS                     → HGIS
  //   - chỉ có GIS (không HGIS)         → GIS
  //   - còn lại (MC, AIS, ...)          → AIS
  function classifyTech(typeSet) {
    // typeSet chứa Phan_loai_thiet_bi (uppercase) của trạm ở cấp hiệu lực
    const arr = [...typeSet];
    const hasGIS  = arr.some(t => t === 'GIS');
    const hasHGIS = arr.some(t => t === 'HGIS');
    const hasMC   = arr.some(t => t === 'MC');
    if (hasHGIS && hasMC) return 'HGIS_AIS';
    if (hasGIS  && hasMC) return 'HGIS_AIS';
    if (hasHGIS)          return 'HGIS';
    if (hasGIS)           return 'GIS';
    return 'AIS';
}

  const tech220 = { AIS: 0, GIS: 0, HGIS: 0, HGIS_AIS: 0 };
  const tech110 = { AIS: 0, GIS: 0, HGIS: 0, HGIS_AIS: 0 };
  // tech22 gộp cả cap 4(22kV) và cap 3(35kV)
  const tech22 = { GIS: 0, KCK: 0, GIS_KCK: 0 };

  const countedTramsHV = new Set();

  // 22-35kV: cùng logic — GIS/HGIS/MC exact match
  function classifyLV(typeSet) {
    const arr = [...typeSet];
    const hasGIS  = arr.some(t => t === 'GIS');
    const hasHGIS = arr.some(t => t === 'HGIS');
    const hasMC   = arr.some(t => t === 'MC');
    if (hasHGIS && hasMC) return 'GIS_KCK';
    if (hasGIS  && hasMC) return 'GIS_KCK';
    if (hasHGIS || hasGIS) return 'GIS';
    return 'KCK';
  }

  Object.entries(tramCapTypes).forEach(([tram, capMap]) => {
    // HV: 220kV ưu tiên
    const effCap = capMap['2'] ? '2' : capMap['1'] ? '1' : null;
    if (effCap && !countedTramsHV.has(tram)) {
      countedTramsHV.add(tram);
      const cls = classifyTech(capMap[effCap]);
      if (effCap === '2') tech220[cls] = (tech220[cls] || 0) + 1;
      else                tech110[cls] = (tech110[cls] || 0) + 1;
    }
    // LV: cap 4 (22kV) và cap 3 (35kV) — gộp chung vào tech22
    const lvCaps = ['4', '3'].filter(c => capMap[c]);
    if (lvCaps.length > 0) {
      // Gộp tất cả types của các cap thấp
      const lvTypes = new Set();
      lvCaps.forEach(cap => capMap[cap].forEach(t => lvTypes.add(t)));
      const cls = classifyLV(lvTypes);
      tech22[cls] = (tech22[cls] || 0) + 1;
    }
  });

  const fmt = n => Number(n).toLocaleString('vi-VN');
  const pct = (a, b) => b > 0 ? ((a / b) * 100).toFixed(1) + '%' : '—';

  setText('totalStations', fmt(totalTBA));
  setText('total110kV',    fmt(n110));
  setText('ratio110kV',    pct(n110, totalTBA));
  setText('total220kV',    fmt(n220));
  setText('ratio220kV',    pct(n220, totalTBA));
  setText('totalDevices',  fmt(totalDevices));
  setText('totalNgan',     fmt(totalNgan));
  setText('nganDuongDay',  fmt(nganDuongDay));
  setText('nganMBA',       fmt(nganMBA));
  setText('nganXT',        fmt(nganXT));
  setText('nganLL',        fmt(nganLL));
  setText('nganTBN',       fmt(nganTBN));
  setText('nganTD',        fmt(nganTD));
  setText('nganKhang',     fmt(nganKhang));
  setText('tongCongSuat',  fmt(Math.round(tongCongSuat)));
  // Công nghệ TBA – render bảng chi tiết
  renderTechTable(tech220, tech110, tech22);
}


// ── 7b. RENDER TECH TABLE ────────────────────────────────────
// Hiển thị bảng công nghệ TBA với filter 220kV / 110kV / 22kV
let techFilter = 'all'; // 'all' | '220' | '110' | '22'

function renderTechTable(tech220, tech110, tech22) {
  window._techData = { tech220, tech110, tech22 };
  _renderTechDisplay(tech220, tech110, tech22);
}

function setTechFilter(f) { setTechHVFilter(f); } // legacy alias

function setTechHVFilter(f) {
  window._hvFilterStat = f;
  // Update dropdown if present
  const sel = document.querySelector('.tech-hv-select');
  if (sel) sel.value = f;
  if (window._techData) {
    _renderTechDisplay(window._techData.tech220, window._techData.tech110, window._techData.tech22);
  }
}

function _renderTechDisplay(tech220, tech110, tech22) {
  const box = document.getElementById('techTBABox');
  if (!box) return;
  const fmt = n => Number(n).toLocaleString('vi-VN');

  function barItem(cls, label, val, maxVal) {
    const pct = maxVal > 0 ? Math.round((val / maxVal) * 100) : 0;
    return `<div class="tech-bar-item">
      <div class="tech-bar-header">
        <span class="tech-bar-label ${cls}">${label}</span>
        <span class="tech-bar-num ${cls}">${fmt(val)}</span>
      </div>
      <div class="tech-bar-track"><div class="tech-bar-fill ${cls}" style="width:${pct}%"></div></div>
    </div>`;
  }

  const hvFilter = window._hvFilterStat || 'all';
  let ais, gis, hgis, honhop;
  if (hvFilter === 'all') {
    ais    = (tech220.AIS||0)      + (tech110.AIS||0);
    gis    = (tech220.GIS||0)      + (tech110.GIS||0);
    hgis   = (tech220.HGIS||0)    + (tech110.HGIS||0);
    honhop = (tech220.HGIS_AIS||0) + (tech110.HGIS_AIS||0);
  } else {
    const t = hvFilter === '220' ? tech220 : tech110;
    ais = t.AIS||0; gis = t.GIS||0; hgis = t.HGIS||0; honhop = t.HGIS_AIS||0;
  }
  const maxHV = Math.max(ais, gis, hgis, honhop, 1);

  // Dropdown header
  const dropHtml = `<select class="tech-hv-select" onchange="setTechHVFilter(this.value)">
    <option value="all"${hvFilter==='all'?' selected':''}>220 – 110kV</option>
    <option value="220"${hvFilter==='220'?' selected':''}>220kV</option>
    <option value="110"${hvFilter==='110'?' selected':''}>110kV</option>
  </select>`;

  let html = `<div class="tech-cap-header" style="display:flex;align-items:center;gap:6px;justify-content:space-between">
    <i class="fas fa-bolt"></i>${dropHtml}</div>`;
  html += `<div class="tech-bar-grid">`;
  html += barItem('ais',    'AIS',        ais,    maxHV);
  html += barItem('honhop', 'HGIS – AIS', honhop, maxHV);
  html += barItem('gis',    'GIS',        gis,    maxHV);
  html += barItem('hgis',   'HGIS',       hgis,   maxHV);
  html += `</div>`;

  // 22+35kV section
  const maxLV = Math.max(tech22.GIS||0, tech22.KCK||0, tech22.GIS_KCK||0, 1);
  html += `<div class="tech-cap-header" style="margin-top:10px"><i class="fas fa-bolt" style="opacity:.6"></i> 22 – 35kV</div>`;
  html += `<div class="tech-bar-grid">`;
  html += barItem('gis',    'GIS',              tech22.GIS||0,     maxLV);
  html += barItem('kck',    'Khí – Chân không', tech22.KCK||0,     maxLV);
  if ((tech22.GIS_KCK||0) > 0)
    html += barItem('honhop', 'GIS + KCK',      tech22.GIS_KCK||0, maxLV);
  html += `</div>`;

  box.innerHTML = html;
}



// ── 8. RENDER DEVICE CHIPS (2 CHIPS) ────────────────────────
// ── 8. RENDER DEVICE CHIPS ──────────────────────────────────
// Hiển thị TẤT CẢ loại thiết bị từ Phan_loai_thiet_bi (trừ TIchânsứ & HTTĐ)
// Nguồn: allData — hiển thị toàn bộ không phụ thuộc filter hiện tại
function renderTypeChips() {
  const container = document.getElementById('deviceByType');
  if (!container) return;

  // Hàm kiểm tra loại trừ — robust với encoding/spaces khác nhau
  function isExcluded(pl) {
    if (!pl) return true;
    const normalized = pl.trim().toUpperCase()
      .replace(/\s+/g, '')           // bỏ tất cả khoảng trắng
      .normalize('NFC');              // chuẩn hóa Unicode
    // Loại trừ: TI chân sứ (các biến thể) và HTTĐ
    if (normalized.startsWith('TICHAN') || normalized.startsWith('TI-CHAN') ||
        normalized === 'TICHANSỨ' || normalized === 'TICHÂNSỨ' ||
        normalized.includes('TICHÂN') || normalized.includes('TICHAN')) return true;
    if (normalized === 'HTTĐ' || normalized === 'HTTD' ||
        normalized.startsWith('HTTĐ') || normalized.startsWith('HTTD')) return true;
    return false;
  }

  // ── 1. Build typeMap từ TOÀN BỘ allData ──
  // typeMap[pl] = { totalCount (rows), soLuong (sum So_luong), hangs: Set }
  const typeMap = {};
  allData.forEach(d => {
    const pl = (d.Phan_loai_thiet_bi || '').trim();
    if (!pl || isExcluded(pl)) return;
    if (!typeMap[pl]) typeMap[pl] = { totalCount: 0, soLuong: 0, hangs: new Set() };
    typeMap[pl].totalCount++;
    typeMap[pl].soLuong += Number(d.So_luong) || 0;
    if ((d.Hang_san_xuat || '').trim()) {
      typeMap[pl].hangs.add(d.Hang_san_xuat.trim());
    }
  });

  // ── 2. Build filteredCounts từ filteredData (phản ánh dropdown/search filter)
  //    KHÔNG tính selectedPhanLoai để chip không bị ẩn khi đang được chọn ──
  const filteredCounts = {}; // pl → { count rows, soLuong }
  filteredData.forEach(d => {
    const pl = (d.Phan_loai_thiet_bi || '').trim();
    if (!pl || isExcluded(pl)) return;
    if (!filteredCounts[pl]) filteredCounts[pl] = { count: 0, soLuong: 0 };
    filteredCounts[pl].count++;
    filteredCounts[pl].soLuong += Number(d.So_luong) || 0;
  });

  container.innerHTML = '';

  // ── Header row: tiêu đề + nút reset ──
  const headerRow = document.createElement('div');
  headerRow.className = 'chips-header-row';

  // Active filter info
  const activeInfo = document.createElement('span');
  activeInfo.id = 'chipsActiveInfo';
  activeInfo.className = 'chips-active-info' + (selectedPhanLoai.size > 0 ? ' visible' : '');
  if (selectedPhanLoai.size > 0) {
    activeInfo.innerHTML = `<i class="fas fa-filter"></i> Đang lọc: ${[...selectedPhanLoai].join(', ')}`;
  }
  headerRow.appendChild(activeInfo);

  // Count display
  const countEl = document.getElementById('typeChipsCount');
  if (countEl) {
    const numTypes = Object.values(typeMap).length;
    const totalSLAll = Object.values(typeMap).reduce((s, v) => s + (v.soLuong || 0), 0);
    countEl.textContent = `${numTypes} loại  ·  ${totalSLAll.toLocaleString('vi-VN')} thiết bị`;
  }

  // Reset button
  const resetBtn = document.createElement('button');
  resetBtn.className = 'chips-reset-btn';
  resetBtn.innerHTML = '<i class="fas fa-times-circle"></i> Bỏ lựa chọn';
  resetBtn.style.display = selectedPhanLoai.size > 0 ? 'inline-flex' : 'none';
  resetBtn.onclick = () => {
    selectedPhanLoai.clear();
    applyFilters();        // re-filter → triggers renderTypeChips
  };
  headerRow.appendChild(resetBtn);
  container.appendChild(headerRow);

  // ── Device chip grid ──
  const grid = document.createElement('div');
  grid.className = 'device-chips-grid';

  // Sort: active first, then by count desc
  const sorted = Object.entries(typeMap)
    .sort((a, b) => {
      const aActive = selectedPhanLoai.has(a[0]) ? 1 : 0;
      const bActive = selectedPhanLoai.has(b[0]) ? 1 : 0;
      if (bActive !== aActive) return bActive - aActive;
      // Sort by So_luong desc, fallback to row count
      const aSL = a[1].soLuong || a[1].totalCount || 0;
      const bSL = b[1].soLuong || b[1].totalCount || 0;
      return bSL - aSL;
    });

  sorted.forEach(([type, info]) => {
    const isActive   = selectedPhanLoai.has(type);
    const fc         = filteredCounts[type] || { count: 0, soLuong: 0 };
    const totalSL    = info.soLuong || 0;
    const filtSL     = fc.soLuong || 0;
    const isFiltered = filtSL !== totalSL && Object.keys(filteredCounts).length < Object.keys(typeMap).length;

    // Hiển thị số lượng (So_luong), nếu = 0 thì dùng số rows
    const displayNum = filtSL > 0 ? filtSL : (fc.count > 0 ? fc.count : 0);
    const totalNum   = totalSL > 0 ? totalSL : info.totalCount;

    // Build hãng list (max 4)
    const hangsArr = [...info.hangs].sort().slice(0, 4);
    const hangStr  = hangsArr.join(' · ') + (info.hangs.size > 4 ? ` +${info.hangs.size - 4}` : '');

    const chip = document.createElement('div');
    chip.className = 'device-chip' + (isActive ? ' active' : '');
    chip.title = `${type}\nSố lượng: ${displayNum.toLocaleString('vi-VN')} / Tổng: ${totalNum.toLocaleString('vi-VN')}\nHãng: ${[...info.hangs].join(', ') || '—'}`;
    chip.innerHTML = `
      <span class="device-chip-name">${type}</span>
      <span class="device-chip-count">
        ${displayNum.toLocaleString('vi-VN')}
        ${isFiltered ? `<span class="device-chip-total">/${totalNum.toLocaleString('vi-VN')}</span>` : ''}
      </span>
      ${hangStr ? `<span class="device-chip-hang">${hangStr}</span>` : ''}
    `;
    chip.onclick = () => {
      if (selectedPhanLoai.has(type)) {
        selectedPhanLoai.delete(type);
      } else {
        selectedPhanLoai.add(type);
      }
      applyFilters();
    };
    grid.appendChild(chip);
  });

  container.appendChild(grid);
}


// ─────────────────────────────────────────────────────────────
// 9. CHARTS – Thiết bị theo trạm & cấp điện áp
// Dữ liệu: cột Tram, Phan_loai_thiet_bi, Cap_dien_ap
// Loại trừ: TIchânsứ, HTTĐ
// Phân nhóm công nghệ: GIS / HGIS / AIS / HGIS-AIS theo trạm
// ─────────────────────────────────────────────────────────────

// Hàm loại trừ thiết bị khỏi charts
function isExcludedChart(pl) {
  if (!pl) return true;
  const n = pl.trim().toUpperCase().replace(/\s+/g,'').normalize('NFC');
  if (n.startsWith('TICHAN') || n.includes('TICHÂN')) return true;
  if (n === 'HTTĐ' || n === 'HTTD' || n.startsWith('HTTD')) return true;
  if (n === 'DẦU' || n === 'DAU' || n.startsWith('DẦU') || n.startsWith('DAU')) return true;
  if (n === 'RL') return true;
  return false;
}

// Phân loại công nghệ của 1 trạm dựa vào Set<Phan_loai_thiet_bi> ở cấp hiệu lực
function classifyTechChart(typeSet) {
  const arr = [...typeSet].map(t => t.toUpperCase());
  const hasGIS  = arr.some(t => t === 'GIS');
  const hasHGIS = arr.some(t => t === 'HGIS');
  const hasMC   = arr.some(t => t === 'MC');
  if (hasHGIS && hasMC) return 'HGIS_AIS';
  if (hasGIS  && hasMC) return 'HGIS_AIS';
  if (hasHGIS) return 'HGIS';
  if (hasGIS)  return 'GIS';
  return 'AIS';
}

// Xây dựng thông tin tổng hợp theo trạm
// Mỗi trạm: { tram, maxCap, techClass, caps:{cap→soLuong}, devTypes:{pl→sl}, total }
// Cấp hiệu lực = cấp cao nhất (220 > 110 > 35 > 22 > 10 > 6 > TT)
function buildStationInfo(data) {
  const map = {};
  data.forEach(d => {
    const tram = (d.Tram || '').trim(); if (!tram) return;
    const pl   = (d.Phan_loai_thiet_bi || '').trim();
    const cap  = (d.Cap_dien_ap !== null && d.Cap_dien_ap !== undefined) ? String(d.Cap_dien_ap) : null;
    const sl   = Number(d.So_luong) || 0;
    if (!map[tram]) map[tram] = { caps:{}, plByCap:{}, total:0, maxCap:null };
    if (cap) {
      // Track max cap bằng TẤT CẢ thiết bị (kể cả loại trừ) để xác định cấp ĐA trạm
      const ni = CAP_ORDER.indexOf(cap), xi = CAP_ORDER.indexOf(map[tram].maxCap);
      if (ni !== -1 && (xi === -1 || ni < xi)) map[tram].maxCap = cap;
      // caps chỉ tính thiết bị KHÔNG bị loại trừ (giống bảng nhiệt cũ)
      if (!isExcludedChart(pl)) {
        map[tram].caps[cap] = (map[tram].caps[cap] || 0) + sl;
        if (!map[tram].plByCap[cap]) map[tram].plByCap[cap] = new Set();
        map[tram].plByCap[cap].add(pl.toUpperCase());
      }
    }
    if (!isExcludedChart(pl)) map[tram].total += sl;
  });

  // Classify tech for each station based on its effective cap
  return Object.entries(map).map(([tram, info]) => {
    const effCap = info.maxCap;
    // For HV stations (220/110): classify using that cap's PL set
    let tech = null;
    if (effCap === '2' || effCap === '1') {
      const plSet = info.plByCap[effCap] || new Set();
      tech = classifyTechChart(plSet);
    }
    return { tram, maxCap: effCap, tech, ...info };
  }).sort((a, b) => {
    const ai = CAP_ORDER.indexOf(a.maxCap ?? ''), bi = CAP_ORDER.indexOf(b.maxCap ?? '');
    const an = ai === -1 ? 99 : ai, bn = bi === -1 ? 99 : bi;
    if (an !== bn) return an - bn;
    return b.total - a.total;
  });
}

function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

// ── Populate chart tram dropdown ─────────────────────────────
function populateChartTramSelect(data) {
  const sel = document.getElementById('chartTramSelect');
  if (!sel) return;
  const cur = sel.value;
  while (sel.options.length > 1) sel.remove(1);
  const allSt = buildStationInfo(data);
  const byCapGroup = {};
  allSt.forEach(s => {
    const capLbl = CAP_LABEL[s.maxCap] || s.maxCap || 'Khác';
    if (!byCapGroup[capLbl]) byCapGroup[capLbl] = [];
    byCapGroup[capLbl].push(s);
  });
  Object.entries(byCapGroup).forEach(([capLbl, arr]) => {
    const grp = document.createElement('optgroup');
    grp.label = `── ${capLbl} ──`;
    arr.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.tram;
      const tl = (s.tech || '').replace('_AIS', ' – AIS');
      opt.textContent = `${s.tram}${tl ? '  [' + tl + ']' : ''}`;
      grp.appendChild(opt);
    });
    sel.appendChild(grp);
  });
  if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
  else { sel.value = ''; selectedChartTram = ''; }
}

// ── Filter chart by tram ──────────────────────────────────────
function filterChartByTram(tramName) {
  selectedChartTram = tramName;
  const sel = document.getElementById('chartTramSelect');
  if (sel && sel.value !== tramName) sel.value = tramName;
  renderBarChart(filteredData);
  renderPieChart(filteredData);
}

// ── 9. BAR CHART ──────────────────────────────────────────────
// Stacked horizontal bar: trục Y = Trạm, trục X = Số thiết bị
// Màu = Cấp điện áp  (220kV→110kV→35kV→22kV→10kV→6kV→TT)
// Nếu selectedChartTram ≠ '' → chỉ hiện trạm đó (bar to, rõ)
function renderBarChart(data) {
  // Đảm bảo canvas tồn tại
  const wrap = document.getElementById('deviceChartWrap');
  if (!wrap) return;
  if (!wrap.querySelector('canvas')) {
    wrap.innerHTML = '<canvas id="deviceChart"></canvas>';
    deviceChart = null;
  }

  const allStations = buildStationInfo(data);

  // Lọc theo trạm được chọn
  const stations = selectedChartTram
    ? allStations.filter(s => s.tram === selectedChartTram)
    : allStations;

  // Sub-label
  const sub = document.getElementById('chartSubLabel');
  if (sub) {
    if (selectedChartTram && stations[0]) {
      const st = stations[0];
      const tech = (st.tech || '').replace('_AIS', ' – AIS');
      sub.textContent = `📍 ${st.tram}  ·  Cấp: ${CAP_LABEL[st.maxCap] || ''}  ·  CN: ${tech || '—'}`;
    } else {
      sub.textContent = `${allStations.length} trạm  ·  220kV → 110kV → 35kV → 22kV → …  ·  hover để xem chi tiết`;
    }
  }

  // Chỉ lấy các cấp ĐA thực sự có trong toàn bộ data (không chỉ trạm đang xem)
  const activeCaps = CAP_ORDER.filter(cap => allStations.some(s => (s.caps[cap] || 0) > 0));

  const datasets = activeCaps.map(cap => ({
    label: CAP_LABEL[cap] || cap,
    data:  stations.map(s => s.caps[cap] || 0),
    backgroundColor: (CAP_COLORS[cap] || '#888') + 'cc',
    borderColor:      CAP_COLORS[cap] || '#888',
    borderWidth: 1,
    borderRadius: 3,
    barThickness: selectedChartTram ? 28 : 14,
  }));

  // Chiều cao canvas: động theo số trạm
  const barPx  = selectedChartTram ? 70 : 22;
  const totalH = Math.max(300, stations.length * barPx + 60);
  const canvas  = wrap.querySelector('canvas') || document.getElementById('deviceChart');
  if (canvas) {
    canvas.style.height = totalH + 'px';
    canvas.style.width  = '100%';
    // Lấy width thực: nếu wrap chưa render xong thì dùng parentElement hoặc fallback
    const w = wrap.clientWidth || wrap.parentElement?.clientWidth || 700;
    canvas.height = totalH;
    canvas.width  = w;
  }

  const ctx = document.getElementById('deviceChart')?.getContext('2d');
  if (!ctx) return;
  if (deviceChart) deviceChart.destroy();
  deviceChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: stations.map(s => s.tram), datasets },
    options: {
      indexAxis: 'y',
      responsive: false,
      maintainAspectRatio: false,
      animation: { duration: 350 },
      layout: { padding: { right: 16 } },
      plugins: {
        legend: {
          position: 'top',
          labels: { color:'#8fa3bd', font:{size:10}, boxWidth:12, padding:12 }
        },
        tooltip: {
          ...chartTooltipOpts(),
          callbacks: {
            title:  i => `🏭 ${i[0].label}`,
            label:  i => ` ${i.dataset.label}: ${Number(i.parsed.x).toLocaleString('vi-VN')} thiết bị`,
            footer: i => `Tổng: ${i.reduce((s,x) => s + Number(x.parsed.x), 0).toLocaleString('vi-VN')}`,
          }
        }
      },
      scales: {
        x: {
          stacked: true,
          beginAtZero: true,
          position: 'top',
          ticks: { color:'#4d6480', font:{size:9} },
          grid:  { color:'rgba(255,255,255,0.06)' }
        },
        y: {
          stacked: true,
          ticks: {
            color: '#c0d0e8',
            font:  { size: selectedChartTram ? 12 : 9.5,
                     weight: selectedChartTram ? '600' : '400' },
            crossAlign: 'far',
          },
          grid: { color:'rgba(255,255,255,0.03)' }
        }
      }
    }
  });
}

// ── Pie/Donut chart: phân loại thiết bị + công nghệ TBA ────────
function renderPieChart(data) {
  // Lọc theo trạm nếu đang chọn
  const srcData = selectedChartTram
    ? data.filter(d => (d.Tram || '').trim() === selectedChartTram)
    : data;
  // Pie phân loại thiết bị, loại trừ TIchânsứ, HTTĐ, Dầu, RL
  const counts = {};
  srcData.forEach(d => {
    const pl = (d.Phan_loai_thiet_bi || '').trim();
    if (!pl || isExcludedChart(pl)) return;
    counts[pl] = (counts[pl] || 0) + (Number(d.So_luong) || 0);
  });
  const sorted  = Object.entries(counts).sort((a,b) => b[1]-a[1]);
  const top     = sorted.slice(0,12);
  const others  = sorted.slice(12).reduce((s,e) => s+e[1], 0);
  if (others > 0) top.push(['Khác', others]);
  const labels  = top.map(e=>e[0]), values = top.map(e=>e[1]);
  const total   = values.reduce((a,b)=>a+b,0);
  const colors  = labels.map((_,i) => PALETTE[i % PALETTE.length]);

  const ctx = document.getElementById('typeChart').getContext('2d');
  if (typeChart) typeChart.destroy();
  typeChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets:[{ data:values, backgroundColor:colors.map(c=>c+'bb'), borderColor:colors, borderWidth:2, hoverOffset:12 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '50%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color:'#8fa3bd', font:{size:9.5}, boxWidth:10, padding:8,
            generateLabels: chart => chart.data.labels.map((lbl,i) => ({
              text: `${lbl}  ${values[i].toLocaleString('vi-VN')}  (${((values[i]/total)*100).toFixed(1)}%)`,
              fillStyle: colors[i]+'bb', strokeStyle: colors[i], lineWidth:1, hidden:false, index:i
            }))
          }
        },
        tooltip: { ...chartTooltipOpts(), callbacks: {
          title: c => c[0].label,
          label: c => [
            ` ${Number(c.parsed).toLocaleString('vi-VN')} thiết bị`,
            ` Tỷ lệ: ${((c.parsed/total)*100).toFixed(1)}%`
          ]
        }}
      }
    }
  });
  // Cập nhật label trạm trên tiêu đề pie
  const pieLabel = document.getElementById('pieChartTramLabel');
  if (pieLabel) pieLabel.textContent = selectedChartTram ? `· ${selectedChartTram}` : '';
}



// ── 11. TIMELINE: Năm sản xuất & Năm vận hành (req 14) ─────
function renderTNTimeline(data) {
  const years = new Set();
  data.forEach(d => {
    if (d.Nam_san_xuat) years.add(Number(d.Nam_san_xuat));
    if (d.Nam_van_hanh) years.add(Number(d.Nam_van_hanh));
  });
  if (!years.size) return;
  const minY = Math.min(...years);
  const maxY = Math.max(...years);
  const labels = [];
  for (let y = minY; y <= maxY; y++) labels.push(y);

  const countsSX = {}, countsVH = {};
  labels.forEach(y => { countsSX[y] = 0; countsVH[y] = 0; });
  data.forEach(d => {
    const sx = Number(d.Nam_san_xuat), vh = Number(d.Nam_van_hanh);
    const sl = Number(d.So_luong) || 1;
    if (sx && countsSX[sx] !== undefined) countsSX[sx] += sl;
    if (vh && countsVH[vh] !== undefined) countsVH[vh] += sl;
  });

  const ctx = document.getElementById('tnTimelineChart').getContext('2d');
  if (tnChart) tnChart.destroy();
  tnChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Năm sản xuất',
          data: labels.map(y => countsSX[y] || 0),
          backgroundColor: 'rgba(0,200,255,0.55)',
          borderColor: '#00c8ff',
          borderWidth: 1, borderRadius: 3,
        },
        {
          label: 'Năm vận hành',
          data: labels.map(y => countsVH[y] || 0),
          backgroundColor: 'rgba(0,230,118,0.55)',
          borderColor: '#00e676',
          borderWidth: 1, borderRadius: 3,
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { color: '#8fa3bd', font: { size: 10 }, boxWidth: 10, padding: 10 } },
        tooltip: chartTooltipOpts()
      },
      scales: {
        x: { ticks: { color: '#4d6480', font: { size: 9 }, maxRotation: 45 }, grid: { color: '#1a2332' } },
        y: { beginAtZero: true, ticks: { color: '#4d6480', font: { size: 9 } }, grid: { color: '#1a2332' } }
      }
    }
  });
}

// ── 12. TABLE (req 15) ───────────────────────────────────────
// Cột: Tram | Ten_thiet_bi | Hang_san_xuat | Kieu | Thong_so | Ly_lich
function renderTable(data) {
  const tbody = document.getElementById('dashboard-tbody');
  const start = (currentPage - 1) * PAGE_SIZE;
  const page  = data.slice(start, start + PAGE_SIZE);
  const count = document.getElementById('tableCount');
  count.textContent = `${data.length.toLocaleString('vi-VN')} bản ghi`;

  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="no-data">Không có dữ liệu phù hợp</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  page.forEach(d => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="station-name">${esc(d.Tram)}</span></td>
      <td>${esc(d.Ten_thiet_bi)}</td>
      <td><span class="hang-badge">${esc(d.Hang_san_xuat)}</span></td>
      <td style="font-family:var(--font-mono);font-size:11px">${esc(d.Kieu)}</td>
      <td style="font-size:11px;color:var(--text-secondary)">${esc(d.Thong_so)}</td>
      <td style="font-size:11px;color:var(--text-muted)">${esc(d.Ly_lich)}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ── 13. SORT TABLE ───────────────────────────────────────────
function sortTable(col) {
  const keys = ['Tram','Ten_thiet_bi','Hang_san_xuat','Kieu','Thong_so','Ly_lich'];
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
  const cols = ['Tram','Ten_thiet_bi','Hang_san_xuat','Kieu','Thong_so','Ly_lich',
                'Phan_loai_thiet_bi','Cap_dien_ap','So_luong','Ngan_thiet_bi',
                'Nam_san_xuat','Nam_van_hanh','Doi','Cong_suat','Loai_ngan_lo'];
  const hdrs = ['Trạm','Tên thiết bị','Hãng sản xuất','Kiểu','Thông số','Lý lịch',
                'Phân loại','Cấp ĐA','Số lượng','Ngăn TB',
                'Năm SX','Năm VH','Đội','Công suất','Loại ngăn'];

  const rows = [hdrs.join(',')];
  filteredData.forEach(d => {
    rows.push(cols.map(c => {
      let v = d[c] ?? '';
      if (c === 'Cap_dien_ap' && v !== '') v = CAP_LABEL[v] || v;
      return `"${String(v).replace(/"/g,'""')}"`;
    }).join(','));
  });

  const blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `tonghopthietbi_${new Date().toISOString().slice(0,10)}.csv`;
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
// CSS overrides for extended stat cards (injected once)
const STATS_EXTRA_CSS = `
  <style id="statsExtraCSS">
    #statsGrid { grid-template-columns: repeat(4, 1fr) !important; }
    .stat-ratio {
      display: inline-block;
      font-size: 11px; font-weight: 600;
      color: #ff9100;
      background: rgba(255,145,0,0.12);
      border: 1px solid rgba(255,145,0,0.3);
      border-radius: 4px; padding: 1px 6px; margin-top: 3px;
      font-family: var(--font-mono, monospace);
    }
    .stat-icon.pink   { background: rgba(255,64,129,0.15); color: #ff4081; }
    .stat-icon.teal   { background: rgba(0,230,118,0.15);  color: #00e676; }
    .stat-icon.cyan2  { background: rgba(24,255,255,0.12); color: #18ffff; }
    .stat-icon.yellow { background: rgba(255,215,64,0.15); color: #ffd740; }
    .stat-icon.green  { background: rgba(0,230,118,0.15);  color: #00e676; }
    .stat-tech-tag { font-size:11px; font-family:var(--font-mono); padding:3px 10px;
      border-radius:5px; border:1px solid rgba(255,255,255,0.1);
      display:inline-flex; align-items:center; gap:5px; white-space:nowrap; }
    .stat-tech-tag.gis    { background:rgba(179,136,255,0.15); color:#b388ff; border-color:rgba(179,136,255,0.3); }
    .stat-tech-tag.hgis   { background:rgba(24,255,255,0.1);   color:#18ffff; border-color:rgba(24,255,255,0.25); }
    .stat-tech-tag.ais    { background:rgba(0,200,255,0.1);    color:#00c8ff; border-color:rgba(0,200,255,0.25); }
    .stat-tech-tag.honhop { background:rgba(255,145,0,0.1);    color:#ff9100; border-color:rgba(255,145,0,0.3); }
    .stat-tech-tag.kck    { background:rgba(0,230,118,0.1);    color:#00e676; border-color:rgba(0,230,118,0.25); }
    .tech-cap-header {
      font-size:10px; font-family:var(--font-mono); font-weight:600; letter-spacing:.08em;
      color:var(--text-secondary); margin:8px 0 5px; width:100%;
      padding-bottom:4px; border-bottom:1px solid rgba(255,255,255,0.07);
      display:flex; align-items:center; gap:5px;
    }
    .tech-cap-header:first-child { margin-top:2px; }
    .tech-tag-grid { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:2px; }
    .tech-bar-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px 12px; margin-bottom:4px; }
    .tech-bar-item { display:flex; flex-direction:column; gap:3px; }
    .tech-bar-header { display:flex; justify-content:space-between; align-items:baseline; }
    .tech-bar-label { font-size:10px; font-family:var(--font-mono); font-weight:700; letter-spacing:.04em; }
    .tech-bar-label.ais    { color:#00c8ff; }
    .tech-bar-label.gis    { color:#b388ff; }
    .tech-bar-label.hgis   { color:#18ffff; }
    .tech-bar-label.honhop { color:#ff9100; }
    .tech-bar-label.kck    { color:#00e676; }
    .tech-bar-num { font-size:18px; font-weight:800; font-family:var(--font-mono); line-height:1; }
    .tech-bar-num.ais    { color:#00c8ff; }
    .tech-bar-num.gis    { color:#b388ff; }
    .tech-bar-num.hgis   { color:#18ffff; }
    .tech-bar-num.honhop { color:#ff9100; }
    .tech-bar-num.kck    { color:#00e676; }
    .tech-bar-track { width:100%; height:5px; background:rgba(255,255,255,0.07); border-radius:3px; overflow:hidden; }
    .tech-bar-fill { height:100%; border-radius:3px; transition:width .5s cubic-bezier(.4,0,.2,1); }
    .tech-bar-fill.ais    { background:#00c8ff; box-shadow:0 0 6px rgba(0,200,255,.5); }
    .tech-bar-fill.gis    { background:#b388ff; box-shadow:0 0 6px rgba(179,136,255,.5); }
    .tech-bar-fill.hgis   { background:#18ffff; box-shadow:0 0 6px rgba(24,255,255,.5); }
    .tech-bar-fill.honhop { background:#ff9100; box-shadow:0 0 6px rgba(255,145,0,.5); }
    .tech-bar-fill.kck    { background:#00e676; box-shadow:0 0 6px rgba(0,230,118,.5); }
    .tech-hv-select {
      font-size:10px; font-family:var(--font-mono); font-weight:600;
      background:var(--bg-elevated,#182030); border:1px solid rgba(0,200,255,0.4);
      color:#00c8ff; border-radius:4px; padding:2px 6px; cursor:pointer; outline:none;
    }
    /* ── Stat card ngăn — clickable ── */
    .stat-card-ngan {
      cursor: pointer;
      transition: border-color .18s, background .18s, transform .15s;
    }
    .stat-card-ngan:hover {
      border-color: rgba(0,200,255,0.4) !important;
      background: rgba(0,200,255,0.05);
      transform: translateY(-2px);
    }
    .stat-card-ngan.stat-card-active {
      border-color: rgba(0,200,255,0.7) !important;
      background: rgba(0,200,255,0.1);
      box-shadow: 0 0 0 1px rgba(0,200,255,0.4), 0 4px 16px rgba(0,0,0,0.3);
    }
    .stat-card-ngan.stat-card-active .stat-value { color: var(--accent) !important; }
    .stat-card-ngan.stat-card-active::after {
      content: '▼ đang lọc';
      display: block;
      font-size: 8px;
      color: var(--accent);
      font-family: var(--font-mono);
      margin-top: 3px;
      letter-spacing: .06em;
    }
    /* ── 2 CHIPS: Device card grid ── */
    .chips-header-row {
      display:flex; align-items:center; justify-content:space-between;
      margin-bottom:10px; flex-wrap:wrap; gap:8px;
    }
    .chips-reset-btn {
      display:inline-flex; align-items:center; gap:6px;
      padding:5px 12px; border-radius:6px; cursor:pointer;
      border:1px solid rgba(255,82,82,0.35); background:rgba(255,82,82,0.08);
      color:#ff5252; font-size:11px; font-weight:500; transition:all .15s;
    }
    .chips-reset-btn:hover { background:rgba(255,82,82,0.18); border-color:rgba(255,82,82,0.6); }
    .chips-reset-btn i { font-size:10px; }
    .chips-active-info {
      font-size:11px; color:var(--accent); font-family:var(--font-mono);
      background:rgba(0,200,255,0.08); border:1px solid rgba(0,200,255,0.2);
      border-radius:5px; padding:3px 10px; display:none;
    }
    .chips-active-info.visible { display:inline-flex; align-items:center; gap:6px; }
    /* Device card chips */
    .device-chips-grid {
      display:flex; flex-wrap:wrap; gap:8px;
    }
    .device-chip {
      display:flex; flex-direction:column; gap:4px;
      padding:8px 12px; border-radius:8px; cursor:pointer;
      border:1px solid rgba(255,255,255,0.08);
      background:rgba(255,255,255,0.03);
      transition:all .18s; min-width:100px; position:relative;
      user-select:none;
    }
    .device-chip:hover {
      background:rgba(0,200,255,0.07);
      border-color:rgba(0,200,255,0.3);
      transform:translateY(-1px);
      box-shadow:0 4px 16px rgba(0,0,0,0.3);
    }
    .device-chip.active {
      background:rgba(0,200,255,0.12);
      border-color:rgba(0,200,255,0.55);
      box-shadow:0 0 0 1px rgba(0,200,255,0.3), 0 4px 16px rgba(0,0,0,0.3);
    }
    .device-chip.active::after {
      content:'✓';
      position:absolute; top:4px; right:7px;
      font-size:9px; color:var(--accent); font-weight:700;
    }
    .device-chip-name {
      font-size:12px; font-weight:600;
      color:var(--text-primary); line-height:1.2;
    }
    .device-chip.active .device-chip-name { color:var(--accent); }
    .device-chip-count {
      font-size:16px; font-weight:800;
      font-family:var(--font-mono); color:var(--accent); line-height:1;
    }
    .device-chip-hang {
      font-size:9px; color:var(--text-muted);
      font-family:var(--font-mono); white-space:nowrap;
      overflow:hidden; text-overflow:ellipsis; max-width:130px;
    }
    .device-chip-total {
      font-size:10px; font-weight:400; opacity:0.45;
      font-family:var(--font-mono);
    }
    .hang-badge {
      font-size:10px; padding:2px 7px; border-radius:4px;
      background:rgba(0,200,255,0.1); color:var(--accent);
      border:1px solid rgba(0,200,255,0.2);
    }
    /* ── Chart filter row ── */
    .chart-filter-row {
      display:flex; align-items:center; gap:10px; flex-wrap:wrap;
      padding:8px 16px 10px; border-bottom:1px solid rgba(255,255,255,0.05);
    }
    .chart-filter-label { font-size:10px; color:var(--text-muted); font-family:var(--font-mono); }
    .chart-tram-select {
      font-size:10.5px; padding:5px 10px; border-radius:6px; cursor:pointer;
      border:1px solid rgba(0,200,255,0.3); background:var(--bg-elevated,#182030);
      color:var(--text-primary); font-family:var(--font-mono); min-width:220px;
      outline:none; transition:border-color .15s; max-width:380px;
    }
    .chart-tram-select:hover { border-color:rgba(0,200,255,0.6); }
    .chart-tram-select optgroup { color:var(--accent); font-size:9px; }
    .chart-reset-btn {
      font-size:10px; padding:5px 11px; border-radius:6px; cursor:pointer;
      border:1px solid rgba(255,82,82,0.3); background:rgba(255,82,82,0.08);
      color:#ff5252; font-family:var(--font-mono); transition:all .15s;
    }
    .chart-reset-btn:hover { background:rgba(255,82,82,0.18); border-color:rgba(255,82,82,0.6); }
    /* ── Heatmap ── */
    .heatmap-wrap { width:100%; overflow:auto; }
    .heatmap-table { border-collapse:collapse; width:100%; font-family:var(--font-mono); font-size:10px; }
    .heatmap-table thead { position:sticky; top:0; z-index:2; background:var(--bg-surface); }
    .heatmap-table tr:hover td { filter:brightness(1.18); }
    .hm-tram-th { text-align:left; padding:4px 8px; color:var(--text-muted); font-size:9px; font-weight:600;
      min-width:130px; position:sticky; left:0; background:var(--bg-surface); z-index:3; }
    .hm-tram-cell { font-size:9.5px; color:var(--text-secondary); padding:3px 8px; white-space:nowrap;
      position:sticky; left:0; background:var(--bg-base); z-index:1; border-right:1px solid rgba(255,255,255,0.06); }
    .hm-cell { text-align:center; padding:3px 5px; font-size:9px; font-weight:600;
      border:1px solid rgba(255,255,255,0.04); min-width:42px; cursor:default; }
    .hm-total-cell { text-align:right; padding:3px 8px; font-size:9.5px; font-weight:700;
      color:var(--text-secondary); border-left:1px solid rgba(255,255,255,0.08); }
  </style>
`;

const DASHBOARD_HTML = `
  ${STATS_EXTRA_CSS}
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

  <!-- 1 STATS: STAT CARDS -->
  <section class="stats-grid" id="statsGrid">
    <!-- Row 1: TBA tổng quan -->
    <div class="stat-card">
      <div class="stat-icon green"><i class="fas fa-building"></i></div>
      <div class="stat-info">
        <span class="stat-label">Tổng số TBA</span>
        <span class="stat-value" id="totalStations">—</span>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon orange"><i class="fas fa-industry"></i></div>
      <div class="stat-info">
        <span class="stat-label">TBA 220kV</span>
        <span class="stat-value" id="total220kV">—</span>
        <span class="stat-ratio" id="ratio220kV"></span>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon pink"><i class="fas fa-bolt"></i></div>
      <div class="stat-info">
        <span class="stat-label">TBA 110kV</span>
        <span class="stat-value" id="total110kV">—</span>
        <span class="stat-ratio" id="ratio110kV"></span>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon cyan"><i class="fas fa-microchip"></i></div>
      <div class="stat-info">
        <span class="stat-label">Tổng số thiết bị</span>
        <span class="stat-value" id="totalDevices">—</span>
      </div>
    </div>
    <!-- Row 2: Công nghệ TBA (span full) -->
    <div class="stat-card" style="grid-column:span 4">
      <div class="stat-icon purple"><i class="fas fa-network-wired"></i></div>
      <div class="stat-info" style="flex:1">
        <span class="stat-label">Công nghệ thiết bị TBA</span>
        <div id="techTBABox" style="margin-top:6px"></div>
      </div>
    </div>
    <!-- Row 3: Ngăn tổng quan + các ngăn chính -->
    <div class="stat-card">
      <div class="stat-icon purple"><i class="fas fa-layer-group"></i></div>
      <div class="stat-info">
        <span class="stat-label">Tổng số ngăn</span>
        <span class="stat-value" id="totalNgan">—</span>
      </div>
    </div>
    <div class="stat-card stat-card-ngan" data-ngan="Ngăn ĐZ" onclick="filterByLoaiNgan('Ngăn ĐZ')" title="Click để lọc ngăn đường dây">
      <div class="stat-icon teal"><i class="fas fa-route"></i></div>
      <div class="stat-info">
        <span class="stat-label">Ngăn đường dây</span>
        <span class="stat-value" id="nganDuongDay">—</span>
      </div>
    </div>
    <div class="stat-card stat-card-ngan" data-ngan="Ngăn MBA" onclick="filterByLoaiNgan('Ngăn MBA')" title="Click để lọc ngăn MBA">
      <div class="stat-icon yellow"><i class="fas fa-wrench"></i></div>
      <div class="stat-info">
        <span class="stat-label">Ngăn MBA</span>
        <span class="stat-value" id="nganMBA">—</span>
      </div>
    </div>
    <div class="stat-card stat-card-ngan" data-ngan="Ngăn XT" onclick="filterByLoaiNgan('Ngăn XT')" title="Click để lọc ngăn xuất tuyến">
      <div class="stat-icon pink"><i class="fas fa-sitemap"></i></div>
      <div class="stat-info">
        <span class="stat-label">Ngăn xuất tuyến (XT)</span>
        <span class="stat-value" id="nganXT">—</span>
      </div>
    </div>
    <!-- Row 4: Các ngăn phụ -->
    <div class="stat-card stat-card-ngan" data-ngan="Ngăn LL" onclick="filterByLoaiNgan('Ngăn LL')" title="Click để lọc ngăn liên lạc">
      <div class="stat-icon cyan2"><i class="fas fa-exchange-alt"></i></div>
      <div class="stat-info">
        <span class="stat-label">Ngăn liên lạc (LL)</span>
        <span class="stat-value" id="nganLL">—</span>
      </div>
    </div>
    <div class="stat-card stat-card-ngan" data-ngan="Ngăn TBN" onclick="filterByLoaiNgan('Ngăn TBN')" title="Click để lọc ngăn tụ bù">
      <div class="stat-icon green"><i class="fas fa-battery-half"></i></div>
      <div class="stat-info">
        <span class="stat-label">Ngăn tụ bù (TBN)</span>
        <span class="stat-value" id="nganTBN">—</span>
      </div>
    </div>
    <div class="stat-card stat-card-ngan" data-ngan="NgănTD" onclick="filterByLoaiNgan('NgănTD')" title="Click để lọc ngăn tự dùng">
      <div class="stat-icon orange"><i class="fas fa-plug"></i></div>
      <div class="stat-info">
        <span class="stat-label">Ngăn tự dùng (TD)</span>
        <span class="stat-value" id="nganTD">—</span>
      </div>
    </div>
    <div class="stat-card stat-card-ngan" data-ngan="Ngăn Kháng" onclick="filterByLoaiNgan('Ngăn Kháng')" title="Click để lọc ngăn kháng">
      <div class="stat-icon purple"><i class="fas fa-magnet"></i></div>
      <div class="stat-info">
        <span class="stat-label">Ngăn kháng</span>
        <span class="stat-value" id="nganKhang">—</span>
      </div>
    </div>
    <!-- Row 5: Tổng công suất -->
    <div class="stat-card" style="grid-column:span 4">
      <div class="stat-icon cyan2"><i class="fas fa-bolt"></i></div>
      <div class="stat-info">
        <span class="stat-label">Tổng công suất (MVA)</span>
        <span class="stat-value" id="tongCongSuat">—</span>
      </div>
    </div>
  </section>

  <!-- 2 CHIPS: Danh sách thiết bị -->
  <section class="section-block">
    <div class="section-header">
      <h2><i class="fas fa-microchip"></i> Danh sách thiết bị</h2>
      <span class="section-count" id="typeChipsCount"></span>
    </div>
    <div id="deviceByType"></div>
  </section>

  <!-- 3 CHARTS -->
  <section class="section-block" style="padding:0">
    <div class="section-header" style="padding:14px 16px 10px">
      <h2><i class="fas fa-chart-bar"></i> Số lượng thiết bị theo trạm</h2>
    </div>
    <!-- Filter: dropdown chọn trạm -->
    <div class="chart-filter-row">
      <span class="chart-filter-label"><i class="fas fa-search-location"></i> Trạm:</span>
      <select class="chart-tram-select" id="chartTramSelect" onchange="filterChartByTram(this.value)">
        <option value="">— Tất cả trạm —</option>
      </select>
      <button class="chart-reset-btn" onclick="filterChartByTram('')">
        <i class="fas fa-times"></i> Bỏ chọn
      </button>
      <span id="chartSubLabel" style="font-size:9px;color:var(--text-muted);font-family:var(--font-mono);margin-left:auto">
        220kV→110kV→35kV→22kV · hover để xem chi tiết
      </span>
    </div>
    <!-- Chart: bar trái rộng + pie phải -->
    <div style="display:grid;grid-template-columns:1fr 300px;gap:32px;padding:12px 16px 16px;align-items:start">
      <div id="deviceChartWrap" style="max-height:75vh;overflow-y:auto;overflow-x:hidden">
        <canvas id="deviceChart"></canvas>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;padding-top:4px">
        <div style="font-size:10px;font-weight:600;color:var(--text-secondary)">
          <i class="fas fa-chart-pie" style="color:var(--accent)"></i>
          Tỷ lệ phân loại thiết bị
          <span id="pieChartTramLabel" style="font-size:9px;font-weight:400;color:var(--accent);margin-left:6px"></span>
        </div>
        <div style="height:500px">
          <canvas id="typeChart"></canvas>
        </div>
      </div>
    </div>
  </section>

  <!-- 4 TIMELINE: Năm sản xuất & Năm vận hành -->
  <section class="section-block">
    <div class="section-header">
      <h2><i class="fas fa-calendar-alt"></i> Năm sản xuất &amp; Năm vận hành</h2>
      <span class="section-sub">Phân bố số lượng thiết bị theo năm</span>
    </div>
    <div class="chart-wrapper" style="height:220px">
      <canvas id="tnTimelineChart"></canvas>
    </div>
  </section>

  <!-- 5 TABLE: Danh sách thiết bị -->
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
            <th onclick="sortTable(1)">Tên thiết bị <i class="fas fa-sort"></i></th>
            <th onclick="sortTable(2)">Hãng sản xuất <i class="fas fa-sort"></i></th>
            <th onclick="sortTable(3)">Kiểu <i class="fas fa-sort"></i></th>
            <th onclick="sortTable(4)">Thông số <i class="fas fa-sort"></i></th>
            <th onclick="sortTable(5)">Lý lịch <i class="fas fa-sort"></i></th>
          </tr>
        </thead>
        <tbody id="dashboard-tbody">
          <tr><td colspan="6" class="no-data">Đang tải...</td></tr>
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
    // Inject extra CSS once
    if (!document.getElementById('statsExtraCSS')) {
      document.head.insertAdjacentHTML('beforeend', STATS_EXTRA_CSS);
    }
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
        '<tr><td colspan="6" class="no-data">Không thể tải dữ liệu. Kiểm tra kết nối Supabase.</td></tr>';
      return;
    }

    allData = data;
    filteredData = [...allData];

    populateFilters(allData);
    renderStats(allData);
    renderTypeChips();
    selectedChartTram = '';
    populateChartTramSelect(allData);
    // Đợi DOM render xong để wrap có clientWidth trước khi vẽ chart
    setTimeout(() => {
      renderBarChart(allData);
      renderPieChart(allData);
    }, 50);
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
  // ── THIẾT BỊ ─────────────────────────────────
  MBA: {
    title: 'Máy biến áp',
    sub:   'MBA — Danh sách, thông số kỹ thuật và lý lịch',
    render: () => appRenderThietBi('MBA')
  },
  MC: {
    title: 'Máy cắt (MC)',
    sub:   'MC, GIS, HGIS — Danh sách, thông số và lý lịch',
    render: () => appRenderThietBi('MC')
  },
  DCL: {
    title: 'Dao cách ly & FCO',
    sub:   'DCL, FCO — Danh sách, thông số và lý lịch',
    render: () => appRenderThietBi('DCL')
  },
  TUTI: {
    title: 'TU, TI đo lường',
    sub:   'TU, TI, TIO — Danh sách, thông số và lý lịch',
    render: () => appRenderThietBi('TUTI')
  },
  CSV: {
    title: 'Chống sét van (CSV)',
    sub:   'CSV — Danh sách, thông số và lý lịch',
    render: () => appRenderThietBi('CSV')
  },
  CAP: {
    title: 'Cáp điện lực',
    sub:   'Cáp — Danh sách, thông số và lý lịch',
    render: () => appRenderThietBi('CAP')
  },
  // ── THÍ NGHIỆM ───────────────────────────────
  TNDK: {
    title: 'Thí nghiệm định kỳ (TNĐK)',
    sub:   'Theo dõi kế hoạch và kết quả thí nghiệm định kỳ',
    render: () => appRenderTN('TNDK')
  },
  TNDX: {
    title: 'Thí nghiệm đột xuất (TNĐX)',
    sub:   'Theo dõi thí nghiệm đột xuất phát sinh',
    render: () => appRenderTN('TNDX')
  },
  // ── GIỮ NGUYÊN PAGES CŨ ──────────────────────
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
    render: () => appRenderThietBi('MC')
  },
  suco: {
    title: 'Sự cố',
    sub:   'Quản lý và theo dõi sự cố',
    render: () => renderPlaceholder('suco')
  },
  kehoachtn: {
    title: 'Kế hoạch TN',
    sub:   'Lập và theo dõi kế hoạch thử nghiệm',
    render: () => appRenderTN('TNDK')
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

// ══════════════════════════════════════════════════════════════
// ── MODULE THIẾT BỊ (đồng bộ với layout-editor-evn_c.html) ───
// ══════════════════════════════════════════════════════════════
const APP_TB_CONF = {
  MBA:  { matchFn: r=>{ const pl=(r.Phan_loai_thiet_bi||'').trim().toUpperCase().replace(/\s+/g,''); return pl.startsWith('MBA'); },
          label:'Máy biến áp (MBA)', icon:'fa-exchange-alt', color:'#10b981',
          dropdowns:['tram','cap','type','hang','kieu','cong_suat','year','opyr'] },
  MC:   { matchFn: r=>{ const pl=(r.Phan_loai_thiet_bi||'').trim().toUpperCase().replace(/\s+/g,''); return pl==='MC'||pl.startsWith('MC')||pl==='GIS'||pl==='HGIS'||pl.startsWith('GIS')||pl.startsWith('HGIS'); },
          label:'Máy cắt (MC)', icon:'fa-bolt', color:'#f59e0b',
          dropdowns:['tram','cap','type','hang','kieu','cong_suat','year','opyr'] },
  DCL:  { matchFn: r=>{ const pl=(r.Phan_loai_thiet_bi||'').trim().toUpperCase().replace(/\s+/g,''); return pl.startsWith('DCL')||pl.startsWith('DAOCACHLY')||pl==='FCO'||pl.startsWith('FCO'); },
          label:'DCL & FCO', icon:'fa-power-off', color:'#00c8ff',
          dropdowns:['tram','cap','type','hang','kieu','year','opyr'] },
  TUTI: { matchFn: r=>{ const pl=(r.Phan_loai_thiet_bi||'').trim().toUpperCase().replace(/\s+/g,''); return pl.startsWith('TU')||pl.startsWith('TI'); },
          label:'TU, TI đo lường', icon:'fa-tachometer-alt', color:'#8b5cf6',
          dropdowns:['tram','cap','type','hang','kieu','year','opyr'] },
  CSV:  { matchFn: r=>{ const pl=(r.Phan_loai_thiet_bi||'').trim().toUpperCase().replace(/\s+/g,''); return pl==='CSV'||pl.startsWith('CSV'); },
          label:'Chống sét van (CSV)', icon:'fa-shield-alt', color:'#ec4899',
          dropdowns:['tram','cap','hang','kieu','year','opyr'] },
  CAP:  { matchFn: r=>{ const pl=(r.Phan_loai_thiet_bi||'').trim().normalize('NFC'); return /^[Cc][aáà]/u.test(pl)||pl.toUpperCase().startsWith('CAP'); },
          label:'Cáp điện lực', icon:'fa-project-diagram', color:'#06b6d4',
          dropdowns:['tram','cap','type','hang','kieu','year','opyr'] },
};

const APP_CAP_LBL = {'2':'220kV','1':'110kV','3':'35kV','4':'22kV','9':'10kV','6':'6kV','0':'TT'};
const APP_CAP_COL = {'2':'#1565c0','1':'#18ffff','3':'#00e676','4':'#e040fb','9':'#00e676','6':'#00e676','0':'#18ffff'};
const APP_CAP_PRIO= {'2':0,'1':1,'3':2,'4':3,'9':4,'6':5,'0':6};

function _appAge(r){const y=Number(r.Nam_van_hanh)>1970?Number(r.Nam_van_hanh):(Number(r.Nam_san_xuat)>1970?Number(r.Nam_san_xuat):0);return y>1970?new Date().getFullYear()-y:-1;}
function _appCapBadge(cap){const c=String(cap??'');return `<span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:9px;font-weight:700;background:${(APP_CAP_COL[c]||'#888')}22;color:${APP_CAP_COL[c]||'#888'}">${APP_CAP_LBL[c]||c||'—'}</span>`;}

// App-level TB state
let _appTbData=[], _appTbFiltered=[], _appTbPage=1, _appTbSort='Tram', _appTbAsc=true;
let _appTbQ='', _appTbFCap='', _appTbFType='', _appTbFTram='', _appTbFHang='', _appTbFKieu='', _appTbFYear='', _appTbFOpyr='';
const APP_TB_PS=50;

function _appTbApply(data){
  const q=_appTbQ.toLowerCase().trim();
  _appTbFiltered=data.filter(r=>{
    if(_appTbFCap  && String(r.Cap_dien_ap??'')!==_appTbFCap)return false;
    if(_appTbFType && (r.Phan_loai_thiet_bi||'').trim()!==_appTbFType)return false;
    if(_appTbFTram && (r.Tram||'').trim()!==_appTbFTram)return false;
    if(_appTbFHang && (r.Hang_san_xuat||'').trim()!==_appTbFHang)return false;
    if(_appTbFKieu && (r.Kieu||'').trim()!==_appTbFKieu)return false;
    if(_appTbFYear && String(r.Nam_san_xuat||'')!==_appTbFYear)return false;
    if(_appTbFOpyr && String(r.Nam_van_hanh||'')!==_appTbFOpyr)return false;
    if(q){const h=[r.Tram,r.Phan_loai_thiet_bi,r.Ten_thiet_bi,r.Ngan_thiet_bi,r.Hang_san_xuat].map(v=>v||'').join(' ').toLowerCase();if(!h.includes(q))return false;}
    return true;
  });
  _appTbFiltered.sort((a,b)=>{
    let va=_appTbSort==='_age'?_appAge(a):(a[_appTbSort]??''),vb=_appTbSort==='_age'?_appAge(b):(b[_appTbSort]??'');
    if(typeof va==='number'&&typeof vb==='number')return _appTbAsc?va-vb:vb-va;
    va=String(va).toLowerCase();vb=String(vb).toLowerCase();return _appTbAsc?va.localeCompare(vb,'vi'):vb.localeCompare(va,'vi');
  });
  _appTbPage=1;
}

function _appTbExportCSV(rows){
  const hdr='Trạm,Cấp ĐA,Loại TB,Tên/Ký hiệu,Kiểu,Ngăn TB,SL,Hãng SX,Năm SX,Năm VH,Thâm niên,CS(MVA),Lý lịch,Thông số,Đội';
  const body=rows.map(r=>{const age=_appAge(r);return[r.Tram,APP_CAP_LBL[String(r.Cap_dien_ap??'')]||r.Cap_dien_ap,r.Phan_loai_thiet_bi,r.Ten_thiet_bi,r.Kieu,r.Ngan_thiet_bi,r.So_luong,r.Hang_san_xuat,r.Nam_san_xuat,r.Nam_van_hanh,age>=0?age:'',r.Cong_suat,r.Ly_lich,r.Thong_so,r.Doi].map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(',');}).join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\uFEFF'+hdr+'\n'+body],{type:'text/csv;charset=utf-8'}));a.download=`EVN_ThietBi_${new Date().toISOString().slice(0,10)}.csv`;a.click();
}

function _appTbTable(data,conf){
  const fmt=n=>Number(n).toLocaleString('vi-VN');
  const start=(_appTbPage-1)*APP_TB_PS,rows=_appTbFiltered.slice(start,start+APP_TB_PS),tot=_appTbFiltered.length,totPg=Math.max(1,Math.ceil(tot/APP_TB_PS));
  const COLS=[{k:'Tram',l:'Trạm',w:'110px'},{k:'Cap_dien_ap',l:'Cấp ĐA',w:'68px'},{k:'Phan_loai_thiet_bi',l:'Loại TB',w:'90px'},{k:'Ten_thiet_bi',l:'Tên/KH',w:'140px'},{k:'Kieu',l:'Kiểu',w:'80px'},{k:'Ngan_thiet_bi',l:'Ngăn TB',w:'120px'},{k:'So_luong',l:'SL',w:'46px',num:1},{k:'Hang_san_xuat',l:'Hãng SX',w:'90px'},{k:'Nam_san_xuat',l:'Năm SX',w:'58px',num:1},{k:'Nam_van_hanh',l:'Năm VH',w:'58px',num:1},{k:'_age',l:'Thâm niên',w:'72px',num:1},{k:'Cong_suat',l:'CS(MVA)',w:'68px',num:1},{k:'Ly_lich',l:'Lý lịch',w:'80px'},{k:'Thong_so',l:'Thông số',w:'100px'},{k:'Doi',l:'Đội',w:'48px',num:1}];
  const thead=COLS.map(c=>{const s=_appTbSort===c.k;return `<th style="padding:7px 10px;font-size:9px;font-weight:700;color:${s?'var(--accent)':'var(--text-muted)'};letter-spacing:.06em;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,.1);cursor:pointer;white-space:nowrap;background:rgba(255,255,255,.03);user-select:none;min-width:${c.w};text-align:${c.num?'right':'left'}" onclick="_appTbSort2('${c.k}')">${c.l}${s?`<span style="color:var(--accent)"> ${_appTbAsc?'↑':'↓'}</span>`:''}</th>`;}).join('');
  const tbody=rows.map(r=>{const age=_appAge(r);const ac=age<0?'#888':age<10?'#00e676':age<15?'#ffd740':'#ff5252';const ll=r.Ly_lich?`<span onclick="_appTbLyLich(this)" data-idx="${_appTbFiltered.indexOf(r)}" style="display:inline-flex;align-items:center;gap:4px;font-size:9px;padding:2px 7px;border-radius:6px;background:rgba(16,185,129,.1);color:#10b981;border:1px solid rgba(16,185,129,.25);cursor:pointer"><i class="fas fa-file-alt"></i>Xem</span>`:'<span style="color:var(--text-muted);font-size:9px">—</span>';return `<tr style="border-bottom:1px solid rgba(255,255,255,.04)"><td style="padding:6px 10px;font-weight:600">${r.Tram||'—'}</td><td style="padding:6px 10px">${_appCapBadge(r.Cap_dien_ap)}</td><td style="padding:6px 10px">${r.Phan_loai_thiet_bi||'—'}</td><td style="padding:6px 10px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.Ten_thiet_bi||''}">${r.Ten_thiet_bi||'—'}</td><td style="padding:6px 10px">${r.Kieu||'—'}</td><td style="padding:6px 10px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.Ngan_thiet_bi||''}">${r.Ngan_thiet_bi||'—'}</td><td style="padding:6px 10px;text-align:right;font-family:var(--font-mono)">${r.So_luong??'—'}</td><td style="padding:6px 10px">${r.Hang_san_xuat||'—'}</td><td style="padding:6px 10px;text-align:right;font-family:var(--font-mono)">${r.Nam_san_xuat||'—'}</td><td style="padding:6px 10px;text-align:right;font-family:var(--font-mono)">${r.Nam_van_hanh||'—'}</td><td style="padding:6px 10px;text-align:right;font-weight:700;font-family:var(--font-mono);color:${ac}">${age>=0?age+'n':'—'}</td><td style="padding:6px 10px;text-align:right;font-family:var(--font-mono)">${r.Cong_suat||'—'}</td><td style="padding:6px 10px">${ll}</td><td style="padding:6px 10px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.Thong_so||''}">${r.Thong_so?r.Thong_so.slice(0,30)+(r.Thong_so.length>30?'…':''):'—'}</td><td style="padding:6px 10px;text-align:right;font-family:var(--font-mono)">${r.Doi||'—'}</td></tr>`;}).join('');
  // Pagination
  const half=3;let lo=Math.max(1,_appTbPage-half),hi=Math.min(totPg,lo+6);if(hi-lo<6)lo=Math.max(1,hi-6);
  let pg='';if(lo>1)pg+=`<button class="app-pg-btn" onclick="_appTbGo(1)">1</button>${lo>2?'…':''}`;for(let p=lo;p<=hi;p++)pg+=`<button class="app-pg-btn${p===_appTbPage?' cur':''}" onclick="_appTbGo(${p})">${p}</button>`;if(hi<totPg)pg+=`${hi<totPg-1?'…':''}<button class="app-pg-btn" onclick="_appTbGo(${totPg})">${totPg}</button>`;
  return `<div style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono);padding:0 0 10px">Hiển thị <b style="color:var(--accent)">${start+1}–${Math.min(start+APP_TB_PS,tot)}</b>/<b style="color:var(--accent)">${fmt(tot)}</b> bản ghi</div><div style="overflow-x:auto;border-radius:8px;border:1px solid rgba(255,255,255,.07)"><table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr>${thead}</tr></thead><tbody>${tbody||'<tr><td colspan="15" style="padding:30px;text-align:center;color:var(--text-muted)">Không có dữ liệu</td></tr>'}</tbody></table></div><div style="display:flex;align-items:center;gap:6px;justify-content:flex-end;padding:10px 0 0"><button class="app-pg-btn" ${_appTbPage<=1?'disabled':''} onclick="_appTbGo(${_appTbPage-1})">‹</button>${pg}<button class="app-pg-btn" ${_appTbPage>=totPg?'disabled':''} onclick="_appTbGo(${_appTbPage+1})">›</button></div>`;
}

function _appTbSort2(c){if(_appTbSort===c)_appTbAsc=!_appTbAsc;else{_appTbSort=c;_appTbAsc=true;}_appTbApply(window._appTbAllData||[]);_appTbDraw();}
function _appTbGo(p){const t=Math.max(1,Math.ceil(_appTbFiltered.length/APP_TB_PS));_appTbPage=Math.max(1,Math.min(p,t));_appTbDraw();}
function _appTbDraw(){const el=document.getElementById('_appTbArea');if(el)el.innerHTML=_appTbTable();}

function _appTbLyLich(btn){
  const idx=parseInt(btn.dataset.idx);
  const r=_appTbFiltered[idx];if(!r)return;
  const age=_appAge(r);const cap=String(r.Cap_dien_ap??'');
  let p=document.getElementById('_appLyLichPanel');
  if(!p){p=document.createElement('div');p.id='_appLyLichPanel';p.style.cssText='position:fixed;top:0;right:-420px;width:400px;height:100vh;z-index:9999;background:var(--bg-surface,#161b22);border-left:1px solid rgba(255,255,255,.12);display:flex;flex-direction:column;transition:right .25s;overflow-y:auto;box-sizing:border-box';document.body.appendChild(p);const bd=document.createElement('div');bd.id='_appLyLichBd';bd.style.cssText='position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.4);display:none';bd.onclick=()=>{p.style.right='-420px';bd.style.display='none'};document.body.appendChild(bd);}
  p.innerHTML=`<div style="padding:16px 20px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;justify-content:space-between;align-items:flex-start"><div><div style="font-size:13px;font-weight:800;color:var(--text-primary)">${r.Ten_thiet_bi||r.Phan_loai_thiet_bi||'—'}</div><div style="font-size:10px;color:var(--accent);margin-top:3px">${r.Tram||''} · <span style="color:${APP_CAP_COL[cap]||'#888'}">${APP_CAP_LBL[cap]||cap||'—'}</span></div></div><button onclick="document.getElementById('_appLyLichPanel').style.right='-420px';document.getElementById('_appLyLichBd').style.display='none'" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px;padding:4px">✕</button></div><div style="padding:14px 20px;flex:1;overflow-y:auto"><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">${[['Loại thiết bị',r.Phan_loai_thiet_bi,'#00c8ff'],['Kiểu',r.Kieu,'#06b6d4'],['Số lượng',r.So_luong??'—','#00e676'],['Hãng sản xuất',r.Hang_san_xuat,'#ffd740'],['Năm sản xuất',r.Nam_san_xuat,'#ffd740'],['Năm vận hành',r.Nam_van_hanh,'#00c8ff'],['Thâm niên',age>=0?age+' năm':'—',age>=15?'#ff5252':age>=10?'#ffd740':'#00e676'],['CS (MVA)',r.Cong_suat,'#b388ff'],['Ngăn TB',r.Ngan_thiet_bi,'#888'],['Đội',r.Doi,'#888']].map(([l,v,col])=>`<div style="background:rgba(255,255,255,.04);border-radius:7px;padding:8px 10px;border:1px solid rgba(255,255,255,.07)"><div style="font-size:8.5px;color:var(--text-muted);margin-bottom:3px">${l}</div><div style="font-size:12px;font-weight:700;color:${col}">${v||'—'}</div></div>`).join('')}</div>${r.Thong_so?`<div style="margin-bottom:12px"><div style="font-size:9px;color:var(--text-muted);margin-bottom:5px;font-weight:700">THÔNG SỐ KỸ THUẬT</div><div style="font-size:10px;padding:8px 10px;background:rgba(255,255,255,.04);border-radius:6px;white-space:pre-wrap;line-height:1.6">${r.Thong_so}</div></div>`:''}${r.Ly_lich?`<div style="margin-bottom:12px"><div style="font-size:9px;color:var(--text-muted);margin-bottom:5px;font-weight:700">LÝ LỊCH THIẾT BỊ</div><div style="font-size:10px;padding:8px 10px;background:rgba(255,255,255,.04);border-radius:6px;white-space:pre-wrap;line-height:1.6">${r.Ly_lich}</div></div>`:`<div style="font-size:10px;color:var(--text-muted);padding:16px 0;text-align:center">Chưa có lý lịch thiết bị</div>`}</div>`;
  p.style.right='0';document.getElementById('_appLyLichBd').style.display='block';
}

function appRenderThietBi(confKey){
  const conf=APP_TB_CONF[confKey];if(!conf)return;
  window._appTbAllData=[];
  _appTbQ=_appTbFCap=_appTbFType=_appTbFTram=_appTbFHang=_appTbFKieu=_appTbFYear=_appTbFOpyr='';
  _appTbSort='Tram';_appTbAsc=true;
  const mainEl=document.getElementById('mainSections');if(!mainEl)return;

  // Inject pagination CSS once
  if(!document.getElementById('app-tb-css')){const s=document.createElement('style');s.id='app-tb-css';s.textContent='.app-pg-btn{padding:4px 9px;border-radius:6px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:var(--text-primary);cursor:pointer;font-size:10px;transition:background .15s}.app-pg-btn:hover:not(:disabled){background:rgba(255,255,255,.1)}.app-pg-btn:disabled{opacity:.35;cursor:default}.app-pg-btn.cur{background:rgba(0,200,255,.15);border-color:var(--accent);color:var(--accent)}.app-dd-trigger{display:inline-flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 10px;border-radius:6px;border:1px solid rgba(0,200,255,.4);background:var(--bg-elevated,#161b22);color:var(--text-primary);font-family:var(--font-mono);font-size:11px;cursor:pointer;outline:none;min-width:120px;white-space:nowrap;transition:border-color .15s}';document.head.appendChild(s);}

  mainEl.innerHTML=`<div style="padding:0 0 32px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
      <div style="width:34px;height:34px;border-radius:8px;background:${conf.color}22;color:${conf.color};display:flex;align-items:center;justify-content:center"><i class="fas ${conf.icon}" style="font-size:15px"></i></div>
      <div><div style="font-size:16px;font-weight:800;color:var(--text-primary)">${conf.label}</div><div style="font-size:10px;color:var(--text-muted)">Dữ liệu trực tiếp từ Supabase · ${new Date().toLocaleDateString('vi-VN')}</div></div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:0 0 12px;border-bottom:1px solid rgba(255,255,255,.07);margin-bottom:12px">
      <div style="position:relative;flex:1;min-width:180px;max-width:300px">
        <i class="fas fa-search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--text-muted);font-size:10px;pointer-events:none"></i>
        <input id="_appTbSearch" type="text" placeholder="🔍 Tìm trạm, tên TB, ngăn, hãng..."
          style="width:100%;box-sizing:border-box;padding:6px 10px 6px 30px;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.05);color:var(--text-primary);font-size:11px;outline:none;font-family:var(--font-mono)"
          oninput="_appTbSearch2(this.value,${JSON.stringify(confKey)})">
      </div>
      <div id="_appTbDdBtns" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"></div>
      <button onclick="_appTbResetFilters(${JSON.stringify(confKey)})" style="padding:5px 11px;border-radius:6px;border:1px solid rgba(255,82,82,.3);background:rgba(255,82,82,.1);color:#ff5252;font-size:10px;cursor:pointer;display:inline-flex;align-items:center;gap:5px"><i class="fas fa-times"></i> Xóa lọc</button>
      <button onclick="_appTbExportCSV(_appTbFiltered)" style="padding:5px 11px;border-radius:6px;border:1px solid rgba(0,230,118,.3);background:rgba(0,230,118,.1);color:#00e676;font-size:10px;cursor:pointer;display:inline-flex;align-items:center;gap:5px"><i class="fas fa-download"></i> CSV</button>
    </div>
    <div id="_appTbArea"><div style="padding:50px;text-align:center;color:var(--text-muted)"><i class="fas fa-spinner fa-spin" style="color:var(--accent);margin-right:8px"></i>Đang tải...</div></div>
  </div>`;

  const doLoad=src=>{
    window._appTbAllData=src.filter(r=>conf.matchFn(r));
    _appTbApply(window._appTbAllData);
    const sVi=(a,b)=>a.localeCompare(b,'vi');
    const sNum=(a,b)=>Number(b)-Number(a);
    const cpPrio={'2':0,'1':1,'3':2,'4':3,'9':4,'6':5,'0':6};
    const trA=[...new Set(window._appTbAllData.map(r=>(r.Tram||'').trim()).filter(Boolean))].sort(sVi);
    const tyA=[...new Set(window._appTbAllData.map(r=>(r.Phan_loai_thiet_bi||'').trim()).filter(Boolean))].sort(sVi);
    const hA=[...new Set(window._appTbAllData.map(r=>(r.Hang_san_xuat||'').trim()).filter(Boolean))].sort(sVi);
    const kA=[...new Set(window._appTbAllData.map(r=>(r.Kieu||'').trim()).filter(Boolean))].sort(sVi);
    const yA=[...new Set(window._appTbAllData.map(r=>String(r.Nam_san_xuat||'')).filter(y=>y&&y!=='null'&&y!=='0'))].sort(sNum);
    const oA=[...new Set(window._appTbAllData.map(r=>String(r.Nam_van_hanh||'')).filter(y=>y&&y!=='null'&&y!=='0'))].sort(sNum);
    const cA=[...new Set(window._appTbAllData.map(r=>String(r.Cap_dien_ap??'')).filter(c=>c&&c!=='null'))].sort((a,b)=>(cpPrio[a]??9)-(cpPrio[b]??9));
    const fc=document.getElementById('_appTbDdBtns');
    if(fc){fc.innerHTML='';
      const mkDD=(key,dflt,items)=>{const btn=document.createElement('button');btn.className='app-dd-trigger';const lbl=document.createElement('span');lbl.textContent=dflt;lbl.dataset.default=dflt;const ico=document.createElement('i');ico.className='fas fa-chevron-down';ico.style.cssText='font-size:8px;color:var(--text-muted)';btn.appendChild(lbl);btn.appendChild(ico);let oc;btn.onclick=e=>{e.stopPropagation();const ex=document.getElementById('_appTbDdList');if(ex){if(ex.dataset.key===key){ex.remove();return;}ex.remove();}const list=document.createElement('div');list.id='_appTbDdList';list.dataset.key=key;list.style.cssText='position:fixed;z-index:9999;background:var(--bg-surface,#161b22);border:1px solid rgba(255,255,255,.12);border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,.5);min-width:180px;max-height:320px;overflow-y:auto;flex-direction:column;padding:4px 0;display:flex';if(['tram','type'].includes(key)){const si=document.createElement('input');si.type='text';si.placeholder='🔍 Tìm...';si.style.cssText='margin:6px 8px;padding:4px 8px;border-radius:5px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:var(--text-primary);font-size:10px;outline:none';si.oninput=ev=>{const q=ev.target.value.toLowerCase();list.querySelectorAll('.app-dd-item').forEach(el=>{el.style.display=el.textContent.toLowerCase().includes(q)?'':'none';});};si.onclick=ev=>ev.stopPropagation();list.appendChild(si);}const mkI=(v,l)=>{const d=document.createElement('div');d.className='app-dd-item';d.style.cssText='padding:6px 14px;cursor:pointer;font-size:11px;color:var(--text-primary);white-space:nowrap;transition:background .1s';d.textContent=l;d.onmouseenter=()=>{d.style.background='rgba(255,255,255,.06)';};d.onmouseleave=()=>{d.style.background='';};d.onclick=()=>{if(key==='tram')_appTbFTram=v;else if(key==='cap')_appTbFCap=v;else if(key==='type')_appTbFType=v;else if(key==='hang')_appTbFHang=v;else if(key==='kieu')_appTbFKieu=v;else if(key==='year')_appTbFYear=v;else if(key==='opyr')_appTbFOpyr=v;lbl.textContent=v?l:dflt;btn.style.borderColor=v?'var(--accent)':'rgba(0,200,255,.4)';btn.style.background=v?'rgba(0,200,255,.08)':'';btn.style.color=v?'var(--accent)':'';ico.style.color=v?'var(--accent)':'var(--text-muted)';_appTbApply(window._appTbAllData);_appTbDraw();list.remove();document.removeEventListener('click',oc);};list.appendChild(d);};mkI('',dflt);items.forEach(it=>typeof it==='object'?mkI(it.v,it.l):mkI(it,it));document.body.appendChild(list);const r=btn.getBoundingClientRect();list.style.top=(r.bottom+4)+'px';list.style.left=r.left+'px';const si=list.querySelector('input');if(si)setTimeout(()=>si.focus(),30);oc=ev=>{if(!list.contains(ev.target)&&ev.target!==btn){list.remove();document.removeEventListener('click',oc);}};setTimeout(()=>document.addEventListener('click',oc),0);};return btn;};
      const dd=conf.dropdowns||[];
      if(dd.includes('tram')) fc.appendChild(mkDD('tram',`— Tất cả trạm (${trA.length}) —`,trA));
      if(dd.includes('cap'))  fc.appendChild(mkDD('cap','Cấp điện áp',cA.map(c=>({v:c,l:APP_CAP_LBL[c]||c}))));
      if(dd.includes('type')&&tyA.length>1) fc.appendChild(mkDD('type','Loại thiết bị',tyA));
      if(dd.includes('hang')&&hA.length>0) fc.appendChild(mkDD('hang','Hãng sản xuất',hA));
      if(dd.includes('kieu')&&kA.length>0) fc.appendChild(mkDD('kieu','Kiểu',kA));
      if(dd.includes('year')&&yA.length>0) fc.appendChild(mkDD('year','Năm SX',yA));
      if(dd.includes('opyr')&&oA.length>0) fc.appendChild(mkDD('opyr','Năm vận hành',oA));
    }
    _appTbDraw();
  };
  if(allData&&allData.length>0) doLoad(allData);
  else fetchData().then(d=>{if(d){allData=d;doLoad(d);}});
}

function _appTbSearch2(v,key){_appTbQ=v||'';_appTbApply(window._appTbAllData||[]);_appTbDraw();}
function _appTbResetFilters(key){_appTbQ=_appTbFCap=_appTbFType=_appTbFTram=_appTbFHang=_appTbFKieu=_appTbFYear=_appTbFOpyr='';const si=document.getElementById('_appTbSearch');if(si)si.value='';document.querySelectorAll('.app-dd-trigger span').forEach(el=>{el.textContent=el.dataset.default||el.textContent;});document.querySelectorAll('.app-dd-trigger').forEach(el=>{el.style.borderColor='rgba(0,200,255,.4)';el.style.background='';el.style.color='';el.querySelector('i').style.color='var(--text-muted)';});_appTbApply(window._appTbAllData||[]);_appTbDraw();}



// ── MODULE THÍ NGHIỆM (đồng bộ HTML) ──────────────────────────

// ══════════════════════════════════════════════════════════════
// ── MODULE THÍ NGHIỆM ĐỊNH KỲ — CongTacThiNghiem ─────────────
// Cảnh báo dựa trên Thoi_gian_thi_nghiem_tiep_theo + Han_thi_nghiem
// ══════════════════════════════════════════════════════════════

const _TN_TABLE     = 'CongTacThiNghiem';
const _TN_SB_URL    = 'https://xqqmfmljwycpehfyknoy.supabase.co';
const _TN_SB_KEY    = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhxcW1mbWxqd3ljcGVoZnlrbm95Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyODM4MDQsImV4cCI6MjA4Nzg1OTgwNH0.J_z0cFqq_Yet-n2X2L_VREdkcAqbkRFpYUp-ti3Fukc';
const _TN_WARN_DAYS = 30;
const _TN_CACHE_KEY = 'evn_tn_cache_v2';
const _TN_CACHE_TTL = 15 * 60 * 1000;

// Nav map
const _tnNavMap = {
  'TNĐK định kỳ':        { mode:'dinhky',  label:'Thí nghiệm định kỳ (TNĐK)',  icon:'fa-calendar-check', color:'#00c8ff' },
  'Thí nghiệm đột xuất': { mode:'dotxuat', label:'Thí nghiệm đột xuất (TNĐX)', icon:'fa-bolt',           color:'#f59e0b' },
};

const _tnCapLbl = {'2':'220kV','1':'110kV','3':'35kV','4':'22kV','9':'10kV','6':'6kV','0':'TT'};
const _tnCapCol = {'2':'#1565c0','1':'#18ffff','3':'#00e676','4':'#e040fb','9':'#00e676','6':'#00e676','0':'#18ffff'};

// ── ALERT LOGIC ───────────────────────────────────────────────
// Logic:
// 1. Quá hạn     : Thoi_gian_thi_nghiem_tiep_theo < today
// 2. Sắp đến hạn : today ≤ Thoi_gian_thi_nghiem_tiep_theo ≤ today + 30 ngày
// 3. Đặt sớm     : (Thoi_gian_thi_nghiem_tiep_theo - Thoi_gian_thi_nghiem_truoc) < Han_thi_nghiem * 0.85
// 4. Đặt muộn    : (Thoi_gian_thi_nghiem_tiep_theo - Thoi_gian_thi_nghiem_truoc) > Han_thi_nghiem * 1.15
// CSV: bỏ qua tất cả cảnh báo

function _tnIsCSV(row) {
  const pl = (row.Phan_loai_thiet_bi||'').trim().toUpperCase().replace(/\s+/g,'');
  return pl === 'CSV' || pl.startsWith('CSV');
}

function _tnAlertStatus(row) {
  if (_tnIsCSV(row)) return { level:'none', label:'CSV', color:'' };

  const today  = new Date(); today.setHours(0,0,0,0);
  const ms     = 86400000;

  // Ngày TN tiếp theo
  const tiepTheo = row.Thoi_gian_thi_nghiem_tiep_theo
    ? new Date(row.Thoi_gian_thi_nghiem_tiep_theo) : null;
  if (tiepTheo) tiepTheo.setHours(0,0,0,0);

  // Ngày TN trước đó
  const truocDo = row.Thoi_gian_thi_nghiem_truoc
    ? new Date(row.Thoi_gian_thi_nghiem_truoc) : null;
  if (truocDo) truocDo.setHours(0,0,0,0);

  // Hạn thí nghiệm (ngày)
  // Han_thi_nghiem tính bằng NĂM → chuyển sang ngày
  const hanNam = Number(row.Han_thi_nghiem) || 0;
  const hanTN  = hanNam * 365;

  // Không có ngày tiếp theo
  if (!tiepTheo) return { level:'info', label:'Chưa có ngày TN', color:'#607d8b' };

  const diffDays = Math.round((tiepTheo - today) / ms);

  // 1. Quá hạn: ngày tiếp theo đã qua
  if (diffDays < 0) {
    return { level:'overdue', label:`Quá hạn ${Math.abs(diffDays)} ngày`, color:'#ff5252', diffDays };
  }
  // 2. Sắp đến hạn ≤ 30 ngày
  if (diffDays <= _TN_WARN_DAYS) {
    return { level:'warning', label:`Còn ${diffDays} ngày`, color:'#ffd740', diffDays };
  }

  // 3+4. Kiểm tra độ lệch chu kỳ so với Han_thi_nghiem
  if (truocDo && tiepTheo && hanTN > 0) {
    const interval = Math.round((tiepTheo - truocDo) / ms); // khoảng cách thực tế (ngày)
    const ratio    = interval / hanTN;
    if (ratio < 0.85) {
      return { level:'early', label:`Đặt sớm ${Math.round((1-ratio)*100)}%`, color:'#00c8ff', diffDays, interval, hanTN };
    }
    if (ratio > 1.15) {
      return { level:'late', label:`Đặt muộn ${Math.round((ratio-1)*100)}%`, color:'#ff9100', diffDays, interval, hanTN };
    }
  }
  return { level:'ok', label:`Còn ${diffDays} ngày`, color:'#00e676', diffDays };
}

function _tnAlertBadge(row) {
  const s = _tnAlertStatus(row);
  if (s.level === 'none') return '<span style="font-size:9px;color:var(--text-muted)">CSV</span>';
  const icons = { overdue:'fa-exclamation-triangle', warning:'fa-clock', early:'fa-forward', late:'fa-backward', ok:'fa-check-circle', info:'fa-info-circle' };
  return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:9px;padding:2px 8px;border-radius:12px;background:${s.color}18;color:${s.color};border:1px solid ${s.color}33;font-weight:600;white-space:nowrap"><i class="fas ${icons[s.level]||'fa-circle'}" style="font-size:7px"></i>${s.label}</span>`;
}

// ── DATA FETCH ────────────────────────────────────────────────
async function _tnFetchData() {
  try {
    const cached = localStorage.getItem(_TN_CACHE_KEY);
    if (cached) {
      const { ts, data } = JSON.parse(cached);
      if (Date.now() - ts < _TN_CACHE_TTL && data.length > 0) return data;
    }
  } catch(_) {}

  const sb = supabaseClient;
  if (!sb) return [];

  let allRows = [], from = 0;
  while (true) {
    const { data, error } = await sb.from(_TN_TABLE).select('*').range(from, from + 999);
    if (error) { console.error('[TN]', error); break; }
    if (!data || !data.length) break;
    allRows = allRows.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  try { localStorage.setItem(_TN_CACHE_KEY, JSON.stringify({ ts:Date.now(), data:allRows })); } catch(_) {}
  return allRows;
}

// ── STATE ─────────────────────────────────────────────────────
let _tnRawData=[], _tnAllData=[], _tnFiltered=[], _tnPage=1, _tnPageSize=50;
let _tnSortCol='_alert', _tnSortAsc=true;
let _tnSearchQ='', _tnFCap='', _tnFType='', _tnFTram='', _tnFNhom='', _tnFAlertOnly=false;
let _tnMode='', _tnConf=null;

// ── FILTER & SORT ─────────────────────────────────────────────
function _tnApply() {
  const q = _tnSearchQ.toLowerCase().trim();
  _tnFiltered = _tnAllData.filter(r => {
    if (_tnFCap   && String(r.Cap_dien_ap??'') !== _tnFCap)             return false;
    if (_tnFType  && (r.Phan_loai_thiet_bi||'').trim() !== _tnFType)   return false;
    if (_tnFTram  && (r.Tram||'').trim() !== _tnFTram)                  return false;
    if (_tnFNhom  && (r.Nhom_thiet_bi||'').trim() !== _tnFNhom)        return false;
    if (_tnFAlertOnly) {
      const lvl = _tnAlertStatus(r).level;
      if (lvl === 'ok' || lvl === 'none') return false;
    }
    if (q) {
      const hay = [(r.Tram||''),(r.Ten_thiet_bi||''),(r.Phan_loai_thiet_bi||''),(r.Nhom_thiet_bi||''),(r.Loai_ngan_lo||'')].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const order = { overdue:0, warning:1, late:2, early:3, info:4, ok:5, none:6 };
  _tnFiltered.sort((a, b) => {
    if (_tnSortCol === '_alert') {
      const la = order[_tnAlertStatus(a).level]??9, lb = order[_tnAlertStatus(b).level]??9;
      return _tnSortAsc ? la-lb : lb-la;
    }
    let va=a[_tnSortCol]??'', vb=b[_tnSortCol]??'';
    if (!isNaN(Date.parse(va)) && !isNaN(Date.parse(vb))) {
      return _tnSortAsc ? new Date(va)-new Date(vb) : new Date(vb)-new Date(va);
    }
    va=String(va).toLowerCase(); vb=String(vb).toLowerCase();
    return _tnSortAsc ? va.localeCompare(vb,'vi') : vb.localeCompare(va,'vi');
  });
  _tnPage = 1;
}

// ── STATS ROW ─────────────────────────────────────────────────
function _tnStats() {
  const fmt = n => Number(n).toLocaleString('vi-VN');
  const f = _tnFiltered;
  const counts = {
    total:    f.length,
    overdue:  f.filter(r=>_tnAlertStatus(r).level==='overdue').length,
    warning:  f.filter(r=>_tnAlertStatus(r).level==='warning').length,
    late:     f.filter(r=>_tnAlertStatus(r).level==='late').length,
    early:    f.filter(r=>_tnAlertStatus(r).level==='early').length,
    ok:       f.filter(r=>_tnAlertStatus(r).level==='ok').length,
  };
  const cards = [
    ['Tổng',          counts.total,   'var(--accent)',  'rgba(0,200,255,.07)', 'rgba(0,200,255,.2)', 'fa-list',                  ''],
    ['Quá hạn',       counts.overdue, '#ff5252',        'rgba(255,82,82,.1)',  'rgba(255,82,82,.3)', 'fa-exclamation-triangle',  'overdue'],
    ['Sắp đến hạn',   counts.warning, '#ffd740',        'rgba(255,215,64,.08)','rgba(255,215,64,.25)','fa-clock',               'warning'],
    ['Đặt muộn',      counts.late,    '#ff9100',        'rgba(255,145,0,.08)', 'rgba(255,145,0,.25)','fa-backward',             'late'],
    ['Đặt sớm',       counts.early,   '#00c8ff',        'rgba(0,200,255,.07)','rgba(0,200,255,.2)', 'fa-forward',               'early'],
    ['Trong hạn',     counts.ok,      '#00e676',        'rgba(0,230,118,.07)','rgba(0,230,118,.2)', 'fa-check-circle',          'ok'],
  ];
  return `<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-bottom:14px">
    ${cards.map(([l,v,col,bg,brd,ic,lvl])=>`
    <div style="background:${bg};border:1px solid ${brd};border-radius:8px;padding:9px 12px;cursor:pointer"
      onclick="${lvl?`_tnFAlertOnly=true;_tnAllData_filter('${lvl}');_tnRefresh()`:'_tnFAlertOnly=false;_tnApply();_tnRefresh()'}">
      <div style="font-size:9px;color:${col};margin-bottom:3px"><i class="fas ${ic}" style="margin-right:3px"></i>${l}</div>
      <div style="font-size:18px;font-weight:800;font-family:var(--font-mono);color:${col}">${fmt(v)}</div>
    </div>`).join('')}
  </div>`;
}

function _tnAllData_filter(lvl) {
  _tnFiltered = _tnAllData.filter(r => _tnAlertStatus(r).level === lvl);
  _tnPage = 1;
}

// ── TABLE ─────────────────────────────────────────────────────
function _tnTable() {
  const fmt = n => Number(n).toLocaleString('vi-VN');
  const fmtD = v => {
    if (!v) return '<span style="color:rgba(255,255,255,.2);font-size:9px">—</span>';
    const d = new Date(v); if (isNaN(d)) return v;
    return `<span style="font-family:var(--font-mono);font-size:10px">${d.toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'})}</span>`;
  };
  const start=(_tnPage-1)*_tnPageSize, rows=_tnFiltered.slice(start,start+_tnPageSize),
        total=_tnFiltered.length, totPg=Math.max(1,Math.ceil(total/_tnPageSize));

  const COLS = [
    {k:'_alert',                          l:'Trạng thái',          w:'135px'},
    {k:'Tram',                            l:'Trạm',                w:'90px'},
    {k:'Cap_dien_ap',                     l:'Cấp ĐA',              w:'65px'},
    {k:'Nhom_thiet_bi',                   l:'Nhóm TB',             w:'90px'},
    {k:'Phan_loai_thiet_bi',              l:'Loại TB',             w:'85px'},
    {k:'Ten_thiet_bi',                    l:'Tên thiết bị',        w:'130px'},
    {k:'Loai_ngan_lo',                    l:'Ngăn',                w:'120px'},
    {k:'So_luong',                        l:'SL',                  w:'44px', num:1},
    {k:'Han_thi_nghiem',                  l:'Hạn TN (ngày)',       w:'90px', num:1},
    {k:'Thoi_gian_thi_nghiem_truoc',      l:'TN trước đó',         w:'100px'},
    {k:'Thoi_gian_thi_nghiem_tiep_theo',  l:'TN tiếp theo',        w:'100px'},
    {k:'Ngay_thi_nghiem',                 l:'Ngày TN thực tế',     w:'105px'},
    {k:'Dien_ban',                        l:'Điện bản',            w:'90px'},
    {k:'Bien_ban',                        l:'Biên bản',            w:'90px'},
    {k:'Ngay_thi_nghiem_dot_xuat',        l:'TN đột xuất',         w:'95px'},
    {k:'Nam_ke_hoach',                    l:'Năm KH',              w:'65px', num:1},
    {k:'Nam_thuc_hien',                   l:'Năm TH',              w:'65px', num:1},
    {k:'Muc_ke_hoach_nam',                l:'Mục KH',              w:'80px'},
    {k:'Doi',                             l:'Đội',                 w:'46px', num:1},
    {k:'Ghi_chu',                         l:'Ghi chú',             w:'140px'},
  ];

  const mkTh = c => {
    const s = _tnSortCol === c.k;
    return `<th style="padding:7px 9px;font-size:9px;font-weight:700;color:${s?'var(--accent)':'var(--text-muted)'};letter-spacing:.05em;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,.1);cursor:pointer;white-space:nowrap;background:rgba(255,255,255,.03);user-select:none;min-width:${c.w};text-align:${c.num?'right':'left'};position:sticky;top:0;z-index:2" onclick="_tnSort('${c.k}')">${c.l}${s?`<span style="color:var(--accent)"> ${_tnSortAsc?'↑':'↓'}</span>`:''}</th>`;
  };

  const tbody = rows.map(r => {
    const s   = _tnAlertStatus(r);
    const cap = String(r.Cap_dien_ap??'');
    const rowBg = s.level==='overdue'?'background:rgba(255,82,82,.04)':s.level==='warning'?'background:rgba(255,215,64,.03)':s.level==='late'?'background:rgba(255,145,0,.03)':'';
    const capBadge = `<span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:9px;font-weight:700;background:${(_tnCapCol[cap]||'#888')}22;color:${_tnCapCol[cap]||'#888'}">${_tnCapLbl[cap]||cap||'—'}</span>`;
    const dateTT = r.Thoi_gian_thi_nghiem_tiep_theo ? new Date(r.Thoi_gian_thi_nghiem_tiep_theo) : null;
    const tiepTheoCell = dateTT
      ? `<span style="font-family:var(--font-mono);font-size:10px;color:${s.level==='overdue'?'#ff5252':s.level==='warning'?'#ffd740':'var(--text-primary)'};font-weight:${s.level!=='ok'&&s.level!=='none'?700:400}">${dateTT.toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'})}</span>`
      : '<span style="color:rgba(255,255,255,.2);font-size:9px">—</span>';

    // Han_thi_nghiem + interval deviation display
    const han = Number(r.Han_thi_nghiem)||0;
    const truoc = r.Thoi_gian_thi_nghiem_truoc ? new Date(r.Thoi_gian_thi_nghiem_truoc) : null;
    const tiep  = dateTT;
    const hanDisplay = han > 0 ? `<span style="font-family:var(--font-mono)">${han} năm</span>` : '<span style="color:rgba(255,255,255,.2);font-size:9px">—</span>';

    return `<tr style="border-bottom:1px solid rgba(255,255,255,.04);${rowBg}">
      <td style="padding:6px 9px">${_tnAlertBadge(r)}</td>
      <td style="padding:6px 9px;font-weight:600">${r.Tram||'—'}</td>
      <td style="padding:6px 9px">${capBadge}</td>
      <td style="padding:6px 9px;font-size:10px">${r.Nhom_thiet_bi||'—'}</td>
      <td style="padding:6px 9px;font-size:10px">${r.Phan_loai_thiet_bi||'—'}</td>
      <td style="padding:6px 9px;font-size:10px;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.Ten_thiet_bi||''}">${r.Ten_thiet_bi||'—'}</td>
      <td style="padding:6px 9px;font-size:10px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.Loai_ngan_lo||''}">${r.Loai_ngan_lo||'—'}</td>
      <td style="padding:6px 9px;text-align:right;font-family:var(--font-mono)">${r.So_luong??'—'}</td>
      <td style="padding:6px 9px;text-align:right">${hanDisplay}</td>
      <td style="padding:6px 9px">${fmtD(r.Thoi_gian_thi_nghiem_truoc)}</td>
      <td style="padding:6px 9px">${tiepTheoCell}</td>
      <td style="padding:6px 9px">${fmtD(r.Ngay_thi_nghiem)}</td>
      <td style="padding:6px 9px;font-size:10px">${r.Dien_ban||'—'}</td>
      <td style="padding:6px 9px;font-size:10px">${r.Bien_ban||'—'}</td>
      <td style="padding:6px 9px">${fmtD(r.Ngay_thi_nghiem_dot_xuat)}</td>
      <td style="padding:6px 9px;text-align:right;font-family:var(--font-mono);font-size:10px">${r.Nam_ke_hoach||'—'}</td>
      <td style="padding:6px 9px;text-align:right;font-family:var(--font-mono);font-size:10px">${r.Nam_thuc_hien||'—'}</td>
      <td style="padding:6px 9px;font-size:10px">${r.Muc_ke_hoach_nam||'—'}</td>
      <td style="padding:6px 9px;text-align:right;font-family:var(--font-mono);font-size:10px">${r.Doi||'—'}</td>
      <td style="padding:6px 9px;font-size:10px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.Ghi_chu||''}">${r.Ghi_chu||'—'}</td>
    </tr>`;
  }).join('');

  const half=3; let lo=Math.max(1,_tnPage-half), hi=Math.min(totPg,lo+6); if(hi-lo<6)lo=Math.max(1,hi-6);
  let pg=''; if(lo>1)pg+=`<button class="app-pg-btn" onclick="_tnGoPage(1)">1</button>${lo>2?'…':''}`;
  for(let p=lo;p<=hi;p++) pg+=`<button class="tb-pb${p===_tnPage?' cur':''}" onclick="_tnGoPage(${p})">${p}</button>`;
  if(hi<totPg) pg+=`${hi<totPg-1?'…':''}<button class="app-pg-btn" onclick="_tnGoPage(${totPg})">${totPg}</button>`;

  return `${_tnStats()}
  <div style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono);padding:0 0 10px">
    Hiển thị <b style="color:var(--accent)">${start+1}–${Math.min(start+_tnPageSize,total)}</b>/<b style="color:var(--accent)">${fmt(total)}</b>
    ${_tnFAlertOnly?'<span style="color:#ffd740;margin-left:8px"><i class="fas fa-filter"></i> Đang lọc cảnh báo</span>':''}
  </div>
  <div style="overflow-x:auto;border-radius:8px;border:1px solid rgba(255,255,255,.07)">
    <table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr>${COLS.map(mkTh).join('')}</tr></thead>
      <tbody>${tbody||'<tr><td colspan="20" style="padding:30px;text-align:center;color:var(--text-muted)">Không có dữ liệu</td></tr>'}</tbody>
    </table>
  </div>
  <div style="display:flex;align-items:center;gap:6px;justify-content:flex-end;padding:10px 0 0">
    <button class="app-pg-btn" ${_tnPage<=1?'disabled':''} onclick="_tnGoPage(${_tnPage-1})">‹</button>
    ${pg}
    <button class="app-pg-btn" ${_tnPage>=totPg?'disabled':''} onclick="_tnGoPage(${_tnPage+1})">›</button>
  </div>`;
}

// ── CONTROLS ─────────────────────────────────────────────────
function _tnSort(c){ if(_tnSortCol===c)_tnSortAsc=!_tnSortAsc;else{_tnSortCol=c;_tnSortAsc=true;} _tnApply();_tnRefresh(); }
function _tnGoPage(p){ const t=Math.max(1,Math.ceil(_tnFiltered.length/_tnPageSize));_tnPage=Math.max(1,Math.min(p,t));_tnRefresh(); }
function _tnRefresh(){ const el=document.getElementById('_tnTableArea');if(el)el.innerHTML=_tnTable(); }
function _tnOnSearch(v){ _tnSearchQ=v||'';_tnApply();_tnRefresh(); }
function _tnOnFilter(k,v){ if(k==='cap')_tnFCap=v;else if(k==='type')_tnFType=v;else if(k==='tram')_tnFTram=v;else if(k==='nhom')_tnFNhom=v;_tnApply();_tnRefresh(); }

function _tnReset(){
  _tnSearchQ=_tnFCap=_tnFType=_tnFTram=_tnFNhom='';_tnFAlertOnly=false;
  document.querySelectorAll('#tbPageOverlay .tn-trigger-lbl').forEach(el=>{ el.textContent=el.dataset.default; });
  document.querySelectorAll('#tbPageOverlay .tn-trigger').forEach(el=>{ el.style.cssText=''; });
  const si=document.getElementById('_tnSi');if(si)si.value='';
  _tnApply();_tnRefresh();
}

function _tnExportCSV() {
  const fmtD = v => v ? new Date(v).toLocaleDateString('vi-VN') : '';
  const hdr = 'Trạng thái,Trạm,Cấp ĐA,Nhóm TB,Loại TB,Tên TB,Ngăn,SL,Hạn TN (ngày),TN trước đó,TN tiếp theo,Ngày TN thực tế,Điện bản,Biên bản,TN đột xuất,Năm KH,Năm TH,Mục KH,Đội,Ghi chú';
  const body = _tnFiltered.map(r=>[
    _tnAlertStatus(r).label, r.Tram, _tnCapLbl[String(r.Cap_dien_ap??'')]||r.Cap_dien_ap,
    r.Nhom_thiet_bi, r.Phan_loai_thiet_bi, r.Ten_thiet_bi, r.Loai_ngan_lo, r.So_luong,
    r.Han_thi_nghiem, fmtD(r.Thoi_gian_thi_nghiem_truoc), fmtD(r.Thoi_gian_thi_nghiem_tiep_theo),
    fmtD(r.Ngay_thi_nghiem), r.Dien_ban, r.Bien_ban, fmtD(r.Ngay_thi_nghiem_dot_xuat),
    r.Nam_ke_hoach, r.Nam_thuc_hien, r.Muc_ke_hoach_nam, r.Doi, r.Ghi_chu
  ].map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob(['\uFEFF'+hdr+'\n'+body],{type:'text/csv;charset=utf-8'}));
  a.download=`TNDK_${new Date().toISOString().slice(0,10)}.csv`; a.click();
}

// ── RENDER PAGE ───────────────────────────────────────────────
function tnRenderPage(conf, title) {
  _tnConf=conf; _tnMode=conf.mode;
  _tnSortCol='_alert'; _tnSortAsc=true;
  _tnSearchQ=_tnFCap=_tnFType=_tnFTram=_tnFNhom=''; _tnFAlertOnly=false;

  const overlay=document.getElementById('mainSections');
  if(!overlay) return;

  overlay.innerHTML=`
    <div style="padding:0 0 32px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
        <div style="width:34px;height:34px;border-radius:8px;background:${conf.color}22;color:${conf.color};display:flex;align-items:center;justify-content:center"><i class="fas ${conf.icon}" style="font-size:15px"></i></div>
        <div>
          <div style="font-size:16px;font-weight:800;color:var(--text-primary)">${title}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px">Bảng <span style="color:var(--accent);font-family:var(--font-mono)">CongTacThiNghiem</span> · Cảnh báo: <span style="color:#ffd740">sắp hạn ≤30 ngày</span>, <span style="color:#ff5252">quá hạn</span>, <span style="color:#ff9100">đặt muộn >15%</span>, <span style="color:#00c8ff">đặt sớm</span> · CSV miễn cảnh báo</div>
        </div>
        <button onclick="navigateTo('dashboard')" style="margin-left:auto;padding:6px 12px;border-radius:7px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:var(--text-primary);font-size:10px;cursor:pointer;display:inline-flex;align-items:center;gap:5px"><i class="fas fa-arrow-left"></i> Dashboard</button>
      </div>

      <!-- Toolbar -->
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:0 0 12px;border-bottom:1px solid rgba(255,255,255,.07);margin-bottom:12px">
        <div style="position:relative;flex:1;min-width:160px;max-width:280px">
          <i class="fas fa-search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--text-muted);font-size:10px;pointer-events:none"></i>
          <input id="_tnSi" type="text" placeholder="🔍 Tìm trạm, tên TB, ngăn..."
            style="width:100%;box-sizing:border-box;padding:6px 10px 6px 30px;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.05);color:var(--text-primary);font-size:11px;outline:none;font-family:var(--font-mono)"
            oninput="_tnOnSearch(this.value)">
        </div>
        <div id="_tnFilterBtns" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"></div>
        <button onclick="_tnFAlertOnly=!_tnFAlertOnly;_tnApply();_tnRefresh();this.style.background=_tnFAlertOnly?'rgba(255,215,64,.2)':'';this.style.color=_tnFAlertOnly?'#ffd740':'';"
          style="padding:5px 11px;border-radius:6px;border:1px solid rgba(255,215,64,.3);background:rgba(255,255,255,.06);color:var(--text-primary);font-size:10px;cursor:pointer;display:inline-flex;align-items:center;gap:5px">
          <i class="fas fa-bell"></i> Chỉ cảnh báo
        </button>
        <button onclick="_tnReset()" style="padding:5px 11px;border-radius:6px;border:1px solid rgba(255,82,82,.3);background:rgba(255,82,82,.1);color:#ff5252;font-size:10px;cursor:pointer;display:inline-flex;align-items:center;gap:5px"><i class="fas fa-times"></i> Xóa lọc</button>
        <button onclick="_tnExportCSV()" style="padding:5px 11px;border-radius:6px;border:1px solid rgba(0,230,118,.3);background:rgba(0,230,118,.1);color:#00e676;font-size:10px;cursor:pointer;display:inline-flex;align-items:center;gap:5px"><i class="fas fa-download"></i> CSV</button>
      </div>

      <div id="_tnTableArea">
        <div style="padding:50px;text-align:center;color:var(--text-muted)"><i class="fas fa-spinner fa-spin" style="color:var(--accent);margin-right:8px"></i>Đang tải...</div>
      </div>
    </div>`;

  _tnFetchData().then(rows => {
    if (!rows.length) {
      const el=document.getElementById('_tnTableArea');
      if(el) el.innerHTML='<div style="padding:40px;text-align:center;color:var(--text-muted)"><i class="fas fa-database" style="font-size:24px;margin-bottom:10px;display:block;opacity:.3"></i>Bảng CongTacThiNghiem chưa có dữ liệu</div>';
      return;
    }
    _tnRawData = rows;
    _tnAllData = conf.mode === 'dinhky'
      ? rows.filter(r => !(r.LoaiTN||'').toUpperCase().includes('ĐỘT'))
      : rows.filter(r => (r.LoaiTN||'').toUpperCase().includes('ĐỘT')) || rows;
    if (!_tnAllData.length) _tnAllData = rows;
    _tnApply();

    // Dropdowns
    const sortVi=(a,b)=>a.localeCompare(b,'vi');
    const cpPrio={'2':0,'1':1,'3':2,'4':3,'9':4,'6':5,'0':6};
    const trA=[...new Set(_tnAllData.map(r=>(r.Tram||'').trim()).filter(Boolean))].sort(sortVi);
    const tyA=[...new Set(_tnAllData.map(r=>(r.Phan_loai_thiet_bi||'').trim()).filter(Boolean))].sort(sortVi);
    const nhA=[...new Set(_tnAllData.map(r=>(r.Nhom_thiet_bi||'').trim()).filter(Boolean))].sort(sortVi);
    const cA =[...new Set(_tnAllData.map(r=>String(r.Cap_dien_ap??'')).filter(c=>c&&c!=='null'))].sort((a,b)=>(cpPrio[a]??9)-(cpPrio[b]??9));
    const fc=document.getElementById('_tnFilterBtns');
    if(fc){
      fc.innerHTML='';
      function mkTnDd(key,dflt,items){
        const btn=document.createElement('button');btn.type='button';btn.className='tn-trigger';
        btn.style.cssText='display:inline-flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 10px;border-radius:6px;border:1px solid rgba(0,200,255,.4);background:var(--bg-elevated,#161b22);color:var(--text-primary);font-family:var(--font-mono);font-size:11px;cursor:pointer;outline:none;min-width:120px;white-space:nowrap;transition:border-color .15s';
        const lbl=document.createElement('span');lbl.className='tn-trigger-lbl';lbl.textContent=dflt;lbl.dataset.default=dflt;
        const ico=document.createElement('i');ico.className='fas fa-chevron-down';ico.style.cssText='font-size:8px;color:var(--text-muted)';
        btn.appendChild(lbl);btn.appendChild(ico);
        let oc;
        btn.onclick=e=>{e.stopPropagation();const ex=document.getElementById('_tnDdList');if(ex){if(ex.dataset.key===key){ex.remove();return;}ex.remove();}
          const list=document.createElement('div');list.id='_tnDdList';list.dataset.key=key;
          list.style.cssText='position:fixed;z-index:9999;background:var(--bg-surface,#161b22);border:1px solid rgba(255,255,255,.12);border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,.5);min-width:180px;max-height:320px;overflow-y:auto;flex-direction:column;padding:4px 0;display:flex';
          if(['tram','type','nhom'].includes(key)){const si=document.createElement('input');si.type='text';si.placeholder='🔍 Tìm...';si.style.cssText='margin:6px 8px;padding:4px 8px;border-radius:5px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:var(--text-primary);font-size:10px;outline:none';si.oninput=ev=>{const q=ev.target.value.toLowerCase();list.querySelectorAll('.tn-dd-item').forEach(el=>{el.style.display=el.textContent.toLowerCase().includes(q)?'':'none';});};si.onclick=ev=>ev.stopPropagation();list.appendChild(si);}
          function mkI(v,l){const d=document.createElement('div');d.className='tn-dd-item';d.style.cssText='padding:6px 14px;cursor:pointer;font-size:11px;color:var(--text-primary);white-space:nowrap;transition:background .1s';d.textContent=l;d.onmouseenter=()=>{d.style.background='rgba(255,255,255,.06)';};d.onmouseleave=()=>{d.style.background='';};d.onclick=()=>{_tnOnFilter(key,v);lbl.textContent=v?l:dflt;btn.style.borderColor=v?'var(--accent)':'rgba(0,200,255,.4)';btn.style.background=v?'rgba(0,200,255,.08)':'';btn.style.color=v?'var(--accent)':'';ico.style.color=v?'var(--accent)':'var(--text-muted)';list.remove();document.removeEventListener('click',oc);};list.appendChild(d);}
          mkI('',dflt);items.forEach(it=>typeof it==='object'?mkI(it.v,it.l):mkI(it,it));
          document.body.appendChild(list);const r=btn.getBoundingClientRect();list.style.top=(r.bottom+4)+'px';list.style.left=r.left+'px';
          const si=list.querySelector('input');if(si)setTimeout(()=>si.focus(),30);
          oc=ev=>{if(!list.contains(ev.target)&&ev.target!==btn){list.remove();document.removeEventListener('click',oc);}};setTimeout(()=>document.addEventListener('click',oc),0);};
        return btn;
      }
      fc.appendChild(mkTnDd('tram',`— Tất cả trạm (${trA.length}) —`,trA));
      fc.appendChild(mkTnDd('cap','Cấp điện áp',cA.map(c=>({v:c,l:_tnCapLbl[c]||c}))));
      fc.appendChild(mkTnDd('nhom','Nhóm thiết bị',nhA));
      fc.appendChild(mkTnDd('type','Loại thiết bị',tyA));
    }
    _tnRefresh();
  });
}

function _tnSetData(source) {
  _tnAllData = source; _tnApply(); _tnRefresh();
}

