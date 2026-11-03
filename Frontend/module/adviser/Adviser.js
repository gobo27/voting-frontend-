
"use strict";

const API_BASE = "https://voting-backend-cdrj.onrender.com/api";
const $ = id => document.getElementById(id);

const getToken = () =>
    sessionStorage.getItem("voting_token") ||
    localStorage.getItem("voting_token") ||
    localStorage.getItem("token");

const SCHOOL_LEVEL_CONFIG = {
    elementary: {
        label: "Elementary",
        gradeLabel: "Grade level",
        courseLabel: "Section / Class",
        coursePlaceholder: "e.g. Grade 6 - Rizal",
        grades: [
            { value: "3", label: "Grade 3" },
            { value: "4", label: "Grade 4" },
            { value: "5", label: "Grade 5" },
            { value: "6", label: "Grade 6" }
        ],
        parties: ["LIVES", "MOVES"]
    },
    highschool: {
        label: "SSG / High School",
        gradeLabel: "Grade level",
        courseLabel: "Section / Strand",
        coursePlaceholder: "e.g. STEM / Grade 12 - Rizal",
        grades: [
            { value: "7", label: "Grade 7" },
            { value: "8", label: "Grade 8" },
            { value: "9", label: "Grade 9" },
            { value: "10", label: "Grade 10" },
            { value: "11", label: "Grade 11" },
            { value: "12", label: "Grade 12" }
        ],
        parties: ["CHAMPS", "ACTS"]
    },
    college: {
        label: "College",
        gradeLabel: "Year level",
        courseLabel: "Course",
        coursePlaceholder: "e.g. BSCS",
        grades: [
            { value: "1", label: "Year 1" },
            { value: "2", label: "Year 2" },
            { value: "3", label: "Year 3" },
            { value: "4", label: "Year 4" }
        ],
        parties: ["Maroon", "White", "Independent"]
    }
};

const SCHOOL_LEVEL_LABELS = {
    elementary: "Elementary",
    highschool: "SSG / High School",
    college: "College"
};

let currentPositions = [];
let currentElectionId = null;
let currentSchoolLevel = null;
let editingCandidateId = null;
let dashboardRefreshTimer = null;
let dashboardLoading = false;
let candidateSubmitting = false;
let candidateUpdating = false;

// API requests
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

    if (!response.ok) {
        throw new Error(
            data.message ||
            data.error ||
            `API error ${response.status}`
        );
    }

    return data;
}

