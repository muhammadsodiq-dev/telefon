/* =========================================================================
   CALL MANAGEMENT SYSTEM — Frontend (Auth + Operator + Admin)
   ========================================================================= */

const API_BASE_URL = ""; // Vercel serverless proksi orqali (/api/[...path].js)
const WS_URL = "http://178.104.182.81:8082/ws"; // <-- backend WebSocket manzilini shu yerga yozing, masalan: "wss://178.104.182.81:8082/ws"

let ws = null;
let phoneLockMap = {}; // phoneId -> {locked, operatorId, operatorName}

function connectWebSocket() {
  if (!WS_URL) return;
  try {
    ws = new WebSocket(WS_URL);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.phoneId !== undefined) {
          phoneLockMap[data.phoneId] = { locked: data.locked, operatorId: data.operatorId, operatorName: data.operatorName };
          refreshLockDisplays();
        }
      } catch (_) {}
    };
    ws.onclose = () => { setTimeout(connectWebSocket, 3000); };
    ws.onerror = () => { try { ws.close(); } catch (_) {} };
  } catch (_) {}
}

function lockCellHtml(id) {
  const info = phoneLockMap[id];
  if (info && info.locked) {
    return `<span class="live-dot" style="display:inline-block;"></span> <span class="muted small">${escapeHtml(info.operatorName || "Band")}</span>`;
  }
  return "";
}

function refreshLockDisplays() {
  document.querySelectorAll("[data-lock-row]").forEach((row) => {
    const id = row.dataset.lockRow;
    const cell = row.querySelector(".lock-indicator");
    if (cell) cell.innerHTML = lockCellHtml(id);
    const takeBtn = row.querySelector("[data-take]");
    const info = phoneLockMap[id];
    if (takeBtn) takeBtn.disabled = !!(info && info.locked && info.operatorId !== (currentUser && currentUser.id));
  });
}

const UZ_MOBILE_PREFIXES = ["90","91","93","94","95","97","98","99","33","88","20","50","55","77"];

const STATUS_META = {
  NEW: { label: "Yangi", color: "neutral" },
  CONNECTED: { label: "Bog'landi", color: "ok" },
  NO_ANSWER: { label: "Ko'tarilmadi", color: "warn" },
  BUSY: { label: "Band", color: "warn" },
  CALLBACK_REQUIRED: { label: "Qayta aloqa", color: "purple" },
  WRONG_NUMBER: { label: "Noto'g'ri raqam", color: "neutral" },
  NOT_INTERESTED: { label: "Qiziqmadi", color: "neutral" },
  BLACKLISTED: { label: "Qora ro'yxatda", color: "danger" },
  FINISHED: { label: "Yakunlangan", color: "ok" },
};
const STATUS_LIST = Object.keys(STATUS_META);

const USER_STATUS_META = {
  ACTIVE: { label: "Faol", color: "ok" },
  UNVERIFIED: { label: "Tasdiqlanmagan", color: "warn" },
  BLOCKED: { label: "Bloklangan", color: "danger" },
};
function userStatusBadge(status) {
  const m = USER_STATUS_META[status] || { label: status || "-", color: "neutral" };
  return `<span class="badge ${m.color}"><span class="dot"></span>${m.label}</span>`;
}

/* ------------------------------ Holat ---------------------------------- */
let accessToken = null;
let refreshToken = null;
let currentUser = null; // { id, first_name, last_name, email, role, status }
let myActivePhoneId = null;

/* ============================== API qatlami ============================= */
async function apiFetch(path, options = {}, retry = true) {
  const headers = Object.assign(
    { "Content-Type": "application/json" },
    options.headers || {},
    accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
  );
  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

  if (res.status === 401 && retry && refreshToken) {
    const ok = await tryRefreshToken();
    if (ok) return apiFetch(path, options, false);
    forceLogout();
    throw new Error("Sessiya tugadi, qaytadan kiring.");
  }
  if (!res.ok) {
    let msg = `Xatolik (${res.status})`;
    try { const b = await res.json(); msg = b.message || b.error || msg; } catch (_) {}
    throw new Error(msg);
  }
  try { return await res.json(); } catch (_) { return null; }
}

async function tryRefreshToken() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    accessToken = data.access_token;
    refreshToken = data.refresh_token || refreshToken;
    return true;
  } catch (_) { return false; }
}

