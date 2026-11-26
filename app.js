/* Gifticon Collection
 * 기기 안(IndexedDB)에만 저장하는 기프티콘 · 멤버십 카드 보관함.
 * 외부 서버 전송 없음. 모든 이미지 처리는 브라우저 안에서만 이뤄집니다.
 */
(function () {
  "use strict";

  /* =========================================================
   * 0. 작은 도구들
   * =======================================================*/
  const $ = (id) => document.getElementById(id);
  const pad2 = (n) => String(n).padStart(2, "0");
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2400);
  }

  let confirmResolve = null;
  function askConfirm(text, okLabel) {
    $("confirmText").textContent = text;
    $("btnConfirmOk").textContent = okLabel || "확인";
    $("confirmModal").classList.remove("hidden");
    return new Promise((resolve) => { confirmResolve = resolve; });
  }
  function closeConfirm(value) {
    $("confirmModal").classList.add("hidden");
    if (confirmResolve) { confirmResolve(value); confirmResolve = null; }
  }

  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  };

  function parseYmd(s) {
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return new Date(y, mo - 1, d);
  }

  /** 오늘 기준 남은 일수 (오늘 = 0, 지났으면 음수) */
  function daysUntil(dateStr) {
    const t = parseYmd(dateStr);
    if (!t) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((t.getTime() - today.getTime()) / 86400000);
  }

  const isExpired = (c) => { const n = daysUntil(c.expiry); return n !== null && n < 0; };

  function fmtDot(dateStr) {
    return dateStr ? dateStr.replace(/-/g, ".") : "";
  }
  function fmtKorean(dateStr) {
    const d = parseYmd(dateStr);
    if (!d) return "";
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
  }
  const won = (n) => Number(n || 0).toLocaleString("ko-KR") + "원";

  function uid() {
    return "c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function ddayInfo(c) {
    if (!c.expiry) return { text: "기한 없음", cls: "" };
    const n = daysUntil(c.expiry);
    if (n === null) return { text: "기한 없음", cls: "" };
    if (n < 0) return { text: "만료", cls: "expired" };
    if (n === 0) return { text: "D-DAY", cls: "urgent" };
    if (n <= 7) return { text: "D-" + n, cls: "urgent" };
    return { text: "D-" + n, cls: "" };
  }

  const BAR_VARS = [
    "var(--pastel-lavender)", "var(--pastel-mint)", "var(--pastel-peach)",
    "var(--pastel-butter)", "var(--pastel-sky)", "var(--pastel-rose)",
    "var(--pastel-lilac)", "var(--pastel-sage)"
  ];
  function barColor(brand) {
    const s = String(brand || "");
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return BAR_VARS[h % BAR_VARS.length];
  }

  /* =========================================================
   * 1. 저장소 (IndexedDB, 막히면 localStorage로 대체)
   * =======================================================*/
  const DB_NAME = "gifticon-collection";
  const DB_VERSION = 1;
  const STORES = ["coupons", "members"];
  let idb = null;
  let useFallback = false;

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) { reject(new Error("no-idb")); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        STORES.forEach((name) => {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
        });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("idb-error"));
      req.onblocked = () => reject(new Error("idb-blocked"));
    });
  }

  function idbTx(storeName, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let out;
      try { out = fn(store); } catch (e) { reject(e); return; }
      tx.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("aborted"));
    });
  }

  const store = {
    async all(name) {
      if (useFallback) return JSON.parse(localStorage.getItem("gc-" + name) || "[]");
      const req = idb.transaction(name, "readonly").objectStore(name).getAll();
      return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    },
    async put(name, rec) {
      if (useFallback) {
        const list = JSON.parse(localStorage.getItem("gc-" + name) || "[]");
        const i = list.findIndex((x) => x.id === rec.id);
        if (i >= 0) list[i] = rec; else list.push(rec);
        localStorage.setItem("gc-" + name, JSON.stringify(list));
        return;
      }
      await idbTx(name, "readwrite", (s) => s.put(rec));
    },
    async remove(name, id) {
      if (useFallback) {
        const list = JSON.parse(localStorage.getItem("gc-" + name) || "[]").filter((x) => x.id !== id);
        localStorage.setItem("gc-" + name, JSON.stringify(list));
        return;
      }
      await idbTx(name, "readwrite", (s) => s.delete(id));
    },
    async bulk(name, records) {
      if (useFallback) {
        const list = JSON.parse(localStorage.getItem("gc-" + name) || "[]");
        records.forEach((rec) => {
          const i = list.findIndex((x) => x.id === rec.id);
          if (i >= 0) list[i] = rec; else list.push(rec);
        });
        localStorage.setItem("gc-" + name, JSON.stringify(list));
        return;
      }
      await idbTx(name, "readwrite", (s) => { records.forEach((rec) => s.put(rec)); });
    }
  };

  async function initStorage() {
    try {
      idb = await openDB();
    } catch (e) {
      useFallback = true;
      console.warn("IndexedDB를 쓸 수 없어 localStorage로 저장합니다.", e);
    }
  }

  /* =========================================================
   * 2. 상태
   * =======================================================*/
  const state = {
    coupons: [],
    members: [],
    folder: "전체",
    search: "",
    sort: "expiry", // expiry | added
    showUsed: false
  };

  const FOLDERS = ["전체", "사진첩", "문자", "카톡 선물하기", "스타벅스", "기타", "멤버십 카드"];

  /* =========================================================
   * 3. 렌더링
   * =======================================================*/
  function renderAll() {
    renderSummary();
    renderTabs();
    renderToolbar();
    renderList();
    renderFooter();
  }

  function renderSummary() {
    const alive = state.coupons.filter((c) => !c.used && !isExpired(c));
    const money = alive
      .filter((c) => c.type === "금액권" && Number(c.balance) > 0)
      .reduce((s, c) => s + Number(c.balance), 0);
    $("sumAvailable").textContent = `${alive.length}장 · ${won(money)}`;

    const urgent = state.coupons.filter((c) => {
      if (c.used) return false;
      const n = daysUntil(c.expiry);
      return n !== null && n >= 0 && n <= 7;
    });
    $("sumUrgent").textContent = `${urgent.length}장 임박`;
  }

  function renderTabs() {
    document.querySelectorAll(".tab-chip").forEach((btn) => {
      const on = btn.dataset.folder === state.folder;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function renderToolbar() {
    const isMember = state.folder === "멤버십 카드";
    $("btnAddMember").classList.toggle("hidden", !isMember);
    $("btnSort").classList.toggle("hidden", isMember);
    $("btnShowUsed").classList.toggle("hidden", isMember);
    $("btnSort").textContent = state.sort === "expiry" ? "유효기간 임박순" : "등록순";
    $("btnShowUsed").setAttribute("aria-pressed", state.showUsed ? "true" : "false");

    const canNotify = "Notification" in window;
    const needAsk = canNotify && Notification.permission === "default";
    $("btnEnableNotif").classList.toggle("hidden", !needAsk);
  }

  function sortCoupons(list) {
    const arr = list.slice();
    if (state.sort === "added") {
      return arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }
    const rank = (c) => {
      if (c.used) return 3;
      const n = daysUntil(c.expiry);
      if (n === null) return 1;
      if (n < 0) return 2;
      return 0;
    };
    return arr.sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      if (ra === 0) return (daysUntil(a.expiry) - daysUntil(b.expiry)) || (b.createdAt || 0) - (a.createdAt || 0);
      if (ra === 2) return (daysUntil(b.expiry) - daysUntil(a.expiry));
      if (ra === 3) return (b.usedAt || 0) - (a.usedAt || 0);
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  function visibleCoupons() {
    let list = state.coupons.slice();
    if (state.folder !== "전체") list = list.filter((c) => c.folder === state.folder);
    if (!state.showUsed) list = list.filter((c) => !c.used);
    const q = state.search.trim().toLowerCase();
    if (q) {
      list = list.filter((c) =>
        [c.brand, c.title, c.code, c.memo, c.folder].join(" ").toLowerCase().includes(q)
      );
    }
    return sortCoupons(list);
  }

  function visibleMembers() {
    let list = state.members.slice();
    const q = state.search.trim().toLowerCase();
    if (q) list = list.filter((m) => [m.brand, m.number].join(" ").toLowerCase().includes(q));
    return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  function emptyBox(title, text, ctaLabel, ctaId) {
    return `<div class="empty-box">
      <div class="empty-emoji">🎁</div>
      <p class="empty-title">${esc(title)}</p>
      <p class="empty-text">${esc(text)}</p>
      ${ctaLabel ? `<button type="button" class="empty-cta" id="${ctaId}">${esc(ctaLabel)}</button>` : ""}
    </div>`;
  }

  function couponCard(c) {
    const d = ddayInfo(c);
    const kind = c.type === "금액권" && Number(c.balance) > 0 ? "잔액 " + won(c.balance) : "교환권";
    return `<article class="coupon-card ${c.used ? "used" : ""}" data-id="${c.id}">
      <div class="coupon-head" style="--bar:${barColor(c.brand)}">
        <span class="coupon-brand">${esc(c.brand || "브랜드")}</span>
        <span class="coupon-exp">${c.expiry ? "~" + fmtDot(c.expiry) : ""}</span>
      </div>
      <div class="coupon-body">
        <div class="coupon-meta">
          <span class="badge" data-folder="${esc(c.folder)}">${esc(c.folder)}</span>
          <span class="dday ${d.cls}">${c.used ? "사용완료" : d.text}</span>
        </div>
        <h3 class="coupon-title">${esc(c.title || "기프티콘")}</h3>
      </div>
      <div class="coupon-divider"></div>
      <div class="coupon-foot">
        <span class="coupon-kind">${esc(kind)}</span>
        <button type="button" class="open-btn" data-open="${c.id}">쿠폰 열기</button>
      </div>
    </article>`;
  }

  function groupDigits(num) {
    const digits = String(num || "").replace(/\D/g, "");
    if (!digits) return "";
    return digits.replace(/(.{4})/g, "$1 ").trim().split(" ").join(" · ");
  }

  function memberTicket(m) {
    const initial = (m.brand || "?").slice(0, 2);
    return `<article class="ticket" data-member="${m.id}">
      <div class="ticket-top" style="--bar:${barColor(m.brand)}">
        <span class="ticket-initial">${esc(initial)}</span>
        <div class="ticket-brand-box">
          <div class="ticket-brand">${esc(m.brand || "멤버십")}</div>
          <div class="ticket-kind-label">멤버십 카드</div>
        </div>
      </div>
      <div class="ticket-scallop" style="--bar:${barColor(m.brand)}"></div>
      <div class="ticket-bottom mono">${esc(groupDigits(m.number) || "번호 없음")}</div>
    </article>`;
  }

  function renderList() {
    const area = $("listArea");
    if (state.folder === "멤버십 카드") {
      const members = visibleMembers();
      if (!members.length) {
        area.innerHTML = emptyBox(
          "멤버십 카드가 없어요",
          "브랜드와 카드 번호만 넣으면 바코드를 만들어\n매장에서 바로 보여 줄 수 있어요.",
          "+ 멤버십 추가",
          "emptyAddMember"
        );
        const btn = $("emptyAddMember");
        if (btn) btn.addEventListener("click", () => openMemberModal());
        return;
      }
      area.innerHTML = `<div class="item-grid">${members.map(memberTicket).join("")}</div>`;
      return;
    }

    const list = visibleCoupons();
    if (!list.length) {
      const searching = state.search.trim() !== "";
      area.innerHTML = searching
        ? emptyBox("검색 결과가 없어요", "다른 브랜드명이나 쿠폰번호로 찾아보세요.", "", "")
        : emptyBox(
            "아직 담긴 기프티콘이 없어요",
            "사진을 올리거나 문자 내용을 붙여넣으면\n쿠폰번호와 만료일을 대신 읽어 드려요.",
            "+ 첫 기프티콘 담기",
            "emptyAddCoupon"
          );
      const btn = $("emptyAddCoupon");
      if (btn) btn.addEventListener("click", () => openCouponModal());
      return;
    }
    area.innerHTML = `<div class="item-grid">${list.map(couponCard).join("")}</div>`;
  }

  function renderFooter() {
    if (state.folder === "멤버십 카드") {
      $("totalCount").textContent = `총 ${state.members.length}장 보관 중`;
    } else {
      const n = state.coupons.filter((c) => !c.used).length;
      $("totalCount").textContent = `총 ${n}장 보관 중`;
    }
  }

  /* =========================================================
   * 4. Code128 바코드
   * =======================================================*/
  const CODE128 = [
    "11011001100","11001101100","11001100110","10010011000","10010001100","10001001100","10011001000","10011000100","10001100100",
    "11001001000","11001000100","11000100100","10110011100","10011011100","10011001110","10111001100","10011101100","10011100110",
    "11001110010","11001011100","11001001110","11011100100","11001110100","11101101110","11101001100","11100101100","11100100110",
    "11101100100","11100110100","11100110010","11011011000","11011000110","11000110110","10100011000","10001011000","10001000110",
    "10110001000","10001101000","10001100010","11010001000","11000101000","11000100010","10110111000","10110001110","10001101110",
    "10111011000","10111000110","10001110110","11101110110","11010001110","11000101110","11011101000","11011100010","11011101110",
    "11101011000","11101000110","11100010110","11101101000","11101100010","11100011010","11101111010","11001000010","11110001010",
    "10100110000","10100001100","10010110000","10010000110","10000101100","10000100110","10110010000","10110000100","10011010000",
    "10011000010","10000110100","10000110010","11000010010","11001010000","11110111010","11000010100","10001111010","10100111100",
    "10010111100","10010011110","10111100100","10011110100","10011110010","11110100100","11110010100","11110010010","11011011110",
    "11011110110","11110110110","10101111000","10100011110","10001011110","10111101000","10111100010","11110101000","11110100010",
    "10111011110","10111101110","11101011110","11110101110","11010000100","11010010000","11010011100","1100011101011"
  ];

  /** Code128-B 로 문자열을 막대 비트열로 바꿉니다. 인코딩 불가면 null */
  function code128Bits(input) {
    const text = String(input == null ? "" : input).replace(/[^\x20-\x7E]/g, "").trim();
    if (!text) return null;
    const start = 104; // Start B
    const values = [start];
    for (let i = 0; i < text.length; i++) values.push(text.charCodeAt(i) - 32);
    let checksum = start;
    for (let i = 0; i < text.length; i++) checksum += (text.charCodeAt(i) - 32) * (i + 1);
    values.push(checksum % 103);
    values.push(106); // Stop
    return values.map((v) => CODE128[v]).join("");
  }

  function drawBarcode(canvas, value, cssHeight) {
    if (!canvas) return false;
    const bits = code128Bits(value);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const host = canvas.parentElement;
    const cssWidth = Math.max(200, Math.floor(canvas.clientWidth || (host ? host.clientWidth - 24 : 320)));
    const h = cssHeight || (canvas.dataset.h ? Number(canvas.dataset.h) : 110);
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!bits) return false;

    const quiet = 10;
    const total = bits.length + quiet * 2;
    const module = Math.max(1, Math.floor((canvas.width - 8) / total));
    const width = module * total;
    let x = Math.round((canvas.width - width) / 2) + quiet * module;
    const top = Math.round(canvas.height * 0.08);
    const barH = Math.round(canvas.height * 0.84);
    ctx.fillStyle = "#1b1a22";
    for (let i = 0; i < bits.length; i++) {
      if (bits[i] === "1") ctx.fillRect(x, top, module, barH);
      x += module;
    }
    return true;
  }

  /* =========================================================
   * 5. 문자 · 카톡 내용 파싱
   * =======================================================*/
  const BRANDS = [
    "스타벅스","메가커피","메가엠지씨","컴포즈커피","투썸플레이스","투썸","이디야커피","이디야","커피빈","폴바셋","할리스",
    "파스쿠찌","배스킨라빈스","배스킨","던킨도너츠","던킨","크리스피크림","도미노피자","피자헛","파파존스","맘스터치","버거킹",
    "맥도날드","롯데리아","KFC","서브웨이","노브랜드버거","이마트24","이마트에브리데이","이마트","홈플러스","롯데마트","CU편의점",
    "CU","GS25","세븐일레븐","올리브영","다이소","CGV","롯데시네마","메가박스","쿠팡","마켓컬리","컬리","배달의민족","요기요",
    "BHC","교촌치킨","교촌","BBQ","굽네치킨","네네치킨","샐러디","이삭토스트","본죽","파리바게뜨","뚜레쥬르","공차","쥬씨","빽다방",
    "더벤티","매머드커피","커피에반하다","설빙","요아정","알라딘","예스24","교보문고","에그드랍","한솔","죠스떡볶이","신전떡볶이",
    "아웃백","TGI","빕스","VIPS","애슐리","놀부","미스터피자","프레드피자","버거리","다이닝브랜즈"
  ].sort((a, b) => b.length - a.length);

  function normalizeCode(raw) {
    const digits = String(raw || "").replace(/[^0-9]/g, "");
    if (digits.length < 10 || digits.length > 20) return String(raw || "").replace(/[^0-9A-Za-z\-]/g, "").trim();
    return digits;
  }

  /** 스타벅스 앱·e-쿠폰·별 쿠폰 등 스타벅스 쿠폰인지 판별 */
  function looksStarbucks(text, brand) {
    const t = String(text || "");
    if (brand === "스타벅스" || /스타벅스|STARBUCKS/i.test(t)) return true;
    // 스타벅스에서만 쓰는 표현
    if (/별\s*쿠폰|사이렌\s*오더|사이렌오더|리워드\s*별|스타벅스\s*카드/.test(t)) return true;
    // 여러 브랜드가 쓰는 표현은 다른 브랜드가 없을 때만
    const hasOther = BRANDS.some((b) => b !== "스타벅스" && t.toUpperCase().includes(b.toUpperCase()));
    if (hasOther) return false;
    return /e[\s-]?쿠폰|사이즈\s*업|샷\s*추가|시럽\s*추가|1\s*\+\s*1/.test(t);
  }

  function detectFolder(text, brand) {
    // 카톡 선물하기 안내문이 분명하면 그 폴더를 우선합니다.
    if (/카카오\s*선물하기|카카오톡\s*선물하기/.test(text)) return "카톡 선물하기";
    if (looksStarbucks(text, brand)) return "스타벅스";
    if (/카카오|선물하기|카톡/.test(text)) return "카톡 선물하기";
    if (/문자|SMS|MMS|web\s*발신/i.test(text)) return "문자";
    if (/사진첩|갤러리|캡처|캡쳐|이미지/.test(text)) return "사진첩";
    return "";
  }

  /**
   * 문자 / 카톡 / OCR 텍스트에서 브랜드, 상품명, 쿠폰번호, 만료일, 금액을 뽑습니다.
   * 확실한 것만 채우고, 못 찾은 값은 빈 문자열로 남깁니다.
   */
  function parseCouponText(raw) {
    const text = String(raw || "").replace(/\r/g, "");
    const out = { brand: "", title: "", code: "", expiry: "", type: "", balance: null, folder: "", amountNote: "" };
    if (!text.trim()) return out;

    const flat = text.replace(/\t/g, " ");

    // --- 만료일 ---
    const fullDate = /(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?/;
    const shortDate = /(?:^|[^\d])(\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?![\d])/;
    const mFull = fullDate.exec(flat);
    if (mFull) {
      const y = +mFull[1], mo = +mFull[2], d = +mFull[3];
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) out.expiry = `${y}-${pad2(mo)}-${pad2(d)}`;
    } else {
      const mShort = shortDate.exec(flat);
      if (mShort) {
        const y = 2000 + +mShort[1], mo = +mShort[2], d = +mShort[3];
        if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) out.expiry = `${y}-${pad2(mo)}-${pad2(d)}`;
      }
    }

    // --- 쿠폰번호 (라벨 우선) ---
    const labeled = /(?:쿠폰\s*번호|바코드\s*번호|쿠폰\s*no\.?|coupon\s*(?:no|number)|승인\s*번호)[^\d\n]{0,8}([\d][\d \t\-]{8,40})/i.exec(flat);
    if (labeled) {
      const digits = labeled[1].replace(/[^\d]/g, "");
      if (digits.length >= 10 && digits.length <= 20) out.code = digits;
    }
    if (!out.code) {
      const runs = flat.match(/\d[\d \t\-]{8,40}/g) || [];
      for (const run of runs) {
        const digits = run.replace(/[^\d]/g, "");
        if (digits.length >= 10 && digits.length <= 20) { out.code = digits; break; }
      }
    }

    // --- 금액권 ---
    const money = /잔액[^\d]{0,8}([\d][\d,]{2,})\s*원/.exec(flat) ||
                  /([\d][\d,]{2,})\s*원\s*(?:권|상당|충전권)?/.exec(flat);
    if (money) {
      const value = Number(money[1].replace(/,/g, ""));
      if (value > 0) {
        out.balance = value;
        if (/금액권|잔액|충전/.test(flat)) out.type = "금액권";
        out.amountNote = won(value);
      }
    }

    // --- 브랜드 ---
    const upper = flat.toUpperCase();
    if (/STARBUCKS|스타벅스/.test(upper)) out.brand = "스타벅스";
    for (const b of BRANDS) {
      if (out.brand) break;
      const key = b.toUpperCase();
      if (upper.includes(key)) {
        // 'CU' 같은 짧은 이름은 단어 경계일 때만
        if (b.length <= 3 && !new RegExp(`(^|[^A-Za-z0-9])${key}([^A-Za-z0-9]|$)`).test(upper)) continue;
        out.brand = b;
        break;
      }
    }

    // --- 줄 단위 분석 ---
    const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
    const skipLine = /^(유효\s*기간|사용\s*기간|만료\s*일?|쿠폰\s*번호|바코드|주문\s*번호|결제|금액|잔액|사용\s*처|교환\s*처|유의\s*사항|문의|고객\s*센터|발신|수신|광고|무료\s*수신|수신\s*거부|\[|\]|※|▶|●|■|\*|-|·)/;
    const looksDate = /20\d{2}\s*[.\-/년]/;
    const looksCode = /^\d[\d\s\-]{9,}$/;
    const looksHeader = /^\[.*\]$|^\(.*\)$/;

    const candidates = [];
    lines.forEach((line) => {
      const clean = line.replace(/^[\s\-•*·▶●■◆]+/, "").trim();
      if (!clean) return;
      if (skipLine.test(clean)) return;
      if (looksDate.test(clean)) return;
      if (looksCode.test(clean)) return;
      if (out.brand && clean.replace(/\s/g, "") === out.brand.replace(/\s/g, "")) return;
      if (clean.length < 2 || clean.length > 60) return;
      candidates.push(clean);
    });

    const strongHint = /(아메리카노|라떼|커피|음료|1잔|2잔|3잔|1개|2개|3개|세트|조각|박스|피자|치킨|버거|샌드위치|케이크|머그|텀블러|스낵|아이스크림|도넛|빵|샐러드|떡볶이|김밥|영화|관람|페레로|쉐이크|주스|에이드|요거트|마카롱|초콜릿|쿠키|핫도그|떡|닭강정|스테이크|파스타|별\s*쿠폰|e[\s-]?쿠폰|프라푸치노|콜드브루|돌체|카라멜|사이즈\s*업|리워드|1\s*\+\s*1)/;
    const weakHint = /(상품권|쿠폰|교환권|금액권|충전권|모바일|상품)/;
    const titleLine = candidates.find((l) => strongHint.test(l)) || candidates.find((l) => weakHint.test(l)) || candidates.find((l) => !looksHeader.test(l));
    const titleHint = strongHint;
    if (titleLine) out.title = titleLine.trim();

    if (!out.brand) {
      const headerish = candidates.find((l) => !looksHeader.test(l) && !titleHint.test(l));
      if (headerish && headerish.length <= 14) out.brand = headerish;
      else if (candidates[0] && candidates[0].length <= 14) out.brand = candidates[0];
    }
    if (!out.title && out.brand) {
      const other = candidates.find((l) => l !== out.brand && !looksHeader.test(l));
      if (other) out.title = other;
    }

    // 상품명 앞에 브랜드가 또 붙어 있으면 떼어 냅니다. (예: "메가커피 아메리카노 1잔")
    if (out.title && out.brand) {
      const re = new RegExp("^" + out.brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*[-:·]?\\s*", "i");
      const stripped = out.title.replace(re, "").trim();
      if (stripped.length >= 2) out.title = stripped;
    }

    out.folder = detectFolder(text, out.brand);
    return out;
  }

  /* =========================================================
   * 6. 쿠폰 추가 / 수정 모달
   * =======================================================*/
  const modal = {
    editId: null,
    image: null,       // dataURL
    memberEditId: null,
    memberImage: null
  };

  function resetCouponForm() {
    ["fBrand", "fTitle", "fCode", "fExpiry", "fMemo", "fBalance"].forEach((id) => ($(id).value = ""));
    $("pasteInput").value = "";
    $("fFolder").value = state.folder !== "전체" && state.folder !== "멤버십 카드" ? state.folder : "사진첩";
    $("fType").value = "교환권";
    $("balanceRow").classList.add("hidden");
    modal.image = null;
    modal.editId = null;
    $("photoPreview").classList.add("hidden");
    $("photoPreviewImg").removeAttribute("src");
    $("btnPickImage").classList.remove("hidden");
    $("ocrNote").textContent = "사진을 넣으면 브랜드·쿠폰번호·만료일을 읽어 봐요";
    $("autoStatus").classList.add("hidden");
    $("autoStatus").textContent = "";
  }

  function fillForm(data, overwrite) {
    const set = (id, value) => {
      if (value == null || value === "") return;
      if (!overwrite && $(id).value) return;
      $(id).value = value;
    };
    set("fBrand", data.brand);
    set("fTitle", data.title);
    set("fCode", data.code);
    set("fExpiry", data.expiry);
    if (data.type === "금액권") {
      $("fType").value = "금액권";
      $("balanceRow").classList.remove("hidden");
      set("fBalance", data.balance != null ? String(data.balance) : "");
    }
    if (data.folder) {
      const current = $("fFolder").value;
      if (overwrite || current === "사진첩") $("fFolder").value = data.folder;
    }
  }

  function openCouponModal(coupon) {
    resetCouponForm();
    if (coupon) {
      modal.editId = coupon.id;
      $("couponModalTitle").textContent = "쿠폰 수정";
      $("couponModalSub").textContent = "값을 고친 뒤 저장을 눌러 주세요";
      $("fBrand").value = coupon.brand || "";
      $("fTitle").value = coupon.title || "";
      $("fCode").value = coupon.code || "";
      $("fExpiry").value = coupon.expiry || "";
      $("fFolder").value = coupon.folder || "사진첩";
      $("fType").value = coupon.type || "교환권";
      $("fMemo").value = coupon.memo || "";
      if (coupon.type === "금액권") {
        $("balanceRow").classList.remove("hidden");
        $("fBalance").value = coupon.balance != null ? String(coupon.balance) : "";
      }
      if (coupon.image) {
        modal.image = coupon.image;
        showPhotoPreview(coupon.image);
        $("ocrNote").textContent = "저장된 사진을 다시 읽을 수 있어요";
      }
    } else {
      $("couponModalTitle").textContent = "쿠폰 추가";
      $("couponModalSub").textContent = "이미지나 문자 내용을 붙여넣으면 자동으로 읽어 채워요";
    }
    $("couponModal").classList.remove("hidden");
  }

  function closeCouponModal() {
    $("couponModal").classList.add("hidden");
  }

  function showPhotoPreview(dataUrl) {
    $("photoPreviewImg").src = dataUrl;
    $("photoPreview").classList.remove("hidden");
    $("btnPickImage").classList.add("hidden");
  }

  function setAutoStatus(msg, warn) {
    const el = $("autoStatus");
    if (!msg) { el.classList.add("hidden"); el.textContent = ""; return; }
    el.textContent = msg;
    el.classList.toggle("warn", !!warn);
    el.classList.remove("hidden");
  }

  /* ---- 이미지 → dataURL (필요하면 줄여서 저장) ---- */
  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image-decode"));
      img.src = src;
    });
  }

  async function fileToStorableDataUrl(file) {
    if (!file || !/^image\//.test(file.type || "")) throw new Error("not-image");
    const raw = await readAsDataUrl(file);
    if (file.size <= 700 * 1024) return raw;
    try {
      const img = await loadImage(raw);
      const maxDim = 1600;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL("image/jpeg", 0.9);
    } catch (e) {
      return raw;
    }
  }

  /* ---- OCR (Tesseract.js, 필요할 때만 CDN에서 불러옴) ---- */
  const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
  let ocrWorker = null;
  let ocrWorkerPromise = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("script-load"));
      document.head.appendChild(s);
    });
  }

  function getOcrWorker(onProgress) {
    if (ocrWorker) return Promise.resolve(ocrWorker);
    if (!ocrWorkerPromise) {
      ocrWorkerPromise = (async () => {
        if (!window.Tesseract) await loadScript(TESSERACT_URL);
        const worker = await window.Tesseract.createWorker("kor+eng", 1, {
          logger: (m) => {
            if (typeof onProgress === "function" && m && m.status === "recognizing text") {
              onProgress(Math.round((m.progress || 0) * 100));
            }
          }
        });
        ocrWorker = worker;
        return worker;
      })().catch((e) => { ocrWorkerPromise = null; throw e; });
    }
    return ocrWorkerPromise;
  }

  async function runOCR(dataUrl, onProgress) {
    const worker = await getOcrWorker(onProgress);
    const result = await worker.recognize(dataUrl);
    return (result && result.data && result.data.text) || "";
  }

  async function handleCouponImage(file) {
    if (!file) return;
    try {
      const dataUrl = await fileToStorableDataUrl(file);
      modal.image = dataUrl;
      showPhotoPreview(dataUrl);
      $("ocrNote").textContent = "사진을 읽는 중이에요…";
      setAutoStatus("사진에서 글자를 읽고 있어요. 처음 한 번은 준비에 조금 걸릴 수 있어요.");
      let text = "";
      try {
        text = await Promise.race([
          runOCR(dataUrl, (p) => setAutoStatus(`사진에서 글자를 읽고 있어요… ${p}%`)),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 90000))
        ]);
      } catch (err) {
        setAutoStatus(
          "사진 글자 읽기 도구를 불러오지 못했어요(오프라인일 수 있어요).\n사진은 그대로 저장되니, 문자 내용을 아래에 붙여넣고 [자동 인식]을 눌러 주세요.",
          true
        );
        $("ocrNote").textContent = "사진은 저장돼요 · 글자는 직접 넣어 주세요";
        return;
      }

      const parsed = parseCouponText(text);
      const found = [parsed.brand && "브랜드", parsed.title && "상품명", parsed.code && "쿠폰번호", parsed.expiry && "만료일"].filter(Boolean);
      if (found.length) {
        fillForm(parsed, false);
        if (!parsed.folder) $("fFolder").value = state.folder !== "전체" && state.folder !== "멤버십 카드" ? state.folder : "사진첩";
        setAutoStatus(`사진에서 ${found.join(" · ")}을(를) 찾아 채웠어요. 맞는지 한 번 봐 주세요.`);
        $("ocrNote").textContent = "사진에서 읽은 내용을 채웠어요";
      } else {
        fillForm(parsed, false);
        setAutoStatus(
          "사진에서 쿠폰번호·만료일을 찾지 못했어요. 아래 칸에 직접 넣어 주세요.\n(사진은 그대로 함께 저장됩니다)",
          true
        );
        $("ocrNote").textContent = "글자를 찾지 못했어요 · 직접 입력";
        if (text.trim()) console.info("[OCR text]", text);
      }
    } catch (e) {
      toast("이미지를 읽지 못했어요. 다른 사진으로 해보세요.");
    }
  }

  async function handleAutoParse() {
    const text = $("pasteInput").value;
    if (!text.trim()) {
      setAutoStatus("붙여넣은 내용이 없어요. 문자나 카톡 내용을 먼저 붙여넣어 주세요.", true);
      return;
    }
    const parsed = parseCouponText(text);
    const found = [parsed.brand && "브랜드", parsed.title && "상품명", parsed.code && "쿠폰번호", parsed.expiry && "만료일", parsed.balance && "금액"].filter(Boolean);
    if (!found.length) {
      setAutoStatus("쿠폰번호나 만료일을 찾지 못했어요. 직접 입력해 주세요.", true);
      return;
    }
    fillForm(parsed, false);
    setAutoStatus(`${found.join(" · ")}을(를) 찾아 채웠어요. 맞는지 한 번 봐 주세요.`);
  }

  async function saveCoupon() {
    const brand = $("fBrand").value.trim();
    const title = $("fTitle").value.trim();
    const code = $("fCode").value.trim();
    const expiry = $("fExpiry").value;
    const folder = $("fFolder").value;
    const type = $("fType").value;
    const balanceRaw = $("fBalance").value;
    const memo = $("fMemo").value.trim();

    if (!brand) { toast("브랜드명을 넣어 주세요."); $("fBrand").focus(); return; }
    if (!title) { toast("기프티콘 내용을 넣어 주세요."); $("fTitle").focus(); return; }
    if (code && normalizeCode(code).length < 6) {
      const ok = await askConfirm("쿠폰번호가 짧아요. 이대로 저장할까요?", "저장");
      if (!ok) return;
    }

    const now = Date.now();
    const existing = modal.editId ? state.coupons.find((c) => c.id === modal.editId) : null;
    const rec = {
      id: existing ? existing.id : uid(),
      brand,
      title,
      code: code ? normalizeCode(code) : "",
      expiry: expiry || "",
      folder,
      type,
      balance: type === "금액권" && balanceRaw !== "" ? Number(balanceRaw) : null,
      memo,
      image: modal.image || null,
      used: existing ? !!existing.used : false,
      usedAt: existing ? existing.usedAt || null : null,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    };

    try {
      await store.put("coupons", rec);
    } catch (e) {
      toast("저장하지 못했어요. 저장 공간을 확인해 주세요.");
      console.error(e);
      return;
    }
    if (existing) {
      const i = state.coupons.findIndex((c) => c.id === rec.id);
      state.coupons[i] = rec;
      toast("수정했어요.");
    } else {
      state.coupons.push(rec);
      toast("기프티콘을 담았어요.");
    }
    closeCouponModal();
    renderAll();
  }

  /* =========================================================
   * 7. 쿠폰 열기
   * =======================================================*/
  let viewingId = null;
  let viewingImageShown = false;

  function openCouponView(id) {
    const c = state.coupons.find((x) => x.id === id);
    if (!c) return;
    viewingId = id;
    viewingImageShown = false;
    const d = ddayInfo(c);
    $("viewBrand").textContent = c.brand || "쿠폰";
    $("viewSub").textContent = [c.type === "금액권" && c.balance ? "잔액 " + won(c.balance) : "교환권", c.expiry ? "~" + fmtDot(c.expiry) : "", c.used ? "사용완료" : d.text]
      .filter(Boolean).join(" · ");

    const imgWrap = $("viewImageWrap");
    imgWrap.classList.add("hidden");
    const toggle = $("btnToggleImage");
    if (c.image) {
      $("viewImage").src = c.image;
      toggle.classList.remove("hidden");
      toggle.textContent = "원본 사진 보기";
    } else {
      toggle.classList.add("hidden");
      $("viewImage").removeAttribute("src");
    }

    $("viewCode").textContent = c.code || "쿠폰번호 없음";
    $("viewMeta").innerHTML = [
      ["브랜드", c.brand || "-"],
      ["상품명", c.title || "-"],
      ["만료일", c.expiry ? `${fmtKorean(c.expiry)} (${d.text})` : "기한 없음"],
      ["폴더", c.folder || "-"],
      ["유형", c.type === "금액권" ? "금액권 · 잔액 " + won(c.balance) : "교환권"],
      ["메모", c.memo || "-"]
    ].map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");

    $("btnViewUsed").textContent = c.used ? "사용 취소" : "사용 완료 처리";
    $("couponViewModal").classList.remove("hidden");

    requestAnimationFrame(() => {
      const ok = drawBarcode($("viewBarcode"), c.code, 110);
      $("barcodeEmpty").classList.toggle("hidden", !!ok);
    });
  }

  async function toggleUsed() {
    const c = state.coupons.find((x) => x.id === viewingId);
    if (!c) return;
    const rec = { ...c, used: !c.used, usedAt: c.used ? null : Date.now(), updatedAt: Date.now() };
    await store.put("coupons", rec);
    const i = state.coupons.findIndex((x) => x.id === rec.id);
    state.coupons[i] = rec;
    toast(rec.used ? "사용 완료로 표시했어요." : "사용 완료를 취소했어요.");
    $("couponViewModal").classList.add("hidden");
    renderAll();
  }

  async function deleteCoupon() {
    const c = state.coupons.find((x) => x.id === viewingId);
    if (!c) return;
    const ok = await askConfirm(`"${c.brand} ${c.title}"을(를) 지울까요?\n지운 기프티콘은 되돌릴 수 없어요.`, "삭제");
    if (!ok) return;
    await store.remove("coupons", c.id);
    state.coupons = state.coupons.filter((x) => x.id !== c.id);
    $("couponViewModal").classList.add("hidden");
    renderAll();
    toast("삭제했어요.");
  }

  async function copyText(text) {
    if (!text) { toast("복사할 번호가 없어요."); return; }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      toast("복사했어요.");
    } catch (e) {
      toast("복사하지 못했어요. 길게 눌러 복사해 주세요.");
    }
  }

  /* =========================================================
   * 8. 멤버십 카드
   * =======================================================*/
  function openMemberModal(member) {
    modal.memberEditId = member ? member.id : null;
    modal.memberImage = member ? member.image || null : null;
    $("memberModalTitle").textContent = member ? "멤버십 카드 수정" : "멤버십 추가";
    $("mBrand").value = member ? member.brand || "" : "";
    $("mNumber").value = member ? formatNumberInput(member.number) : "";
    $("memberPhotoPreview").classList.toggle("hidden", !modal.memberImage);
    $("btnPickMemberImage").classList.toggle("hidden", !!modal.memberImage);
    if (modal.memberImage) $("memberPhotoPreviewImg").src = modal.memberImage;
    $("memberModal").classList.remove("hidden");
    requestAnimationFrame(updateMemberPreview);
  }

  function formatNumberInput(number) {
    const digits = String(number || "").replace(/\D/g, "");
    return digits.replace(/(.{4})/g, "$1 ").trim();
  }

  function updateMemberPreview() {
    const canvas = $("memberBarcodePreview");
    const value = $("mNumber").value.replace(/\D/g, "");
    const ok = value ? drawBarcode(canvas, value, 70) : false;
    if (!value) {
      const ctx = canvas.getContext("2d");
      canvas.width = canvas.clientWidth * (window.devicePixelRatio || 1);
      canvas.height = 70 * (window.devicePixelRatio || 1);
      ctx.fillStyle = "#fbfaff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    $("memberBarcodeEmpty").classList.toggle("hidden", !!ok);
  }

  async function saveMember() {
    const brand = $("mBrand").value.trim();
    const number = $("mNumber").value.replace(/\D/g, "");
    if (!brand) { toast("브랜드명을 넣어 주세요."); $("mBrand").focus(); return; }
    if (number.length < 6) { toast("카드 번호를 조금 더 넣어 주세요."); $("mNumber").focus(); return; }

    const existing = modal.memberEditId ? state.members.find((m) => m.id === modal.memberEditId) : null;
    const now = Date.now();
    const rec = {
      id: existing ? existing.id : uid(),
      brand,
      number,
      image: modal.memberImage || null,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    };
    await store.put("members", rec);
    if (existing) {
      const i = state.members.findIndex((m) => m.id === rec.id);
      state.members[i] = rec;
      toast("수정했어요.");
    } else {
      state.members.push(rec);
      toast("멤버십 카드를 담았어요.");
    }
    $("memberModal").classList.add("hidden");
    renderAll();
  }

  let viewingMemberId = null;

  function openMemberView(id) {
    const m = state.members.find((x) => x.id === id);
    if (!m) return;
    viewingMemberId = id;
    $("memberViewBrand").textContent = m.brand;
    $("memberViewNumber").textContent = formatNumberInput(m.number) || "번호 없음";
    $("memberImageWrap").classList.add("hidden");
    if (m.image) {
      $("memberImage").src = m.image;
      $("btnToggleMemberImage").classList.remove("hidden");
      $("btnToggleMemberImage").textContent = "원본 사진 보기";
    } else {
      $("btnToggleMemberImage").classList.add("hidden");
    }
    $("memberViewModal").classList.remove("hidden");
    requestAnimationFrame(() => drawBarcode($("memberViewBarcode"), m.number, 110));
  }

  async function deleteMember() {
    const m = state.members.find((x) => x.id === viewingMemberId);
    if (!m) return;
    const ok = await askConfirm(`"${m.brand}" 멤버십 카드를 지울까요?`, "삭제");
    if (!ok) return;
    await store.remove("members", m.id);
    state.members = state.members.filter((x) => x.id !== m.id);
    $("memberViewModal").classList.add("hidden");
    renderAll();
    toast("삭제했어요.");
  }

  /* =========================================================
   * 9. 백업 · 복원
   * =======================================================*/
  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  function backupJson() {
    const payload = {
      app: "gifticon-collection",
      version: 1,
      exportedAt: new Date().toISOString(),
      coupons: state.coupons,
      members: state.members
    };
    download(`gifticon-backup-${todayStr()}.json`, JSON.stringify(payload, null, 2), "application/json");
    toast("백업 파일을 저장했어요.");
  }

  function restoreFromFile(file) {
    const fr = new FileReader();
    fr.onload = async () => {
      let data;
      try {
        data = JSON.parse(String(fr.result));
      } catch (e) {
        toast("백업 파일을 읽지 못했어요.");
        return;
      }
      const coupons = Array.isArray(data) ? data : data.coupons;
      const members = (Array.isArray(data) ? [] : data.members) || [];
      if (!Array.isArray(coupons) && !Array.isArray(members)) {
        toast("이 앱의 백업 파일이 아니에요.");
        return;
      }
      const ok = await askConfirm(
        `백업에서 기프티콘 ${(coupons || []).length}장, 멤버십 ${members.length}장을 불러올까요?\n지금 보관 중인 항목은 그대로 두고 같은 항목만 갱신해요.`,
        "불러오기"
      );
      if (!ok) return;

      const cleanCoupons = (coupons || []).filter((c) => c && c.id && c.brand).map((c) => ({
        id: c.id,
        brand: c.brand || "",
        title: c.title || "",
        code: c.code || "",
        expiry: c.expiry || "",
        folder: FOLDERS.includes(c.folder) ? c.folder : "기타",
        type: c.type === "금액권" ? "금액권" : "교환권",
        balance: c.balance != null ? Number(c.balance) : null,
        memo: c.memo || "",
        image: c.image || null,
        used: !!c.used,
        usedAt: c.usedAt || null,
        createdAt: c.createdAt || Date.now(),
        updatedAt: c.updatedAt || Date.now()
      }));
      const cleanMembers = members.filter((m) => m && m.id && m.brand).map((m) => ({
        id: m.id,
        brand: m.brand || "",
        number: String(m.number || "").replace(/\D/g, ""),
        image: m.image || null,
        createdAt: m.createdAt || Date.now(),
        updatedAt: m.updatedAt || Date.now()
      }));

      await store.bulk("coupons", cleanCoupons);
      await store.bulk("members", cleanMembers);
      await loadData();
      renderAll();
      toast(`기프티콘 ${cleanCoupons.length}장 · 멤버십 ${cleanMembers.length}장을 불러왔어요.`);
    };
    fr.readAsText(file);
  }

  /* =========================================================
   * 10. .ics 캘린더 알림
   * =======================================================*/
  function icsEscape(str) {
    return String(str || "")
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r?\n/g, "\\n");
  }

  /** 75옥타브(byte) 넘지 않게 줄바꿈 (한글은 3바이트) */
  function foldLine(line) {
    const bytes = new TextEncoder().encode(line);
    if (bytes.length <= 73) return line;
    const out = [];
    let current = "";
    let size = 0;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const chSize = new TextEncoder().encode(ch).length;
      if (size + chSize > 73) {
        out.push(current);
        current = " " + ch;
        size = 1 + chSize;
      } else {
        current += ch;
        size += chSize;
      }
    }
    if (current) out.push(current);
    return out.join("\r\n");
  }

  function utcStamp() {
    const d = new Date();
    return (
      d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + "T" +
      pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + "Z"
    );
  }

  function buildIcs(coupons) {
    const stamp = utcStamp();
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Gifticon Collection//KO",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:기프티콘 만료 알림",
      "X-WR-TIMEZONE:Asia/Seoul",
      "BEGIN:VTIMEZONE",
      "TZID:Asia/Seoul",
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      "TZOFFSETFROM:+0900",
      "TZOFFSETTO:+0900",
      "TZNAME:KST",
      "END:STANDARD",
      "END:VTIMEZONE"
    ];

    let count = 0;
    coupons.forEach((c, idx) => {
      const d = parseYmd(c.expiry);
      if (!d) return;
      const ymd = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
      const summary = `🎁 ${c.brand} 기프티콘 만료 (${c.title})`;
      const desc = [
        `브랜드: ${c.brand}`,
        `내용: ${c.title}`,
        c.code ? `쿠폰번호: ${c.code}` : "",
        `만료일: ${fmtDot(c.expiry)}`,
        c.folder ? `폴더: ${c.folder}` : "",
        c.memo ? `메모: ${c.memo}` : ""
      ].filter(Boolean).join("\n");

      lines.push("BEGIN:VEVENT");
      lines.push(`UID:gifticon-${c.id}-${idx}@gifticon-collection`);
      lines.push(`DTSTAMP:${stamp}`);
      lines.push(`DTSTART;TZID=Asia/Seoul:${ymd}T090000`);
      lines.push(`DTEND;TZID=Asia/Seoul:${ymd}T093000`);
      lines.push(`SUMMARY:${icsEscape(summary)}`);
      lines.push(`DESCRIPTION:${icsEscape(desc)}`);
      lines.push("TRANSP:TRANSPARENT");
      lines.push("BEGIN:VALARM");
      lines.push("ACTION:DISPLAY");
      lines.push(`DESCRIPTION:${icsEscape(summary + " — 7일 뒤 만료예요")}`);
      lines.push("TRIGGER:-P7D");
      lines.push("END:VALARM");
      lines.push("END:VEVENT");
      count++;
    });

    lines.push("END:VCALENDAR");
    if (!count) return null;
    return lines.map(foldLine).join("\r\n") + "\r\n";
  }

  function exportIcs() {
    const targets = state.coupons.filter((c) => {
      if (c.used) return false;
      const n = daysUntil(c.expiry);
      return n !== null && n >= 0;
    });
    if (!targets.length) {
      toast("알림을 만들 만료 예정 기프티콘이 없어요.");
      return;
    }
    const ics = buildIcs(targets);
    if (!ics) { toast("만료일이 있는 기프티콘이 없어요."); return; }
    download("gifticon-expiry-alerts.ics", ics, "text/calendar;charset=utf-8");
    toast(`만료 7일 전 오전 9시 알림 ${targets.length}건을 담았어요.`);
  }

  /* =========================================================
   * 11. 만료 알림 (브라우저 Notification)
   * =======================================================*/
  function urgentCoupons() {
    return state.coupons
      .filter((c) => {
        if (c.used) return false;
        const n = daysUntil(c.expiry);
        return n !== null && n >= 0 && n <= 7;
      })
      .sort((a, b) => daysUntil(a.expiry) - daysUntil(b.expiry));
  }

  async function notifyExpiring() {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const urgent = urgentCoupons();
    if (!urgent.length) return;
    const key = "gc-notified-" + todayStr();
    if (localStorage.getItem(key)) return;

    const title = `🎁 기프티콘 ${urgent.length}장이 곧 만료돼요`;
    const body = urgent.slice(0, 3).map((c) => {
      const d = ddayInfo(c);
      return `${c.brand} ${c.title} (${d.text})`;
    }).join(" · ") + (urgent.length > 3 ? " 외" : "");

    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(title, { body, icon: "icon-192.png", tag: "gc-expiry", badge: "icon-192.png" });
      } else {
        new Notification(title, { body, icon: "icon-192.png", tag: "gc-expiry" });
      }
      localStorage.setItem(key, "1");
    } catch (e) {
      console.warn("알림을 표시하지 못했어요", e);
    }
  }

  async function enableNotifications() {
    if (!("Notification" in window)) {
      toast("이 브라우저에서는 알림을 지원하지 않아요.");
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      if (perm === "granted") {
        toast("만료 알림을 켰어요. 앱을 열 때 7일 안에 만료되는 기프티콘을 알려 드려요.");
        renderToolbar();
        notifyExpiring();
      } else if (perm === "denied") {
        toast("알림이 꺼져 있어요. 폰 설정에서 이 사이트 알림을 허용해 주세요.");
      } else {
        toast("알림 권한을 나중에 정할 수 있어요.");
      }
    } catch (e) {
      toast("알림 권한을 요청하지 못했어요.");
    }
  }

  /* =========================================================
   * 12. 이벤트 연결
   * =======================================================*/
  function bindEvents() {
    $("btnAddCoupon").addEventListener("click", () => openCouponModal());
    $("btnGoMembership").addEventListener("click", () => {
      setFolder("멤버십 카드");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    $("btnAddMember").addEventListener("click", () => openMemberModal());

    $("folderTabs").addEventListener("click", (e) => {
      const btn = e.target.closest(".tab-chip");
      if (!btn) return;
      setFolder(btn.dataset.folder);
    });

    $("searchInput").addEventListener("input", (e) => {
      state.search = e.target.value;
      $("btnClearSearch").classList.toggle("hidden", !state.search);
      renderList();
      renderFooter();
    });
    $("btnClearSearch").addEventListener("click", () => {
      state.search = "";
      $("searchInput").value = "";
      $("btnClearSearch").classList.add("hidden");
      renderList();
      renderFooter();
    });

    $("btnSort").addEventListener("click", () => {
      state.sort = state.sort === "expiry" ? "added" : "expiry";
      renderToolbar();
      renderList();
    });
    $("btnShowUsed").addEventListener("click", () => {
      state.showUsed = !state.showUsed;
      renderToolbar();
      renderList();
    });
    $("btnEnableNotif").addEventListener("click", enableNotifications);

    $("listArea").addEventListener("click", (e) => {
      const memberEl = e.target.closest("[data-member]");
      if (memberEl) { openMemberView(memberEl.dataset.member); return; }
      const openBtn = e.target.closest("[data-open]");
      if (openBtn) { openCouponView(openBtn.dataset.open); return; }
      const card = e.target.closest(".coupon-card");
      if (card) openCouponView(card.dataset.id);
    });

    // 쿠폰 추가/수정
    $("btnCloseCouponModal").addEventListener("click", closeCouponModal);
    $("btnCancelCoupon").addEventListener("click", closeCouponModal);
    $("btnSaveCoupon").addEventListener("click", saveCoupon);
    $("btnAutoParse").addEventListener("click", handleAutoParse);
    $("btnPickImage").addEventListener("click", () => $("couponFileInput").click());
    $("couponFileInput").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (file) handleCouponImage(file);
    });
    $("btnRemoveImage").addEventListener("click", () => {
      modal.image = null;
      $("photoPreview").classList.add("hidden");
      $("photoPreviewImg").removeAttribute("src");
      $("btnPickImage").classList.remove("hidden");
      $("ocrNote").textContent = "사진을 넣으면 브랜드·쿠폰번호·만료일을 읽어 봐요";
    });
    $("fType").addEventListener("change", (e) => {
      $("balanceRow").classList.toggle("hidden", e.target.value !== "금액권");
    });

    // 쿠폰 열기
    $("btnCloseView").addEventListener("click", () => $("couponViewModal").classList.add("hidden"));
    $("btnCopyCode").addEventListener("click", () => {
      const c = state.coupons.find((x) => x.id === viewingId);
      copyText(c ? c.code : "");
    });
    $("btnToggleImage").addEventListener("click", () => {
      const wrap = $("viewImageWrap");
      const hidden = wrap.classList.contains("hidden");
      wrap.classList.toggle("hidden", !hidden);
      $("btnToggleImage").textContent = hidden ? "사진 접기" : "원본 사진 보기";
    });
    $("viewImage").addEventListener("click", () => {
      const c = state.coupons.find((x) => x.id === viewingId);
      if (c && c.image) openLightbox(c.image);
    });
    $("btnViewEdit").addEventListener("click", () => {
      const c = state.coupons.find((x) => x.id === viewingId);
      $("couponViewModal").classList.add("hidden");
      if (c) openCouponModal(c);
    });
    $("btnViewUsed").addEventListener("click", toggleUsed);
    $("btnViewDelete").addEventListener("click", deleteCoupon);

    // 멤버십
    $("btnCloseMemberModal").addEventListener("click", () => $("memberModal").classList.add("hidden"));
    $("btnCancelMember").addEventListener("click", () => $("memberModal").classList.add("hidden"));
    $("btnSaveMember").addEventListener("click", saveMember);
    $("mNumber").addEventListener("input", updateMemberPreview);
    $("btnPickMemberImage").addEventListener("click", () => $("memberFileInput").click());
    $("memberFileInput").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        modal.memberImage = await fileToStorableDataUrl(file);
        $("memberPhotoPreviewImg").src = modal.memberImage;
        $("memberPhotoPreview").classList.remove("hidden");
        $("btnPickMemberImage").classList.add("hidden");
      } catch (err) { toast("사진을 넣지 못했어요."); }
    });
    $("btnRemoveMemberImage").addEventListener("click", () => {
      modal.memberImage = null;
      $("memberPhotoPreview").classList.add("hidden");
      $("btnPickMemberImage").classList.remove("hidden");
    });
    $("btnCloseMemberView").addEventListener("click", () => $("memberViewModal").classList.add("hidden"));
    $("btnCopyMemberNumber").addEventListener("click", () => {
      const m = state.members.find((x) => x.id === viewingMemberId);
      copyText(m ? m.number : "");
    });
    $("btnToggleMemberImage").addEventListener("click", () => {
      const wrap = $("memberImageWrap");
      const hidden = wrap.classList.contains("hidden");
      wrap.classList.toggle("hidden", !hidden);
      $("btnToggleMemberImage").textContent = hidden ? "사진 접기" : "원본 사진 보기";
    });
    $("memberImage").addEventListener("click", () => {
      const m = state.members.find((x) => x.id === viewingMemberId);
      if (m && m.image) openLightbox(m.image);
    });
    $("btnMemberEdit").addEventListener("click", () => {
      const m = state.members.find((x) => x.id === viewingMemberId);
      $("memberViewModal").classList.add("hidden");
      if (m) openMemberModal(m);
    });
    $("btnMemberDelete").addEventListener("click", deleteMember);

    // 확인 모달
    $("btnConfirmOk").addEventListener("click", () => closeConfirm(true));
    $("btnConfirmCancel").addEventListener("click", () => closeConfirm(false));
    $("confirmModal").addEventListener("click", (e) => {
      if (e.target === $("confirmModal")) closeConfirm(false);
    });

    // 백업
    $("btnBackup").addEventListener("click", backupJson);
    $("btnRestore").addEventListener("click", () => $("restoreFileInput").click());
    $("restoreFileInput").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (file) restoreFromFile(file);
    });
    $("btnIcs").addEventListener("click", exportIcs);

    // 라이트박스 / 백드롭
    $("lightboxClose").addEventListener("click", closeLightbox);
    $("lightbox").addEventListener("click", (e) => { if (e.target === $("lightbox")) closeLightbox(); });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!$("lightbox").classList.contains("hidden")) { closeLightbox(); return; }
      ["couponModal", "couponViewModal", "memberModal", "memberViewModal"].forEach((id) => $(id).classList.add("hidden"));
      if (!$("confirmModal").classList.contains("hidden")) closeConfirm(false);
    });

    window.addEventListener("resize", () => {
      if (!$("couponViewModal").classList.contains("hidden")) {
        const c = state.coupons.find((x) => x.id === viewingId);
        if (c) drawBarcode($("viewBarcode"), c.code, 110);
      }
      if (!$("memberViewModal").classList.contains("hidden")) {
        const m = state.members.find((x) => x.id === viewingMemberId);
        if (m) drawBarcode($("memberViewBarcode"), m.number, 110);
      }
    });
  }

  function setFolder(folder) {
    state.folder = folder;
    renderTabs();
    renderToolbar();
    renderList();
    renderFooter();
  }

  function openLightbox(src) {
    $("lightboxImg").src = src;
    $("lightbox").classList.remove("hidden");
  }
  function closeLightbox() {
    $("lightbox").classList.add("hidden");
    $("lightboxImg").removeAttribute("src");
  }

  /* =========================================================
   * 13. 시작
   * =======================================================*/
  async function loadData() {
    state.coupons = await store.all("coupons");
    state.members = await store.all("members");
  }

  async function boot() {
    await initStorage();
    try {
      await loadData();
    } catch (e) {
      console.error(e);
      toast("저장된 목록을 불러오지 못했어요.");
    }
    bindEvents();
    renderAll();
    if ("Notification" in window && Notification.permission === "granted") {
      setTimeout(notifyExpiring, 900);
    }
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js").catch(() => {});
      });
    }
  }

  // 테스트용 (앱 동작에는 영향 없음)
  window.__gc = { parseCouponText, code128Bits, buildIcs, daysUntil, ddayInfo, groupDigits };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
