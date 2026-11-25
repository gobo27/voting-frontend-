"use strict";

// ==========================================
// CAMPUSVOTE - ELECTION ARCHIVE
// ==========================================

const API_BASE = "http://localhost:3000/api";

const $ = id => document.getElementById(id);

const token = () =>
    sessionStorage.getItem("voting_token") ||
    localStorage.getItem("voting_token") ||
    localStorage.getItem("token");

// ==========================================
// DATE FORMAT
// ==========================================

const fmt = value => value.replace("T", " ") + ":00";

// ==========================================
// API REQUEST
// ==========================================

async function request(path, options = {}) {
    const t = token();

    const response = await fetch(API_BASE + path, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(t ? { Authorization: "Bearer " + t } : {}),
            ...(options.headers || {})
        }
    });

    const json = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(
            json.message || `API error ${response.status}`
        );
    }

    return json;
}

// ==========================================
// TABLE HELPERS
// ==========================================

function td(row, value) {
    const cell = document.createElement("td");
    cell.textContent = String(value ?? "");
    row.appendChild(cell);
    return cell;
}

function emptyTable(id, columns, text) {
    const body = $(id);
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

// ==========================================
// STATUS BADGE
// ==========================================

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

// ==========================================
// LOAD ELECTION HISTORY
// ==========================================

async function refresh() {
    try {
        const data = await request("/election_archive");

        const elections = Array.isArray(data.elections)
            ? data.elections
            : [];

        const history = $("history");
        const copy = $("copy");

        history.replaceChildren();
        copy.replaceChildren();

        const empty = document.createElement("option");
        empty.value = "";
        empty.textContent = "Start with no positions";
        copy.appendChild(empty);

        for (const election of elections) {

            // COPY POSITIONS OPTION
            const option = document.createElement("option");

            option.value = election.election_id;
            option.textContent =
                `Copy positions from #${election.election_id} — ${election.title}`;

            copy.appendChild(option);

            // HISTORY ROW
            const row = document.createElement("tr");

            td(
                row,
                String(election.election_id).padStart(2, "0")
            );

            td(row, election.title);

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

            // VIEW DETAILS BUTTON
            const viewBtn = document.createElement("button");

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

            // ARCHIVE BUTTON
            if (
                !election.archived_at &&
                election.status === "completed"
            ) {
                const archiveBtn = document.createElement("button");

                archiveBtn.className = "archive-btn";
                archiveBtn.textContent = "Archive";

                archiveBtn.addEventListener("click", async () => {
                    const confirmed = confirm(
                        `Archive election #${election.election_id}?\n\n` +
                        "Historical records will remain saved."
                    );

                    if (!confirmed) return;

                    archiveBtn.disabled = true;

                    try {
                        const result = await request(
                            `/election_archive/${election.election_id}/archive`,
                            { method: "POST" }
                        );

                        message(result.message);

                        $("detailsCard").hidden = true;

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

        if (!elections.length) {
            emptyTable(
                "history",
                7,
                "No elections found"
            );
        }

        $("historyCount").textContent = elections.length;

        $("historyFooter").textContent =
            `Showing ${elections.length} of ${elections.length} elections`;

    } catch (error) {
        console.error("Election archive error:", error);

        message(error.message, true);

        emptyTable(
            "history",
            7,
            "Unable to load election history"
        );

        $("historyCount").textContent = "0";
        $("historyFooter").textContent =
            "Unable to load elections";
    }
}

// ==========================================
// SUMMARY CARD
// ==========================================

function addSummary(label, value) {
    const box = document.createElement("div");
    box.className = "summary-box";

    const strong = document.createElement("strong");
    strong.textContent = String(value);

    const small = document.createElement("small");
    small.textContent = label;

    box.appendChild(strong);
    box.appendChild(small);

    $("summaryGrid").appendChild(box);
}

// ==========================================
// VIEW ELECTION DETAILS
// ==========================================

async function viewDetails(electionId) {
    const data = await request(
        `/election_archive/${electionId}/details`
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

    const ballotCounts = Array.isArray(data.ballot_status_counts)
        ? data.ballot_status_counts
        : [];

    // ELECTION TITLE
    $("detailsTitle").textContent =
        `${election.title || "Election"} (#${electionId})`;

    $("detailsStatus").textContent =
        election.archived_at
            ? "Archived election · Read-only"
            : "Current / previous election · Read-only details";

    // POSITION LOOKUP
    const positionMap = new Map();

    for (const position of positions) {
        positionMap.set(
            Number(position.position_id),
            position.title
        );
    }

    // VOTE LOOKUP
    const voteMap = new Map();

    for (const vote of votes) {
        const key =
            `${vote.position_id}:${vote.candidate_id}`;

        voteMap.set(
            key,
            Number(vote.total_votes) || 0
        );
    }

    // BALLOT STATUS COUNTS
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

    // SUMMARY
    $("summaryGrid").replaceChildren();

    addSummary("Positions", positions.length);
    addSummary("Candidates", candidates.length);
    addSummary("Ballot templates", templates.length);
    addSummary("Generated ballots", issued + cast + counted + voided);
    addSummary("Issued / not received", issued);
    addSummary("Received / pending", cast);
    addSummary("Counted ballots", counted);
    addSummary("Void ballots", voided);

    // ======================================
    // ELECTION RESULTS
    // ======================================

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

        td(row, positionName);
        td(row, candidate.name);
        td(row, candidate.party_list || "Independent");
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

    // ======================================
    // BALLOT TEMPLATES
    // ======================================

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

    // ======================================
    // CANDIDATES
    // ======================================

    const candidatesBody = $("candidatesBody");
    candidatesBody.replaceChildren();

    for (const candidate of candidates) {
        const row = document.createElement("tr");

        const positionName =
            positionMap.get(Number(candidate.position_id)) ||
            "Unknown position";

        td(row, candidate.name);
        td(row, positionName);
        td(row, candidate.course || "—");
        td(row, candidate.grade_level || "—");
        td(row, candidate.party_list || "Independent");

        candidatesBody.appendChild(row);
    }

    if (!candidates.length) {
        emptyTable(
            "candidatesBody",
            5,
            "No candidates found"
        );
    }

    // SHOW DETAILS
    $("detailsCard").hidden = false;

    $("detailsCard").scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}

// ==========================================
// CLOSE DETAILS
// ==========================================

$("closeDetails").addEventListener("click", () => {
    $("detailsCard").hidden = true;
});

// ==========================================
// REFRESH BUTTON
// ==========================================

$("reload").addEventListener("click", refresh);

// ==========================================
// CREATE NEW ELECTION
// ==========================================

$("createForm").addEventListener("submit", async event => {
    event.preventDefault();

    const button = event.currentTarget.querySelector(
        'button[type="submit"]'
    );

    const start = $("start").value;
    const end = $("end").value;

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

    const confirmed = confirm(
        "Create a new election with fresh candidates and votes?"
    );

    if (!confirmed) return;

    button.disabled = true;

    try {
        const payload = {
            title: $("title").value.trim(),
            start_time: fmt(start),
            end_time: fmt(end)
        };

        if ($("copy").value) {
            payload.copy_positions_from =
                Number($("copy").value);
        }

        const result = await request(
            "/election_archive",
            {
                method: "POST",
                body: JSON.stringify(payload)
            }
        );

        message(
            `Election #${result.election_id} created successfully`
        );

        $("createForm").reset();

        await refresh();

    } catch (error) {
        message(error.message, true);

    } finally {
        button.disabled = false;
    }
});

// ==========================================
// INITIAL LOAD
// ==========================================

refresh();