const api = {
  login: (email, password) => apiFetch("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }, false),
  register: (payload) => apiFetch("/api/auth/register", { method: "POST", body: JSON.stringify(payload) }, false),
  verify: (email, code) => apiFetch("/api/auth/verify", { method: "POST", body: JSON.stringify({ email, code }) }, false),
  restartPassword: (first_name, email) => apiFetch("/api/auth/reset-password", { method: "POST", body: JSON.stringify({ first_name, email }) }, false),
  verifyResetCode: (email, code, new_password) => apiFetch("/api/auth/reset-password/verify-otp", { method: "POST", body: JSON.stringify({ email, code, new_password }) }, false),

  me: () => apiFetch("/api/users/me"),
  updateMe: (payload) => apiFetch("/api/users", { method: "PATCH", body: JSON.stringify(payload) }),
  listUsers: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v) q.set(k, v); });
    return apiFetch(`/api/users?${q.toString()}`);
  },
  updateUserByAdmin: (id, payload) => apiFetch(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  changeUserRole: (userId, role) => apiFetch(`/api/users/role?role=${role}&userId=${userId}`, { method: "PATCH" }),
  changeUserStatus: (userId, status) => apiFetch(`/api/users/${userId}/status?status=${status}`, { method: "PATCH" }),
  deleteUser: (userId) => apiFetch(`/api/users/${userId}`, { method: "DELETE" }),
  getPhoneStatistics: () => apiFetch("/api/phones/statistics"),
  getCallHistoryStatistics: () => apiFetch("/api/call-history/statistics"),

  listPhones: ({ search = "", status = "", page = 0, size = 10 } = {}) => {
    const q = new URLSearchParams();
    if (search) q.set("search", search);
    if (status) q.set("status", status);
    q.set("page", page); q.set("size", size);
    return apiFetch(`/api/phones?${q.toString()}`);
  },
  createPhone: (payload) => apiFetch("/api/phones", { method: "POST", body: JSON.stringify(payload) }),
  updatePhone: (id, payload) => apiFetch(`/api/phones/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  updateOperatorPhone: (id, status, body) => {
    const q = new URLSearchParams({ status });
    return apiFetch(`/api/phones/${id}/operator?${q.toString()}`, { method: "PATCH", body: JSON.stringify(body) });
  },
  takePhone: (id) => apiFetch(`/api/phones/${id}/take`, { method: "POST" }),
  unlockPhone: (id) => apiFetch(`/api/phones/unlock/${id}`, { method: "PATCH" }),
  deletePhone: (id) => apiFetch(`/api/phones/${id}`, { method: "DELETE" }),
  myActive: () => apiFetch("/api/phones/my-active"),

  listCallHistory: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== "") q.set(k, v); });
    return apiFetch(`/api/call-history?${q.toString()}`);
  },
  deleteHistoryBeforeDate: (beforeDate) => apiFetch(`/api/call-history?beforeDate=${beforeDate}`, { method: "DELETE" }),
};

/* ================================ Validatsiya ============================ */
function normalizeDigits(raw) {
  let d = (raw || "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("998")) d = d.slice(3);
  if (d.length === 10 && d.startsWith("0")) d = d.slice(1);
  return d;
}
function validateUzPhone(raw) {
  const d = normalizeDigits(raw);
  return d.length === 9 && UZ_MOBILE_PREFIXES.includes(d.slice(0, 2));
}
function formatPhoneDisplay(phoneNumber) {
  const d = normalizeDigits(phoneNumber);
  if (d.length !== 9) return phoneNumber || "-";
  return `+998 ${d.slice(0,2)} ${d.slice(2,5)} ${d.slice(5,7)} ${d.slice(7,9)}`;
}
function fmtDate(v) {
  if (!v) return "-";
  const d = new Date(v);
  if (isNaN(d)) return String(v);
  return d.toLocaleString("uz-UZ", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

/* ---------- Custom tasdiqlash oynasi (confirm() o'rniga) ---------- */
function showConfirm(message, title = "Tasdiqlang") {
  return new Promise((resolve) => {
    document.getElementById("confirmTitle").textContent = title;
    document.getElementById("confirmMessage").textContent = message;
    openModal("confirmModal");

    const okBtn = document.getElementById("confirmOkBtn");
    const cancelBtn = document.getElementById("confirmCancelBtn");

    const cleanup = (result) => {
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      closeModal("confirmModal");
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
  });
}
let toastContainer = null;
function showToast(message, type = "danger") {
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.id = "toastContainer";
    toastContainer.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:8px;align-items:center;";
    document.body.appendChild(toastContainer);
  }
  const el = document.createElement("div");
  const bg = type === "ok" ? "var(--ok-bg)" : "var(--danger-bg)";
  const color = type === "ok" ? "var(--ok)" : "var(--danger)";
  const border = type === "ok" ? "rgba(53,200,138,0.35)" : "rgba(255,84,112,0.35)";
  el.style.cssText = `background:${bg};color:${color};border:1px solid ${border};padding:10px 16px;border-radius:10px;font-size:13px;font-family:'Inter',sans-serif;box-shadow:0 10px 30px -6px rgba(0,0,0,.5);opacity:0;transform:translateY(8px);transition:all .2s ease;max-width:90vw;`;
  el.textContent = message;
  toastContainer.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = "1"; el.style.transform = "translateY(0)"; });
  setTimeout(() => {
    el.style.opacity = "0"; el.style.transform = "translateY(8px)";
    setTimeout(() => el.remove(), 250);
  }, 3200);
}
function getUserFullName(u) {
  if (!u) return "-";
  // Backend turli field nomlarida qaytarishi mumkin — hammasini sinab ko'ramiz
  const first = u.first_name || u.firstName || "";
  const last = u.last_name || u.lastName || "";
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;
  if (u.full_name) return u.full_name;
  if (u.fullName) return u.fullName;
  if (u.name) return u.name;
  if (u.username) return u.username;
  return "-";
}
function badgeHtml(status) {
  const m = STATUS_META[status] || { label: status, color: "neutral" };
  return `<span class="badge ${m.color}"><span class="dot"></span>${m.label}</span>`;
}

/* ============================== VIEW ROUTER ============================= */
function show(id) {
  document.getElementById(id).classList.remove("is-hidden");
}
function hide(id) {
  document.getElementById(id).classList.add("is-hidden");
}
function showOnly(ids, activeId) {
  ids.forEach((id) => (id === activeId ? show(id) : hide(id)));
}

const AUTH_VIEWS = ["loginView", "registerView", "verifyView", "verifiedView", "forgotView", "resetView"];
function showAuthView(id) {
  showOnly(AUTH_VIEWS, id);
}

document.querySelectorAll("[data-goto]").forEach((btn) => {
  btn.addEventListener("click", () => showAuthView(btn.dataset.goto));
});

/* ============================== LOGIN ============================= */
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const loginSubmit = document.getElementById("loginSubmit");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.classList.add("is-hidden");
  loginSubmit.disabled = true;
  try {
    const data = await api.login(
      document.getElementById("loginEmail").value.trim(),
      document.getElementById("loginPassword").value
    );
    accessToken = data.access_token;
    refreshToken = data.refresh_token;
    await afterLogin();
  } catch (err) {
    loginError.textContent = err.message || "Login yoki parol noto'g'ri.";
    loginError.classList.remove("is-hidden");
  } finally {
    loginSubmit.disabled = false;
  }
});

async function afterLogin() {
  currentUser = await api.me();
  document.getElementById("authScreen").classList.add("is-hidden");

  const role = (currentUser.role || "USER").toUpperCase();
  connectWebSocket();
  if (role === "ADMIN" || role === "SUPER_USER") {
    show("adminApp");
    initAdminApp();
  } else {
    show("operatorApp");
    initOperatorApp();
  }
}

function forceLogout() {
  accessToken = null; refreshToken = null; currentUser = null; myActivePhoneId = null;
  hide("operatorApp"); hide("adminApp");
  document.getElementById("authScreen").classList.remove("is-hidden");
  showAuthView("loginView");
  loginForm.reset();
}
document.getElementById("opLogoutBtn").addEventListener("click", forceLogout);
document.getElementById("adLogoutBtn").addEventListener("click", forceLogout);

/* ============================== REGISTER ============================= */
const registerForm = document.getElementById("registerForm");
const registerError = document.getElementById("registerError");
const registerSubmit = document.getElementById("registerSubmit");
let pendingVerifyEmail = "";

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  registerError.classList.add("is-hidden");
  registerSubmit.disabled = true;
  const email = document.getElementById("regEmail").value.trim();
  try {
    await api.register({
      first_name: document.getElementById("regFirstName").value.trim(),
      last_name: document.getElementById("regLastName").value.trim(),
      email,
      password: document.getElementById("regPassword").value,
    });
    pendingVerifyEmail = email;
    document.getElementById("verifyEmailLabel").textContent = email;
    showAuthView("verifyView");
    startOtpTimer();
  } catch (err) {
    registerError.textContent = err.message || "Ro'yxatdan o'tishda xatolik.";
    registerError.classList.remove("is-hidden");
  } finally {
    registerSubmit.disabled = false;
  }
});

document.querySelectorAll(".pw-toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.dataset.target);
    input.type = input.type === "password" ? "text" : "password";
  });
});

/* ============================== VERIFY (OTP) ============================= */
const otpInputs = Array.from(document.querySelectorAll(".otp-digit"));
otpInputs.forEach((inp, idx) => {
  inp.addEventListener("input", () => {
    inp.value = inp.value.replace(/\D/g, "").slice(0, 1);
    if (inp.value && otpInputs[idx + 1]) otpInputs[idx + 1].focus();
  });
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && !inp.value && otpInputs[idx - 1]) otpInputs[idx - 1].focus();
  });
});

let otpTimerInterval = null;
function startOtpTimer() {
  let seconds = 59;
  const timerEl = document.getElementById("verifyTimer");
  const resendBtn = document.getElementById("resendCodeBtn");
  resendBtn.disabled = true;
  clearInterval(otpTimerInterval);
  otpTimerInterval = setInterval(() => {
    seconds--;
    timerEl.textContent = `00:${String(Math.max(seconds, 0)).padStart(2, "0")}`;
    if (seconds <= 0) {
      clearInterval(otpTimerInterval);
      resendBtn.disabled = false;
      timerEl.textContent = "00:00";
    }
  }, 1000);
}

document.getElementById("verifyForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const verifyError = document.getElementById("verifyError");
  verifyError.classList.add("is-hidden");
  const code = otpInputs.map((i) => i.value).join("");
  if (code.length !== 4) {
    verifyError.textContent = "4 xonali kodni to'liq kiriting.";
    verifyError.classList.remove("is-hidden");
    return;
  }
  try {
    await api.verify(pendingVerifyEmail, Number(code));
    clearInterval(otpTimerInterval);
    showAuthView("verifiedView");
  } catch (err) {
    verifyError.textContent = err.message || "Kod noto'g'ri yoki muddati o'tgan.";
    verifyError.classList.remove("is-hidden");
  }
});

document.getElementById("resendCodeBtn").addEventListener("click", async () => {
  try {
    await api.restartPassword("", pendingVerifyEmail); // eslatma: qayta yuborish uchun alohida endpoint yo'q, shu bilan urinamiz
  } catch (_) {}
  startOtpTimer();
});

/* ============================== FORGOT / RESET ============================= */
let pendingResetEmail = "";

document.getElementById("forgotForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("forgotError");
  err.classList.add("is-hidden");
  const email = document.getElementById("forgotEmail").value.trim();
  try {
    await api.restartPassword(document.getElementById("forgotFirstName").value.trim(), email);
    pendingResetEmail = email;
    showAuthView("resetView");
  } catch (e2) {
    err.textContent = e2.message || "Xatolik yuz berdi.";
    err.classList.remove("is-hidden");
  }
});

document.getElementById("resetForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("resetError");
  err.classList.add("is-hidden");
  try {
    await api.verifyResetCode(
      pendingResetEmail,
      document.getElementById("resetCode").value.trim(),
      document.getElementById("resetNewPassword").value
    );
    showAuthView("loginView");
  } catch (e2) {
    err.textContent = e2.message || "Kod noto'g'ri.";
    err.classList.remove("is-hidden");
  }
});

document.getElementById("opGoForgotBtn")?.addEventListener("click", () => {
  forceLogout();
  showAuthView("forgotView");
});

/* ============================== MODAL YORDAMCHILARI ============================= */
function openModal(id) { document.getElementById(id).classList.add("open"); }
function closeModal(id) { document.getElementById(id).classList.remove("open"); }
document.querySelectorAll(".js-close").forEach((btn) => {
  btn.addEventListener("click", () => closeModal(btn.dataset.modal));
});
document.querySelectorAll(".modal-overlay").forEach((ov) => {
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.classList.remove("open"); });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") document.querySelectorAll(".modal-overlay.open").forEach((ov) => ov.classList.remove("open"));
});

function renderPager(container, page, totalPages, onGo) {
  container.innerHTML = "";
  if (totalPages <= 1) return;
  const maxBtns = 6;
  let start = Math.max(0, page - 2);
  let end = Math.min(totalPages, start + maxBtns);
  start = Math.max(0, end - maxBtns);
  for (let i = start; i < end; i++) {
    const b = document.createElement("button");
    b.textContent = i + 1;
    if (i === page) b.classList.add("active");
    b.addEventListener("click", () => onGo(i));
    container.appendChild(b);
  }
}

/* =========================================================================
   OPERATOR APP
   ========================================================================= */
const OP_VIEWS = ["opDashboardView", "opActiveView", "opHistoryView", "opProfileView", "opPasswordView"];
let opPage = 0;
const OP_PAGE_SIZE = 8;
let opDebounce = null;

function initOperatorApp() {
  document.getElementById("opAvatar").textContent = getUserFullName(currentUser)[0].toUpperCase();
  document.getElementById("opUserName").textContent = getUserFullName(currentUser);

  document.querySelectorAll("#operatorApp .nav-item[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#operatorApp .nav-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      showOnly(OP_VIEWS, btn.dataset.view + "View");
      if (btn.dataset.view === "opActive") loadOpActive();
      if (btn.dataset.view === "opHistory") loadOpHistory();
      if (btn.dataset.view === "opProfile") loadOpProfile();
    });
  });

  document.getElementById("opSearchInput").addEventListener("input", () => {
    clearTimeout(opDebounce);
    opDebounce = setTimeout(() => { opPage = 0; loadOpPhones(); }, 350);
  });
  document.getElementById("opStatusFilter").addEventListener("change", () => { opPage = 0; loadOpPhones(); });

  loadOpMyActiveBanner();
  loadOpPhones();
}

async function loadOpMyActiveBanner() {
  try {
    const res = await api.myActive();
    const banner = document.getElementById("opActiveBanner");
    if (res && res.id) {
      myActivePhoneId = res.id;
      document.getElementById("opActiveBannerName").textContent = `${formatPhoneDisplay(res.phone_number)} (Siz)`;
      banner.classList.remove("is-hidden");
    } else {
      myActivePhoneId = null;
      banner.classList.add("is-hidden");
    }
  } catch (_) { myActivePhoneId = null; }
}

async function loadOpPhones() {
  const tbody = document.getElementById("opTableBody");
  try {
    const res = await api.listPhones({
      search: document.getElementById("opSearchInput").value.trim(),
      status: document.getElementById("opStatusFilter").value,
      page: opPage, size: OP_PAGE_SIZE,
    });
    document.getElementById("opEmptyState").classList.toggle("is-hidden", res.content.length !== 0);
    tbody.innerHTML = res.content.map((r, i) => `
      <tr data-lock-row="${r.id}">
        <td>${opPage * OP_PAGE_SIZE + i + 1}</td>
        <td class="phone-mono">${formatPhoneDisplay(r.phone_number)}</td>
        <td>${escapeHtml(r.owner_name || "-")}</td>
        <td>${badgeHtml(r.status)}</td>
        <td class="lock-indicator">${lockCellHtml(r.id)}</td>
        <td>
          <div class="row-actions">
            <button class="btn-ghost btn-xs" data-show="${r.id}">Ko'rish</button>
            <button class="btn-primary btn-xs" data-take="${r.id}">Band qilish</button>
          </div>
        </td>
      </tr>
    `).join("");

    tbody.querySelectorAll("[data-show]").forEach((b) => b.addEventListener("click", () => openDetails(res.content.find(x => x.id == b.dataset.show))));
    tbody.querySelectorAll("[data-take]").forEach((b) => b.addEventListener("click", () => doTake(b.dataset.take, res.content.find(x => x.id == b.dataset.take))));

    renderPager(document.getElementById("opPager"), opPage, res.total_pages, (p) => { opPage = p; loadOpPhones(); });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">${escapeHtml(err.message)}</td></tr>`;
  }
}

