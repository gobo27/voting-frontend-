
"use strict";

const API_BASE = "https://voting-backend-cdrj.onrender.com/api";
const $ = id => document.getElementById(id);
const getToken = () => sessionStorage.getItem("voting_token") || localStorage.getItem("voting_token") || localStorage.getItem("token");

let currentPositions = [];
let currentElectionId = null;
let editingCandidateId = null;
let dashboardRefreshTimer = null;

async function apiRequest(path, options = {}) {
    const token = getToken();
    const response = await fetch(API_BASE + path, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(options.headers || {})
        },
        cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `API error ${response.status}`);
    return data;
}

function notify(message, type = "success") {
    if (typeof window.showToast === "function") window.showToast(message, type);
    else alert(message);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function normalizePosition(value) {
    return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function findPosition(title) {
    return currentPositions.find(p => normalizePosition(p.title) === normalizePosition(title));
}

async function loadDashboardData() {
    const hint = $("positionHint");
    if (hint) hint.textContent = "Loading positions...";

    try {
        const data = await apiRequest("/positions/election/current");
        currentElectionId = data.election_id;
        currentPositions = Array.isArray(data.positions) ? data.positions : [];

        populatePositionDropdown();
        renderCandidatesTable();

        const total = currentPositions.reduce((sum, p) => sum + (p.candidates || []).length, 0);
        if ($("statCandidates")) $("statCandidates").textContent = total.toLocaleString();
        if ($("statPositions")) $("statPositions").textContent = currentPositions.length.toLocaleString();
        if ($("candidateCount")) $("candidateCount").textContent = `(${total})`;

        await loadLiveResults();
    } catch (error) {
        console.error("Dashboard error:", error);
        if (hint) hint.textContent = "Unable to load positions.";
        if ($("candidatesTableBody")) {
            $("candidatesTableBody").innerHTML =
                `<tr><td colspan="5" class="p-5 text-red-700">${escapeHtml(error.message)}</td></tr>`;
        }
        notify("Position error: " + error.message, "error");
    }
}

function populatePositionDropdown() {
    const list = $("positionSuggestions");
    if (!list) return;
    list.replaceChildren();

    currentPositions.forEach(position => {
        const option = document.createElement("option");
        option.value = position.title;
        list.appendChild(option);
    });
    updatePositionHint();
}

function updatePositionHint() {
    const input = $("candPositionText");
    const hint = $("positionHint");
    if (!input || !hint) return;

    const value = input.value.trim();
    if (!value) {
        hint.textContent = "Type an existing or new position.";
        hint.className = "hint";
        return;
    }

    const existing = findPosition(value);
    hint.textContent = existing
        ? `Existing position: ${existing.title}`
        : `New position will be created: ${value}`;
    hint.className = existing
        ? "text-xs text-green-700 mt-2"
        : "text-xs text-blue-700 mt-2";
}

function getPartyRowClass(partyList) {
    switch (String(partyList ?? "").trim().toLowerCase()) {
        case "maroon": return "bg-[#800000] text-white";
        case "white": return "bg-white text-gray-900";
        case "independent": return "bg-[#64748B] text-white";
        default: return "bg-gray-100 text-gray-900";
    }
}

function getPartyBadgeClass(partyList) {
    switch (String(partyList ?? "").trim().toLowerCase()) {
        case "maroon": return "bg-white/20 text-white border-white/30";
        case "white": return "bg-gray-100 text-gray-900 border-gray-300";
        case "independent": return "bg-white/20 text-white border-white/30";
        default: return "bg-gray-200 text-gray-800 border-gray-300";
    }
}

async function getOrCreatePosition(title) {
    const existing = findPosition(title);
    if (existing) return existing;
    if (!currentElectionId) throw new Error("Election not loaded.");

    const data = await apiRequest("/positions", {
        method: "POST",
        body: JSON.stringify({ election_id: currentElectionId, title })
    });

    if (!data.position?.position_id) {
        throw new Error("Position API did not return a position ID.");
    }
    return data.position;
}

async function handleCandidateSubmit(event) {
    event.preventDefault();

    const form = $("addCandidateForm");
    const button = form.querySelector('button[type="submit"]');
    const positionTitle = $("candPositionText").value.trim().replace(/\s+/g, " ");

    const payload = {
        name: $("candFullName").value.trim(),
        course: $("candCourse").value.trim(),
        grade_level: $("candGrade").value,
        party_list: $("candParty").value.trim()
    };

    if (!payload.name || !payload.course || !payload.grade_level ||
        !payload.party_list || !positionTitle) {
        notify("Please complete all fields.", "error");
        return;
    }

    if (positionTitle.length > 100) {
        notify("Position must be 100 characters or fewer.", "error");
        return;
    }

    if (!currentElectionId) {
        notify("Election not loaded. Please refresh.", "error");
        return;
    }

    try {
        button.disabled = true;
        button.textContent = "Adding Candidate...";

        const position = await getOrCreatePosition(positionTitle);
        payload.position_id = Number(position.position_id);

        await apiRequest("/candidates", {
            method: "POST",
            body: JSON.stringify(payload)
        });

        form.reset();
        await loadDashboardData();
        notify("Candidate added successfully!");
    } catch (error) {
        console.error("Add candidate error:", error);
        notify("Failed to add candidate: " + error.message, "error");
    } finally {
        button.disabled = false;
        button.innerHTML = `<i data-lucide="user-round-plus"></i> Add candidate`;
        if (window.lucide) lucide.createIcons();
    }
}

function renderCandidatesTable() {
    const tbody = $("candidatesTableBody");
    if (!tbody) return;

    let total = 0;

    if (!currentPositions.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="p-5 text-center">No positions found. Type a new position when adding a candidate.</td></tr>`;
        if ($("No.candidates")) $("No.candidates").textContent = "0";
        if ($("candidateCount")) $("candidateCount").textContent = "(0)";
        return;
    }

    tbody.innerHTML = currentPositions.map(position => {
        const candidates = position.candidates || [];
        total += candidates.length;

        const heading = `<tr class="bg-gray-200 font-bold text-gray-900"><td colspan="5" class="p-3 uppercase">${escapeHtml(position.title)}</td></tr>`;

        const rows = candidates.map(candidate => {
            const id = Number(candidate.candidate_id);
            const rowClass = getPartyRowClass(candidate.party_list);
            const badgeClass = getPartyBadgeClass(candidate.party_list);

            return `
            <tr class="${rowClass}">
                <td class="p-3 font-semibold">${escapeHtml(candidate.name)}</td>
                <td class="p-3">${escapeHtml(candidate.course || "-")}</td>
                <td class="p-3">${escapeHtml(candidate.grade_level || "-")}</td>
                <td class="p-3">
                    <span class="inline-block px-3 py-1 rounded-full text-xs font-semibold border ${badgeClass}">
                        ${escapeHtml(candidate.party_list || "-")}
                    </span>
                </td>
                <td class="p-3">
                    <div class="action-buttons">
                        <button type="button" data-edit="${id}" class="action-btn action-edit">
                            <i data-lucide="pencil"></i> Edit
                        </button>
                        <button type="button" data-delete="${id}" class="action-btn action-delete">
                            <i data-lucide="trash-2"></i> Delete
                        </button>
                    </div>
                </td>
            </tr>`;
        }).join("");

        return heading + (rows || `<tr><td colspan="5" class="p-3 text-gray-500">No candidates registered.</td></tr>`);
    }).join("");

    if ($("No.candidates")) $("No.candidates").textContent = total.toLocaleString();
    if ($("candidateCount")) $("candidateCount").textContent = `(${total})`;
    if (window.lucide) lucide.createIcons();
}

async function loadLiveResults() {
    const status = $("votesStatus");

    try {
        const data = await apiRequest("/dashboard/current/overview");
        const statistics = data.statistics || {};
        const positions = Array.isArray(data.positions) ? data.positions : [];
        const scanned = Number(statistics.scanned_ballots || 0);

        if ($("statVotes")) $("statVotes").textContent = scanned.toLocaleString();
        if (status) status.textContent = "Scanned ballots counted";

        renderLiveResults(positions, data.election);

        const overviewRows = document.querySelectorAll(".overview-row");
        overviewRows.forEach(row => {
            const label = row.querySelector("span")?.textContent.trim().toLowerCase();
            const value = row.querySelector("strong");
            if (!value) return;

            if (label === "votes cast") value.textContent = scanned.toLocaleString();
            if (label === "candidates") value.textContent =
                Number(statistics.total_candidates || 0).toLocaleString();
        });
    } catch (error) {
        console.error("Live results error:", error);
        if (status) status.textContent = "Unable to load live results";
        const sidebar = $("dynamicSidebarPositions");
        if (sidebar && !sidebar.dataset.loaded) {
            sidebar.textContent = "Live results are currently unavailable.";
        }
    }
}

function renderLiveResults(positions = [], election = {}) {
    const sidebar = $("dynamicSidebarPositions");
    if (!sidebar) return;

    const revealNames =
        String(election.status || "").toLowerCase() === "completed" &&
        !Boolean(Number(election.mask_names));

    if (!positions.length) {
        sidebar.innerHTML = `<p class="muted">No election results available.</p>`;
        sidebar.dataset.loaded = "true";
        return;
    }

    sidebar.innerHTML = positions.map(position => {
        const candidates = position.candidates || [];
        const totalVotes = candidates.reduce(
            (sum, candidate) => sum + Number(candidate.total_votes || 0), 0
        );

        const rows = candidates.map(candidate => {
            const votes = Number(candidate.total_votes || 0);
            const percentage = totalVotes > 0 ? votes / totalVotes * 100 : 0;
            const safePercentage = Math.max(0, Math.min(100, percentage));
            const name = revealNames
                ? candidate.name
                : `Candidate #${candidate.candidate_id}`;

            return `
            <div class="mb-3">
                <div class="flex justify-between text-xs mb-1 gap-2">
                    <span>${escapeHtml(name)}</span>
                    <span class="whitespace-nowrap">${votes.toLocaleString()} (${percentage.toFixed(1)}%)</span>
                </div>
                <div class="bg-gray-300 h-3 rounded-full overflow-hidden">
                    <div class="bg-[#800000] h-3 rounded-full" style="width:${safePercentage}%"></div>
                </div>
            </div>`;
        }).join("");

        return `
        <div class="mb-5">
            <h3 class="font-bold mb-2">${escapeHtml(position.position_title || "Position").toUpperCase()}</h3>
            ${rows || `<p class="text-xs">No candidates</p>`}
        </div>`;
    }).join("");

    sidebar.dataset.loaded = "true";
}