function notify(message, type = "success") {
    if (typeof window.showToast === "function") {
        window.showToast(message, type);
    } else {
        alert(message);
    }
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
    return String(value ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
}

function normalizeSchoolLevel(value) {
    const level = String(value || "")
        .trim()
        .toLowerCase();

    return SCHOOL_LEVEL_CONFIG[level]
        ? level
        : null;
}

function getSchoolConfig() {
    return SCHOOL_LEVEL_CONFIG[currentSchoolLevel] || null;
}

// School level display, nasa JS na lahat
function updateSchoolLevelDisplay() {
    const display = $("schoolLevelDisplay");

    if (!display) return;

    if (!currentSchoolLevel) {
        display.textContent =
            "School level: No current election loaded";
        return;
    }

    const label =
        SCHOOL_LEVEL_LABELS[currentSchoolLevel] ||
        currentSchoolLevel;

    display.textContent =
        `Current school level: ${label}`;
}

function findPosition(title) {
    return currentPositions.find(
        position =>
            normalizePosition(position.title) ===
            normalizePosition(title)
    );
}

// Dynamic grade options
function populateGradeOptions(selectId, selectedValue = "") {
    const select = $(selectId);
    const config = getSchoolConfig();

    if (!select) return;

    select.replaceChildren();

    const placeholder = document.createElement("option");

    placeholder.value = "";
    placeholder.textContent = config
        ? `Select ${config.gradeLabel.toLowerCase()}`
        : "Select school level first";

    select.appendChild(placeholder);

    if (!config) {
        select.disabled = true;
        return;
    }

    select.disabled = false;

    for (const grade of config.grades) {
        const option = document.createElement("option");

        option.value = grade.value;
        option.textContent = grade.label;

        select.appendChild(option);
    }

    const selected = String(selectedValue || "");

    select.value = config.grades.some(
        grade => grade.value === selected
    ) ? selected : "";
}

// Party suggestions para sa Add form
function populatePartySuggestions(selectedValue = "") {
    const input = $("candParty");
    const list = $("partySuggestions");
    const config = getSchoolConfig();

    if (!input || !list) return;

    list.replaceChildren();

    if (!config) {
        input.value = "";
        input.disabled = true;
        input.placeholder = "No current school level";
        return;
    }

    input.disabled = false;
    input.placeholder = "Select or enter party list";

    for (const party of config.parties) {
        const option = document.createElement("option");

        option.value = party;
        list.appendChild(option);
    }

    const matchingParty = config.parties.find(
        party =>
            party.toLowerCase() ===
            String(selectedValue).trim().toLowerCase()
    );

    input.value = matchingParty || "";
}

// Party dropdown para sa Edit modal
function populateEditPartyOptions(selectedValue = "") {
    const select = $("editParty");
    const config = getSchoolConfig();

    if (!select) return;

    select.replaceChildren();

    const placeholder = document.createElement("option");

    placeholder.value = "";
    placeholder.textContent = "Select party list";

    select.appendChild(placeholder);

    if (!config) {
        select.disabled = true;
        return;
    }

    select.disabled = false;

    for (const party of config.parties) {
        const option = document.createElement("option");

        option.value = party;
        option.textContent = party;

        select.appendChild(option);
    }

    const matchingParty = config.parties.find(
        party =>
            party.toLowerCase() ===
            String(selectedValue).trim().toLowerCase()
    );

    select.value = matchingParty || "";
}

// Palitan ang labels ayon sa school level
function updateSchoolLevelFields() {
    const config = getSchoolConfig();

    populateGradeOptions("candGrade");
    populateGradeOptions("editGrade");

    populatePartySuggestions();
    populateEditPartyOptions();

    const courseInput = $("candCourse");
    const editCourseInput = $("editCourse");

    const courseLabel = document.querySelector(
        'label[for="candCourse"]'
    );

    const editCourseLabel = document.querySelector(
        'label[for="editCourse"]'
    );

    const gradeLabel = document.querySelector(
        'label[for="candGrade"]'
    );

    const editGradeLabel = document.querySelector(
        'label[for="editGrade"]'
    );

    if (config) {
        if (courseLabel) {
            courseLabel.textContent =
                config.courseLabel + " *";
        }

        if (editCourseLabel) {
            editCourseLabel.textContent =
                config.courseLabel;
        }

        if (gradeLabel) {
            gradeLabel.textContent =
                config.gradeLabel + " *";
        }

        if (editGradeLabel) {
            editGradeLabel.textContent =
                config.gradeLabel;
        }

        if (courseInput) {
            courseInput.placeholder =
                config.coursePlaceholder;
            courseInput.disabled = false;
        }

        if (editCourseInput) {
            editCourseInput.disabled = false;
        }

    } else {
        if (courseInput) courseInput.disabled = true;
        if (editCourseInput) editCourseInput.disabled = true;
    }

    const addButton = $("addCandidateForm")?.querySelector(
        'button[type="submit"]'
    );

    if (addButton) {
        addButton.disabled = !config;
    }
}

// Frontend validation
function validateSchoolLevelCandidate(payload) {
    const config = getSchoolConfig();

    if (!config) {
        throw new Error(
            "School level not loaded. Please refresh the page."
        );
    }

    const grade = String(payload.grade_level || "");

    if (!config.grades.some(item => item.value === grade)) {
        throw new Error(
            `Invalid ${config.gradeLabel.toLowerCase()} ` +
            `for ${config.label}.`
        );
    }

    const matchingParty = config.parties.find(
        party =>
            party.toLowerCase() ===
            String(payload.party_list || "")
                .trim()
                .toLowerCase()
    );

    if (!matchingParty) {
        throw new Error(
            `Invalid party list for ${config.label}. ` +
            `Allowed: ${config.parties.join(", ")}`
        );
    }

    payload.party_list = matchingParty;

    return payload;
}

function formatGradeLevel(value) {
    const config = getSchoolConfig();

    if (!config) {
        return String(value || "-");
    }

    const grade = config.grades.find(
        item => item.value === String(value)
    );

    return grade
        ? grade.label
        : String(value || "-");
}

// Kunin ang current positions at school level
async function loadDashboardData() {
    if (dashboardLoading) return;

    dashboardLoading = true;

    const hint = $("positionHint");

    if (hint) {
        hint.textContent = "Loading positions...";
    }

    try {
        const [positionData, candidateData] = await Promise.all([
            apiRequest("/positions/election/current"),
            apiRequest("/candidates")
        ]);

        const positionElectionId = Number(
            positionData.election_id
        );

        const candidateElectionId = Number(
            candidateData.election_id
        );

        if (
            !Number.isSafeInteger(positionElectionId) ||
            positionElectionId <= 0
        ) {
            throw new Error("No current election found.");
        }

        if (
            positionElectionId !== candidateElectionId
        ) {
            throw new Error(
                "Election data changed while loading. Please refresh."
            );
        }

        const schoolLevel = normalizeSchoolLevel(
            candidateData.school_level
        );

        if (!schoolLevel) {
            throw new Error(
                "Current election school level is unavailable. " +
                "Please check the backend update."
            );
        }

        const previousElectionId = currentElectionId;
        const previousSchoolLevel = currentSchoolLevel;

        currentElectionId = positionElectionId;
        currentSchoolLevel = schoolLevel;

        // Automatic update ng school level display
        updateSchoolLevelDisplay();

        currentPositions = Array.isArray(positionData.positions)
            ? positionData.positions
            : [];

        if (
            previousElectionId !== currentElectionId ||
            previousSchoolLevel !== currentSchoolLevel
        ) {
            $("addCandidateForm")?.reset();
            updateSchoolLevelFields();
        }

        populatePositionDropdown();
        renderCandidatesTable();

        const total = currentPositions.reduce(
            (sum, position) =>
                sum + (position.candidates || []).length,
            0
        );

        if ($("statCandidates")) {
            $("statCandidates").textContent =
                total.toLocaleString();
        }

        if ($("statPositions")) {
            $("statPositions").textContent =
                currentPositions.length.toLocaleString();
        }

        if ($("candidateCount")) {
            $("candidateCount").textContent = `(${total})`;
        }

        await loadLiveResults();

    } catch (error) {
        console.error("Dashboard error:", error);

        currentElectionId = null;
        currentSchoolLevel = null;
        currentPositions = [];

        updateSchoolLevelDisplay();
        updateSchoolLevelFields();

        if (hint) {
            hint.textContent = "Unable to load positions.";
        }

        if ($("candidatesTableBody")) {
            $("candidatesTableBody").innerHTML =
                `<tr><td colspan="5" class="p-5 text-red-700">` +
                `${escapeHtml(error.message)}</td></tr>`;
        }

        notify(
            "Position error: " + error.message,
            "error"
        );

    } finally {
        dashboardLoading = false;
    }
}

// Existing at new positions
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
        hint.textContent =
            "Type an existing or new position.";
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
    switch (
        String(partyList ?? "").trim().toLowerCase()
    ) {
        case "maroon":
            return "bg-[#800000] text-white";

        case "white":
            return "bg-white text-gray-900";

        case "independent":
            return "bg-[#64748B] text-white";

        default:
            return "bg-gray-100 text-gray-900";
    }
}