let detailsCurrentPhone = null;
function openDetails(phone) {
  detailsCurrentPhone = phone;
  document.getElementById("detailsBody").innerHTML = `
    <div class="details-row"><span class="dr-label">Telefon raqami</span><span class="dr-value">${formatPhoneDisplay(phone.phone_number)}</span></div>
    <div class="details-row"><span class="dr-label">Ism-familiya</span><span class="dr-value">${escapeHtml(phone.owner_name || "-")}</span></div>
    <div class="details-row"><span class="dr-label">Holat</span><span class="dr-value">${badgeHtml(phone.status)}</span></div>
    <div class="details-row"><span class="dr-label">Qo'shilgan sana</span><span class="dr-value">${fmtDate(phone.created_at)}</span></div>
  `;
  openModal("detailsModal");
}
document.getElementById("detailsCloseBtn").addEventListener("click", () => closeModal("detailsModal"));
document.getElementById("detailsTakeBtn").addEventListener("click", () => {
  closeModal("detailsModal");
  doTake(detailsCurrentPhone.id, detailsCurrentPhone);
});

async function doTake(id, phone) {
  // Avval mavjud faol raqamni tekshiramiz — backend xatoligini oldini olish uchun
  try {
    const active = await api.myActive();
    if (active && active.id && Number(active.id) !== Number(id)) {
      showToast(`Sizda hali faol raqam bor (${formatPhoneDisplay(active.phone_number)}). Avval uni yangilang yoki bo'shating.`);
      return;
    }
    if (active && active.id && Number(active.id) === Number(id)) {
      // Bu raqam allaqachon siz tomondan band qilingan — qayta "take" yubormasdan to'g'ridan-to'g'ri yangilash oynasini ochamiz
      myActivePhoneId = Number(id);
      openUpdateModal(phone || active);
      return;
    }
  } catch (_) {
    // my-active so'rovi xato bersa ham, take'ni sinab ko'ramiz
  }

  try {
    await api.takePhone(id);
    myActivePhoneId = Number(id);
    openUpdateModal(phone || { id, phone_number: "" });
    loadOpMyActiveBanner();
  } catch (err) {
    showToast(err.message || "Band qilib bo'lmadi.");
  }
}

