
"use strict";

const API_BASE =
    "https://voting-backend-cdrj.onrender.com/api";

const ELECTION_ID =
    new URLSearchParams(window.location.search)
        .get("election_id") || "current";

const $ = id => document.getElementById(id);

const POLL_INTERVAL = 3000;

let currentPositions = [];
let electionStatus = "UNKNOWN";
let namesMasked = true;
let scanningClosedAt = null;
let votingClosedAt = null;
let isLoading = false;
let lastError = null;
let selectedScope = "all";
let analyticsData = null;
let votingChart = null;
let revealVotes = false;
let analyticsLoading = false;


// LOAD LIVE DASHBOARD DATA

async function loadDashboardData() {
    if (isLoading) return;

    isLoading = true;

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
        revealVotes = election.reveal_votes === true;
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
                position_id: Number(position.position_id),
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

        await loadAnalytics();
        renderAnalytics();

    } catch (error) {
        console.error(
            "Dashboard error:",
            error
        );
        revealVotes = false;
        analyticsData = null;
        namesMasked = true;
        electionStatus = "UNKNOWN";
        currentPositions = [];
        renderAnalytics();
        lastError = error.message;

    } finally {
        isLoading = false;
        renderLiveResults();
    }
}

async function loadAnalytics() {
    if (analyticsLoading) return;

    analyticsLoading = true;

    const requestedScope = selectedScope;

    try {
        const response = await fetch(
            `${API_BASE}/dashboard/` +
            `${encodeURIComponent(ELECTION_ID)}/analytics` +
            `?scope_id=${encodeURIComponent(requestedScope)}`,
            { cache: "no-store" }
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.message || "Unable to load analytics."
            );
        }

        if (requestedScope !== selectedScope) return;

        analyticsData = data;

        const filter = $("scopeFilter");

        const isCollege =
            data.school_level === "college";

        $("scopeFilterLabel").textContent =
            isCollege ? "Department" : "Grade Level";

        const options = [
            new Option(
                isCollege
                    ? "All Departments"
                    : "All Grades",
                "all"
            )
        ];

        for (const scope of data.scopes || []) {
            options.push(
                new Option(
                    scope.scope_name,
                    String(scope.scope_id)
                )
            );
        }

        options.push(
            new Option(
                "Unassigned / Legacy Ballots",
                "legacy"
            )
        );

        filter.replaceChildren(...options);
        filter.value = selectedScope;

        renderAnalytics();

    } catch (error) {
        analyticsData = null;

        console.error("Analytics error:", error);

        renderAnalytics();

        $("analyticsMessage").textContent =
            "Unable to load analytics.";

    } finally {
        analyticsLoading = false;

        if (requestedScope !== selectedScope) {
            loadAnalytics().then(renderLiveResults);
        }
    }
}