function getPartyBadgeClass(partyList) {
    switch (
        String(partyList ?? "").trim().toLowerCase()
    ) {
        case "maroon":
            return "bg-white/20 text-white border-white/30";

        case "white":
            return "bg-gray-100 text-gray-900 border-gray-300";

        case "independent":
            return "bg-white/20 text-white border-white/30";

        default:
            return "bg-gray-200 text-gray-800 border-gray-300";
    }
}

// Reuse muna ang position bago gumawa
async function getOrCreatePosition(title) {
    const existing = findPosition(title);

    if (existing) return existing;

    if (!currentElectionId) {
        throw new Error("Election not loaded.");
    }

    const data = await apiRequest("/positions", {
        method: "POST",
        body: JSON.stringify({
            election_id: currentElectionId,
            title
        })
    });

    if (!data.position?.position_id) {
        throw new Error(
            "Position API did not return a position ID."
        );
    }

    return data.position;
}

// Add Candidate
async function handleCandidateSubmit(event) {
    event.preventDefault();

    if (candidateSubmitting) return;

    const form = $("addCandidateForm");

    const button = form.querySelector(
        'button[type="submit"]'
    );

    const positionTitle = $("candPositionText")
        .value.trim()
        .replace(/\s+/g, " ");

    const payload = {
        name: $("candFullName").value.trim(),
        course: $("candCourse").value.trim(),
        grade_level: $("candGrade").value,
        party_list: $("candParty").value.trim()
    };

    if (
        !payload.name ||
        !payload.course ||
        !payload.grade_level ||
        !payload.party_list ||
        !positionTitle
    ) {
        notify(
            "Please complete all fields.",
            "error"
        );
        return;
    }

    if (positionTitle.length > 100) {
        notify(
            "Position must be 100 characters or fewer.",
            "error"
        );
        return;
    }

    if (!currentElectionId) {
        notify(
            "Election not loaded. Please refresh.",
            "error"
        );
        return;
    }

    try {
        validateSchoolLevelCandidate(payload);

        candidateSubmitting = true;

        button.disabled = true;
        button.textContent = "Adding Candidate...";

        const position = await getOrCreatePosition(
            positionTitle
        );

        payload.position_id = Number(
            position.position_id
        );

        await apiRequest("/candidates", {
            method: "POST",
            body: JSON.stringify(payload)
        });

        form.reset();

        await loadDashboardData();

        notify("Candidate added successfully!");

    } catch (error) {
        console.error(
            "Add candidate error:",
            error
        );

        notify(
            "Failed to add candidate: " + error.message,
            "error"
        );

    } finally {
        candidateSubmitting = false;

        button.disabled = !getSchoolConfig();

        button.innerHTML =
            '<i data-lucide="user-round-plus"></i> Add candidate';

        if (window.lucide) {
            lucide.createIcons();
        }
    }
}

