
"use strict";

const API_BASE = "https://voting-backend-cdrj.onrender.com/api";
const ACCOUNT_PATH = "/createAccount/accounts";

const $ = id => document.getElementById(id);

let accounts = [];
let currentScopes = [];
let scopeElection = null;
let scopesLoaded = false;
let scopesManageable = false;
let editAssignmentsLoaded = false;
let editLoadVersion = 0;

// AUTHENTICATION

function getToken() {
    return sessionStorage.getItem("voting_token") ||
        localStorage.getItem("voting_token") ||
        localStorage.getItem("token");
}

function getHeaders() {
    const token = getToken();

    return {
        "Content-Type": "application/json",
        ...(token ? {
            Authorization: `Bearer ${token}`
        } : {})
    };
}

// TOAST NOTIFICATIONS

function notify(message, type = "info") {
    if (typeof window.showToast === "function") {
        window.showToast(message, type);
    } else {
        console.warn("Toast unavailable:", message);
    }
}

// SECURE PASSWORD GENERATOR

function secureRandomIndex(length) {
    if (!window.crypto || !window.crypto.getRandomValues) {
        throw new Error(
            "Secure password generation is unavailable."
        );
    }

    const range = 4294967296;
    const limit = Math.floor(range / length) * length;
    const buffer = new Uint32Array(1);

    let number;

    do {
        crypto.getRandomValues(buffer);
        number = buffer[0];
    } while (number >= limit);

    return number % length;
}

function randomCharacter(characters) {
    return characters[secureRandomIndex(characters.length)];
}

function generateRandomPassword() {
    const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const lower = "abcdefghijkmnopqrstuvwxyz";
    const numbers = "23456789";
    const symbols = "!@#$%";

    const all = upper + lower + numbers + symbols;

    const characters = [
        randomCharacter(upper),
        randomCharacter(lower),
        randomCharacter(numbers),
        randomCharacter(symbols)
    ];

    while (characters.length < 9) {
        characters.push(randomCharacter(all));
    }

    for (let i = characters.length - 1; i > 0; i--) {
        const j = secureRandomIndex(i + 1);

        [characters[i], characters[j]] = [
            characters[j],
            characters[i]
        ];
    }

    return characters.join("");
}

function setCreatePassword() {
    try {
        $("password").value = generateRandomPassword();
    } catch (error) {
        notify(error.message, "error");
    }
}

function setEditPassword() {
    try {
        $("editPassword").value = generateRandomPassword();

        notify(
            "New 9-character password generated. Save changes to apply it.",
            "info"
        );

    } catch (error) {
        notify(error.message, "error");
    }
}

// API REQUEST

async function apiRequest(path = "", options = {}) {
    const token = getToken();

    if (!token) {
        throw new Error("Please log in again.");
    }

    let response;

    try {
        response = await fetch(
            API_BASE + ACCOUNT_PATH + path,
            {
                ...options,
                headers: {
                    ...getHeaders(),
                    ...(options.headers || {})
                }
            }
        );

    } catch (error) {
        throw new Error(
            "Cannot connect to backend. Check your server."
        );
    }

    const text = await response.text();
    let data = {};

    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            throw new Error(
                `Invalid server response (HTTP ${response.status}).`
            );
        }
    }

    if (!response.ok) {
        throw new Error(
            data.message ||
            data.error ||
            `Request failed (HTTP ${response.status}).`
        );
    }

    return data;
}

// Current-election scopes use a different URL than /accounts.
async function scopeRequest(path, options = {}) {
    const token = getToken();
    if (!token) throw new Error("Please log in again.");

    let response;
    try {
        response = await fetch(API_BASE + "/createAccount" + path, {
            ...options,
            headers: {
                ...getHeaders(),
                ...(options.headers || {})
            }
        });
    } catch (_) {
        throw new Error(
            "Cannot connect to backend. Check your server."
        );
    }

    const raw = await response.text();
    let data = {};

    if (raw) {
        try {
            data = JSON.parse(raw);
        } catch (_) {
            throw new Error(
                `Invalid server response (HTTP ${response.status}).`
            );
        }
    }

    if (!response.ok) {
        throw new Error(
            data.message ||
            `Request failed (HTTP ${response.status}).`
        );
    }

    return data;
}

// Kunin ang selected department/grade IDs
function checkedScopeIds(containerId) {
    return Array.from(
        $(containerId).querySelectorAll(
            'input[type="checkbox"]:checked'
        )
    ).map(input => Number(input.value));
}

