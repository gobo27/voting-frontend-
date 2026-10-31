
"use strict";

const API_BASE =
    "https://voting-backend-cdrj.onrender.com/api";

const ELECTION_ID =
    new URLSearchParams(window.location.search)
        .get("election_id") || "current";

const $ = id => document.getElementById(id);

const POLL_INTERVAL = 3000;
const MASK_CHAR = "••••••••";

let currentPositions = [];
let electionStatus = "UNKNOWN";
let namesMasked = true;
let scanningClosedAt = null;
let votingClosedAt = null;
let isLoading = false;
let lastError = null;

// LOAD LIVE DASHBOARD DATA

async function loadDashboardData() {
    if (isLoading) return;

    isLoading = true;

    try {
        const response = await fetch(
            `${API_BASE}/dashboard/${encodeURIComponent(ELECTION_ID)}/overview`,
            { cache: "no-store" }
        );

        const data = await response.json()
            .catch(() => ({}));

        if (!response.ok) {
            throw new Error(
                data.message ||
                `API error ${response.status}`
            );
        }

        if (
            !data.election ||
            !Array.isArray(data.positions)
        ) {
            throw new Error(
                "Invalid dashboard API response"
            );
        }

        const election = data.election;

        const totalScannedBallots =
            Number(data.statistics?.scanned_ballots || 0);

        const scanCountElement =
            document.getElementById("totalScannedBallots");

        if (scanCountElement) {
            scanCountElement.textContent =
                totalScannedBallots.toLocaleString();
        }


        electionStatus = String(
            election.status || "UNKNOWN"
        ).toUpperCase();

        namesMasked = Boolean(
            Number(election.mask_names ?? 1)
        );

        scanningClosedAt =
            election.scanning_closed_at || null;

        votingClosedAt =
            election.voting_closed_at || null;

        currentPositions = data.positions.map(
            position => ({
                title: position.position_title,
                max_choices:
                    Number(position.max_selection) || 1,

                candidates: (
                    position.candidates || []
                ).map(candidate => ({
                    id: Number(candidate.candidate_id),
                    name: candidate.name,
                    votes:
                        Number(candidate.total_votes) || 0
                }))
            })
        );

        lastError = null;

    } catch (error) {
        console.error(
            "Dashboard error:",
            error
        );

        lastError = error.message;

    } finally {
        isLoading = false;
        renderLiveResults();
    }
}

// RESULTS RELEASE CHECK
// Requires scanning_closed_at from backend.
// Completed status alone is not sufficient.

function isFinalized() {
    return (
        electionStatus === "COMPLETED" &&
        Boolean(scanningClosedAt) &&
        !namesMasked
    );
}

// BEFORE ELECTION CHECK

function isBeforeElection() {
    return (
        electionStatus !== "ACTIVE" &&
        electionStatus !== "COMPLETED" &&
        !votingClosedAt
    );
}

// CHECK IF CANDIDATE NAMES CAN BE SHOWN

