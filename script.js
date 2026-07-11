/* =========================================================================
   CALL MANAGEMENT SYSTEM — Frontend (Auth + Operator + Admin)
   ========================================================================= */

const API_BASE_URL = ""; // Vercel serverless proksi orqali (/api/[...path].js)

const UZ_MOBILE_PREFIXES = ["90","91","93","94","95","97","98","99","33","88","20","50","55","77"];

const STATUS_META = {
  NEW: { label: "Yangi", color: "neutral" },
  IN_PROGRESS: { label: "Jarayonda", color: "accent" },
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

  listPhones: ({ search = "", status = "", page = 0, size = 10 } = {}) => {
    const q = new URLSearchParams();
    if (search) q.set("search", search);
    if (status) q.set("status", status);
    q.set("page", page); q.set("size", size);
    return apiFetch(`/api/phones?${q.toString()}`);
  },
  createPhone: (payload) => apiFetch("/api/phones", { method: "POST", body: JSON.stringify(payload) }),
  updatePhone: (id, payload) => apiFetch(`/api/phones/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  updateOperatorPhone: (id, payload) => {
    const q = new URLSearchParams({ status: payload.status });
    return apiFetch(`/api/phones/${id}/operator?${q.toString()}`, { method: "PATCH", body: JSON.stringify(payload) });
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
  document.getElementById("opAvatar").textContent = (currentUser.first_name || "?")[0].toUpperCase();
  document.getElementById("opUserName").textContent = `${currentUser.first_name || ""} ${currentUser.last_name || ""}`.trim();

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
      <tr>
        <td>${opPage * OP_PAGE_SIZE + i + 1}</td>
        <td class="phone-mono">${formatPhoneDisplay(r.phone_number)}</td>
        <td>${escapeHtml(r.owner_name || "-")}</td>
        <td>${badgeHtml(r.status)}</td>
        <td>${fmtDate(r.created_at)}</td>
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
    <div class="details-row"><span class="dr-label">Phone Number</span><span class="dr-value">${formatPhoneDisplay(phone.phone_number)}</span></div>
    <div class="details-row"><span class="dr-label">Owner Name</span><span class="dr-value">${escapeHtml(phone.owner_name || "-")}</span></div>
    <div class="details-row"><span class="dr-label">Status</span><span class="dr-value">${badgeHtml(phone.status)}</span></div>
    <div class="details-row"><span class="dr-label">Created At</span><span class="dr-value">${fmtDate(phone.created_at)}</span></div>
  `;
  openModal("detailsModal");
}
document.getElementById("detailsCloseBtn").addEventListener("click", () => closeModal("detailsModal"));
document.getElementById("detailsTakeBtn").addEventListener("click", () => {
  closeModal("detailsModal");
  doTake(detailsCurrentPhone.id, detailsCurrentPhone);
});

async function doTake(id, phone) {
  try {
    await api.takePhone(id);
    myActivePhoneId = Number(id);
    openUpdateModal(phone || { id, phone_number: "" });
    loadOpMyActiveBanner();
  } catch (err) {
    alert(err.message || "Band qilib bo'lmadi.");
  }
}

function openUpdateModal(phone) {
  document.getElementById("uId").value = phone.id;
  document.getElementById("updatePhoneLabel").textContent = formatPhoneDisplay(phone.phone_number);
  document.getElementById("uStatus").value = phone.status && STATUS_LIST.includes(phone.status) ? phone.status : "IN_PROGRESS";
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
    await api.updateOperatorPhone(id, {
      status: document.getElementById("uStatus").value,
      description: document.getElementById("uDescription").value.trim(),
    });
    closeModal("updateModal");
    loadOpPhones();
    loadOpMyActiveBanner();
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
      catch (err) { alert(err.message || "Bo'shatib bo'lmadi."); }
    });
  } catch (err) {
    card.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }
}