function openUpdateModal(phone) {
  document.getElementById("uId").value = phone.id;
  document.getElementById("updatePhoneLabel").textContent = formatPhoneDisplay(phone.phone_number);
  document.getElementById("uStatus").value = phone.status && STATUS_LIST.includes(phone.status) ? phone.status : "NEW";
  document.getElementById("uDescription").value = "";
  document.getElementById("updateError").classList.add("is-hidden");
  openModal("updateModal");
}

document.getElementById("updateForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("updateError");
  err.classList.add("is-hidden");
  const id = document.getElementById("uId").value;
  try {
    await api.updateOperatorPhone(id, document.getElementById("uStatus").value, {
      description: document.getElementById("uDescription").value.trim(),
    });
    closeModal("updateModal");
    if (!document.getElementById("operatorApp").classList.contains("is-hidden")) {
      loadOpPhones();
      loadOpMyActiveBanner();
    }
    if (!document.getElementById("adminApp").classList.contains("is-hidden")) {
      loadAdPhones();
    }
  } catch (e2) {
    err.textContent = e2.message || "Saqlab bo'lmadi.";
    err.classList.remove("is-hidden");
  }
});

/* ---------- My Active Phone ---------- */
async function loadOpActive() {
  const card = document.getElementById("opActiveCard");
  card.innerHTML = `<p class="muted">Yuklanmoqda...</p>`;
  try {
    const r = await api.myActive();
    if (!r || !r.id) {
      card.innerHTML = `<p class="muted">Sizda hozircha band qilingan raqam yo'q.</p>`;
      return;
    }
    card.innerHTML = `
      <div class="ap-phone">${formatPhoneDisplay(r.phone_number)}</div>
      <div class="ap-row"><span class="muted">Status</span>${badgeHtml(r.status)}</div>
      <div class="ap-row"><span class="muted">Owner Name</span><span>${escapeHtml(r.owner_name || "-")}</span></div>
      <div class="ap-row"><span class="muted">Created At</span><span>${fmtDate(r.created_at)}</span></div>
      <div class="ap-actions">
        <button class="btn-primary" id="apContinueBtn">Davom ettirish</button>
        <button class="btn-danger" id="apReleaseBtn">Bo'shatish</button>
      </div>
    `;
    document.getElementById("apContinueBtn").addEventListener("click", () => openUpdateModal(r));
    document.getElementById("apReleaseBtn").addEventListener("click", async () => {
      try { await api.unlockPhone(r.id); myActivePhoneId = null; loadOpActive(); loadOpMyActiveBanner(); }
      catch (err) { showToast(err.message || "Bo'shatib bo'lmadi."); }
    });
  } catch (err) {
    card.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }
}