function isRevealed() {
    return isBeforeElection() || isFinalized();
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

    if (!container) return;

    const finalized = isFinalized();
    const revealed = isRevealed();
    const beforeElection = isBeforeElection();

    if (lastError && !currentPositions.length) {
        container.innerHTML = `
            <div class="empty-message">
                <h3 class="font-bold text-red-700">
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
            <div class="empty-message">
                <h3 class="font-bold">
                    No Ballot Data Found
                </h3>
                <p class="text-sm mt-2">
                    Please add positions and candidates first.
                </p>
            </div>
        `;

        applyBannerState();
        return;
    }

    container.innerHTML = currentPositions.map(
        position => {

            // COPY ARRAY BEFORE SORTING
            const candidates = [
                ...position.candidates
            ];

            // AUTOMATIC HIGHEST TO LOWEST
            candidates.sort((a, b) =>
                b.votes - a.votes ||
                a.id - b.id
            );

            const totalVotes = candidates.reduce(
                (sum, candidate) =>
                    sum + candidate.votes,
                0
            );

            const highestVotes =
                candidates[0]?.votes || 0;

            const highestCount = candidates.filter(
                candidate =>
                    candidate.votes === highestVotes
            ).length;

            // WINNER ONLY FOR FINALIZED
            // SINGLE-WINNER POSITIONS
            // NO WINNER IF THERE IS A TIE

            const hasWinner =
                finalized &&
                highestVotes > 0 &&
                highestCount === 1 &&
                position.max_choices === 1;

            const rows = candidates.map(
                (candidate, index) => {

                    const percent =
                        totalVotes > 0
                            ? (
                                candidate.votes /
                                totalVotes
                            ) * 100
                            : 0;

                    const safePercent = Math.max(
                        0,
                        Math.min(100, percent)
                    );

                    const isWinner =
                        hasWinner &&
                        index === 0;

                    const displayName = revealed
                        ? candidate.name
                        : MASK_CHAR;

                    const winnerBadge = isWinner
                        ? `
                            <span class="winner-badge">
                                🏆 WINNER
                            </span>
                          `
                        : "";

                    const displayVotes = finalized
                        ? `
                            ${percent.toFixed(1)}%
                            (${candidate.votes.toLocaleString()} votes)
                          `
                        : beforeElection
                            ? "Not started"
                            : "Results pending";

                    // KEEP VOTES HIDDEN UNTIL FINAL
                    const displayBarWidth = finalized
                        ? safePercent
                        : 0;

                    return `
                        <div
                            class="candidate-row ${isWinner ? "winner-row" : ""
                        }"
                            data-candidate-id="${candidate.id}"
                        >
                            <div class="candidate-info">
                                <span class="candidate-name">
                                    ${escapeHtml(displayName)}
                                    ${winnerBadge}
                                </span>

                                <span class="candidate-percent">
                                    ${displayVotes}
                                </span>
                            </div>

                            <div class="progress-track">
                                <div
                                    class="candidate-bar"
                                    style="width:${displayBarWidth.toFixed(2)}%"
                                ></div>
                            </div>
                        </div>
                    `;
                }
            ).join("");

            return `
                <section class="position-section">
                    <div class="position-header">
                        <h3>
                            ${escapeHtml(position.title).toUpperCase()}
                        </h3>

                        <span class="position-limit">
                            Select up to ${position.max_choices}
                        </span>
                    </div>

                    <div class="candidates-list">
                        ${rows ||
                '<p class="text-sm text-gray-500">No candidates registered.</p>'
                }
                    </div>
                </section>
            `;
        }
    ).join("");

    applyBannerState();
}

// UPDATE ELECTION STATUS BANNER

function applyBannerState() {
    const banner = $("statusBanner");
    const bannerText = $("statusBannerText");
    const statusIcon = $("statusIcon");

    if (
        !banner ||
        !bannerText ||
        !statusIcon
    ) return;

    banner.classList.remove(
        "bg-emerald-100",
        "text-emerald-900",
        "border-emerald-400",
        "bg-amber-100",
        "text-amber-900",
        "border-amber-400",
        "bg-gray-200",
        "text-gray-800",
        "border-gray-400"
    );

    if (isFinalized()) {
        bannerText.textContent =
            "Election Ended — Official Results Revealed";

        statusIcon.textContent = "✅";

        banner.classList.add(
            "bg-emerald-100",
            "text-emerald-900",
            "border-emerald-400"
        );

    } else if (isBeforeElection()) {
        bannerText.textContent =
            "Election Not Started — Candidate Preview";

        statusIcon.textContent = "⏳";

        banner.classList.add(
            "bg-gray-200",
            "text-gray-800",
            "border-gray-400"
        );

    } else if (
        electionStatus === "COMPLETED"
    ) {
        bannerText.textContent =
            "Voting Ended — Ballot Counting / Finalization Pending";

        statusIcon.textContent = "🔒";

        banner.classList.add(
            "bg-gray-200",
            "text-gray-800",
            "border-gray-400"
        );

    } else {
        bannerText.textContent =
            "Voting in Progress — Results Hidden";

        statusIcon.textContent = "🔒";

        banner.classList.add(
            "bg-amber-100",
            "text-amber-900",
            "border-amber-400"
        );
    }
}

// INITIALIZE DASHBOARD

document.addEventListener(
    "DOMContentLoaded",
    () => {
        loadDashboardData();

        setInterval(
            loadDashboardData,
            POLL_INTERVAL
        );
    }
);
