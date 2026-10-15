
"use strict";

const API_BASE = "http://localhost:3000/api";
const urlParams = new URLSearchParams(window.location.search);

let activeElectionId = urlParams.get("election_id") || null;

async function resolveCurrentElection() {
    if (activeElectionId) {
        return activeElectionId;
    }

    const data = await apiFetch("/positions/election/current");

    const id = data.election_id;

    if (!id) {
        throw new Error(
            "No current election found. Please create or select an election first."
        );
    }

    activeElectionId = String(id);
    return activeElectionId;
}


const REFRESH_INTERVAL = 5000;
const MASK_CHAR = "••••••••";

let electionData = null;
let positionsData = [];
let refreshing = false;

const $ = id => document.getElementById(id);

function getToken() {
    return sessionStorage.getItem("voting_token") ||
        localStorage.getItem("voting_token") ||
        localStorage.getItem("token");
}

async function apiFetch(path, options = {}) {
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
        throw new Error(data.message || `API error ${response.status}`);
    }

    return data;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function electionStatus() {
    const value = String(electionData?.status || "UNKNOWN").toUpperCase();

    if (["CLOSED", "COMPLETED", "FINISHED"].includes(value)) {
        return "CLOSED";
    }

    if (value === "PAUSED") return "PAUSED";
    if (value === "ACTIVE" || value === "OPEN") return "OPEN";

    return value;
}

function namesMasked() {
    return Boolean(Number(electionData?.mask_names ?? 1));
}

function namesRevealed() {
    return electionStatus() === "CLOSED" && !namesMasked();
}

async function refreshDashboard() {
    if (refreshing) return;
    refreshing = true;

    try {
        const result = await apiFetch(
            `/dashboard/${encodeURIComponent(activeElectionId)}/overview`
        );

        if (!result.election || !Array.isArray(result.positions)) {
            throw new Error("Invalid dashboard API response.");
        }

        electionData = result.election;
        positionsData = result.positions;

        refreshStatusUI();
        renderLiveSidebar();

    } catch (error) {
        console.error("Election management refresh error:", error);

        const sidebar = $("dynamicSidebarPositions");

        if (sidebar && !positionsData.length) {
            sidebar.textContent = "Unable to load results: " + error.message;
        }
    } finally {
        refreshing = false;
    }
}

function refreshStatusUI() {
    const status = electionStatus();
    const masked = namesMasked();

    if ($("statusText")) {
        $("statusText").textContent = status;
        $("statusText").className =
            status === "OPEN"
                ? "text-emerald-600 font-bold"
                : "text-red-600 font-bold";
    }

    if ($("maskedText")) {
        $("maskedText").textContent =
            masked ? "Masked" : "Unmasked";
    }

    if ($("maskBtnTitle")) {
        $("maskBtnTitle").textContent =
            masked ? "Unmask Names" : "Mask Names";
    }

    if ($("maskBtnDesc")) {
        $("maskBtnDesc").textContent =
            masked
                ? "Show candidate real names"
                : "Hide candidate real names";
    }

    if ($("maskIconContainer")) {
        $("maskIconContainer").innerHTML = masked
            ? '<i data-lucide="eye" class="w-6 h-6 text-white"></i>'
            : '<i data-lucide="eye-off" class="w-6 h-6 text-white"></i>';
    }

    if ($("stopVotingBtn")) {
        $("stopVotingBtn").disabled = status === "CLOSED";
        $("stopVotingBtn").classList.toggle(
            "opacity-50",
            status === "CLOSED"
        );
    }

    if (window.lucide) lucide.createIcons();
}