// Candidate table
function renderCandidatesTable() {
    const tbody = $("candidatesTableBody");

    if (!tbody) return;

    let total = 0;

    if (!currentPositions.length) {
        tbody.innerHTML =
            `<tr><td colspan="5" class="p-5 text-center">` +
            `No positions found. Type a new position when ` +
            `adding a candidate.</td></tr>`;

        if ($("No.candidates")) {
            $("No.candidates").textContent = "0";
        }

        if ($("candidateCount")) {
            $("candidateCount").textContent = "(0)";
        }

        return;
    }

    tbody.innerHTML = currentPositions.map(position => {
        const candidates = position.candidates || [];

        total += candidates.length;

        const heading =
            `<tr class="bg-gray-200 font-bold text-gray-900">` +
            `<td colspan="5" class="p-3 uppercase">` +
            `${escapeHtml(position.title)}</td></tr>`;

        const rows = candidates.map(candidate => {
            const id = Number(candidate.candidate_id);

            const rowClass = getPartyRowClass(
                candidate.party_list
            );

            const badgeClass = getPartyBadgeClass(
                candidate.party_list
            );

            return `
            <tr class="${rowClass}">
                <td class="p-3 font-semibold">
                    ${escapeHtml(candidate.name)}
                </td>
                <td class="p-3">
                    ${escapeHtml(candidate.course || "-")}
                </td>
                <td class="p-3">
                    ${escapeHtml(formatGradeLevel(candidate.grade_level))}
                </td>
                <td class="p-3">
                    <span class="inline-block px-3 py-1 rounded-full text-xs font-semibold border ${badgeClass}">
                        ${escapeHtml(candidate.party_list || "-")}
                    </span>
                </td>
                <td class="p-3">
                    <div class="action-buttons">
                        <button type="button"
                            data-edit="${id}"
                            class="action-btn action-edit">
                            <i data-lucide="pencil"></i> Edit
                        </button>
                        <button type="button"
                            data-delete="${id}"
                            class="action-btn action-delete">
                            <i data-lucide="trash-2"></i> Delete
                        </button>
                    </div>
                </td>
            </tr>`;
        }).join("");

        return heading + (
            rows ||
            `<tr><td colspan="5" class="p-3 text-gray-500">` +
            `No candidates registered.</td></tr>`
        );
    }).join("");

    if ($("No.candidates")) {
        $("No.candidates").textContent =
            total.toLocaleString();
    }

    if ($("candidateCount")) {
        $("candidateCount").textContent = `(${total})`;
    }

    if (window.lucide) {
        lucide.createIcons();
    }
}

