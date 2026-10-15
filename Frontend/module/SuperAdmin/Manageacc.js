
const API_BASE =
    window.location.port === "5500"
        ? "http://localhost:3000/api/createAccount"
        : "/api/createAccount";

const $ = id => document.getElementById(id);

const getToken = () =>
    sessionStorage.getItem("voting_token") ||
    localStorage.getItem("voting_token") ||
    localStorage.getItem("token");

const getHeaders = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${getToken()}`
});

let currentPositions = [];
let currentElectionId = null;

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function normalizePosition(value) {
    return String(value ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
}

function findPosition(title) {
    return currentPositions.find(
        p => normalizePosition(p.title) === normalizePosition(title)
    );
}

function getAllCandidates() {
    return currentPositions.flatMap(
        p => p.candidates || []
    );
}

async function apiRequest(path, options = {}) {
    const response = await fetch(API_BASE + path, {
        ...options,
        headers: {
            ...getHeaders(),
            ...(options.headers || {})
        }
    });

    const text = await response.text();
    let data;

    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        throw new Error(
            `API returned invalid JSON (HTTP ${response.status})`
        );
    }

    if (!response.ok) {
        throw new Error(
            data.message || `HTTP ${response.status}`
        );
    }

    return data;
}

// ================= LOAD DASHBOARD =================

async function loadDashboardData() {
    try {
        const data = await apiRequest(
            "/positions/election/current"
        );

        currentPositions = data.positions || [];

        currentElectionId = Number(
            data.election_id ||
            currentPositions[0]?.election_id
        ) || null;

        populatePositionSuggestions();
        renderCandidates();
        renderLiveResults();
        updateStats();

        if (!currentElectionId) {
            $("positionHint").textContent =
                "Election ID unavailable. Check the positions API.";
        }

    } catch (error) {
        console.error("Dashboard error:", error);

        $("candidatesTableBody").innerHTML = `
            <tr>
                <td colspan="5" style="color:red">
                    ${escapeHtml(error.message)}
                </td>
            </tr>
        `;

        $("positionHint").textContent =
            "Unable to load election.";

        alert("Dashboard error: " + error.message);
    }
}

// ================= POSITIONS =================

function populatePositionSuggestions() {
    const list = $("positionSuggestions");
    list.replaceChildren();

    currentPositions.forEach(position => {
        const option = document.createElement("option");
        option.value = position.title;
        list.appendChild(option);
    });

    updatePositionHint();
}

function updatePositionHint() {
    const title = $("candPositionText").value;
    const existing = findPosition(title);

    $("positionHint").textContent = !title.trim()
        ? "Choose existing or type new."
        : existing
            ? `Existing position: ${existing.title}`
            : `New position: ${title.trim()}`;
}

async function resolvePosition(title) {
    const clean = title.trim().replace(/\s+/g, " ");

    if (!clean || clean.length > 100) {
        throw new Error("Invalid position name.");
    }

    const existing = findPosition(clean);
    if (existing) return existing;

    if (!currentElectionId) {
        throw new Error("Election not loaded.");
    }

    const data = await apiRequest("/positions", {
        method: "POST",
        body: JSON.stringify({
            election_id: currentElectionId,
            title: clean
        })
    });

    return data.position;
}

// ================= ADD CANDIDATE =================

async function addCandidate(event) {
    event.preventDefault();

    const form = $("addCandidateForm");
    const button = form.querySelector('[type="submit"]');

    const name = $("candFullName").value.trim();
    const course = $("candCourse").value.trim();
    const grade_level = $("candGrade").value;
    const party_list = $("candParty").value.trim();
    const positionTitle = $("candPositionText").value.trim();

    if (!name || !course || !grade_level ||
        !party_list || !positionTitle) {
        alert("Please complete all fields.");
        return;
    }

    try {
        button.disabled = true;
        button.textContent = "Saving...";

        const position = await resolvePosition(positionTitle);

        await apiRequest("/candidates", {
            method: "POST",
            body: JSON.stringify({
                name,
                course,
                grade_level,
                party_list,
                position_id: position.position_id
            })
        });

        alert("Candidate added successfully!");
        form.reset();
        await loadDashboardData();

    } catch (error) {
        alert("Error: " + error.message);
    } finally {
        button.disabled = false;
        button.textContent = "+ Add candidate";
    }
}

// ================= CANDIDATE TABLE =================

function renderCandidates() {
    const tbody = $("candidatesTableBody");
    const search = $("candidateSearch").value
        .trim().toLowerCase();

    let html = "";
    let visibleCount = 0;

    currentPositions.forEach(position => {
        const candidates = (position.candidates || [])
            .filter(candidate => {
                const text = [
                    candidate.name,
                    candidate.course,
                    candidate.grade_level,
                    candidate.party_list,
                    position.title
                ].join(" ").toLowerCase();

                return text.includes(search);
            });

        if (!candidates.length) return;

        html += `
            <tr class="group-row">
                <td colspan="5">
                    ${escapeHtml(position.title)}
                    <small>${candidates.length} candidate(s)</small>
                </td>
            </tr>
        `;

        candidates.forEach(candidate => {
            visibleCount++;

            const initials = String(candidate.name)
                .split(/\s+/)
                .map(part => part[0] || "")
                .slice(0, 2)
                .join("")
                .toUpperCase();

            html += `
                <tr>
                    <td>
                        <span class="avatar">
                            ${escapeHtml(initials)}
                        </span>
                        ${escapeHtml(candidate.name)}
                    </td>
                    <td>${escapeHtml(candidate.course || "-")}</td>
                    <td>Year ${escapeHtml(candidate.grade_level || "-")}</td>
                    <td>
                        <span class="party">
                            ${escapeHtml(candidate.party_list || "-")}
                        </span>
                    </td>
                    <td>
                        <div class="actions">
                            <button
                                type="button"
                                class="icon-btn edit"
                                data-edit="${Number(candidate.candidate_id)}"
                                title="Edit candidate"
                                aria-label="Edit candidate">
                                <i data-lucide="pencil"></i>
                            </button>

                            <button
                                type="button"
                                class="icon-btn delete"
                                data-delete="${Number(candidate.candidate_id)}"
                                title="Delete candidate"
                                aria-label="Delete candidate">
                                <i data-lucide="trash-2"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });
    });

    tbody.innerHTML = html || `
        <tr>
            <td colspan="5" style="text-align:center">
                No candidates found.
            </td>
        </tr>
    `;

    $("tableFooter").textContent =
        `Showing ${visibleCount} of ${getAllCandidates().length} candidates`;

    $("candidateCount").textContent = getAllCandidates().length;

    if (window.lucide) lucide.createIcons();
}

