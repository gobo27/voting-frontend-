
"use strict";

const API_BASE = "https://voting-backend-cdrj.onrender.com/api";

const $ = id => document.getElementById(id);

const token = () =>
    sessionStorage.getItem("voting_token") ||
    localStorage.getItem("voting_token") ||
    localStorage.getItem("token");

const SCHOOL_LEVELS = {
    elementary: "Elementary",
    highschool: "SSG / High School",
    college: "College"
};

const SCHOOL_FIELDS = {
    elementary: {
        course: "Section / Class",
        grade: "Grade level",
        prefix: "Grade"
    },
    highschool: {
        course: "Section / Strand",
        grade: "Grade level",
        prefix: "Grade"
    },
    college: {
        course: "Course",
        grade: "Year level",
        prefix: "Year"
    }
};

function schoolFields(level) {
    return SCHOOL_FIELDS[
        String(level || "").trim().toLowerCase()
    ] || {
        course: "Course / Section",
        grade: "Grade / Year",
        prefix: ""
    };
}

// Grade 7 o Year 2 depende sa school level
function formatCandidateGrade(value, level) {
    const raw = String(value ?? "").trim();

    if (!raw) return "—";

    const prefix = schoolFields(level).prefix;

    return prefix && /^\d+$/.test(raw)
        ? `${prefix} ${raw}`
        : raw;
}

let electionHistory = [];
let refreshingHistory = false;
let creatingElection = false;

// Format ng MySQL DATETIME
const fmt = value => {
    const text = String(value || "").trim();

    if (!text) return "";

    return text.replace("T", " ") +
        (text.length === 16 ? ":00" : "");
};

function schoolLevelLabel(value) {
    const level = String(value || "")
        .trim()
        .toLowerCase();

    return SCHOOL_LEVELS[level] || "Unknown";
}

function getSelectedSchoolLevel() {
    return $("schoolLevel")?.value || "college";
}

function isValidSchoolLevel(level) {
    return Object.prototype.hasOwnProperty.call(
        SCHOOL_LEVELS,
        level
    );
}

// Authenticated API requests
async function request(path, options = {}) {
    const t = token();

    const response = await fetch(API_BASE + path, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(t ? { Authorization: "Bearer " + t } : {}),
            ...(options.headers || {})
        },
        cache: "no-store"
    });

    const json = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(
            json.message ||
            json.error ||
            `API error ${response.status}`
        );
    }

    return json;
}

// Table helpers
function td(row, value) {
    const cell = document.createElement("td");

    cell.textContent = String(value ?? "");
    row.appendChild(cell);

    return cell;
}

function emptyTable(id, columns, text) {
    const body = $(id);

    if (!body) return;

    body.replaceChildren();

    const row = document.createElement("tr");
    const cell = td(row, text);

    cell.colSpan = columns;
    cell.className = "empty-row";

    body.appendChild(row);
}

function message(text, error = false) {
    const msg = $("message");

    if (msg) {
        msg.textContent = text;
        msg.style.color = error ? "#a3202c" : "#167347";
    }

    if (typeof window.showToast === "function") {
        window.showToast(
            text,
            error ? "error" : "success"
        );
    }
}

// Status badge ng election
function createStatusBadge(election) {
    const badge = document.createElement("span");

    badge.className = "status-badge";

    if (election.archived_at) {
        badge.classList.add("archived");
        badge.textContent = "Archived";

    } else if (Number(election.is_current) === 1) {
        const status = election.status || "Pending";

        badge.classList.add(
            status.toLowerCase() === "pending"
                ? "pending"
                : "current"
        );

        badge.textContent = "Current · " + status;

    } else {
        const status = election.status || "Pending";

        badge.classList.add(
            status.toLowerCase() === "completed"
                ? "completed"
                : "pending"
        );

        badge.textContent = status;
    }

    return badge;
}

// Same school level lang ang puwedeng pagkuhanan ng positions
function updateCopyPositions() {
    const copy = $("copy");

    if (!copy) return;

    const selectedLevel = getSelectedSchoolLevel();
    const previousValue = copy.value;

    copy.replaceChildren();

    const empty = document.createElement("option");

    empty.value = "";
    empty.textContent = "Start with no positions";

    copy.appendChild(empty);

    for (const election of electionHistory) {
        const sourceLevel = String(
            election.school_level || "college"
        ).toLowerCase();

        // Skip kapag ibang level o walang positions
        if (
            sourceLevel !== selectedLevel ||
            Number(election.positions_count || 0) <= 0
        ) {
            continue;
        }

        const option = document.createElement("option");

        option.value = String(election.election_id);

        option.textContent =
            `Copy positions from #${election.election_id}` +
            ` — ${election.title}`;

        copy.appendChild(option);
    }

    const previousStillExists = Array.from(
        copy.options
    ).some(option => option.value === previousValue);

    copy.value = previousStillExists
        ? previousValue
        : "";
}

 // I-lock ang Create button kapag may current election