// Live Results para sa Adviser
async function loadLiveResults() {
    const status = $("votesStatus");

    try {
        const data = await apiRequest(
            "/dashboard/current/admin-overview"
        );

        const statistics = data.statistics || {};

        const positions = Array.isArray(data.positions)
            ? data.positions
            : [];

        const scanned = Number(
            statistics.scanned_ballots || 0
        );

        if ($("statVotes")) {
            $("statVotes").textContent =
                scanned.toLocaleString();
        }

        if (status) {
            status.textContent =
                "Scanned ballots counted";
        }

        renderLiveResults(
            positions,
            data.election
        );

        const overviewRows = document.querySelectorAll(
            ".overview-row"
        );

        overviewRows.forEach(row => {
            const label = row.querySelector("span")
                ?.textContent.trim().toLowerCase();

            const value = row.querySelector("strong");

            if (!value) return;

            if (label === "votes cast") {
                value.textContent =
                    scanned.toLocaleString();
            }

            if (label === "candidates") {
                value.textContent = Number(
                    statistics.total_candidates || 0
                ).toLocaleString();
            }
        });

    } catch (error) {
        console.error(
            "Live results error:",
            error
        );

        if (status) {
            status.textContent =
                "Unable to load live results";
        }

        const sidebar = $("dynamicSidebarPositions");

        if (sidebar && !sidebar.dataset.loaded) {
            sidebar.textContent =
                "Live results are currently unavailable.";
        }
    }
}

// Candidate vote ranking
function renderLiveResults(positions = [], election = {}) {
    const sidebar = $("dynamicSidebarPositions");

    if (!sidebar) return;

    if (!positions.length) {
        sidebar.innerHTML =
            `<p class="muted">No election results available.</p>`;

        sidebar.dataset.loaded = "true";
        return;
    }

    sidebar.innerHTML = positions.map(position => {
        const candidates = Array.isArray(
            position.candidates
        )
            ? [...position.candidates]
            : [];

        candidates.sort(
            (a, b) =>
                Number(b.total_votes || 0) -
                    Number(a.total_votes || 0) ||
                Number(a.display_order || 0) -
                    Number(b.display_order || 0) ||
                Number(a.candidate_id || 0) -
                    Number(b.candidate_id || 0)
        );

        const totalVotes = candidates.reduce(
            (sum, candidate) =>
                sum + Number(candidate.total_votes || 0),
            0
        );

        const rows = candidates.map(candidate => {
            const votes = Number(
                candidate.total_votes || 0
            );

            const percentage = totalVotes > 0
                ? votes / totalVotes * 100
                : 0;

            const safePercentage = Math.max(
                0,
                Math.min(100, percentage)
            );

            const name = candidate.name ||
                `Candidate #${candidate.candidate_id}`;

            return `
            <div class="mb-3">
                <div class="flex justify-between text-xs mb-1 gap-2">
                    <span>${escapeHtml(name)}</span>
                    <span class="whitespace-nowrap">
                        ${votes.toLocaleString()}
                        (${percentage.toFixed(1)}%)
                    </span>
                </div>
                <div class="bg-gray-300 h-3 rounded-full overflow-hidden">
                    <div class="bg-[#800000] h-3 rounded-full"
                        style="width:${safePercentage}%">
                    </div>
                </div>
            </div>`;
        }).join("");

        return `
        <div class="mb-5">
            <h3 class="font-bold mb-2">
                ${escapeHtml(
                    position.position_title || "Position"
                ).toUpperCase()}
            </h3>
            ${rows || `<p class="text-xs">No candidates</p>`}
        </div>`;
    }).join("");

    sidebar.dataset.loaded = "true";
}

// Edit modal position options
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
        const candidate = (
            position.candidates || []
        ).find(
            item =>
                Number(item.candidate_id) === Number(id)
        );

        if (candidate) {
            selectedCandidate = candidate;
            selectedPosition = position;
            break;
        }
    }

    if (!selectedCandidate || !selectedPosition) {
        notify(
            "Candidate not found.",
            "error"
        );
        return;
    }

    if (!getSchoolConfig()) {
        notify(
            "School level not loaded.",
            "error"
        );
        return;
    }

    editingCandidateId = Number(id);

    $("editCandidateId").value =
        selectedCandidate.candidate_id;

    $("editName").value =
        selectedCandidate.name || "";

    $("editCourse").value =
        selectedCandidate.course || "";

    populateGradeOptions(
        "editGrade",
        selectedCandidate.grade_level
    );

    populateEditPartyOptions(
        selectedCandidate.party_list
    );

    populateEditPositions();

    $("editPosition").value =
        selectedPosition.title || "";

    $("editModal").classList.add("open");
}

