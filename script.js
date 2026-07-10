/* =========================================================================
   DISPATCH/OS — Frontend logikasi (CALL_MANAGEMENT_SYSTEM API bilan ulangan)
   ========================================================================= */

const API_BASE_URL = "";

const UZ_MOBILE_PREFIXES = ["90", "91", "93", "94", "95", "97", "98", "99", "33", "88", "20", "50", "55", "77"];

const STATUS_META = {
  NEW: { label: "Yangi", color: "neutral" },
  IN_PROGRESS: { label: "Jarayonda", color: "accent" },
  CONNECTED: { label: "Bog'landi", color: "ok" },
  NO_ANSWER: { label: "Ko'tarilmadi", color: "warn" },
  BUSY: { label: "Band (liniya)", color: "warn" },
  CALLBACK_REQUIRED: { label: "Qayta aloqa kerak", color: "warn" },
  WRONG_NUMBER: { label: "Noto'g'ri raqam", color: "neutral" },
  NOT_INTERESTED: { label: "Qiziqmadi", color: "neutral" },
  BLACKLISTED: { label: "Qora ro'yxatda", color: "danger" },
  FINISHED: { label: "Yakunlangan", color: "ok" },
};

/* ------------------------------ Holat/token --------------------------- */
let accessToken = null;
let refreshToken = null;
let myActivePhoneId = null;

let currentPage = 0;
const PAGE_SIZE = 15;
let totalPages = 1;
let items = []; // yig'ilgan ro'yxat (sahifalash uchun)

/* ================================ API qatlami ============================ */
async function apiFetch(path, options = {}, retry = true) {
  const headers = Object.assign(
    { "Content-Type": "application/json" },
    options.headers || {},
    accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
  );

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

  if (res.status === 401 && retry && refreshToken) {
    const refreshed = await tryRefreshToken();
    if (refreshed) return apiFetch(path, options, false);
    forceLogout();
    throw new Error("Sessiya tugadi, qaytadan kiring.");
  }

  if (!res.ok) {
    let msg = `Xatolik (${res.status})`;
    try {
      const body = await res.json();
      msg = body.message || body.error || msg;
    } catch (_) {}
    throw new Error(msg);
  }

  if (res.status === 200) {
    try {
      return await res.json();
    } catch (_) {
      return null;
    }
  }
  return null;
}

async function tryRefreshToken() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    accessToken = data.access_token;
    refreshToken = data.refresh_token || refreshToken;
    return true;
  } catch (_) {
    return false;
  }
}

const api = {
  login: (email, password) =>
    apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }, false),

  listPhones: ({ search = "", status = "", page = 0, size = PAGE_SIZE } = {}) => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    params.set("page", page);
    params.set("size", size);
    return apiFetch(`/api/phones?${params.toString()}`);
  },

  createPhone: (payload) =>
    apiFetch("/api/phones", { method: "POST", body: JSON.stringify(payload) }),

  updateOperator: (id, payload) =>
    apiFetch(`/api/phones/${id}/operator`, { method: "PATCH", body: JSON.stringify(payload) }),

  takePhone: (id) => apiFetch(`/api/phones/${id}/take`, { method: "POST" }),

  unlockPhone: (id) => apiFetch(`/api/phones/unlock/${id}`, { method: "PATCH" }),

  deletePhone: (id) => apiFetch(`/api/phones/${id}`, { method: "DELETE" }),

  myActive: () => apiFetch("/api/phones/my-active"),
};

/* ================================ Validatsiya ============================ */
function normalizeDigits(raw) {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("998")) digits = digits.slice(3);
  if (digits.length === 10 && digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}
function validateUzPhone(raw) {
  const digits = normalizeDigits(raw);
  if (digits.length !== 9) return false;
  return UZ_MOBILE_PREFIXES.includes(digits.slice(0, 2));
}
function formatPhoneDisplay(phoneNumber) {
  const digits = normalizeDigits(phoneNumber);
  if (digits.length !== 9) return phoneNumber;
  return `+998 ${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 7)} ${digits.slice(7, 9)}`;
}

/* ============================== DOM ulanishi ============================= */
const loginScreen = document.getElementById("loginScreen");
const dashboard = document.getElementById("dashboard");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const loginSubmit = document.getElementById("loginSubmit");
const logoutBtn = document.getElementById("logoutBtn");

const searchToggle = document.getElementById("searchToggle");
const searchBar = document.getElementById("searchBar");
const searchInput = document.getElementById("searchInput");
const statusFilter = document.getElementById("statusFilter");
const totalCountEl = document.getElementById("totalCount");

const activeBanner = document.getElementById("activeBanner");
const activeBannerPhone = document.getElementById("activeBannerPhone");
const activeBannerGo = document.getElementById("activeBannerGo");