/* ---------- Call History (operator) ---------- */
async function loadOpHistory() {
  const tbody = document.getElementById("opHistoryBody");
  tbody.innerHTML = `<tr><td colspan="7" class="muted">Yuklanmoqda...</td></tr>`;
  try {
    const res = await api.listCallHistory({ dispatcherId: currentUser.id, size: 50 });
    const content = res.content || [];
    document.getElementById("opHistoryEmpty").classList.toggle("is-hidden", content.length !== 0);
    tbody.innerHTML = content.map((h, i) => `
      <tr>
        <td>${i + 1}</td><td>${fmtDate(h.call_date)}</td><td class="phone-mono">${formatPhoneDisplay(h.phone_number)}</td>
        <td>${badgeHtml(h.status)}</td><td>${h.duration ?? 0}s</td>
        <td class="cell-truncate">${escapeHtml(h.description || "-")}</td>
        <td><button class="btn-ghost btn-xs" data-histdetail="${h.id}">Batafsil</button></td>
      </tr>
    `).join("");
    tbody.querySelectorAll("[data-histdetail]").forEach((b) => {
      b.addEventListener("click", () => openHistDetails(content.find((x) => x.id == b.dataset.histdetail)));
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">${escapeHtml(err.message)}</td></tr>`;
  }
}

/* ---------- Profile ---------- */
function loadOpProfile() {
  document.getElementById("opProfileAvatar").textContent = getUserFullName(currentUser)[0].toUpperCase();
  document.getElementById("opProfileName").textContent = getUserFullName(currentUser);
  document.getElementById("opProfileEmail").textContent = currentUser.email || "";
  document.getElementById("opProfileFirstName").value = currentUser.first_name || "";
  document.getElementById("opProfileLastName").value = currentUser.last_name || "";
  document.getElementById("opProfileEmailInput").value = currentUser.email || "";
}
document.getElementById("opProfileForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("opProfileError");
  const ok = document.getElementById("opProfileSuccess");
  err.classList.add("is-hidden"); ok.classList.add("is-hidden");
  try {
    await api.updateMe({
      first_name: document.getElementById("opProfileFirstName").value.trim(),
      last_name: document.getElementById("opProfileLastName").value.trim(),
      email: document.getElementById("opProfileEmailInput").value.trim(),
    });
    currentUser = await api.me();
    loadOpProfile();
    ok.classList.remove("is-hidden");
  } catch (e2) {
    err.textContent = e2.message || "Saqlab bo'lmadi.";
    err.classList.remove("is-hidden");
  }
});

/* =========================================================================
   ADMIN APP
   ========================================================================= */
const AD_VIEWS = ["adDashboardView", "adPhonesView", "adUsersView", "adHistoryView", "adUnlockView", "adImportView"];
let adPhonesPage = 0;
const AD_PAGE_SIZE = 10;
let adHistPage = 0;
let adPhoneDebounce = null, adUserDebounce = null;

function initAdminApp() {
  document.querySelectorAll("#adminApp .nav-item[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#adminApp .nav-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      showOnly(AD_VIEWS, btn.dataset.view + "View");
      if (btn.dataset.view === "adDashboard") loadAdminDashboard();
      if (btn.dataset.view === "adPhones") loadAdPhones();
      if (btn.dataset.view === "adUsers") loadAdUsers();
      if (btn.dataset.view === "adHistory") { loadAdHistory(); loadAdHistPhoneOptions(); }
    });
  });

  document.getElementById("adPhoneSearch").addEventListener("input", () => {
    clearTimeout(adPhoneDebounce);
    adPhoneDebounce = setTimeout(() => { adPhonesPage = 0; loadAdPhones(); }, 350);
  });
  document.getElementById("adUserSearch").addEventListener("input", () => {
    clearTimeout(adUserDebounce);
    adUserDebounce = setTimeout(loadAdUsers, 350);
  });

  document.getElementById("adAddPhoneBtn").addEventListener("click", () => openPhoneForm(null));
  document.getElementById("adHistApplyBtn").addEventListener("click", () => { adHistPage = 0; loadAdHistory(); });
  document.getElementById("adHistResetBtn").addEventListener("click", () => {
    document.getElementById("adHistFrom").value = "";
    document.getElementById("adHistTo").value = "";
    document.getElementById("adHistStatus").value = "";
    document.getElementById("adHistPhoneSearch").value = "";
    document.getElementById("adHistDispatcherId").value = "";
    adHistPage = 0; loadAdHistory();
  });
  document.getElementById("adDeleteHistBtn").addEventListener("click", async () => {
    const d = document.getElementById("adDeleteUpTo").value;
    if (!d) return showToast("Sana tanlang.");
    const ok = await showConfirm(`${d} sanasigacha bo'lgan tarix butunlay o'chiriladi. Davom etasizmi?`, "Tarixni o'chirish");
    if (!ok) return;
    try { await api.deleteHistoryBeforeDate(d); loadAdHistory(); }
    catch (err) { showToast(err.message || "O'chirib bo'lmadi."); }
  });

  document.getElementById("adUnlockBtn").addEventListener("click", async () => {
    const err = document.getElementById("adUnlockError"), ok = document.getElementById("adUnlockSuccess");
    err.classList.add("is-hidden"); ok.classList.add("is-hidden");
    const id = document.getElementById("adUnlockId").value.trim();
    if (!id) { err.textContent = "Phone ID kiriting."; err.classList.remove("is-hidden"); return; }
    try { await api.unlockPhone(id); ok.classList.remove("is-hidden"); }
    catch (e2) { err.textContent = e2.message || "Bo'shatib bo'lmadi."; err.classList.remove("is-hidden"); }
  });

  document.getElementById("adImportBtn").addEventListener("click", async () => {
    const err = document.getElementById("adImportError"), ok = document.getElementById("adImportSuccess");
    err.classList.add("is-hidden"); ok.classList.add("is-hidden");
    const phoneVal = document.getElementById("adImportPhone").value;
    if (!validateUzPhone(phoneVal)) { err.textContent = "Noto'g'ri raqam formati."; err.classList.remove("is-hidden"); return; }
    try {
      await api.createPhone({ phone_number: `+998${normalizeDigits(phoneVal)}`, owner_name: document.getElementById("adImportName").value.trim() || undefined });
      ok.classList.remove("is-hidden");
      document.getElementById("adImportPhone").value = ""; document.getElementById("adImportName").value = "";
    } catch (e2) { err.textContent = e2.message || "Qo'shib bo'lmadi."; err.classList.remove("is-hidden"); }
  });

  loadAdminDashboard();
}

