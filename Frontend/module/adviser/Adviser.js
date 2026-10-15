"use strict";

const API_BASE = "http://localhost:3000/api";
const $ = id => document.getElementById(id);

const getToken = () => sessionStorage.getItem("voting_token") || localStorage.getItem("voting_token") || localStorage.getItem("token");

const getHeaders = () => {
    const token = getToken();
    return {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
};

let currentPositions = [];
let currentElectionId = null;
let editingCandidateId = null;

// ================= API HELPER =================

async function apiRequest(path, options = {}) {
    const response = await fetch(API_BASE + path, {
        ...options,
        headers: {
            ...getHeaders(),
            ...(options.headers || {})
        },
        cache: "no-store"
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.message || data.error || `API error ${response.status}`);
    }

    return data;
}

// ================= LOAD DATA =================

async function loadDashboardData() {
    const hint = $("positionHint");
    if (hint) hint.textContent = "Loading positions...";

    try {
        const data = await apiRequest("/positions/election/current");
        currentElectionId = data.election_id;
        currentPositions = Array.isArray(data.positions) ? data.positions : [];

        populatePositionDropdown();
        renderCandidatesTable();
        renderLiveResults();

        const totalCandidates = currentPositions.reduce((sum, position) => sum + (position.candidates || []).length, 0);

        if ($("statCandidates")) $("statCandidates").textContent = totalCandidates.toLocaleString();
        if ($("statPositions")) $("statPositions").textContent = currentPositions.length.toLocaleString();
        if ($("candidateCount")) $("candidateCount").textContent = `(${totalCandidates})`;

    } catch (error) {
        console.error("Load dashboard error:", error);
        if (hint) hint.textContent = "Unable to load positions.";
        if ($("candidatesTableBody")) {
            $("candidatesTableBody").innerHTML = `<tr><td colspan="5" class="p-5 text-red-700">${escapeHtml(error.message)}</td></tr>`;
        }
        alert("Position error: " + error.message);
    }
}

// ================= POSITION HELPERS =================

function normalizePosition(value) {
    return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function findPosition(title) {
    return currentPositions.find(position => normalizePosition(position.title) === normalizePosition(title));
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
    if (existing) {
        hint.textContent = `Existing position: ${existing.title}`;
        hint.className = "text-xs text-green-700 mt-2";
    } else {
        hint.textContent = `New position will be created: ${value}`;
        hint.className = "text-xs text-blue-700 mt-2";
    }
}

// ================= PARTY LIST COLORS =================

function getPartyRowClass(partyList) {
    const party = String(partyList ?? "").trim().toLowerCase();
    switch (party) {
        case "maroon": return "bg-[#800000] text-white";
        case "white": return "bg-white text-gray-900";
        case "independent": return "bg-[#64748B] text-white";
        default: return "bg-gray-100 text-gray-900";
    }
}

function getPartyBadgeClass(partyList) {
    const party = String(partyList ?? "").trim().toLowerCase();
    switch (party) {
        case "maroon": return "bg-white/20 text-white border-white/30";
        case "white": return "bg-gray-100 text-gray-900 border-gray-300";
        case "independent": return "bg-white/20 text-white border-white/30";
        default: return "bg-gray-200 text-gray-800 border-gray-300";
    }
}

// ================= CREATE / FIND POSITION =================

async function getOrCreatePosition(title) {
    const existing = findPosition(title);
    if (existing) return existing;

    if (!currentElectionId) throw new Error("Election not loaded.");

    const data = await apiRequest("/positions", {
        method: "POST",
        body: JSON.stringify({ election_id: currentElectionId, title: title })
    });

    if (!data.position || !data.position.position_id) {
        throw new Error("Position API did not return a position ID.");
    }

    return data.position;
}

// ================= ADD CANDIDATE =================

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

    if (!payload.name || !payload.course || !payload.grade_level || !payload.party_list || !positionTitle) {
        alert("Please complete all fields.");
        return;
    }

    if (positionTitle.length > 100) {
        alert("Position must be 100 characters or fewer.");
        return;
    }

    if (!currentElectionId) {
        alert("Election not loaded. Please refresh.");
        return;
    }

    try {
        button.disabled = true;
        button.textContent = "Adding Candidate...";

        const position = await getOrCreatePosition(positionTitle);
        payload.position_id = position.position_id;

        await apiRequest("/candidates", {
            method: "POST",
            body: JSON.stringify(payload)
        });

        alert("Candidate added successfully!");
        form.reset();
        await loadDashboardData();

    } catch (error) {
        console.error("Add candidate error:", error);
        alert("Error: " + error.message);
    } finally {
        button.disabled = false;
        button.innerHTML = `<i data-lucide="user-round-plus"></i> Add candidate`;
        if (window.lucide) lucide.createIcons();
    }
}

// ================= RENDER CANDIDATES =================

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

        const heading = `<tr class="bg-gray-200 font-bold text-gray-900"><td colspan="5" class="p-3">${escapeHtml(position.title)}</td></tr>`;

        const rows = candidates.map(candidate => {
            const rowClass = getPartyRowClass(candidate.party_list);
            const badgeClass = getPartyBadgeClass(candidate.party_list);
            const candidateId = Number(candidate.candidate_id);

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
                            <button type="button" data-edit="${candidateId}" class="action-btn action-edit" title="Edit candidate">
                                <i data-lucide="pencil"></i> Edit
                            </button>
                            <button type="button" data-delete="${candidateId}" class="action-btn action-delete" title="Delete candidate">
                                <i data-lucide="trash-2"></i> Delete
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join("");

        return heading + (rows || `<tr><td colspan="5" class="p-3 text-gray-500">No candidates registered.</td></tr>`);
    }).join("");

    if ($("No.candidates")) $("No.candidates").textContent = total.toLocaleString();
    if ($("candidateCount")) $("candidateCount").textContent = `(${total})`;

    if (window.lucide) lucide.createIcons();
}