function setScopeChecks(containerId, ids) {
    const selected = new Set(ids.map(Number));

    $(containerId)
        .querySelectorAll('input[type="checkbox"]')
        .forEach(input => {
            input.checked = selected.has(Number(input.value));
        });

    showScopeCount(containerId);
}

function showScopeCount(containerId) {
    const stateId = containerId === "createScopeList"
        ? "createScopeState"
        : "editScopeState";

    const total = $(containerId)
        .querySelectorAll('input[type="checkbox"]').length;

    const selected = checkedScopeIds(containerId).length;

    if (scopesLoaded && scopesManageable) {
        $(stateId).textContent =
            `${selected} of ${total} selected`;

        $(stateId).classList.remove("error");
    }
}

// Dynamic checkboxes mula sa database
function renderScopeChoices(containerId) {
    $(containerId).innerHTML = currentScopes.map(scope => `
        <label class="scope-choice">
            <input
                type="checkbox"
                value="${Number(scope.scope_id)}"
                ${Number(scope.is_active) !== 1 ||
            !scopesManageable
            ? "disabled"
            : ""
        }
            >
            <span>${escapeHtml(scope.scope_name)}</span>
        </label>
    `).join("");

    showScopeCount(containerId);
}

function scopeSectionVisible(role, isEdit) {
    $(
        isEdit
            ? "editScopeSection"
            : "createScopeSection"
    ).hidden = role !== "committee";
}

// Load available departments/grades
async function loadScopes() {
    scopesLoaded = false;
    scopesManageable = false;

    $("createScopeState").textContent =
        "Loading departments/grades...";

    $("editScopeState").textContent =
        "Loading departments/grades...";

    try {
        const data = await scopeRequest("/scopes");

        if (!Array.isArray(data.scopes)) {
            throw new Error(
                "Unexpected scopes API response."
            );
        }

        currentScopes = data.scopes.filter(
            scope => Number(scope.is_active) === 1
        );

        scopeElection = data.election;
        const canManageValue = data.can_manage ?? data.canManage;

        scopesManageable =
            canManageValue === true ||
            canManageValue === 1 ||
            canManageValue === "1";
        scopesLoaded = true;

        const description = scopeElection
            ? `${scopeElection.title} · ` +
            `${scopeElection.school_level} · ` +
            `Election #${scopeElection.election_id}`
            : "Current election";

        $("createScopeElection").textContent = description;
        $("editScopeElection").textContent = description;

        renderScopeChoices("createScopeList");
        renderScopeChoices("editScopeList");

        if (!currentScopes.length) {
            $("createScopeState").textContent =
                "No departments/grades configured for this election.";

            $("editScopeState").textContent =
                "No departments/grades configured for this election.";

        } else if (!scopesManageable) {
            $("createScopeState").textContent =
                "Assignments are locked for this election.";

            $("editScopeState").textContent =
                "Assignments are locked for this election.";
        }

        $("createScopeState").classList.remove("error");
        $("editScopeState").classList.remove("error");

    } catch (error) {
        console.error("Load scopes error:", error);

        currentScopes = [];
        scopeElection = null;

        $("createScopeList").innerHTML = "";
        $("editScopeList").innerHTML = "";

        $("createScopeState").textContent = error.message;
        $("editScopeState").textContent = error.message;

        $("createScopeState").classList.add("error");
        $("editScopeState").classList.add("error");

        notify(
            "Unable to load scanner assignments: " +
            error.message,
            "warning"
        );
    }
}

// Prevent saving kapag hindi loaded ang scopes
function requireScopesReady() {
    if (
        !scopesLoaded ||
        !scopesManageable ||
        !scopeElection
    ) {
        notify(
            "Assignments are unavailable. Refresh or check the current election.",
            "warning"
        );
        return false;
    }

    return true;
}

// Load saved assignments sa Edit Account
async function loadEditAssignments(id) {
    const version = ++editLoadVersion;

    editAssignmentsLoaded = false;

    $("editScopeState").textContent =
        "Loading saved assignments...";

    try {
        if (!scopesLoaded) {
            await loadScopes();
        }

        if (!scopesLoaded || !scopeElection) {
            throw new Error(
                "Election scopes are unavailable."
            );
        }

        const existingAccount = accounts.find(
            account => String(account.id) === String(id)
        );

        if (existingAccount?.role === "adviser") {
            if (version !== editLoadVersion) return;

            setScopeChecks("editScopeList", []);
            editAssignmentsLoaded = true;
            return;
        }

        const data = await scopeRequest(
            `/accounts/${encodeURIComponent(id)}/assignments`
        );

        if (
            version !== editLoadVersion ||
            String($("editId").value) !== String(id)
        ) {
            return;
        }

        if (!Array.isArray(data.assignments)) {
            throw new Error(
                "Unexpected assignments response."
            );
        }

        setScopeChecks(
            "editScopeList",
            data.assignments
                .filter(a => Number(a.is_active) === 1)
                .map(a => Number(a.scope_id))
        );

        editAssignmentsLoaded = true;

        if (!scopesManageable) {
            $("editScopeState").textContent =
                "Assignments cannot be changed after election starts.";
        }

    } catch (error) {
        if (version !== editLoadVersion) return;

        $("editScopeState").textContent =
            "Could not load assignments: " + error.message;

        $("editScopeState").classList.add("error");

        notify(
            "Failed to load Committee assignments: " +
            error.message,
            "error"
        );
    }
}