function updateCreateAvailability() {
    const button = $("createForm")?.querySelector(
        'button[type="submit"]'
    );

    if (!button) return;

    const currentElection = electionHistory.find(
        election =>
            Number(election.is_current) === 1 &&
            !election.archived_at
    );

    button.disabled = creatingElection ||
        refreshingHistory ||
        Boolean(currentElection);

    button.title = currentElection
        ? `Archive election #${currentElection.election_id} first.`
        : "";

    const msg = $("message");

    if (
        currentElection &&
        msg &&
        !msg.textContent.trim()
    ) {
        msg.textContent =
            `Election #${currentElection.election_id} is current. ` +
            "Finish scanning and archive it before creating another election.";

        msg.style.color = "#667085";
    }
}

// Election history table
function renderHistory() {
    const history = $("history");

    if (!history) return;

    history.replaceChildren();

    for (const election of electionHistory) {
        const row = document.createElement("tr");

        td(
            row,
            String(election.election_id).padStart(2, "0")
        );

        td(row, election.title);

        td(
            row,
            schoolLevelLabel(election.school_level)
        );

        const statusCell = td(row, "");

        statusCell.appendChild(
            createStatusBadge(election)
        );

        td(row, election.positions_count ?? 0);
        td(row, election.candidates_count ?? 0);
        td(row, election.scanned_ballots_count ?? 0);

        const action = td(row, "");

        const buttons = document.createElement("div");

        buttons.className = "action-buttons";

        // Read-only election details
        const viewBtn = document.createElement("button");

        viewBtn.type = "button";
        viewBtn.className = "view-btn";
        viewBtn.textContent = "View Details";

        viewBtn.addEventListener("click", async () => {
            viewBtn.disabled = true;

            try {
                await viewDetails(election.election_id);
            } catch (error) {
                message(error.message, true);
            } finally {
                viewBtn.disabled = false;
            }
        });

        buttons.appendChild(viewBtn);

        // Archive remains protected by the backend
        if (
            !election.archived_at &&
            election.status === "completed"
        ) {
            const archiveBtn = document.createElement("button");

            archiveBtn.type = "button";
            archiveBtn.className = "archive-btn";
            archiveBtn.textContent = "Archive";

            archiveBtn.addEventListener("click", async () => {
                const confirmed = window.confirm(
                    `Archive election #${election.election_id}?\n\n` +
                    "Historical records will remain saved."
                );

                if (!confirmed) return;

                archiveBtn.disabled = true;

                try {
                    const result = await request(
                        `/election_archive/${encodeURIComponent(
                            election.election_id
                        )}/archive`,
                        {
                            method: "POST"
                        }
                    );

                    message(result.message);

                    if ($("detailsCard")) {
                        $("detailsCard").hidden = true;
                    }

                    await refresh();

                } catch (error) {
                    message(error.message, true);
                    archiveBtn.disabled = false;
                }
            });

            buttons.appendChild(archiveBtn);
        }

        action.appendChild(buttons);
        history.appendChild(row);
    }

    if (!electionHistory.length) {
        emptyTable(
            "history",
            8,
            "No elections found"
        );
    }

    if ($("historyCount")) {
        $("historyCount").textContent =
            electionHistory.length;
    }

    if ($("historyFooter")) {
        $("historyFooter").textContent =
            `Showing ${electionHistory.length} of ` +
            `${electionHistory.length} elections`;
    }
}

// Reload history at copy-position options
async function refresh() {
    if (refreshingHistory) return;

    refreshingHistory = true;

    updateCreateAvailability();

    try {
        const data = await request("/election_archive");

        electionHistory = Array.isArray(data.elections)
            ? data.elections
            : [];

        renderHistory();
        updateCopyPositions();

    } catch (error) {
        console.error("Election archive error:", error);

        electionHistory = [];

        message(error.message, true);

        emptyTable(
            "history",
            8,
            "Unable to load election history"
        );

        if ($("historyCount")) {
            $("historyCount").textContent = "0";
        }

        if ($("historyFooter")) {
            $("historyFooter").textContent =
                "Unable to load elections";
        }

    } finally {
        refreshingHistory = false;
        updateCreateAvailability();
    }
}