// ================= LIVE RESULTS =================

function renderLiveResults() {
    const sidebar = $("dynamicSidebarPositions");
    if (!sidebar) return;

    sidebar.innerHTML = currentPositions.map(position => `
        <div class="mb-5">
            <h3 class="font-bold mb-2">${escapeHtml(position.title)}</h3>
            ${(position.candidates || []).map(candidate => `
                <div class="mb-3">
                    <div class="flex justify-between text-xs mb-1">
                        <span>${escapeHtml(candidate.name)}</span>
                        <span>0%</span>
                    </div>
                    <div class="bg-gray-300 h-3 rounded-full">
                        <div class="bg-[#800000] h-3 rounded-full" style="width:0%"></div>
                    </div>
                </div>
            `).join("") || "<p class='text-xs'>No candidates</p>"}
        </div>
    `).join("");
}

// ================= EDIT CANDIDATE =================


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
        const candidate = (position.candidates || []).find(c => Number(c.candidate_id) === Number(id));
        if (candidate) {
            selectedCandidate = candidate;
            selectedPosition = position;
            break;
        }
    }

    if (!selectedCandidate || !selectedPosition) {
        alert("Candidate not found.");
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
        alert("No candidate selected.");
        return;
    }

    const form = $("editCandidateForm");
    const button = form.querySelector('button[type="submit"]');
    const positionTitle = $("editPosition").value.trim().replace(/\s+/g, " ");

    const payload = {
        name: $("editName").value.trim(),
        course: $("editCourse").value.trim(),
        grade_level: $("editGrade").value,
        party_list: $("editParty").value.trim()
    };

    if (!payload.name || !payload.course || !payload.grade_level || !payload.party_list || !positionTitle) {
        alert("Please complete all fields.");
        return;
    }

    if (positionTitle.length > 100) {
        alert("Position must be 100 characters or fewer.");
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
        alert("Candidate updated successfully!");

    } catch (error) {
        console.error("Update failed:", error);
        alert("Update failed: " + error.message);
    } finally {
        button.disabled = false;
        button.innerHTML = `<i data-lucide="save"></i> Save changes`;
        if (window.lucide) lucide.createIcons();
    }
}

// ================= DELETE CANDIDATE =================

async function deleteCandidate(id) {
    if (!confirm("Delete this candidate?")) return;

    try {
        await apiRequest(`/candidates/${id}`, { method: "DELETE" });
        alert("Candidate deleted successfully!");
        await loadDashboardData();
    } catch (error) {
        console.error("Delete candidate error:", error);
        alert("Error: " + error.message);
    }
}

// ================= SECURITY =================

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// ================= EVENTS =================

document.addEventListener("DOMContentLoaded", () => {
    const addForm = $("addCandidateForm");
    if (addForm) addForm.addEventListener("submit", handleCandidateSubmit);

    const positionInput = $("candPositionText");
    if (positionInput) positionInput.addEventListener("input", updatePositionHint);

    const tableBody = $("candidatesTableBody");
    if (tableBody) {
        tableBody.addEventListener("click", event => {
            const editButton = event.target.closest("[data-edit]");
            const deleteButton = event.target.closest("[data-delete]");

            if (editButton) {
                openEditCandidate(Number(editButton.dataset.edit));
                return;
            }
            if (deleteButton) {
                deleteCandidate(Number(deleteButton.dataset.delete));
            }
        });
    }

    const editForm = $("editCandidateForm");
    if (editForm) editForm.addEventListener("submit", handleEditCandidate);

    const cancelButton = $("cancelEdit");
    if (cancelButton) cancelButton.addEventListener("click", closeEditCandidate);

    const editModal = $("editModal");
    if (editModal) {
        editModal.addEventListener("click", event => {
            if (event.target === editModal) closeEditCandidate();
        });
    }

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && $("editModal")?.classList.contains("open")) {
            closeEditCandidate();
        }
    });

    loadDashboardData();

    if (window.lucide) lucide.createIcons();
});