function renderAnalytics() {
    const hidden =
        !revealVotes ||
        !analyticsData ||
        analyticsData.results_hidden;

    if (hidden) {
        $("analyticsRegistered").textContent = "—";
        $("analyticsCounted").textContent = "—";
        $("analyticsTurnout").textContent = "—";

        $("analyticsMessage").textContent =
            "Analytics unavailable until results are released.";

        if (votingChart) {
            votingChart.destroy();
            votingChart = null;
        }

        return;
    }

    const stats = analyticsData.statistics;

    $("analyticsRegistered").textContent =
        Number(stats.registered_ballots).toLocaleString();

    $("analyticsCounted").textContent =
        Number(stats.counted_ballots).toLocaleString();

    $("analyticsTurnout").textContent =
        stats.counting_percentage === null
            ? "N/A"
            : `${stats.counting_percentage}%`;

    const timeline = analyticsData.timeline || [];

    $("analyticsMessage").textContent =
        timeline.length
            ? "Cumulative counted ballots • Philippine time"
            : "No recorded counting activity.";

    if (typeof Chart === "undefined") {
        $("analyticsMessage").textContent =
            "Chart library unavailable.";
        return;
    }

    const chartLabels = timeline.map(item =>
        new Date(item.timestamp).toLocaleString(
            "en-PH",
            {
                timeZone: "Asia/Manila",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit"
            }
        )
    );

    const chartValues = timeline.map(
        item => item.counted_ballots
    );

    if (votingChart) {
        votingChart.data.labels = chartLabels;
        votingChart.data.datasets[0].data = chartValues;
        votingChart.update("none");
        return;
    }

    votingChart = new Chart(
        $("votingLineChart"),
        {
            type: "line",

            data: {
                labels: chartLabels,

                datasets: [{
                    label: "Counted Ballots",
                    data: chartValues,
                    borderColor: "#800000",
                    backgroundColor: "rgba(128,0,0,0.08)",
                    borderWidth: 3,
                    pointRadius: 4,
                    fill: true,
                    tension: 0
                }]
            },

            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,

                scales: {
                    y: {
                        beginAtZero: true,

                        ticks: {
                            precision: 0
                        }
                    }
                },

                plugins: {
                    legend: {
                        display: false
                    }
                }
            }
        }
    );
}
// RESULTS RELEASE CHECK

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


            const filteredTallies = new Map(
                (analyticsData?.candidate_tallies || []).map(
                    candidate => [
                        candidate.candidate_id,
                        candidate.total_votes
                    ]
                )
            );

            const scopeReady =
                revealVotes &&
                analyticsData &&
                !analyticsData.results_hidden &&
                analyticsData.selected_scope === selectedScope;

            const candidates = position.candidates.map(
                candidate => ({
                    ...candidate,

                    votes: !revealVotes
                        ? 0
                        : selectedScope === "all"
                            ? candidate.votes
                            : scopeReady
                                ? Number(
                                    filteredTallies.get(candidate.id) || 0
                                )
                                : 0
                })
            );

            const showVoteCounts =
                revealVotes &&
                (
                    selectedScope === "all" ||
                    scopeReady
                );



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

            // Kunin ang allowed winners sa position
            const maxWinners = Math.max(
                1,
                Number(position.max_choices) || 1
            );

            // Top candidates base sa allowed winners
            const winningCandidates = candidates
                .filter(candidate => candidate.votes > 0)
                .slice(0, maxWinners);

            // Check kung may tie sa last winning slot
            const cutoffCandidate = candidates[maxWinners - 1];
            const nextCandidate = candidates[maxWinners];

            const hasCutoffTie =
                cutoffCandidate &&
                nextCandidate &&
                cutoffCandidate.votes > 0 &&
                cutoffCandidate.votes === nextCandidate.votes;

            const cutoffVotes = hasCutoffTie
                ? cutoffCandidate.votes
                : null;

            // IDs ng confirmed winners
            const winnerIds = new Set(
                winningCandidates
                    .filter(candidate =>
                        !hasCutoffTie ||
                        candidate.votes > cutoffVotes
                    )
                    .map(candidate => candidate.id)
            );

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

                    // Winner lang kapag finalized ang election
                    const isWinner =
                        finalized &&
                        revealVotes &&
                        selectedScope === "all" &&
                        winnerIds.has(candidate.id);


                    const stableIndex = [...position.candidates]
                        .sort((a, b) => a.id - b.id)
                        .findIndex(item => item.id === candidate.id);

                    const displayName = revealed
                        ? candidate.name
                        : `Candidate ${String.fromCharCode(65 + stableIndex)}`;


                    const winnerBadge = isWinner
                        ? `
                            <span class="winner-badge">
                                🏆 WINNER
                            </span>
                          `
                        : "";


                    const displayVotes =
                        beforeElection
                            ? "Not started"
                            : !showVoteCounts
                                ? "Results hidden / unavailable"
                                : `${percent.toFixed(1)}% ` +
                                `(${candidate.votes.toLocaleString()} votes)`;

                    const displayBarWidth =
                        showVoteCounts ? safePercent : 0;


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

            const positionStats = scopeReady
                ? analyticsData.positions?.find(
                    item =>
                        Number(item.position_id) ===
                        Number(position.position_id)
                )
                : null;

            const noVoteCount = Number(
                positionStats?.no_recorded_vote || 0
            );

            const applicableBallots = Number(
                positionStats?.applicable_ballots || 0
            );

            const noVotePercent =
                applicableBallots > 0
                    ? ((noVoteCount / applicableBallots) * 100)
                        .toFixed(1)
                    : null;

            const underVoteHtml =
                finalized && showVoteCounts && positionStats
                    ? `
            <div class="undervote-info">
                No Recorded Vote:
                <strong>
                    ${noVoteCount.toLocaleString()} ballots
                    (${noVotePercent ?? "N/A"}${noVotePercent !== null ? "%" : ""})
                </strong>

                <br>

                Partial Selections:
                <strong>
                    ${Number(
                        positionStats.partial_selections || 0
                    ).toLocaleString()} ballots
                </strong>
            </div>
        `
                    : "";

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
                    ${underVoteHtml}
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
        $("scopeFilter")?.addEventListener(
            "change",
            async event => {
                selectedScope = event.target.value;
                analyticsData = null;

                renderAnalytics();
                renderLiveResults();

                await loadAnalytics();
                renderLiveResults();
            }
        );

        loadDashboardData();

        setInterval(
            loadDashboardData,
            POLL_INTERVAL
        );
    }
);