// Summary card
function addSummary(label, value) {
    const box = document.createElement("div");

    box.className = "summary-box";

    const strong = document.createElement("strong");
    strong.textContent = String(value ?? "");

    const small = document.createElement("small");
    small.textContent = label;

    box.appendChild(strong);
    box.appendChild(small);

    $("summaryGrid").appendChild(box);
}

// Read-only election details
async function viewDetails(electionId) {
    const data = await request(
        `/election_archive/${encodeURIComponent(
            electionId
        )}/details`
    );

    const election = data.election || {};

    const positions = Array.isArray(data.positions)
        ? data.positions
        : [];

    const candidates = Array.isArray(data.candidates)
        ? data.candidates
        : [];

    const templates = Array.isArray(data.templates)
        ? data.templates
        : [];

    const votes = Array.isArray(data.recorded_votes)
        ? data.recorded_votes
        : [];

    const ballotCounts = Array.isArray(
        data.ballot_status_counts
    )
        ? data.ballot_status_counts
        : [];

    // School level ng selected election
    const level = String(
        election.school_level || ""
    ).trim().toLowerCase();

    const fields = schoolFields(level);

    // Election title at school level
    $("detailsTitle").textContent =
        `${election.title || "Election"} (#${electionId})`;

    const levelText = schoolLevelLabel(level);

    $("detailsStatus").textContent =
        `${levelText} · ` +
        (
            election.archived_at
                ? "Archived election · Read-only"
                : "Current / previous election · Read-only details"
        );

    // Dynamic labels sa Candidates table
    const candidatesTable = $("candidatesBody")?.closest("table");

    if (candidatesTable) {
        const headers = candidatesTable.querySelectorAll(
            "thead th"
        );

        if (headers.length >= 5) {
            headers[2].textContent = fields.course;
            headers[3].textContent = fields.grade;
        }
    }

    // Position lookup
    const positionMap = new Map();

    for (const position of positions) {
        positionMap.set(
            Number(position.position_id),
            position.title
        );
    }

    // Vote lookup
    const voteMap = new Map();

    for (const vote of votes) {
        const key =
            `${vote.position_id}:${vote.candidate_id}`;

        voteMap.set(
            key,
            Number(vote.total_votes) || 0
        );
    }

    // Ballot status counts
    const statusMap = new Map();

    for (const item of ballotCounts) {
        statusMap.set(
            String(item.status),
            Number(item.total) || 0
        );
    }

    const issued = statusMap.get("ISSUED") || 0;
    const cast = statusMap.get("CAST") || 0;
    const counted = statusMap.get("COUNTED") || 0;
    const voided = statusMap.get("VOID") || 0;

    // Summary
    $("summaryGrid").replaceChildren();

    addSummary("Positions", positions.length);
    addSummary("Candidates", candidates.length);
    addSummary("Ballot templates", templates.length);
    addSummary(
        "Generated ballots",
        issued + cast + counted + voided
    );
    addSummary("Issued / not received", issued);
    addSummary("Received / pending", cast);
    addSummary("Counted ballots", counted);
    addSummary("Void ballots", voided);

    // Election results
    const resultsBody = $("resultsBody");

    resultsBody.replaceChildren();

    for (const candidate of candidates) {
        const row = document.createElement("tr");

        const positionName =
            positionMap.get(Number(candidate.position_id)) ||
            "Unknown position";

        const key =
            `${candidate.position_id}:${candidate.candidate_id}`;

        const totalVotes = voteMap.get(key) || 0;

        const partyList = String(
            candidate.party_list ?? ""
        ).trim() || "—";

        td(row, positionName);
        td(row, candidate.name);
        td(row, partyList);
        td(row, totalVotes);

        resultsBody.appendChild(row);
    }

    if (!candidates.length) {
        emptyTable(
            "resultsBody",
            4,
            "No candidate results available"
        );
    }

    // Ballot templates
    const templatesBody = $("templatesBody");

    templatesBody.replaceChildren();

    for (const template of templates) {
        const row = document.createElement("tr");

        td(row, template.template_id);
        td(row, template.template_name);
        td(row, template.paper_size);

        templatesBody.appendChild(row);
    }

    if (!templates.length) {
        emptyTable(
            "templatesBody",
            3,
            "No ballot templates saved"
        );
    }

    // Candidate records
    const candidatesBody = $("candidatesBody");

    candidatesBody.replaceChildren();

    for (const candidate of candidates) {
        const row = document.createElement("tr");

        const positionName =
            positionMap.get(Number(candidate.position_id)) ||
            "Unknown position";

        const partyList = String(
            candidate.party_list ?? ""
        ).trim() || "—";

        td(row, candidate.name);
        td(row, positionName);
        td(row, candidate.course || "—");

        td(
            row,
            formatCandidateGrade(
                candidate.grade_level,
                level
            )
        );

        td(row, partyList);

        candidatesBody.appendChild(row);
    }

    if (!candidates.length) {
        emptyTable(
            "candidatesBody",
            5,
            "No candidates found"
        );
    }

    // Display details panel
    $("detailsCard").hidden = false;

    $("detailsCard").scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}