// ================= EDIT MODAL =================

function openEditModal(id) {
    const candidate = getAllCandidates().find(
        c => Number(c.candidate_id) === Number(id)
    );

    if (!candidate) {
        alert("Candidate not found.");
        return;
    }

    const position = currentPositions.find(
        p => Number(p.position_id) === Number(candidate.position_id)
    );

    $("editCandidateId").value = candidate.candidate_id;
    $("editName").value = candidate.name || "";
    $("editCourse").value = candidate.course || "";
    $("editGrade").value = candidate.grade_level || "1";
    $("editParty").value = candidate.party_list || "";
    $("editPosition").value = position?.title || "";

    $("editModal").classList.add("open");
    $("editName").focus();
}

function closeEditModal() {
    $("editModal").classList.remove("open");
}

// ================= SAVE EDIT =================

async function saveEdit(event) {
    event.preventDefault();

    const form = $("editCandidateForm");
    const button = form.querySelector('[type="submit"]');

    const id = Number($("editCandidateId").value);
    const name = $("editName").value.trim();
    const course = $("editCourse").value.trim();
    const grade_level = $("editGrade").value;
    const party_list = $("editParty").value.trim();
    const positionTitle = $("editPosition").value.trim();

    if (!name || !course || !grade_level ||
        !party_list || !positionTitle) {
        alert("Please complete all fields.");
        return;
    }

    try {
        button.disabled = true;
        button.textContent = "Saving...";

        const position = await resolvePosition(positionTitle);

        await apiRequest(`/candidates/${id}`, {
            method: "PATCH",
            body: JSON.stringify({
                name,
                course,
                grade_level,
                party_list,
                position_id: position.position_id
            })
        });

        closeEditModal();
        alert("Candidate updated successfully!");
        await loadDashboardData();

    } catch (error) {
        alert("Update failed: " + error.message);
    } finally {
        button.disabled = false;
        button.textContent = "Save changes";
    }
}