// HELPERS

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function normalizeRole(role) {
    return String(role || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_");
}

function normalizeAccount(account) {
    return {
        id: account.user_id ?? account.id,
        name: account.name ?? account.username ?? "",
        email: account.email ?? "",
        role: normalizeRole(account.role)
    };
}

function formatCount(value) {
    return String(value).padStart(2, "0");
}

function initials(name) {
    return String(name || "?")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map(part => part.charAt(0))
        .join("")
        .toUpperCase();
}

function roleLabel(role) {
    if (role === "super_admin") return "Super Admin";
    if (role === "adviser") return "Adviser";
    if (role === "committee") return "Committee";

    return role || "Unknown";
}

// ACCOUNT STATISTICS

function updateStats() {
    $("statTotal").textContent =
        formatCount(accounts.length);

    $("statAdvisers").textContent = formatCount(
        accounts.filter(
            account => account.role === "adviser"
        ).length
    );

    $("statCommittee").textContent = formatCount(
        accounts.filter(
            account => account.role === "committee"
        ).length
    );

    $("listCount").textContent = accounts.length;
}

// RENDER ACCOUNT LIST

function renderAccounts() {
    const tbody = $("accountsTableBody");

    if (!accounts.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align:center">
                    No accounts found.
                </td>
            </tr>
        `;

        updateStats();
        return;
    }

    tbody.innerHTML = accounts.map(account => {
        const id = account.id;
        const hasId = id !== undefined && id !== null;

        const editable =
            hasId &&
            ["adviser", "committee"].includes(account.role);

        const deletable =
            hasId &&
            ["adviser", "committee", "super_admin"]
                .includes(account.role);

        return `
            <tr>
                <td>
                    <div class="user-cell">
                        <span class="initials">
                            ${escapeHtml(initials(account.name))}
                        </span>

                        <strong>
                            ${escapeHtml(account.name)}
                        </strong>
                    </div>
                </td>

                <td>
                    <span class="role ${escapeHtml(account.role)}">
                        ${escapeHtml(roleLabel(account.role))}
                    </span>
                </td>

                <td class="email">
                    ${escapeHtml(account.email)}
                </td>

                <td>
                    <div class="actions">
                        <button
                            type="button"
                            class="icon-btn edit"
                            data-edit="${escapeHtml(id)}"
                            title="Edit account"
                            ${editable ? "" : "disabled"}
                        >
                            <svg viewBox="0 0 24 24">
                                <path d="M12 20h9"/>
                                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L9 17l-4 1 1-4Z"/>
                            </svg>
                        </button>

                        <button
                            type="button"
                            class="icon-btn delete"
                            data-delete="${escapeHtml(id)}"
                            title="Delete account"
                            ${deletable ? "" : "disabled"}
                        >
                            <svg viewBox="0 0 24 24">
                                <path d="M3 6h18"/>
                                <path d="M8 6V4h8v2"/>
                                <path d="M5 6l1 14h12l1-14"/>
                                <path d="M10 10v7M14 10v7"/>
                            </svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");

    updateStats();
}

// LOAD ACCOUNTS

async function loadAccounts() {
    const tbody = $("accountsTableBody");

    tbody.innerHTML = `
        <tr>
            <td colspan="4" style="text-align:center">
                Loading accounts...
            </td>
        </tr>
    `;

    try {
        const data = await apiRequest("");

        const list = Array.isArray(data)
            ? data
            : data.users ?? data.accounts ?? data.data;

        if (!Array.isArray(list)) {
            throw new Error(
                "Unexpected accounts API response."
            );
        }

        accounts = list.map(normalizeAccount);
        renderAccounts();

    } catch (error) {
        console.error("Load accounts error:", error);

        tbody.innerHTML = `
            <tr>
                <td
                    colspan="4"
                    style="text-align:center;color:#dc2626"
                >
                    Unable to load accounts.
                </td>
            </tr>
        `;

        notify(
            "Failed to load accounts: " + error.message,
            "error"
        );
    }
}

// CREATE ACCOUNT

async function addAccount(event) {
    event.preventDefault();

    const button = $("createAccountButton");

    const name = $("userName").value.trim();
    const email = $("accountEmail").value.trim();
    const password = $("password").value;
    const role = $("role").value;

    if (!name || !email || !password || !role) {
        notify(
            "Please complete all fields.",
            "warning"
        );
        return;
    }

    if (password.length !== 9) {
        notify(
            "Password must contain exactly 9 characters.",
            "warning"
        );
        return;
    }

    if (role === "committee" && !requireScopesReady()) return;

    const payload = { name, email, password, role };

    if (role === "committee") {
        payload.scope_ids = checkedScopeIds("createScopeList");
    }

    try {
        button.disabled = true;
        button.textContent = "Creating...";

        const data = await apiRequest("", {
            method: "POST",
            body: JSON.stringify(payload)
        });

        if (data.emailSent === true) {
            notify(
                "Account created! Email accepted by EmailJS.",
                "success"
            );

        } else if (data.emailSent === false) {
            notify(
                "Account created, but the email was not sent. Check EmailJS settings and logs.",
                "warning"
            );

        } else {
            notify(
                "Account created successfully. Email delivery status is unavailable.",
                "info"
            );
        }

        $("userName").value = "";
        $("accountEmail").value = "";
        $("role").value = "adviser";

        scopeSectionVisible("adviser", false);
        setScopeChecks("createScopeList", []);

        setCreatePassword();

        await loadAccounts();

    } catch (error) {
        console.error("Create account error:", error);

        notify(
            "Failed to create account: " + error.message,
            "error"
        );

    } finally {
        button.disabled = false;
        button.textContent = "＋ Create account";
    }
}

// OPEN EDIT MODAL

function openEditModal(id) {
    const account = accounts.find(
        account => String(account.id) === String(id)
    );

    if (!account) {
        notify("Account not found.", "error");
        return;
    }

    if (
        !["adviser", "committee"].includes(account.role)
    ) {
        notify(
            "This account cannot be edited here.",
            "warning"
        );
        return;
    }

    $("editId").value = account.id;
    $("editName").value = account.name;
    $("editEmail").value = account.email;
    $("editRole").value = account.role;
    $("editPassword").value = "";

    editAssignmentsLoaded = false;

    setScopeChecks("editScopeList", []);
    scopeSectionVisible(account.role, true);

    $("editModal").classList.add("open");
    $("editName").focus();

    if (account.role === "committee") {
        loadEditAssignments(id);
    }
}

// CLOSE EDIT MODAL

function closeEditModal() {
    ++editLoadVersion;
    editAssignmentsLoaded = false;

    $("editModal").classList.remove("open");
    $("editAccountForm").reset();
}

// SAVE EDIT ACCOUNT

async function saveEdit(event) {
    event.preventDefault();

    const button = $("saveEditButton");

    const id = $("editId").value;
    const name = $("editName").value.trim();
    const email = $("editEmail").value.trim();
    const role = $("editRole").value;
    const password = $("editPassword").value;

    if (!id || !name || !email || !role) {
        notify(
            "Please complete all required fields.",
            "warning"
        );
        return;
    }

    if (password && password.length !== 9) {
        notify(
            "New password must contain exactly 9 characters.",
            "warning"
        );
        return;
    }

    const payload = {
        name,
        email,
        role
    };

    if (password) {
        payload.password = password;
    }

    if (role === "committee") {
        if (!requireScopesReady()) return;

        if (!editAssignmentsLoaded) {
            notify(
                "Wait until the saved assignments have loaded.",
                "warning"
            );
            return;
        }

        payload.scope_ids = checkedScopeIds("editScopeList");
    }

    try {
        button.disabled = true;
        button.textContent = "Saving...";

        await apiRequest(
            `/${encodeURIComponent(id)}`,
            {
                method: "PUT",
                body: JSON.stringify(payload)
            }
        );

        closeEditModal();

        if (password) {
            notify(
                "Account updated! Securely share the new password.",
                "success"
            );

        } else {
            notify(
                "Account updated successfully!",
                "success"
            );
        }

        await loadAccounts();

    } catch (error) {
        console.error("Update account error:", error);

        notify(
            "Failed to update account: " + error.message,
            "error"
        );

    } finally {
        button.disabled = false;
        button.textContent = "Save changes";
    }
}

// DELETE ACCOUNT WITH CONFIRMATION TOAST

let deletingAccount = false;

async function deleteAccount(id) {
    if (deletingAccount) return;

    const account = accounts.find(
        account => String(account.id) === String(id)
    );

    if (!account) {
        notify("Account not found.", "error");
        return;
    }

    if (
        !["adviser", "committee", "super_admin"]
            .includes(account.role)
    ) {
        notify(
            "This account cannot be deleted here.",
            "warning"
        );
        return;
    }

    // Confirmation gamit ang existing toast.js
    if (typeof window.showConfirmToast !== "function") {
        notify(
            "Confirmation toast is unavailable. Check toast.js.",
            "error"
        );
        return;
    }

    const confirmed = await window.showConfirmToast(
        `Are you sure you want to delete ${account.name}? This action cannot be undone.`,
        {
            title: "Delete Account?",
            confirmText: "Delete Account",
            cancelText: "Cancel"
        }
    );

    if (!confirmed) {
        return;
    }

    try {
        deletingAccount = true;

        await apiRequest(
            `/${encodeURIComponent(id)}`,
            {
                method: "DELETE"
            }
        );

        notify(
            "Account deleted successfully!",
            "success"
        );

        await loadAccounts();

    } catch (error) {
        console.error("Delete account error:", error);

        notify(
            "Failed to delete account: " + error.message,
            "error"
        );

    } finally {
        deletingAccount = false;
    }
}

// EVENT LISTENERS

document.addEventListener("DOMContentLoaded", () => {

    // Load current election scopes
    loadScopes();

    scopeSectionVisible($("role").value, false);

    $("role").addEventListener("change", () => {
        scopeSectionVisible($("role").value, false);
    });

    $("editRole").addEventListener("change", () => {
        scopeSectionVisible($("editRole").value, true);

        if ($("editRole").value === "committee") {
            loadEditAssignments($("editId").value);
        }
    });

    // Select All at Clear All sa Create/Edit
    for (const [prefix, container] of [
        ["create", "createScopeList"],
        ["edit", "editScopeList"]
    ]) {
        $(prefix + "SelectAll").addEventListener(
            "click",
            () => {
                if (!scopesManageable) return;

                $(container)
                    .querySelectorAll(
                        'input[type="checkbox"]:not(:disabled)'
                    )
                    .forEach(checkbox => {
                        checkbox.checked = true;
                    });

                showScopeCount(container);
            }
        );

        $(prefix + "ClearAll").addEventListener(
            "click",
            () => {
                if (!scopesManageable) return;

                $(container)
                    .querySelectorAll(
                        'input[type="checkbox"]:not(:disabled)'
                    )
                    .forEach(checkbox => {
                        checkbox.checked = false;
                    });

                showScopeCount(container);
            }
        );

        $(container).addEventListener(
            "change",
            () => showScopeCount(container)
        );
    }

    // GENERATE INITIAL PASSWORD

    setCreatePassword();

    // GENERATE CREATE PASSWORD

    $("generatePassword").addEventListener(
        "click",
        () => {
            setCreatePassword();

            notify(
                "New 9-character password generated.",
                "info"
            );
        }
    );

    // GENERATE EDIT PASSWORD

    $("generateEditPassword").addEventListener(
        "click",
        setEditPassword
    );

    // RESET CREATE FORM

    $("addAccountForm").addEventListener(
        "reset",
        () => {
            setTimeout(() => {
                setCreatePassword();
                scopeSectionVisible($("role").value, false);
                setScopeChecks("createScopeList", []);
            }, 0);
        }
    );

    // CREATE ACCOUNT

    $("addAccountForm").addEventListener(
        "submit",
        addAccount
    );

    // SAVE EDIT

    $("editAccountForm").addEventListener(
        "submit",
        saveEdit
    );

    // CANCEL EDIT

    $("cancelEdit").addEventListener(
        "click",
        closeEditModal
    );

    // CLOSE EDIT MODAL ON BACKDROP CLICK

    $("editModal").addEventListener(
        "click",
        event => {
            if (event.target === $("editModal")) {
                closeEditModal();
            }
        }
    );

    // ESCAPE KEY

    document.addEventListener(
        "keydown",
        event => {
            if (event.key === "Escape") {
                closeEditModal();
            }
        }
    );

    // ACCOUNT ACTION BUTTONS

    $("accountsTableBody").addEventListener(
        "click",
        event => {
            const edit =
                event.target.closest("[data-edit]");

            const remove =
                event.target.closest("[data-delete]");

            if (edit && !edit.disabled) {
                openEditModal(edit.dataset.edit);
            }

            if (remove && !remove.disabled) {
                deleteAccount(remove.dataset.delete);
            }
        }
    );

    // LOAD ACCOUNTS

    loadAccounts();
});