function populateEditPositions() {
    const select = $("editPosition");
    if (!select) return;

    select.replaceChildren();
    currentPositions.forEach(position => {
        const option = document.createElement("option");
        option.value = position.title;
        option.textContent = position.title;
        select.appendChild(option);
    });
}

function openEditCandidate(id) {
    let selectedCandidate = null;
    let selectedPosition = null;

    for (const position of currentPositions) {
        const candidate = (position.candidates || []).find(
            item => Number(item.candidate_id) === Number(id)
        );
        if (candidate) {
            selectedCandidate = candidate;
            selectedPosition = position;
            break;
        }
    }

    if (!selectedCandidate || !selectedPosition) {
        notify("Candidate not found.", "error");
        return;
    }

    editingCandidateId = Number(id);
    $("editCandidateId").value = selectedCandidate.candidate_id;
    $("editName").value = selectedCandidate.name || "";
    $("editCourse").value = selectedCandidate.course || "";
    $("editGrade").value = selectedCandidate.grade_level || "";
    $("editParty").value = selectedCandidate.party_list || "";

    populateEditPositions();
    $("editPosition").value = selectedPosition.title || "";
    $("editModal").classList.add("open");
}

function closeEditCandidate() {
    $("editModal").classList.remove("open");
    $("editCandidateForm").reset();
    editingCandidateId = null;
}