/* ---------- Admin Dashboard: stat + donut ---------- */
async function loadAdminDashboard() {
  const grid = document.getElementById("adStatGrid");
  grid.innerHTML = `<div class="stat-card"><div class="stat-label">Yuklanmoqda...</div></div>`;
  try {
    const [phoneStats, callStats, usersRes] = await Promise.all([
      api.getPhoneStatistics(),
      api.getCallHistoryStatistics(),
      api.listUsers({}).catch(() => []),
    ]);
    const usersArr = Array.isArray(usersRes) ? usersRes : (usersRes.content || []);

    grid.innerHTML = `
      <div class="stat-card"><div class="stat-label">Jami raqamlar</div><div class="stat-value">${phoneStats.total ?? 0}</div></div>
      <div class="stat-card purple"><div class="stat-label">Jami foydalanuvchilar</div><div class="stat-value">${usersArr.length}</div></div>
      <div class="stat-card neutral"><div class="stat-label">Yangi</div><div class="stat-value">${phoneStats.new_phones ?? 0}</div></div>
      <div class="stat-card ok"><div class="stat-label">Bog'landi</div><div class="stat-value">${phoneStats.connected ?? 0}</div></div>
      <div class="stat-card warn"><div class="stat-label">Band</div><div class="stat-value">${phoneStats.busy ?? 0}</div></div>
      <div class="stat-card warn"><div class="stat-label">Ko'tarilmadi</div><div class="stat-value">${phoneStats.no_answer ?? 0}</div></div>
      <div class="stat-card purple"><div class="stat-label">Qayta aloqa</div><div class="stat-value">${phoneStats.callback_required ?? 0}</div></div>
      <div class="stat-card danger"><div class="stat-label">Qora ro'yxatda</div><div class="stat-value">${phoneStats.blacklisted ?? 0}</div></div>
    `;

    const phoneCounts = {
      NEW: phoneStats.new_phones ?? 0,
      CONNECTED: phoneStats.connected ?? 0,
      NO_ANSWER: phoneStats.no_answer ?? 0,
      BUSY: phoneStats.busy ?? 0,
      CALLBACK_REQUIRED: phoneStats.callback_required ?? 0,
      WRONG_NUMBER: phoneStats.wrong_number ?? 0,
      NOT_INTERESTED: phoneStats.not_interested ?? 0,
      BLACKLISTED: phoneStats.blacklisted ?? 0,
      FINISHED: phoneStats.finished ?? 0,
    };
    renderDonut("adPhoneDonut", "adPhoneLegend", phoneCounts);

    const callCounts = {
      CONNECTED: callStats.connected ?? 0,
      NO_ANSWER: callStats.no_answer ?? 0,
      BUSY: callStats.busy ?? 0,
      CALLBACK_REQUIRED: callStats.callback_required ?? 0,
      WRONG_NUMBER: callStats.wrong_number ?? 0,
      NOT_INTERESTED: callStats.not_interested ?? 0,
      BLACKLISTED: callStats.blacklisted ?? 0,
      FINISHED: callStats.finished ?? 0,
    };
    renderDonut("adCallDonut", "adCallLegend", callCounts);
  } catch (err) {
    grid.innerHTML = `<div class="stat-card"><div class="stat-label">${escapeHtml(err.message)}</div></div>`;
  }
}

const COLOR_HEX = { ok: "#35C88A", warn: "#FFB020", danger: "#FF5470", neutral: "#8891A6", accent: "#3DA9FC", purple: "#A78BFA" };
function renderDonut(donutId, legendId, counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  const stops = [];
  Object.entries(counts).forEach(([status, val]) => {
    if (val === 0) return;
    const meta = STATUS_META[status];
    const start = (acc / total) * 360;
    acc += val;
    const end = (acc / total) * 360;
    stops.push(`${COLOR_HEX[meta.color]} ${start}deg ${end}deg`);
  });
  const donut = document.getElementById(donutId);
  donut.style.background = stops.length ? `conic-gradient(${stops.join(",")})` : "var(--surface-2)";
  donut.style.boxShadow = "inset 0 0 0 26px var(--surface)";

  const legend = document.getElementById(legendId);
  legend.innerHTML = Object.entries(counts).filter(([, v]) => v > 0).map(([status, val]) => {
    const meta = STATUS_META[status];
    return `<div class="legend-item"><span class="legend-dot" style="background:${COLOR_HEX[meta.color]}"></span><span class="legend-label">${meta.label}</span><span class="legend-value">${val}</span></div>`;
  }).join("") || `<div class="muted small">Ma'lumot yo'q</div>`;
}

