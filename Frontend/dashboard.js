
"use strict";

const API_BASE = "http://127.0.0.1:3000/api";

const ELECTION_ID =
    new URLSearchParams(window.location.search)
        .get("election_id") || "current";

const $ = id => document.getElementById(id);

const MASK_CHAR = "";
const POLL_INTERVAL = 3000;

let currentPositions = [];
let totalCountedBallots = 0;
let electionStatus = "UNKNOWN";
let namesMasked = true;
let isLoading = false;
let lastError = null;

// LOAD DASHBOARD DATA

async function loadDashboardData() {
    if (isLoading) return;

    isLoading = true;

    try {
        const response = await fetch(
            `${API_BASE}/dashboard/${encodeURIComponent(ELECTION_ID)}/overview`,
            { cache: "no-store" }
        );

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(
                data.message || `API error ${response.status}`
            );
        }

        if (!data.election || !Array.isArray(data.positions)) {
            throw new Error("Invalid dashboard API response");
        }

        electionStatus = String(
            data.election.status || "UNKNOWN"
        ).toUpperCase();

        namesMasked = Boolean(
            Number(data.election.mask_names ?? 1)
        );

        // TOTAL COUNTED BALLOTS FROM DATABASE
        totalCountedBallots = Number(
            data.statistics?.scanned_ballots
        ) || 0;

        // POSITIONS AND CANDIDATE VOTES
        currentPositions = data.positions.map(position => ({
            title: position.position_title,
            max_choices: Number(position.max_selection) || 1,
            candidates: (position.candidates || []).map(candidate => ({
                id: candidate.candidate_id,
                name: candidate.name,
                votes: Number(candidate.total_votes) || 0
            }))
        }));

        lastError = null;

    } catch (error) {
        console.error("Dashboard error:", error);
        lastError = error.message;

    } finally {
        isLoading = false;
        renderLiveResults();
    }
}

// CHECK IF CANDIDATE NAMES CAN BE REVEALED

function isRevealed() {
    return electionStatus === "COMPLETED" && !namesMasked;
}

// ESCAPE HTML

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// RENDER LIVE RESULTS

function renderLiveResults() {
    const container = $("resultsContainer");
    const sortSelect = $("sortSelect");

    // UPDATE TOTAL COUNTED BALLOTS
    const ballotCounter = $("totalCountedBallots");

    if (ballotCounter) {
        ballotCounter.textContent =
            totalCountedBallots.toLocaleString();
    }

    if (!container) return;

    const sortMode = sortSelect ? sortSelect.value : "default";
    const revealed = isRevealed();

    if (lastError && !currentPositions.length) {
        container.innerHTML = `
            <div class="p-8 text-center bg-white/60 border border-red-300 rounded-2xl">
                <h3 class="font-serif font-bold text-red-700 text-lg">
                    Unable to load results
                </h3>
                <p class="text-sm text-red-600 mt-2">
                    ${escapeHtml(lastError)}
                </p>
            </div>
        `;

        applyBannerState();
        return;
    }

    if (!currentPositions.length) {
        container.innerHTML = `
            <div class="p-8 text-center bg-white/60 border border-gray-300 rounded-2xl">
                <h3 class="font-serif font-bold text-gray-700 text-lg">
                    No Ballot Data Found
                </h3>
                <p class="text-sm text-gray-500 mt-2">
                    Please add positions and candidates first.
                </p>
            </div>
        `;

        applyBannerState();
        return;
    }

    container.innerHTML = currentPositions.map(position => {
        const candidates = [...position.candidates];

        const totalVotes = candidates.reduce(
            (sum, candidate) => sum + candidate.votes,
            0
        );

        if (sortMode === "high-low") {
            candidates.sort((a, b) => b.votes - a.votes);
        } else if (sortMode === "low-high") {
            candidates.sort((a, b) => a.votes - b.votes);
        }

        const rows = candidates.map(candidate => {
            const percent = totalVotes > 0
                ? (candidate.votes / totalVotes) * 100
                : 0;

            const displayName = revealed
                ? candidate.name
                : MASK_CHAR;

            return `
                <div class="candidate-row flex flex-col w-full mb-3"
                     data-candidate-id="${Number(candidate.id)}">

                    <div class="flex justify-between items-center gap-3 text-sm font-serif font-semibold text-gray-800 mb-1">

                        <span class="candidate-name truncate">
                            ${escapeHtml(displayName)}
                        </span>

                        <span class="candidate-percent shrink-0">
                            ${percent.toFixed(1)}%
                            (${candidate.votes.toLocaleString()} votes)
                        </span>
                    </div>

                    <div class="w-full bg-gray-400/60 h-3.5 rounded-full overflow-hidden shadow-inner">
                        <div
                            class="candidate-bar bg-[#8f0000] h-full rounded-full transition-all duration-500"
                            style="width:${percent.toFixed(2)}%">
                        </div>
                    </div>
                </div>
            `;
        }).join("");

        return `
            <section class="position-section flex flex-col gap-2 w-full">

                <div class="border-l-4 border-red-800 pl-3 flex items-center justify-between gap-3">
                    <h3 class="text-xl font-serif font-bold text-gray-900">
                        ${escapeHtml(position.title).toUpperCase()}
                    </h3>

                    <span class="text-xs text-gray-500 font-serif shrink-0">
                        Select up to ${position.max_choices}
                    </span>
                </div>

                <div class="candidates-list flex flex-col pl-3 w-full">
                    ${rows || '<p class="text-sm text-gray-500">No candidates registered.</p>'}
                </div>

            </section>
        `;
    }).join("");

    applyBannerState();
}

// UPDATE ELECTION STATUS BANNER

function applyBannerState() {
    const banner = $("statusBanner");
    const bannerText = $("statusBannerText");
    const statusIcon = $("statusIcon");

    if (!banner || !bannerText || !statusIcon) return;

    banner.classList.remove(
        "bg-emerald-100", "text-emerald-900", "border-emerald-400",
        "bg-amber-100", "text-amber-900", "border-amber-400",
        "bg-gray-200", "text-gray-800", "border-gray-400"
    );

    if (electionStatus === "COMPLETED" && !namesMasked) {
        bannerText.textContent =
            "Election Ended — Official Results Revealed";
        statusIcon.textContent = "✅";

        banner.classList.add(
            "bg-emerald-100",
            "text-emerald-900",
            "border-emerald-400"
        );

    } else if (electionStatus === "COMPLETED") {
        bannerText.textContent =
            "Election Ended — Candidate Names Hidden";
        statusIcon.textContent = "🔒";

        banner.classList.add(
            "bg-gray-200",
            "text-gray-800",
            "border-gray-400"
        );

    } else if (electionStatus === "ACTIVE") {
        bannerText.textContent =
            "Voting in Progress — Candidate Names Hidden";
        statusIcon.textContent = "🔒";

        banner.classList.add(
            "bg-amber-100",
            "text-amber-900",
            "border-amber-400"
        );

    } else {
        bannerText.textContent =
            "Election Not Started — Results Preview";
        statusIcon.textContent = "⏳";

        banner.classList.add(
            "bg-gray-200",
            "text-gray-800",
            "border-gray-400"
        );
    }
}

// INITIALIZE DASHBOARD

document.addEventListener("DOMContentLoaded", () => {
    const sortSelect = $("sortSelect");

    if (sortSelect) {
        sortSelect.addEventListener("change", renderLiveResults);
    }

    loadDashboardData();

    setInterval(loadDashboardData, POLL_INTERVAL);
});