/* ---------- Call History (operator) ---------- */
async function loadOpHistory() {
  const tbody = document.getElementById("opHistoryBody");
  tbody.innerHTML = `<tr><td colspan="6" class="muted">Yuklanmoqda...</td></tr>`;
  try {
    const res = await api.listCallHistory({ dispatcherId: currentUser.id, size: 50 });
    const content = res.content || [];
    document.getElementById("opHistoryEmpty").classList.toggle("is-hidden", content.length !== 0);
    tbody.innerHTML = content.map((h, i) => `
      <tr>
        <td>${i + 1}</td><td>${fmtDate(h.call_date)}</td><td class="phone-mono">${formatPhoneDisplay(h.phone_number)}</td>
        <td>${badgeHtml(h.status)}</td><td>${h.duration ?? 0}s</td><td>${escapeHtml(h.description || "-")}</td>
      </tr>
    `).join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">${escapeHtml(err.message)}</td></tr>`;
  }
}

/* ---------- Profile ---------- */
function loadOpProfile() {
  document.getElementById("opProfileAvatar").textContent = (currentUser.first_name || "?")[0].toUpperCase();
  document.getElementById("opProfileName").textContent = `${currentUser.first_name || ""} ${currentUser.last_name || ""}`.trim();
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
      if (btn.dataset.view === "adHistory") loadAdHistory();
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
    adHistPage = 0; loadAdHistory();
  });
  document.getElementById("adDeleteHistBtn").addEventListener("click", async () => {
    const d = document.getElementById("adDeleteUpTo").value;
    if (!d) return alert("Sana tanlang.");
    if (!confirm(`${d} sanasigacha bo'lgan tarix butunlay o'chiriladi. Davom etasizmi?`)) return;
    try { await api.deleteHistoryBeforeDate(d); loadAdHistory(); }
    catch (err) { alert(err.message || "O'chirib bo'lmadi."); }
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
    const [phonesRes, usersRes, historyRes] = await Promise.all([
      api.listPhones({ page: 0, size: 100 }),
      api.listUsers({}).catch(() => []),
      api.listCallHistory({ size: 100 }).catch(() => ({ content: [] })),
    ]);

    const phones = phonesRes.content || [];
    const usersArr = Array.isArray(usersRes) ? usersRes : (usersRes.content || []);
    const totalPhones = phonesRes.total_elements ?? phones.length;

    const counts = {};
    STATUS_LIST.forEach((s) => (counts[s] = 0));
    phones.forEach((p) => { if (counts[p.status] !== undefined) counts[p.status]++; });

    grid.innerHTML = `
      <div class="stat-card"><div class="stat-label">Jami raqamlar</div><div class="stat-value">${totalPhones}</div></div>
      <div class="stat-card purple"><div class="stat-label">Jami foydalanuvchilar</div><div class="stat-value">${usersArr.length}</div></div>
      <div class="stat-card accent"><div class="stat-label">Jarayonda</div><div class="stat-value">${counts.IN_PROGRESS}</div></div>
      <div class="stat-card ok"><div class="stat-label">Bog'landi</div><div class="stat-value">${counts.CONNECTED}</div></div>
      <div class="stat-card warn"><div class="stat-label">Band</div><div class="stat-value">${counts.BUSY}</div></div>
      <div class="stat-card warn"><div class="stat-label">Ko'tarilmadi</div><div class="stat-value">${counts.NO_ANSWER}</div></div>
      <div class="stat-card purple"><div class="stat-label">Qayta aloqa</div><div class="stat-value">${counts.CALLBACK_REQUIRED}</div></div>
    `;

    renderDonut("adPhoneDonut", "adPhoneLegend", counts);

    const histContent = historyRes.content || [];
    const hCounts = {};
    STATUS_LIST.forEach((s) => (hCounts[s] = 0));
    histContent.forEach((h) => { if (hCounts[h.status] !== undefined) hCounts[h.status]++; });
    renderDonut("adCallDonut", "adCallLegend", hCounts);
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
      <tr>
        <td>${adPhonesPage * AD_PAGE_SIZE + i + 1}</td>
        <td class="phone-mono">${formatPhoneDisplay(r.phone_number)}</td>
        <td>${escapeHtml(r.owner_name || "-")}</td>
        <td>${badgeHtml(r.status)}</td>
        <td>${fmtDate(r.created_at)}</td>
        <td><div class="row-actions">
          <button class="icon-btn" data-edit="${r.id}" title="Tahrirlash">✎</button>
          <button class="icon-btn" data-del="${r.id}" title="O'chirish">🗑</button>
        </div></td>
      </tr>
    `).join("");
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
  if (!confirm("Bu raqamni o'chirmoqchimisiz?")) return;
  try { await api.deletePhone(id); loadAdPhones(); }
  catch (err) { alert(err.message || "O'chirib bo'lmadi."); }
}

/* ---------- Admin: Users Management ---------- */
async function loadAdUsers() {
  const tbody = document.getElementById("adUsersBody");
  tbody.innerHTML = `<tr><td colspan="6" class="muted">Yuklanmoqda...</td></tr>`;
  try {
    const res = await api.listUsers({ search: document.getElementById("adUserSearch").value.trim() });
    const list = Array.isArray(res) ? res : (res.content || []);
    tbody.innerHTML = list.map((u, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(`${u.first_name || ""} ${u.last_name || ""}`.trim())}</td>
        <td>${escapeHtml(u.email || "-")}</td>
        <td>
          <select class="select-compact role-select" data-uid="${u.id}" style="padding:5px 24px 5px 8px;font-size:12px;">
            <option value="USER" ${u.role === "USER" ? "selected" : ""}>USER</option>
            <option value="ADMIN" ${u.role === "ADMIN" ? "selected" : ""}>ADMIN</option>
            <option value="SUPER_USER" ${u.role === "SUPER_USER" ? "selected" : ""}>SUPER_USER</option>
          </select>
        </td>
        <td>${u.status === "ACTIVE" ? badgeHtml("CONNECTED").replace("CONNECTED","ACTIVE") : `<span class="badge neutral"><span class="dot"></span>${escapeHtml(u.status || "-")}</span>`}</td>
        <td><button class="icon-btn" data-editu="${u.id}" title="Tahrirlash">✎</button></td>
      </tr>
    `).join("");

    tbody.querySelectorAll(".role-select").forEach((sel) => {
      sel.addEventListener("change", async () => {
        try { await api.changeUserRole(sel.dataset.uid, sel.value); }
        catch (err) { alert(err.message || "Rolni o'zgartirib bo'lmadi."); loadAdUsers(); }
      });
    });
    tbody.querySelectorAll("[data-editu]").forEach((b) => {
      b.addEventListener("click", async () => {
        const u = list.find((x) => x.id == b.dataset.editu);
        const firstName = prompt("Ism:", u.first_name || "");
        if (firstName === null) return;
        const lastName = prompt("Familiya:", u.last_name || "");
        if (lastName === null) return;
        try { await api.updateUserByAdmin(u.id, { first_name: firstName, last_name: lastName, email: u.email }); loadAdUsers(); }
        catch (err) { alert(err.message || "Saqlab bo'lmadi."); }
      });
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">${escapeHtml(err.message)}</td></tr>`;
  }
}

/* ---------- Admin: Call History ---------- */
async function loadAdHistory() {
  const tbody = document.getElementById("adHistoryBody");
  tbody.innerHTML = `<tr><td colspan="7" class="muted">Yuklanmoqda...</td></tr>`;
  try {
    const res = await api.listCallHistory({
      status: document.getElementById("adHistStatus").value,
      fromDate: document.getElementById("adHistFrom").value,
      toDate: document.getElementById("adHistTo").value,
      page: adHistPage, size: AD_PAGE_SIZE,
    });
    const content = res.content || [];
    tbody.innerHTML = content.map((h, i) => `
      <tr>
        <td>${adHistPage * AD_PAGE_SIZE + i + 1}</td><td>${fmtDate(h.call_date)}</td>
        <td class="phone-mono">${formatPhoneDisplay(h.phone_number)}</td><td>${escapeHtml(h.dispatcher || "-")}</td>
        <td>${badgeHtml(h.status)}</td><td>${h.duration ?? 0}s</td><td>${escapeHtml(h.description || "-")}</td>
      </tr>
    `).join("") || `<tr><td colspan="7" class="muted">Tarix topilmadi.</td></tr>`;
    renderPager(document.getElementById("adHistoryPager"), adHistPage, res.total_pages || 1, (p) => { adHistPage = p; loadAdHistory(); });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">${escapeHtml(err.message)}</td></tr>`;
  }
}