const listEl = document.getElementById("list");
const emptyState = document.getElementById("emptyState");
const loadMoreWrap = document.getElementById("loadMoreWrap");
const loadMoreBtn = document.getElementById("loadMoreBtn");

const addBtn = document.getElementById("addBtn");
const createModal = document.getElementById("createModal");
const createForm = document.getElementById("createForm");
const cPhone = document.getElementById("cPhone");
const cName = document.getElementById("cName");
const cPhoneError = document.getElementById("cPhoneError");
const createError = document.getElementById("createError");

const editModal = document.getElementById("editModal");
const editForm = document.getElementById("editForm");
const editPhoneLabel = document.getElementById("editPhoneLabel");
const eId = document.getElementById("eId");
const eName = document.getElementById("eName");
const eStatus = document.getElementById("eStatus");
const eDescription = document.getElementById("eDescription");
const editError = document.getElementById("editError");
const eTakeBtn = document.getElementById("eTakeBtn");
const eUnlockBtn = document.getElementById("eUnlockBtn");
const eDeleteBtn = document.getElementById("eDeleteBtn");

let debounceTimer = null;

/* =============================== Login =================================== */
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.hidden = true;
  loginSubmit.disabled = true;

  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  try {
    const data = await api.login(email, password);
    accessToken = data.access_token;
    refreshToken = data.refresh_token;

    loginScreen.hidden = true;
    dashboard.hidden = false;
    await loadMyActive();
    await loadPhones(true);
  } catch (err) {
    loginError.textContent = err.message || "Login yoki parol noto'g'ri.";
    loginError.hidden = false;
  } finally {
    loginSubmit.disabled = false;
  }
});

logoutBtn.addEventListener("click", forceLogout);

function forceLogout() {
  accessToken = null;
  refreshToken = null;
  myActivePhoneId = null;
  dashboard.hidden = true;
  loginScreen.hidden = false;
  loginForm.reset();
}

/* =============================== Qidiruv / filtr ==================================== */
searchToggle.addEventListener("click", () => {
  const isOpen = searchBar.classList.toggle("open");
  if (isOpen) searchInput.focus();
  else {
    searchInput.value = "";
    loadPhones(true);
  }
});

searchInput.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => loadPhones(true), 400);
});

statusFilter.addEventListener("change", () => loadPhones(true));

loadMoreBtn.addEventListener("click", () => loadPhones(false));

/* ============================== Yuklash / chizish ============================ */
async function loadMyActive() {
  try {
    const res = await api.myActive();
    if (res && res.id) {
      myActivePhoneId = res.id;
      activeBannerPhone.textContent = formatPhoneDisplay(res.phone_number);
      activeBanner.hidden = false;
    } else {
      myActivePhoneId = null;
      activeBanner.hidden = true;
    }
  } catch (_) {
    myActivePhoneId = null;
    activeBanner.hidden = true;
  }
}

activeBannerGo.addEventListener("click", () => {
  if (myActivePhoneId) {
    const r = items.find((x) => x.id === myActivePhoneId);
    if (r) openEditModal(r);
  }
});

async function loadPhones(reset) {
  if (reset) {
    currentPage = 0;
    items = [];
  }
  try {
    const res = await api.listPhones({
      search: searchInput.value.trim(),
      status: statusFilter.value,
      page: currentPage,
      size: PAGE_SIZE,
    });

    items = reset ? res.content : items.concat(res.content);
    totalPages = res.total_pages;
    totalCountEl.textContent = `${res.total_elements} ta raqam`;

    renderList();

    loadMoreWrap.hidden = currentPage + 1 >= totalPages;
  } catch (err) {
    console.error(err);
  }
}

function renderList() {
  listEl.innerHTML = "";
  emptyState.hidden = items.length !== 0;

  items.forEach((r) => {
    const meta = STATUS_META[r.status] || { label: r.status, color: "neutral" };
    const row = document.createElement("div");
    row.className = "list-row";
    row.innerHTML = `
      <div class="call-icon ${meta.color}">${phoneIconSvg()}</div>
      <div class="row-main">
        <div class="row-name">${escapeHtml(r.owner_name || "Noma'lum")}</div>
        <div class="row-sub">
          <span class="row-phone">${formatPhoneDisplay(r.phone_number)}</span>
        </div>
      </div>
      <div class="row-meta">
        <span class="badge ${meta.color}"><span class="dot"></span>${meta.label}</span>
        <button class="row-info" data-id="${r.id}" title="Batafsil / tahrirlash">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.3" stroke="currentColor" stroke-width="1.3"/><path d="M8 7.2V11.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="8" cy="5" r="0.9" fill="currentColor"/></svg>
        </button>
      </div>
    `;
    row.addEventListener("click", () => openEditModal(r));
    listEl.appendChild(row);
  });
}

