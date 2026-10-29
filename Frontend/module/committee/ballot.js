
"use strict";

const API_BASE = "https://voting-backend-cdrj.onrender.com/api";
const $ = id => document.getElementById(id);

let electionId = null;
let ballots = [];
let counting = null;
let printSummary = null;
let busy = false;

function getToken() {
    return sessionStorage.getItem("voting_token") ||
        localStorage.getItem("voting_token") ||
        localStorage.getItem("token");
}

function notify(message, error = false) {
    if (typeof window.showToast === "function") {
        window.showToast(message, error ? "error" : "success");
    } else {
        console[error ? "error" : "log"](message);
        alert(message);
    }
}

async function confirmAction(message, title, confirmText) {
    if (typeof window.showConfirmToast === "function") {
        return Boolean(await window.showConfirmToast(message, {
            title,
            confirmText,
            cancelText: "Cancel"
        }));
    }
    return window.confirm(message);
}

async function api(path, method = "GET", payload) {
    const token = getToken();
    if (!token) throw new Error("Please log in as Committee.");

    const headers = { Authorization: `Bearer ${token}` };
    if (payload !== undefined) headers["Content-Type"] = "application/json";

    const response = await fetch(API_BASE + path, {
        method,
        headers,
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.message || data.error || `Request failed (${response.status})`);
    }
    return data;
}

function getSelected() {
    return [...document.querySelectorAll(".void-ballot-check:checked")]
        .map(input => input.value);
}

function getTotals() {
    return counting?.ballots || null;
}

function getNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
}

function canVoid() {
    return counting?.scanning_open === true &&
        counting?.voting_open === false;
}

function updateButtons() {
    const selected = getSelected();
    const reason = $("voidReason").value.trim();
    const verified = $("voidVerified").checked;
    const totals = getTotals();

    $("voidSelectedCount").textContent = `${selected.length} selected`;

    $("voidSubmit").disabled = !(
        !busy && canVoid() &&
        selected.length >= 1 && selected.length <= 100 &&
        reason.length >= 10 && reason.length <= 500 && verified
    );

    $("finishScanCommittee").disabled = !(
        !busy && canVoid() && totals &&
        getNumber(totals.ISSUED) === 0 &&
        getNumber(totals.CAST) === 0
    );

    $("voidSelectAll").disabled = busy || !canVoid() || ballots.length === 0;
}

function renderPrintSummary() {
    if (!printSummary) {
        $("monitorOriginal").textContent = "—";
        $("monitorReprints").textContent = "—";
        $("monitorTotal").textContent = "—";
        $("monitorPhysical").textContent = "— / —";
        $("monitorNote").textContent = "Confirmed print totals are unavailable.";
        return;
    }

    const original = getNumber(printSummary.original);
    const reprints = getNumber(printSummary.reprints);
    const overall = getNumber(printSummary.overall);
    const unique = getNumber(printSummary.registered_unique);

    $("monitorOriginal").textContent = original.toLocaleString();
    $("monitorReprints").textContent = reprints.toLocaleString();
    $("monitorTotal").textContent = overall.toLocaleString();
    $("monitorPhysical").textContent =
        `${overall.toLocaleString()} / ${unique.toLocaleString()} unique`;

    $("monitorNote").textContent =
        "Confirmed individual A5 ballot copies. " +
        "Original + Reprints = Overall. " +
        "Print jobs made before tracking was enabled are excluded.";
}

async function refreshPrintSummary() {
    if (!electionId) return;

    try {
        const result = await api(
            `/ballots/qr/print-summary/election/${electionId}`
        );

        if (!result || typeof result !== "object") {
            throw new Error("Invalid print summary response.");
        }

        printSummary = result;
        renderPrintSummary();
    } catch (error) {
        console.warn("Print summary unavailable:", error);
        printSummary = null;
        renderPrintSummary();
    }
}

function renderStatus() {
    const totals = getTotals();

    const fields = {
        voidIssued: "ISSUED",
        voidCast: "CAST",
        voidCounted: "COUNTED",
        voidVoided: "VOID"
    };

    for (const [elementId, status] of Object.entries(fields)) {
        $(elementId).textContent = totals ? getNumber(totals[status]) : "—";
    }

    renderPrintSummary();

    if (!counting) {
        $("voidElectionState").textContent = "Election status unavailable.";
    } else if (counting.voting_open) {
        $("voidElectionState").textContent =
            "Voting is still open. Close voting before voiding.";
    } else if (counting.scanning_open) {
        $("voidElectionState").textContent =
            "Voting closed; scanning open. Physically verify each unused ballot before VOID.";
    } else {
        $("voidElectionState").textContent =
            "Scanning is closed. VOID is unavailable.";
    }

    updateButtons();
}