function closeEditCandidate() {
    $("editModal").classList.remove("open");

    $("editCandidateForm").reset();

    editingCandidateId = null;
}

// Save edited candidate
async function handleEditCandidate(event) {
    event.preventDefault();

    if (candidateUpdating) return;

    if (!editingCandidateId) {
        notify(
            "No candidate selected.",
            "error"
        );
        return;
    }

    const button = $("editCandidateForm")
        .querySelector('button[type="submit"]');

    const positionTitle = $("editPosition")
        .value.trim()
        .replace(/\s+/g, " ");

    const payload = {
        name: $("editName").value.trim(),
        course: $("editCourse").value.trim(),
        grade_level: $("editGrade").value,
        party_list: $("editParty").value.trim()
    };

    if (
        !payload.name ||
        !payload.course ||
        !payload.grade_level ||
        !payload.party_list ||
        !positionTitle
    ) {
        notify(
            "Please complete all fields.",
            "error"
        );
        return;
    }

    if (positionTitle.length > 100) {
        notify(
            "Position must be 100 characters or fewer.",
            "error"
        );
        return;
    }

    try {
        validateSchoolLevelCandidate(payload);

        candidateUpdating = true;

        button.disabled = true;
        button.textContent = "Saving changes...";

        const position = await getOrCreatePosition(
            positionTitle
        );

        payload.position_id = Number(
            position.position_id
        );

        await apiRequest(
            `/candidates/${editingCandidateId}`,
            {
                method: "PUT",
                body: JSON.stringify(payload)
            }
        );

        closeEditCandidate();

        await loadDashboardData();

        notify(
            "Candidate updated successfully!"
        );

    } catch (error) {
        console.error(
            "Update failed:",
            error
        );

        notify(
            "Update failed: " + error.message,
            "error"
        );

    } finally {
        candidateUpdating = false;

        button.disabled = false;

        button.innerHTML =
            '<i data-lucide="save"></i> Save changes';

        if (window.lucide) {
            lucide.createIcons();
        }
    }
}

// Delete candidate
async function deleteCandidate(id) {
    if (!confirm("Delete this candidate?")) {
        return;
    }

    try {
        await apiRequest(
            `/candidates/${id}`,
            {
                method: "DELETE"
            }
        );

        await loadDashboardData();

        notify(
            "Candidate deleted successfully!"
        );

    } catch (error) {
        console.error(
            "Delete candidate error:",
            error
        );

        notify(
            error.message.includes(
                "No editable current election"
            )
                ? "Cannot delete candidates while voting is in progress."
                : "Error: " + error.message,
            "error"
        );
    }
}

// Event listeners at initialization
document.addEventListener("DOMContentLoaded", () => {
    $("addCandidateForm")?.addEventListener(
        "submit",
        handleCandidateSubmit
    );

    $("candPositionText")?.addEventListener(
        "input",
        updatePositionHint
    );

    $("editCandidateForm")?.addEventListener(
        "submit",
        handleEditCandidate
    );

    $("cancelEdit")?.addEventListener(
        "click",
        closeEditCandidate
    );

    $("candidatesTableBody")?.addEventListener(
        "click",
        event => {
            const editButton = event.target.closest(
                "[data-edit]"
            );

            const deleteButton = event.target.closest(
                "[data-delete]"
            );

            if (editButton) {
                openEditCandidate(
                    Number(editButton.dataset.edit)
                );

            } else if (deleteButton) {
                deleteCandidate(
                    Number(deleteButton.dataset.delete)
                );
            }
        }
    );

    $("editModal")?.addEventListener(
        "click",
        event => {
            if (event.target === $("editModal")) {
                closeEditCandidate();
            }
        }
    );

    document.addEventListener("keydown", event => {
        if (
            event.key === "Escape" &&
            $("editModal")?.classList.contains("open")
        ) {
            closeEditCandidate();
        }
    });

    // Initial school level display
    updateSchoolLevelDisplay();
    updateSchoolLevelFields();

    // Load current election
    loadDashboardData();

    // Refresh live results every 10 seconds
    dashboardRefreshTimer = setInterval(() => {
        if (!document.hidden) {
            loadLiveResults();
        }
    }, 10000);

    if (window.lucide) {
        lucide.createIcons();
    }
});