function phoneIconSvg() {
  return `<svg width="17" height="17" viewBox="0 0 20 20" fill="none"><path d="M4.5 3.5c0 8 4 12 12 12 1 0 1.6-.8 1.6-1.7v-1.6c0-.6-.4-1.1-1-1.2l-2.6-.5c-.5-.1-1 .1-1.3.5l-1 1.1c-1.7-.9-3-2.3-3.9-4l1.1-1c.4-.4.6-.9.5-1.4l-.5-2.6c-.1-.6-.6-1-1.2-1H5.7c-.7 0-1.2.3-1.2.9z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ================================ Yangi raqam qo'shish ==================================== */
addBtn.addEventListener("click", () => {
  createForm.reset();
  cPhoneError.hidden = true;
  cPhone.closest(".field").classList.remove("has-error");
  createError.hidden = true;
  createModal.classList.add("open");
  cPhone.focus();
});

document.querySelectorAll(".js-close-create").forEach((b) => b.addEventListener("click", () => createModal.classList.remove("open")));
createModal.addEventListener("click", (e) => { if (e.target === createModal) createModal.classList.remove("open"); });

createForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  createError.hidden = true;

  if (!validateUzPhone(cPhone.value)) {
    cPhone.closest(".field").classList.add("has-error");
    cPhoneError.hidden = false;
    cPhone.focus();
    return;
  }

  const digits = normalizeDigits(cPhone.value);
  const submitBtn = createForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  try {
    await api.createPhone({
      phone_number: `+998${digits}`,
      owner_name: cName.value.trim() || undefined,
    });
    createModal.classList.remove("open");
    await loadPhones(true);
  } catch (err) {
    createError.textContent = err.message || "Xatolik yuz berdi.";
    createError.hidden = false;
  } finally {
    submitBtn.disabled = false;
  }
});

cPhone.addEventListener("input", () => {
  cPhone.closest(".field").classList.remove("has-error");
  cPhoneError.hidden = true;
});

/* ================================ Tahrirlash / holat ==================================== */
function openEditModal(r) {
  editError.hidden = true;
  eId.value = r.id;
  eName.value = r.owner_name || "";
  eStatus.value = r.status;
  eDescription.value = "";
  editPhoneLabel.textContent = formatPhoneDisplay(r.phone_number);

  const isMine = myActivePhoneId === r.id;
  eTakeBtn.hidden = isMine;
  eUnlockBtn.hidden = !isMine;

  editModal.classList.add("open");
}

document.querySelectorAll(".js-close-edit").forEach((b) => b.addEventListener("click", () => editModal.classList.remove("open")));
editModal.addEventListener("click", (e) => { if (e.target === editModal) editModal.classList.remove("open"); });

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  createModal.classList.remove("open");
  editModal.classList.remove("open");
});

eTakeBtn.addEventListener("click", async () => {
  const id = eId.value;
  eTakeBtn.disabled = true;
  try {
    await api.takePhone(id);
    myActivePhoneId = Number(id);
    eTakeBtn.hidden = true;
    eUnlockBtn.hidden = false;
    await loadMyActive();
    await loadPhones(true);
  } catch (err) {
    editError.textContent = err.message || "Band qilib bo'lmadi.";
    editError.hidden = false;
  } finally {
    eTakeBtn.disabled = false;
  }
});

eUnlockBtn.addEventListener("click", async () => {
  const id = eId.value;
  eUnlockBtn.disabled = true;
  try {
    await api.unlockPhone(id);
    myActivePhoneId = null;
    eUnlockBtn.hidden = true;
    eTakeBtn.hidden = false;
    await loadMyActive();
    await loadPhones(true);
  } catch (err) {
    editError.textContent = err.message || "Bo'shatib bo'lmadi.";
    editError.hidden = false;
  } finally {
    eUnlockBtn.disabled = false;
  }
});

eDeleteBtn.addEventListener("click", async () => {
  const id = eId.value;
  if (!confirm("Bu raqamni butunlay o'chirmoqchimisiz?")) return;
  eDeleteBtn.disabled = true;
  try {
    await api.deletePhone(id);
    editModal.classList.remove("open");
    if (myActivePhoneId === Number(id)) myActivePhoneId = null;
    await loadPhones(true);
  } catch (err) {
    editError.textContent = err.message || "O'chirib bo'lmadi.";
    editError.hidden = false;
  } finally {
    eDeleteBtn.disabled = false;
  }
});

editForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  editError.hidden = true;

  const id = eId.value;
  const submitBtn = editForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  try {
    await api.updateOperator(id, {
      owner_name: eName.value.trim() || undefined,
      status: eStatus.value,
      description: eDescription.value.trim() || undefined,
    });
    editModal.classList.remove("open");
    await loadPhones(true);
  } catch (err) {
    editError.textContent = err.message || "Saqlab bo'lmadi.";
    editError.hidden = false;
  } finally {
    submitBtn.disabled = false;
  }
});