function renderBallots() {
    const container = $("voidBallotList");
    container.replaceChildren();

    if (!ballots.length) {
        container.textContent = "No ISSUED ballot IDs to review.";
        updateButtons();
        return;
    }

    ballots.forEach(ballot => {
        const label = document.createElement("label");
        label.className = "void-ballot-item";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "void-ballot-check";
        checkbox.value = String(ballot.ballot_id);
        checkbox.disabled = !canVoid() || busy;

        checkbox.addEventListener("change", () => {
            if (checkbox.checked && getSelected().length > 100) {
                checkbox.checked = false;
                notify("Maximum of 100 ballots per request.", true);
            }
            updateButtons();
        });

        const text = document.createElement("span");
        text.textContent =
            `Batch ${ballot.batch_id ?? "—"} · ${ballot.ballot_id}`;

        label.append(checkbox, text);
        container.appendChild(label);
    });

    updateButtons();
}

async function refresh(showError = true) {
    try {
        const current = await api("/election/current/status");
        electionId = Number(current.election?.election_id);

        if (!Number.isSafeInteger(electionId) || electionId < 1) {
            throw new Error("No current election found.");
        }

        const [status, unused] = await Promise.all([
            api(`/election/${electionId}/counting-status`),
            api(`/election/${electionId}/unused-ballots`)
        ]);

        counting = status;
        ballots = Array.isArray(unused.ballots) ? unused.ballots : [];

        $("voidVerified").checked = false;
        $("voidSelectAll").checked = false;

        renderStatus();
        renderBallots();

        await refreshPrintSummary();
    } catch (error) {
        console.error("Committee refresh:", error);

        counting = null;
        ballots = [];
        printSummary = null;

        renderStatus();
        renderBallots();

        $("voidBallotList").textContent = "Unable to load unused ballots.";
        $("voidElectionState").textContent = error.message;

        if (showError) notify(error.message, true);
    }
}

async function voidSelected() {
    if (busy || !canVoid()) return;

    const ids = getSelected();
    const reason = $("voidReason").value.trim();

    if (
        ids.length < 1 || ids.length > 100 ||
        reason.length < 10 || reason.length > 500 ||
        !$("voidVerified").checked
    ) {
        return notify(
            "Select 1–100 ballots, enter a reason of 10–500 characters, " +
            "and confirm physical verification.",
            true
        );
    }

    const confirmed = await confirmAction(
        `VOID ${ids.length} physically verified unused ballot(s)? ` +
        "This action cannot normally be undone.",
        "Confirm Ballot VOID",
        "Void Ballots"
    );

    if (!confirmed) return;

    busy = true;
    updateButtons();

    try {
        const result = await api(
            `/election/${electionId}/void-unused-ballots`,
            "POST",
            {
                ballot_ids: ids,
                reason,
                physically_verified: true
            }
        );

        notify(result.message || "Unused ballots successfully voided.");

        $("voidReason").value = "";
        $("voidVerified").checked = false;

        await refresh();
    } catch (error) {
        console.error("VOID error:", error);
        notify(error.message, true);
    } finally {
        busy = false;
        updateButtons();
    }
}

async function finishScanning() {
    if (busy || !electionId || $("finishScanCommittee").disabled) return;

    const confirmed = await confirmAction(
        "Finish scanning and close ballot counting? " +
        "All ballots must already be counted or reconciled.",
        "Finish Scanning",
        "Finish Scanning"
    );

    if (!confirmed) return;

    busy = true;
    updateButtons();

    try {
        const result = await api(
            `/election/${electionId}/finish-scanning`,
            "POST"
        );

        notify(result.message || "Scanning successfully finished.");
        await refresh();
    } catch (error) {
        console.error("Finish scanning error:", error);
        notify(error.message, true);
    } finally {
        busy = false;
        updateButtons();
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const panel = $("voidDetails");

    if (!panel || !$("openVoidPanel")) {
        console.error("VOID HTML elements are missing.");
        return;
    }

    $("openVoidPanel").addEventListener("click", async () => {
        panel.hidden = !panel.hidden;
        if (!panel.hidden) await refresh();
    });

    $("voidRefresh").addEventListener("click", () => refresh());

    $("voidSelectAll").addEventListener("change", event => {
        const checkboxes = [
            ...document.querySelectorAll(".void-ballot-check")
        ];

        checkboxes.forEach((checkbox, index) => {
            checkbox.checked = event.target.checked && canVoid() && index < 100;
        });

        updateButtons();
    });

    $("voidReason").addEventListener("input", updateButtons);
    $("voidVerified").addEventListener("change", updateButtons);
    $("voidSubmit").addEventListener("click", voidSelected);
    $("finishScanCommittee").addEventListener("click", finishScanning);

    refresh(false);
});