// ================= DELETE CANDIDATE =================

async function deleteCandidate(id) {
    if (!confirm("Are you sure you want to delete this candidate?")) {
        return;
    }

    try {
        await apiRequest(`/candidates/${id}`, {
            method: "DELETE"
        });

        alert("Candidate deleted successfully!");
        await loadDashboardData();

    } catch (error) {
        alert("Delete failed: " + error.message);
    }
}

// ================= LIVE RESULTS =================

function renderLiveResults() {
    const container = $("dynamicSidebarPositions");

    container.innerHTML = currentPositions.map(position => `
        <div class="live-position">
            <h3>${escapeHtml(position.title)}</h3>

            ${(position.candidates || []).map(candidate => `
                <div class="vote-item">
                    <div class="line">
                        <span>${escapeHtml(candidate.name)}</span>
                        <span>—</span>
                    </div>
                    <div class="progress">
                        <div style="width:0%"></div>
                    </div>
                </div>
            `).join("") || '<p class="muted">No candidates</p>'}
        </div>
    `).join("");
}

function updateStats() {
    const total = getAllCandidates().length;

    $("statCandidates").textContent =
        String(total).padStart(2, "0");

    $("statPositions").textContent =
        String(currentPositions.length).padStart(2, "0");

    $("No.candidates").textContent = total;
}

// ================= EXPORT CSV =================

function exportCandidates() {
    const rows = [
        ["Full Name", "Course", "Grade Level", "Party List", "Position"]
    ];

    currentPositions.forEach(position => {
        (position.candidates || []).forEach(candidate => {
            rows.push([
                candidate.name,
                candidate.course,
                candidate.grade_level,
                candidate.party_list,
                position.title
            ]);
        });
    });

    const csv = rows.map(row =>
        row.map(value => {
            let text = String(value ?? "");
            if (/^[\s]*[=+\-@\t\r]/.test(text)) {
                text = "'" + text;
            }
            return `"${text.replace(/"/g, '""')}"`;
        }).join(",")
    ).join("\r\n");

    const blob = new Blob(
        ["\uFEFF" + csv],
        { type: "text/csv;charset=utf-8" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "campusvote-candidates.csv";
    link.click();

    URL.revokeObjectURL(url);
}

// ================= EVENTS =================

document.addEventListener("DOMContentLoaded", () => {
    $("addCandidateForm").addEventListener("submit", addCandidate);
    $("editCandidateForm").addEventListener("submit", saveEdit);
    $("candPositionText").addEventListener("input", updatePositionHint);
    $("candidateSearch").addEventListener("input", renderCandidates);
    $("cancelEdit").addEventListener("click", closeEditModal);
    $("exportCandidates").addEventListener("click", exportCandidates);

    $("editModal").addEventListener("click", event => {
        if (event.target === $("editModal")) {
            closeEditModal();
        }
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") closeEditModal();
    });

    $("candidatesTableBody").addEventListener("click", event => {
        const edit = event.target.closest("[data-edit]");
        const remove = event.target.closest("[data-delete]");

        if (edit) {
            openEditModal(Number(edit.dataset.edit));
        }

        if (remove) {
            deleteCandidate(Number(remove.dataset.delete));
        }
    });

    if (window.lucide) lucide.createIcons();

    loadDashboardData();
});
