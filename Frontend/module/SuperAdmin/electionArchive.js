
"use strict";
const API_BASE = "http://localhost:3000/api";
const $ = id => document.getElementById(id);

const token = () =>
    sessionStorage.getItem("voting_token") ||
    localStorage.getItem("voting_token") ||
    localStorage.getItem("token");

const fmt = value => value.replace("T", " ") + ":00";

// ================= API REQUEST =================

async function request(path, options = {}) {
    const t = token();

    const requestUrl = API_BASE + path;

console.log("API Request URL:", requestUrl);

const response = await fetch(requestUrl, {
    ...options,
    headers: {
        "Content-Type": "application/json",
        ...(t ? {
            Authorization: "Bearer " + t
        } : {})
    }
});

console.log("API Response Status:", response.status);

    const json = await response.json()
        .catch(() => ({}));

    if (!response.ok) {
        throw new Error(
            json.message ||
            `API error ${response.status}`
        );
    }

    return json;
}

// ================= TABLE HELPERS =================

function td(row, text) {
    const cell = document.createElement("td");

    cell.textContent = String(text ?? "");

    row.appendChild(cell);

    return cell;
}

function message(text, error = false) {
    $("message").textContent = text;

    $("message").style.color =
        error ? "#a3202c" : "#167347";
}

// ================= LOAD ELECTION HISTORY =================

async function refresh() {
    try {
        const data = await request("/election_archive");

        const history = $("history");
        history.replaceChildren();

        const copy = $("copy");
        copy.replaceChildren();

        const empty = document.createElement("option");
        empty.value = "";
        empty.textContent = "Start with no positions";

        copy.appendChild(empty);

        for (const e of data.elections) {

            // Copy existing positions option
            const opt = document.createElement("option");

            opt.value = e.election_id;

            opt.textContent =
                `Copy positions from #${e.election_id} — ${e.title}`;

            copy.appendChild(opt);

            // Election history row
            const row = document.createElement("tr");

            td(row, e.election_id);
            td(row, e.title);

            const status = e.archived_at
                ? "Archived"
                : e.is_current
                    ? "Current · " + (e.status || "Pending")
                    : (e.status || "Pending");

            td(row, status);
            td(row, e.positions_count);
            td(row, e.candidates_count);
            td(row, e.scanned_ballots_count);

            const action = td(row, "");

            // Only completed elections can be archived
            if (!e.archived_at && e.status === "completed") {

                const btn = document.createElement("button");

                btn.className = "danger";
                btn.textContent = "Archive";

                btn.addEventListener("click", async () => {

                    if (!confirm(
                        `Archive election #${e.election_id}? ` +
                        "Historical records will remain."
                    )) {
                        return;
                    }

                    btn.disabled = true;

                    try {
                        const result = await request(
                            `/election_archive/${e.election_id}/archive`,
                            {
                                method: "POST"
                            }
                        );

                        message(result.message);

                        await refresh();

                    } catch (error) {
                        message(error.message, true);
                        btn.disabled = false;
                    }
                });

                action.appendChild(btn);

            } else {
                action.textContent = e.archived_at
                    ? "Read-only"
                    : "Stop voting first";
            }

            history.appendChild(row);
        }

        if (!data.elections.length) {
            const row = document.createElement("tr");
            const cell = td(row, "No elections found");

            cell.colSpan = 7;
            history.appendChild(row);
        }

    } catch (error) {
        message(error.message, true);

        $("history").textContent =
            "Unable to load election history";
    }
}

// ================= REFRESH BUTTON =================

$("reload").addEventListener("click", refresh);

// ================= CREATE NEW ELECTION =================

$("createForm").addEventListener("submit", async event => {
    event.preventDefault();

    const button = event.currentTarget.querySelector(
        'button[type="submit"]'
    );

    if (!confirm(
        "Create a new election with a fresh candidate " +
        "and vote dataset?"
    )) {
        return;
    }

    button.disabled = true;

    try {
        const payload = {
            title: $("title").value.trim(),
            start_time: fmt($("start").value),
            end_time: fmt($("end").value)
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

// ================= INITIAL LOAD =================

refresh();