async function handleEditCandidate(event) {
    event.preventDefault();

    if (!editingCandidateId) {
        notify("No candidate selected.", "error");
        return;
    }

    const button = $("editCandidateForm").querySelector('button[type="submit"]');
    const positionTitle = $("editPosition").value.trim().replace(/\s+/g, " ");

    const payload = {
        name: $("editName").value.trim(),
        course: $("editCourse").value.trim(),
        grade_level: $("editGrade").value,
        party_list: $("editParty").value.trim()
    };

    if (!payload.name || !payload.course || !payload.grade_level ||
        !payload.party_list || !positionTitle) {
        notify("Please complete all fields.", "error");
        return;
    }

    if (positionTitle.length > 100) {
        notify("Position must be 100 characters or fewer.", "error");
        return;
    }

    try {
        button.disabled = true;
        button.textContent = "Saving changes...";

        const position = await getOrCreatePosition(positionTitle);
        payload.position_id = Number(position.position_id);

        await apiRequest(`/candidates/${editingCandidateId}`, {
            method: "PUT",
            body: JSON.stringify(payload)
        });

        closeEditCandidate();
        await loadDashboardData();
        notify("Candidate updated successfully!");
    } catch (error) {
        console.error("Update failed:", error);
        notify("Update failed: " + error.message, "error");
    } finally {
        button.disabled = false;
        button.innerHTML = `<i data-lucide="save"></i> Save changes`;
        if (window.lucide) lucide.createIcons();
    }
}

async function deleteCandidate(id) {
    if (!confirm("Delete this candidate?")) return;

    try {
        await apiRequest(`/candidates/${id}`, { method: "DELETE" });
        await loadDashboardData();
        notify("Candidate deleted successfully!");
    } catch (error) {
        console.error("Delete candidate error:", error);
        notify(
            error.message.includes("No editable current election")
                ? "Cannot delete candidates while voting is in progress."
                : "Error: " + error.message,
            "error"
        );
    }
}

document.addEventListener("DOMContentLoaded", () => {
    $("addCandidateForm")?.addEventListener("submit", handleCandidateSubmit);
    $("candPositionText")?.addEventListener("input", updatePositionHint);
    $("editCandidateForm")?.addEventListener("submit", handleEditCandidate);
    $("cancelEdit")?.addEventListener("click", closeEditCandidate);

    $("candidatesTableBody")?.addEventListener("click", event => {
        const editButton = event.target.closest("[data-edit]");
        const deleteButton = event.target.closest("[data-delete]");

        if (editButton) openEditCandidate(Number(editButton.dataset.edit));
        else if (deleteButton) deleteCandidate(Number(deleteButton.dataset.delete));
    });

    $("editModal")?.addEventListener("click", event => {
        if (event.target === $("editModal")) closeEditCandidate();
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && $("editModal")?.classList.contains("open")) {
            closeEditCandidate();
        }
    });

    loadDashboardData();

    dashboardRefreshTimer = setInterval(() => {
        if (!document.hidden) loadLiveResults();
    }, 10000);

    if (window.lucide) lucide.createIcons();
});