/* ---------- Admin: Phones Management ---------- */
async function loadAdPhones() {
  const tbody = document.getElementById("adPhonesBody");
  try {
    const res = await api.listPhones({ search: document.getElementById("adPhoneSearch").value.trim(), page: adPhonesPage, size: AD_PAGE_SIZE });
    tbody.innerHTML = res.content.map((r, i) => `
      <tr data-lock-row="${r.id}">
        <td>${adPhonesPage * AD_PAGE_SIZE + i + 1}</td>
        <td class="phone-mono">${formatPhoneDisplay(r.phone_number)}</td>
        <td>${escapeHtml(r.owner_name || "-")}</td>
        <td>${badgeHtml(r.status)}</td>
        <td class="lock-indicator">${lockCellHtml(r.id)}</td>
        <td><div class="row-actions">
          <button class="btn-primary btn-xs" data-take="${r.id}">Band qilish</button>
          <button class="icon-btn" data-edit="${r.id}" title="Tahrirlash">✎</button>
          <button class="icon-btn" data-del="${r.id}" title="O'chirish">🗑</button>
        </div></td>
      </tr>
    `).join("");
    tbody.querySelectorAll("[data-take]").forEach((b) => b.addEventListener("click", () => doTake(b.dataset.take, res.content.find(x => x.id == b.dataset.take))));
    tbody.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openPhoneForm(res.content.find(x => x.id == b.dataset.edit))));
    tbody.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => deletePhoneConfirm(b.dataset.del)));
    renderPager(document.getElementById("adPhonesPager"), adPhonesPage, res.total_pages, (p) => { adPhonesPage = p; loadAdPhones(); });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">${escapeHtml(err.message)}</td></tr>`;
  }
}

function openPhoneForm(phone) {
  document.getElementById("phoneFormTitle").textContent = phone ? "Raqamni tahrirlash" : "Raqam qo'shish";
  document.getElementById("pfId").value = phone ? phone.id : "";
  document.getElementById("pfPhone").value = phone ? normalizeDigits(phone.phone_number).replace(/(\d{2})(\d{3})(\d{2})(\d{2})/, "$1 $2 $3 $4") : "";
  document.getElementById("pfName").value = phone ? (phone.owner_name || "") : "";
  document.getElementById("pfDeleteBtn").classList.toggle("is-hidden", !phone);
  document.getElementById("phoneFormError").classList.add("is-hidden");
  document.getElementById("pfPhoneError").classList.add("is-hidden");
  openModal("phoneFormModal");
}

document.getElementById("phoneFormForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("phoneFormError");
  err.classList.add("is-hidden");
  const id = document.getElementById("pfId").value;
  const phoneVal = document.getElementById("pfPhone").value;

  if (!id && !validateUzPhone(phoneVal)) {
    document.getElementById("pfPhoneError").classList.remove("is-hidden");
    return;
  }
  try {
    const payload = { owner_name: document.getElementById("pfName").value.trim() || undefined };
    if (id) {
      payload.phone_number = `+998${normalizeDigits(phoneVal)}`;
      await api.updatePhone(id, payload);
    } else {
      payload.phone_number = `+998${normalizeDigits(phoneVal)}`;
      await api.createPhone(payload);
    }
    closeModal("phoneFormModal");
    loadAdPhones();
  } catch (e2) {
    err.textContent = e2.message || "Saqlab bo'lmadi.";
    err.classList.remove("is-hidden");
  }
});

document.getElementById("pfDeleteBtn").addEventListener("click", () => {
  const id = document.getElementById("pfId").value;
  closeModal("phoneFormModal");
  deletePhoneConfirm(id);
});

async function deletePhoneConfirm(id) {
  const ok = await showConfirm("Bu raqamni o'chirmoqchimisiz?", "Raqamni o'chirish");
  if (!ok) return;
  try { await api.deletePhone(id); loadAdPhones(); }
  catch (err) { showToast(err.message || "O'chirib bo'lmadi."); }
}

/* ---------- Admin: Users Management ---------- */
let adUsersPage = 0;
let adUsersFullList = [];

