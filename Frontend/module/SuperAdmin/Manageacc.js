
"use strict";

const API_BASE = "https://voting-backend-cdrj.onrender.com/api";
const ACCOUNT_PATH = "/createAccount/accounts";

const $ = id => document.getElementById(id);

let accounts = [];

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

        const editable =
            id !== undefined &&
            id !== null &&
            ["adviser", "committee","super_admin"].includes(account.role);

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
                            ${editable ? "" : "disabled"}
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

// CREATE ACCOUNT + RESEND

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

    try {
        button.disabled = true;
        button.textContent = "Creating...";

        const data = await apiRequest("", {
            method: "POST",
            body: JSON.stringify({
                name,
                email,
                password,
                role
            })
        });

        if (data.emailSent === true) {
            if (data.emailRedirected === true) {
                notify(
                    "Account created! Test email accepted by Resend.",
                    "success"
                );
            } else {
                notify(
                    "Account created! Email accepted by Resend.",
                    "success"
                );
            }

        } else if (data.emailSent === false) {
            notify(
                "Account created, but the email was not sent. Check Resend settings and logs.",
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
        !["adviser", "committee","super_admin"].includes(account.role)
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

    $("editModal").classList.add("open");
    $("editName").focus();
}

// CLOSE EDIT MODAL

function closeEditModal() {
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
        !["adviser", "committee","super_admin"].includes(account.role)
    ) {
        notify(
            "This account cannot be deleted here.",
            "warning"
        );
        return;
    }

    // NEW: CONFIRMATION USING SEPARATE toast.js

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
            setTimeout(setCreatePassword, 0);
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