// Close election details
$("closeDetails").addEventListener("click", () => {
    $("detailsCard").hidden = true;
});

// Refresh button
$("reload").addEventListener("click", refresh);

// School level change: refresh matching positions
$("schoolLevel").addEventListener("change", () => {
    updateCopyPositions();
});

// Reset form: College ang default
$("createForm").addEventListener("reset", () => {
    // Hintayin ang native form reset bago mag-filter
    queueMicrotask(() => {
        updateCopyPositions();
    });
});

// Create new election
$("createForm").addEventListener("submit", async event => {
    event.preventDefault();

    if (creatingElection || refreshingHistory) return;

    const button = event.currentTarget.querySelector(
        'button[type="submit"]'
    );

    const title = $("title").value.trim();
    const start = $("start").value;
    const end = $("end").value;
    const schoolLevel = getSelectedSchoolLevel();

    if (!title || title.length > 150) {
        message(
            "Enter an election title (max 150 characters).",
            true
        );
        return;
    }

    if (!isValidSchoolLevel(schoolLevel)) {
        message(
            "Please select a valid school level.",
            true
        );
        return;
    }

    if (!start || !end) {
        message(
            "Please select starting and closing dates.",
            true
        );
        return;
    }

    if (new Date(end) <= new Date(start)) {
        message(
            "Closing date must be after starting date.",
            true
        );
        return;
    }

    const currentElection = electionHistory.find(
        election =>
            Number(election.is_current) === 1 &&
            !election.archived_at
    );

    if (currentElection) {
        message(
            `Archive election #${currentElection.election_id} ` +
            "before creating a new election.",
            true
        );
        return;
    }

    const copyValue = $("copy").value;

    if (copyValue) {
        const source = electionHistory.find(
            election =>
                String(election.election_id) === copyValue
        );

        if (!source) {
            message(
                "Selected source election was not found.",
                true
            );
            return;
        }

        const sourceLevel = String(
            source.school_level || "college"
        ).toLowerCase();

        if (sourceLevel !== schoolLevel) {
            message(
                "You can only copy positions from an election " +
                "with the same school level.",
                true
            );
            return;
        }

        if (Number(source.positions_count || 0) <= 0) {
            message(
                "The selected election has no positions to copy.",
                true
            );
            return;
        }
    }

    const confirmed = window.confirm(
        `Create a new ${schoolLevelLabel(schoolLevel)} election?\n\n` +
        "New candidates and votes will start fresh." +
        (
            copyValue
                ? "\nPositions will be copied from the selected election."
                : "\nNo positions will be copied."
        )
    );

    if (!confirmed) return;

    creatingElection = true;
    button.disabled = true;

    try {
        const payload = {
            title,
            school_level: schoolLevel,
            start_time: fmt(start),
            end_time: fmt(end)
        };

        if (copyValue) {
            payload.copy_positions_from =
                Number(copyValue);
        }

        const result = await request(
            "/election_archive",
            {
                method: "POST",
                body: JSON.stringify(payload)
            }
        );

        message(
            `${schoolLevelLabel(schoolLevel)} election ` +
            `#${result.election_id} created successfully`
        );

        $("createForm").reset();

        if ($("detailsCard")) {
            $("detailsCard").hidden = true;
        }

        await refresh();

    } catch (error) {
        message(error.message, true);

    } finally {
        creatingElection = false;
        updateCreateAvailability();
    }
});

// Initial load
refresh();