function renderLiveSidebar() {
    const sidebar = $("dynamicSidebarPositions");
    if (!sidebar) return;

    let candidateCount = 0;

    sidebar.innerHTML = positionsData.map(position => {
        const candidates = position.candidates || [];

        candidateCount += candidates.length;

        const totalVotes = candidates.reduce(
            (sum, c) => sum + Math.max(0, Number(c.total_votes) || 0),
            0
        );

        const rows = candidates.map(candidate => {
            const votes = Math.max(
                0,
                Number(candidate.total_votes) || 0
            );

            const percent = totalVotes
                ? (votes / totalVotes) * 100
                : 0;

            const name = namesRevealed()
                ? candidate.name
                : MASK_CHAR;

            return `
                <div class="candidate-row flex flex-col w-full mb-3">
                    <div class="flex justify-between items-center gap-2 text-xs font-serif font-semibold text-gray-800 mb-1">
                        <span class="truncate">
                            ${escapeHtml(name)}
                        </span>
                        <span class="shrink-0">
                            ${percent.toFixed(1)}%
                            (${votes.toLocaleString()} votes)
                        </span>
                    </div>

                    <div class="w-full bg-gray-400/60 h-3 rounded-full overflow-hidden">
                        <div
                            class="bg-[#8f0000] h-full rounded-full transition-all duration-500"
                            style="width:${percent.toFixed(2)}%">
                        </div>
                    </div>
                </div>
            `;
        }).join("");

        return `
            <section class="position-section mb-4">
                <h4 class="text-lg font-serif font-bold text-gray-900 mb-2">
                    ${escapeHtml(position.position_title)}
                </h4>

                <p class="text-xs text-gray-500 mb-2">
                    Select up to ${Number(position.max_selection) || 1}
                </p>

                <div class="pl-2">
                    ${rows || '<p class="text-sm">No candidates yet.</p>'}
                </div>
            </section>
        `;
    }).join("");

    if (!positionsData.length) {
        sidebar.textContent = "No positions or candidates found.";
    }

    if ($("No.candidates")) {
        $("No.candidates").textContent =
            candidateCount.toLocaleString();
    }

    // These require a separate voter statistics API.
    if ($("No.voters")) {
        $("No.voters").textContent = "Not available";
    }

    if ($("Voted")) {
        $("Voted").textContent = "Not available";
    }
}

// Existing election-control actions.
// Their routes must match electionControl.router.js.


async function handleStartElectionClick() {
    try {
        await resolveCurrentElection();
        await refreshDashboard();

        if (!electionData) {
            throw new Error(
                "Election details could not be loaded."
            );
        }

        if (electionStatus() === "CLOSED") {
            alert(
                "This election has already been permanently stopped. " +
                "Please create a new election instead."
            );
            return;
        }

        if (electionStatus() === "OPEN") {
            alert("This election is already active.");
            return;
        }

        if (!confirm("Start this election?")) return;

        await apiFetch(
            `/election/${encodeURIComponent(activeElectionId)}/start`,
            { method: "POST" }
        );
        await refreshDashboard();
        alert("Election started successfully!");
    } catch (error) {
        console.error("Start election error:", error);
        alert("Start failed: " + error.message);
    }
}
async function handleStopVoting() {
    if (electionStatus() === "CLOSED") return;

    if (!confirm("Permanently stop voting for this election?")) {
        return;
    }

    try {
        await apiFetch(
            `/election/${activeElectionId}/stop`,
            { method: "POST" }
        );

        alert("Election stopped successfully.");
        await refreshDashboard();

    } catch (error) {
        alert("Stop failed: " + error.message);
    }
}

async function handleMaskToggle() {
    try {
        await apiFetch(
            `/election/${activeElectionId}/mask`,
            { method: "POST" }
        );

        await refreshDashboard();

    } catch (error) {
        alert("Mask update failed: " + error.message);
    }
}

async function handleStartElection(event) {
    event.preventDefault();

    const startTime = $("startTime").value;
    const closingTime = $("closingTime").value;

    if (!startTime || !closingTime) {
        alert("Please enter both times.");
        return;
    }

    const today = new Date();
    const date = [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, "0"),
        String(today.getDate()).padStart(2, "0")
    ].join("-");

    try {
        await apiFetch(
            `/election/${activeElectionId}/schedule`,
            {
                method: "PATCH",
                body: JSON.stringify({
                    start_time: `${date} ${startTime}:00`,
                    end_time: `${date} ${closingTime}:00`
                })
            }
        );

        alert("Election schedule saved.");
        await refreshDashboard();

    } catch (error) {
        alert("Schedule update failed: " + error.message);
    }
}

function openLiveDashboard() {
    window.location.href =
        `dashboard.html?election_id=${encodeURIComponent(activeElectionId)}`;
}


document.addEventListener("DOMContentLoaded", async () => {
    if (window.lucide) {
        lucide.createIcons();
    }

    const button = $("viewLiveResultsBtn");

    if (button) {
        button.addEventListener(
            "click",
            openLiveDashboard
        );
    }

    try {
        await resolveCurrentElection();
        await refreshDashboard();

        setInterval(refreshDashboard, REFRESH_INTERVAL);

    } catch (error) {
        console.error("Election initialization error:", error);

        if ($("statusText")) {
            $("statusText").textContent = "NOT FOUND";
        }

        if ($("dynamicSidebarPositions")) {
            $("dynamicSidebarPositions").textContent =
                error.message;
        }

        for (const id of [
            "startElectionBtn",
            "stopVotingBtn",
            "maskToggleBtn"
        ]) {
            const button = $(id);
            if (button) button.disabled = true;
        }
    }
});