async function loadAdUsers() {
  const tbody = document.getElementById("adUsersBody");
  tbody.innerHTML = `<tr><td colspan="6" class="muted">Yuklanmoqda...</td></tr>`;
  try {
    const res = await api.listUsers({ search: document.getElementById("adUserSearch").value.trim() });
    adUsersFullList = Array.isArray(res) ? res : (res.content || []);
    adUsersPage = 0;
    renderAdUsersPage();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderAdUsersPage() {
  const tbody = document.getElementById("adUsersBody");
  const totalPages = Math.max(1, Math.ceil(adUsersFullList.length / AD_PAGE_SIZE));
  const start = adUsersPage * AD_PAGE_SIZE;
  const list = adUsersFullList.slice(start, start + AD_PAGE_SIZE);

  tbody.innerHTML = list.map((u, i) => `
      <tr>
        <td>${start + i + 1}</td>
        <td>${escapeHtml(getUserFullName(u))}</td>
        <td>${escapeHtml(u.email || "-")}</td>
        <td>
          <select class="select-compact role-select" data-uid="${u.id}" style="padding:5px 24px 5px 8px;font-size:12px;">
            <option value="USER" ${u.role === "USER" ? "selected" : ""}>USER</option>
            <option value="ADMIN" ${u.role === "ADMIN" ? "selected" : ""}>ADMIN</option>
            <option value="SUPER_USER" ${u.role === "SUPER_USER" ? "selected" : ""}>SUPER_USER</option>
          </select>
        </td>
        <td>
          <select class="select-compact status-select" data-uid="${u.id}" style="padding:5px 24px 5px 8px;font-size:12px;">
            <option value="ACTIVE" ${u.status === "ACTIVE" ? "selected" : ""}>Faol</option>
            <option value="UNVERIFIED" ${u.status === "UNVERIFIED" ? "selected" : ""}>Tasdiqlanmagan</option>
            <option value="BLOCKED" ${u.status === "BLOCKED" ? "selected" : ""}>Bloklangan</option>
          </select>
        </td>
        <td><div class="row-actions">
          <button class="icon-btn" data-editu="${u.id}" title="Tahrirlash">✎</button>
          <button class="icon-btn" data-delu="${u.id}" title="O'chirish">🗑</button>
        </div></td>
      </tr>
    `).join("") || `<tr><td colspan="6" class="muted">Foydalanuvchi topilmadi.</td></tr>`;

  tbody.querySelectorAll(".role-select").forEach((sel) => {
    sel.addEventListener("change", async () => {
      try { await api.changeUserRole(sel.dataset.uid, sel.value); showToast("Rol yangilandi.", "ok"); }
      catch (err) { showToast(err.message || "Rolni o'zgartirib bo'lmadi."); loadAdUsers(); }
    });
  });
  tbody.querySelectorAll(".status-select").forEach((sel) => {
    sel.addEventListener("change", async () => {
      try { await api.changeUserStatus(sel.dataset.uid, sel.value); showToast("Holat yangilandi.", "ok"); }
      catch (err) { showToast(err.message || "Holatni o'zgartirib bo'lmadi."); loadAdUsers(); }
    });
  });
  tbody.querySelectorAll("[data-editu]").forEach((b) => {
    b.addEventListener("click", async () => {
      const u = adUsersFullList.find((x) => x.id == b.dataset.editu);
      const firstName = prompt("Ism:", u.first_name || "");
      if (firstName === null) return;
      const lastName = prompt("Familiya:", u.last_name || "");
      if (lastName === null) return;
      try { await api.updateUserByAdmin(u.id, { first_name: firstName, last_name: lastName, email: u.email }); loadAdUsers(); }
      catch (err) { showToast(err.message || "Saqlab bo'lmadi."); }
    });
  });
  tbody.querySelectorAll("[data-delu]").forEach((b) => {
    b.addEventListener("click", async () => {
      const ok = await showConfirm("Bu foydalanuvchini butunlay o'chirmoqchimisiz?", "Foydalanuvchini o'chirish");
      if (!ok) return;
      try { await api.deleteUser(b.dataset.delu); loadAdUsers(); }
      catch (err) { showToast(err.message || "O'chirib bo'lmadi."); }
    });
  });

  renderPager(document.getElementById("adUsersPager"), adUsersPage, totalPages, (p) => { adUsersPage = p; renderAdUsersPage(); });
}

/* ---------- Admin: Call History ---------- */
let adHistPhoneMap = {}; // "+998 90 123 45 67" -> phoneId

async function loadAdHistPhoneOptions() {
  try {
    const res = await api.listPhones({ page: 0, size: 200 });
    adHistPhoneMap = {};
    const datalist = document.getElementById("adHistPhoneDatalist");
    datalist.innerHTML = (res.content || []).map((p) => {
      const label = formatPhoneDisplay(p.phone_number);
      adHistPhoneMap[label] = p.id;
      return `<option value="${label}">`;
    }).join("");
  } catch (_) {}
}

async function loadAdHistory() {
  const tbody = document.getElementById("adHistoryBody");
  tbody.innerHTML = `<tr><td colspan="8" class="muted">Yuklanmoqda...</td></tr>`;
  try {
    const phoneTyped = document.getElementById("adHistPhoneSearch").value.trim();
    const phoneId = adHistPhoneMap[phoneTyped] || "";
    const dispatcherId = document.getElementById("adHistDispatcherId").value.trim();

    const res = await api.listCallHistory({
      status: document.getElementById("adHistStatus").value,
      fromDate: document.getElementById("adHistFrom").value,
      toDate: document.getElementById("adHistTo").value,
      phoneId, dispatcherId,
      page: adHistPage, size: AD_PAGE_SIZE,
    });
    const content = res.content || [];
    tbody.innerHTML = content.map((h, i) => `
      <tr>
        <td>${adHistPage * AD_PAGE_SIZE + i + 1}</td><td>${fmtDate(h.call_date)}</td>
        <td class="phone-mono">${formatPhoneDisplay(h.phone_number)}</td><td>${escapeHtml(h.dispatcher || "-")}</td>
        <td>${badgeHtml(h.status)}</td><td>${h.duration ?? 0}s</td><td class="cell-truncate">${escapeHtml(h.description || "-")}</td>
        <td><button class="btn-ghost btn-xs" data-histdetail="${h.id}">Batafsil</button></td>
      </tr>
    `).join("") || `<tr><td colspan="8" class="muted">Tarix topilmadi.</td></tr>`;

    tbody.querySelectorAll("[data-histdetail]").forEach((b) => {
      b.addEventListener("click", () => openHistDetails(content.find((x) => x.id == b.dataset.histdetail)));
    });

    renderPager(document.getElementById("adHistoryPager"), adHistPage, res.total_pages || 1, (p) => { adHistPage = p; loadAdHistory(); });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="muted">${escapeHtml(err.message)}</td></tr>`;
  }
}

function openHistDetails(h) {
  if (!h) return;
  document.getElementById("histDetailsBody").innerHTML = `
    <div class="details-row"><span class="dr-label">Telefon raqami</span><span class="dr-value">${formatPhoneDisplay(h.phone_number)}</span></div>
    <div class="details-row"><span class="dr-label">Dispetcher</span><span class="dr-value">${escapeHtml(h.dispatcher || "-")}</span></div>
    <div class="details-row"><span class="dr-label">Holat</span><span class="dr-value">${badgeHtml(h.status)}</span></div>
    <div class="details-row"><span class="dr-label">Davomiyligi</span><span class="dr-value">${h.duration ?? 0}s</span></div>
    <div class="details-row"><span class="dr-label">Sana va vaqt</span><span class="dr-value">${fmtDate(h.call_date)}</span></div>
    <div class="details-row"><span class="dr-label">Izoh</span><span class="dr-value">${escapeHtml(h.description || "-")}</span></div>
  `;
  openModal("histDetailsModal");
}
document.getElementById("histDetailsCloseBtn").addEventListener("click", () => closeModal("histDetailsModal"));
