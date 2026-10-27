
"use strict";

// CONFIGURATION

const API_BASE = "http://localhost:3000/api";

const urlParams = new URLSearchParams(
    window.location.search
);

let activeElectionId =
    urlParams.get("election_id") || null;

const REFRESH_INTERVAL = 5000;
const MASK_CHAR = "••••••••";

let electionData = null;
let positionsData = [];
let dashboardStatistics = {};
let electionControlStatus = null;

let refreshing = false;
let savingSchedule = false;
let scheduleDirty = false;
let scheduleInitialized = false;
let lastSavedSchedule = null;
let actionPending = false;

const $ = id => document.getElementById(id);

// AUTHENTICATION

function getToken() {
    return sessionStorage.getItem("voting_token") ||
        localStorage.getItem("voting_token") ||
        localStorage.getItem("token");
}

// API HELPER

async function apiFetch(path, options = {}) {
    const token = getToken();

    const response = await fetch(API_BASE + path, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(token
                ? { Authorization: `Bearer ${token}` }
                : {}),
            ...(options.headers || {})
        },
        cache: "no-store"
    });

    const data = await response.json()
        .catch(() => ({}));

    if (!response.ok) {
        throw new Error(
            data.message ||
            data.error ||
            `API error ${response.status}`
        );
    }

    return data;
}

// NOTIFICATIONS

function showElectionNotice(message, type = "info") {
    if (typeof window.showToast === "function") {
        window.showToast(message, type);
    } else {
        alert(message);
    }
}

async function confirmElectionAction(message) {
    if (
        typeof window.showConfirmToast === "function"
    ) {
        return window.showConfirmToast(message, {
            title: "Confirm Election Action",
            confirmText: "Continue",
            cancelText: "Cancel"
        });
    }

    return window.confirm(message);
}

// CURRENT ELECTION

async function resolveCurrentElection() {
    if (activeElectionId) {
        return activeElectionId;
    }

    const data = await apiFetch(
        "/positions/election/current"
    );

    const id =
        data.election_id ??
        data.election?.election_id;

    if (!id) {
        throw new Error(
            "No current election found. " +
            "Please create or select an election first."
        );
    }

    activeElectionId = String(id);

    return activeElectionId;
}

// HELPERS

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function electionStatus() {
    const value = String(
        electionControlStatus?.status ||
        electionData?.status ||
        "UNKNOWN"
    ).toUpperCase();

    if (
        ["CLOSED", "COMPLETED", "FINISHED"]
            .includes(value)
    ) {
        return "CLOSED";
    }

    if (value === "PAUSED") {
        return "PAUSED";
    }

    if (
        value === "ACTIVE" ||
        value === "OPEN"
    ) {
        return "OPEN";
    }

    return value;
}

function isArchived() {
    return Boolean(
        electionControlStatus?.archived_at ||
        electionData?.archived_at
    );
}

function namesMasked() {
    const value =
        electionControlStatus?.mask_names ??
        electionData?.mask_names;

    if (value === undefined || value === null) {
        return true;
    }

    return value === true ||
        value === 1 ||
        value === "1";
}

function namesRevealed() {
    return electionStatus() === "CLOSED" &&
        !namesMasked();
}

function flagIsTrue(value) {
    return value === true ||
        value === 1 ||
        value === "1";
}

function votingIsOpen() {
    if (!electionControlStatus) return false;

    return flagIsTrue(
        electionControlStatus.voting_open
    );
}

function countingIsOpen() {
    if (!electionControlStatus) return false;

    const value =
        electionControlStatus.scanning_open ??
        electionControlStatus.counting_open;

    return flagIsTrue(value);
}

function votingHasEnded() {
    if (!electionControlStatus) return false;

    return (
        electionStatus() === "CLOSED" ||
        electionControlStatus.schedule_state === "ENDED"
    ) && !votingIsOpen();
}

// ELECTION LIFECYCLE

function updateElectionLifecycle() {
    const status = electionStatus();
    const archived = isArchived();

    const hasSchedule = Boolean(
        electionData?.start_time &&
        electionData?.end_time
    );

    const stages = [
        $("lifecycleSchedule"),
        $("lifecycleVoting"),
        $("lifecycleClosed"),
        $("lifecycleArchive")
    ];

    if (stages.some(stage => !stage)) {
        return;
    }

    // 0 = Set Schedule
    // 1 = Voting
    // 2 = Closed
    // 3 = Archive

    let currentStage = 0;

    if (archived) {
        currentStage = 3;
    } else if (status === "CLOSED") {
        currentStage = 2;
    } else if (
        status === "OPEN" ||
        status === "PAUSED"
    ) {
        currentStage = 1;
    }

    stages.forEach((stage, index) => {
        stage.classList.remove(
            "active",
            "completed",
            "pending"
        );

        if (index < currentStage) {
            stage.classList.add("completed");
        } else if (index === currentStage) {
            stage.classList.add("active");
        } else {
            stage.classList.add("pending");
        }
    });

    const description =
        $("lifecycleDescription");

    if (!description) return;

    if (!electionData || !electionControlStatus) {
        description.textContent =
            "Loading election lifecycle...";
        return;
    }

    if (archived) {
        description.textContent =
            "Election archived. Results and " +
            "election history are preserved.";
        return;
    }

    if (status === "CLOSED") {
        description.textContent =
            countingIsOpen()
                ? "Voting is closed. Finish scanning " +
                "all received ballots before archiving."
                : "Voting is closed. Verify the final " +
                "results before archiving in Super Admin.";
        return;
    }

    if (status === "OPEN") {
        description.textContent =
            votingIsOpen()
                ? "Election is active. Voting is currently open."
                : "Election is active, but voting is not " +
                "currently open according to the backend.";
        return;
    }

    if (status === "PAUSED") {
        description.textContent =
            "Election voting is currently paused.";
        return;
    }

    if (hasSchedule) {
        description.textContent =
            "Voting schedule is saved. " +
            "Start the election when ready.";
    } else {
        description.textContent =
            "Set and save the voting schedule " +
            "to begin the election process.";
    }
}

// PHILIPPINE DATE AND TIME

function getPhilippineToday() {
    const parts = new Intl.DateTimeFormat(
        "en-US",
        {
            timeZone: "Asia/Manila",
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }
    ).formatToParts(new Date());

    const part = type =>
        parts.find(p => p.type === type)?.value;

    return [
        part("year"),
        part("month"),
        part("day")
    ].join("-");
}

function parseScheduleDateTime(value) {
    if (!value) return null;

    const text = String(value).trim();

    const localMatch = text.match(
        /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/
    );

    if (
        localMatch &&
        !/[zZ]|[+-]\d{2}:\d{2}$/.test(text)
    ) {
        return {
            date: localMatch[1],
            time: localMatch[2]
        };
    }

    const date = new Date(text);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    const parts = new Intl.DateTimeFormat(
        "en-CA",
        {
            timeZone: "Asia/Manila",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23"
        }
    ).formatToParts(date);

    const part = type =>
        parts.find(p => p.type === type)?.value;

    return {
        date: [
            part("year"),
            part("month"),
            part("day")
        ].join("-"),
        time: `${part("hour")}:${part("minute")}`
    };
}

// INITIALIZE SCHEDULE INPUTS

function initializeScheduleInputs() {
    const today = getPhilippineToday();

    if ($("startDate") && !$("startDate").value) {
        $("startDate").value = today;
    }

    if ($("endDate") && !$("endDate").value) {
        $("endDate").value = today;
    }

    if ($("startTime") && !$("startTime").value) {
        $("startTime").value = "07:00";
    }

    if (
        $("closingTime") &&
        !$("closingTime").value
    ) {
        $("closingTime").value = "19:00";
    }
}

// READ SAVED SCHEDULE FROM DATABASE

function syncScheduleFromElection() {
    if (!electionData || scheduleDirty) {
        return;
    }

    const source =
        electionControlStatus || electionData;

    const start = parseScheduleDateTime(
        source.start_time || electionData.start_time
    );

    const end = parseScheduleDateTime(
        source.end_time || electionData.end_time
    );

    if (start && end) {
        $("startDate").value = start.date;
        $("startTime").value = start.time;

        $("endDate").value = end.date;
        $("closingTime").value = end.time;

        lastSavedSchedule = {
            start_time:
                `${start.date} ${start.time}:00`,
            end_time:
                `${end.date} ${end.time}:00`
        };

        if ($("scheduleInfo")) {
            $("scheduleInfo").textContent =
                `Saved: ${start.date} ${start.time} ` +
                `to ${end.date} ${end.time} ` +
                "(Philippine time)";
        }

        scheduleInitialized = true;

    } else if (!scheduleInitialized) {
        initializeScheduleInputs();
        scheduleInitialized = true;
    }
}

// VALIDATE VOTING SCHEDULE

function readSchedule() {
    const startDate = $("startDate").value;
    const startTime = $("startTime").value;

    const endDate = $("endDate").value;
    const closingTime = $("closingTime").value;

    if (
        !startDate ||
        !startTime ||
        !endDate ||
        !closingTime
    ) {
        throw new Error(
            "Please complete the voting schedule."
        );
    }

    const startValue =
        `${startDate} ${startTime}:00`;

    const endValue =
        `${endDate} ${closingTime}:00`;

    if (endValue <= startValue) {
        throw new Error(
            "Closing date and time must be " +
            "later than starting date and time."
        );
    }

    return {
        start_time: startValue,
        end_time: endValue
    };
}

// CHECK SAVED SCHEDULE

function isScheduleSaved() {
    if (scheduleDirty) {
        return false;
    }

    if (!lastSavedSchedule) {
        return Boolean(
            electionData?.start_time &&
            electionData?.end_time
        );
    }

    try {
        const current = readSchedule();

        return (
            current.start_time ===
            lastSavedSchedule.start_time &&
            current.end_time ===
            lastSavedSchedule.end_time
        );

    } catch {
        return false;
    }
}

// SAVE VOTING SCHEDULE

async function saveVotingSchedule() {
    if (savingSchedule || actionPending) {
        return false;
    }

    await resolveCurrentElection();

    const status = electionStatus();

    if (
        isArchived() ||
        status === "OPEN" ||
        status === "CLOSED"
    ) {
        throw new Error(
            "Voting schedule cannot be changed " +
            "after voting has started or closed."
        );
    }

    const schedule = readSchedule();
    const button = $("saveScheduleBtn");

    try {
        savingSchedule = true;

        if (button) {
            button.disabled = true;
            button.textContent = "Saving...";
        }

        await apiFetch(
            `/election/${encodeURIComponent(
                activeElectionId
            )}/schedule`,
            {
                method: "PATCH",
                body: JSON.stringify(schedule)
            }
        );

        lastSavedSchedule = schedule;
        scheduleDirty = false;

        if ($("scheduleInfo")) {
            $("scheduleInfo").textContent =
                "Saved: " +
                schedule.start_time.slice(0, 16) +
                " to " +
                schedule.end_time.slice(0, 16) +
                " (Philippine time)";
        }

        await refreshDashboard();

        return true;

    } finally {
        savingSchedule = false;

        if (button) {
            button.innerHTML =
                '<i data-lucide="save" ' +
                'style="width:17px;height:17px"></i>' +
                'Save Voting Schedule';
        }

        refreshStatusUI();
    }
}

// FORM SUBMIT

async function handleStartElection(event) {
    event.preventDefault();

    try {
        const saved = await saveVotingSchedule();

        if (saved) {
            showElectionNotice(
                "Voting schedule saved successfully!",
                "success"
            );
        }

    } catch (error) {
        console.error(
            "Schedule update failed:",
            error
        );

        showElectionNotice(
            "Schedule update failed: " +
            error.message,
            "error"
        );
    }
}

// REFRESH DASHBOARD

async function refreshDashboard() {
    if (refreshing || !activeElectionId) {
        return;
    }

    refreshing = true;

    try {
        const id =
            encodeURIComponent(activeElectionId);

        const [overviewResult, statusResult] =
            await Promise.all([
                apiFetch(`/dashboard/${id}/overview`),
                apiFetch(`/election/${id}/status`)
            ]);

        if (
            !overviewResult.election ||
            !Array.isArray(overviewResult.positions)
        ) {
            throw new Error(
                "Invalid dashboard API response."
            );
        }

        if (!statusResult.election) {
            throw new Error(
                "Invalid election status API response."
            );
        }

        electionData = overviewResult.election;
        positionsData = overviewResult.positions;
        dashboardStatistics = overviewResult.statistics || {};

        electionControlStatus =
            statusResult.election;

        syncScheduleFromElection();

        refreshStatusUI();

        renderLiveSidebar();

    } catch (error) {
        console.error(
            "Election management refresh error:",
            error
        );

        const sidebar =
            $("dynamicSidebarPositions");

        if (
            sidebar &&
            !positionsData.length
        ) {
            sidebar.textContent =
                "Unable to load results: " +
                error.message;
        }

    } finally {
        refreshing = false;
    }
}

// UPDATE STATUS UI


function refreshStatusUI() {
    const status = electionStatus();
    const masked = namesMasked();
    const archived = isArchived();

    const hasStatus = Boolean(
        electionData && electionControlStatus
    );

    const votingOpen = votingIsOpen();
    const scanningOpen = countingIsOpen();
    const votingEnded = votingHasEnded();

    const scheduleState =
        electionControlStatus?.schedule_state || "";

    // STATUS PILL

    if ($("statusText")) {
        let displayStatus = status;

        if (archived) {
            displayStatus = "ARCHIVED";
        } else if (
            status === "OPEN" &&
            scheduleState === "ENDED"
        ) {
            displayStatus = "VOTING ENDED";
        }

        $("statusText").textContent = displayStatus;

        $("statusText").className =
            votingOpen && !archived
                ? "text-emerald-600 font-bold"
                : "text-red-600 font-bold";
    }

    if ($("maskedText")) {
        $("maskedText").textContent =
            masked ? "Masked" : "Unmasked";
    }

    // MASK BUTTON LABEL

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
        $("maskIconContainer").innerHTML =
            masked
                ? '<i data-lucide="eye"></i>'
                : '<i data-lucide="eye-off"></i>';
    }

    // START ELECTION

    const startButton = $("startElectionBtn");

    if (startButton) {
        startButton.disabled =
            !hasStatus ||
            actionPending ||
            archived ||
            status === "OPEN" ||
            status === "CLOSED" ||
            !isScheduleSaved();
    }

    // STOP VOTING
    // An active election may need to be formally closed
    // even after its scheduled voting window has ended.

    const stopButton = $("stopVotingBtn");

    if (stopButton) {
        stopButton.disabled =
            !hasStatus ||
            actionPending ||
            archived ||
            status !== "OPEN";

        stopButton.title =
            status === "OPEN" && !votingOpen
                ? "Close the active election after its voting window."
                : "Close voting for this election.";
    }

    // MASK / UNMASK NAMES

    const maskButton = $("maskToggleBtn");

    if (maskButton) {
        maskButton.disabled =
            !hasStatus ||
            actionPending ||
            archived ||
            !["OPEN", "CLOSED"].includes(status);
    }

    // FINISH SCANNING
    // Requires voting to be closed and scanning to be open.

    const finishButton = $("finishScanningBtn");

    if (finishButton) {
        finishButton.disabled =
            !hasStatus ||
            actionPending ||
            archived ||
            !scanningOpen ||
            !votingEnded;

        finishButton.title =
            !scanningOpen
                ? "Scanning is not open or is already finished."
                : !votingEnded
                    ? "Close voting first before finishing scanning."
                    : "Finalize OMR scanning for this election.";
    }

    // SAVE SCHEDULE

    const saveButton = $("saveScheduleBtn");

    const lockSchedule =
        archived ||
        status === "OPEN" ||
        status === "CLOSED";

    if (saveButton) {
        saveButton.disabled =
            !hasStatus ||
            savingSchedule ||
            actionPending ||
            lockSchedule;
    }

    // SCHEDULE INPUTS

    for (const id of [
        "startDate",
        "startTime",
        "endDate",
        "closingTime"
    ]) {
        if ($(id)) {
            $(id).disabled = lockSchedule;
        }
    }

    // ELECTION LIFECYCLE

    updateElectionLifecycle();

    // ICONS

    if (window.lucide) {
        lucide.createIcons();
    }
}
// START ELECTION

async function handleStartElectionClick() {
    if (actionPending) return;

    try {
        await resolveCurrentElection();
        await refreshDashboard();

        if (!electionData || !electionControlStatus) {
            throw new Error(
                "Election details could not be loaded."
            );
        }

        if (isArchived()) {
            showElectionNotice(
                "This election is already archived.",
                "warning"
            );
            return;
        }

        if (electionStatus() === "CLOSED") {
            showElectionNotice(
                "This election has already closed. " +
                "Archive it separately in Super Admin.",
                "warning"
            );
            return;
        }

        if (electionStatus() === "OPEN") {
            showElectionNotice(
                "This election is already active.",
                "info"
            );
            return;
        }

        readSchedule();

        if (!isScheduleSaved()) {
            showElectionNotice(
                "Save the voting schedule first " +
                "before starting the election.",
                "warning"
            );
            return;
        }

        const confirmed =
            await confirmElectionAction(
                "Start voting for this election?"
            );

        if (!confirmed) return;

        actionPending = true;
        refreshStatusUI();

        const result = await apiFetch(
            `/election/${encodeURIComponent(activeElectionId)}/start`,
            {
                method: "POST"
            }
        );

        showElectionNotice(
            result.message || "Election started successfully!",
            "success"
        );

        await refreshDashboard();

    } catch (error) {
        console.error(
            "Start election error:",
            error
        );

        showElectionNotice(
            "Start failed: " + error.message,
            "error"
        );

    } finally {
        actionPending = false;
        refreshStatusUI();
    }
}

// STOP VOTING


async function handleStopVoting() {
    if (actionPending) return;

    try {
        await resolveCurrentElection();
        await refreshDashboard();

        if (!electionControlStatus) {
            throw new Error(
                "Unable to verify election status."
            );
        }

        if (isArchived()) {
            showElectionNotice(
                "This election is already archived.",
                "warning"
            );
            return;
        }

        if (electionStatus() !== "OPEN") {
            showElectionNotice(
                "Only an active election can be stopped.",
                "warning"
            );
            return;
        }

        const confirmed =
            await confirmElectionAction(
                "Permanently close voting for this election? " +
                "OMR scanning will remain open. " +
                "The election will NOT be archived automatically."
            );

        if (!confirmed) return;

        actionPending = true;
        refreshStatusUI();

        const result = await apiFetch(
            `/election/${encodeURIComponent(
                activeElectionId
            )}/stop`,
            {
                method: "POST"
            }
        );

        showElectionNotice(
            result.message ||
            "Voting closed successfully. " +
            "Committee scanning remains open.",
            "success"
        );

        await refreshDashboard();

    } catch (error) {
        console.error(
            "Stop voting error:",
            error
        );

        showElectionNotice(
            "Stop failed: " + error.message,
            "error"
        );

    } finally {
        actionPending = false;
        refreshStatusUI();
    }
}

// MASK / UNMASK NAMES

async function handleMaskToggle() {
    if (actionPending) return;

    try {
        await resolveCurrentElection();

        if (isArchived()) {
            showElectionNotice(
                "Archived elections cannot be modified.",
                "warning"
            );
            return;
        }

        actionPending = true;
        refreshStatusUI();

        await apiFetch(
            `/election/${encodeURIComponent(
                activeElectionId
            )}/mask`,
            {
                method: "POST"
            }
        );

        await refreshDashboard();

        showElectionNotice(
            "Candidate name visibility updated.",
            "success"
        );

    } catch (error) {
        console.error(
            "Mask update failed:",
            error
        );

        showElectionNotice(
            "Mask update failed: " +
            error.message,
            "error"
        );

    } finally {
        actionPending = false;
        refreshStatusUI();
    }
}

// FINISH SCANNING

async function handleFinishScanning() {
    if (actionPending) return;

    try {
        await resolveCurrentElection();
        await refreshDashboard();

        if (!electionControlStatus) {
            throw new Error(
                "Unable to verify election scanning status."
            );
        }

        if (isArchived()) {
            showElectionNotice(
                "This election is already archived.",
                "warning"
            );
            return;
        }

        if (!countingIsOpen()) {
            showElectionNotice(
                "Scanning is already closed or not yet open.",
                "warning"
            );
            return;
        }

        if (!votingHasEnded()) {
            showElectionNotice(
                "Close voting first before finishing scanning.",
                "warning"
            );
            return;
        }

        const confirmed =
            await confirmElectionAction(
                "Finish scanning? " +
                "This will permanently stop OMR ballot counting " +
                "for this election. Make sure all received " +
                "ballots have been processed."
            );

        if (!confirmed) return;

        actionPending = true;
        refreshStatusUI();

        const result = await apiFetch(
            `/election/${encodeURIComponent(
                activeElectionId
            )}/finish-scanning`,
            {
                method: "POST"
            }
        );

        showElectionNotice(
            result.message ||
            "Scanning finished successfully.",
            "success"
        );

        await refreshDashboard();

    } catch (error) {
        console.error(
            "Finish scanning error:",
            error
        );

        showElectionNotice(
            "Finish scanning failed: " +
            error.message,
            "error"
        );

    } finally {
        actionPending = false;
        refreshStatusUI();
    }
}

// LIVE RESULTS

function renderLiveSidebar() {
    const sidebar =
        $("dynamicSidebarPositions");

    if (!sidebar) return;

    let candidateCount = 0;

    sidebar.innerHTML = positionsData.map(
        position => {
            const candidates =
                position.candidates || [];

            candidateCount += candidates.length;

            const totalVotes = candidates.reduce(
                (sum, candidate) => {
                    return sum + Math.max(
                        0,
                        Number(candidate.total_votes) || 0
                    );
                },
                0
            );

            const rows = candidates.map(
                candidate => {
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

                            <div class="flex justify-between items-center gap-2 text-xs font-semibold text-gray-800 mb-1">

                                <span class="truncate">
                                    ${escapeHtml(name)}
                                </span>

                                <span class="shrink-0">
                                    ${percent.toFixed(1)}%
                                    (${votes.toLocaleString()} votes)
                                </span>

                            </div>

                            <div class="w-full bg-gray-200 h-3 rounded-full overflow-hidden">

                                <div
                                    class="bg-[#8f0000] h-full rounded-full transition-all duration-500"
                                    style="width:${percent.toFixed(2)}%">
                                </div>

                            </div>

                        </div>
                    `;
                }
            ).join("");

            return `
                <section class="position-section">

                    <h4 class="text-base font-bold text-gray-900 mb-2">
                        ${escapeHtml(position.position_title)}
                    </h4>

                    <p class="text-xs text-gray-500 mb-3">
                        Select up to
                        ${Number(position.max_selection) || 1}
                    </p>

                    <div>
                        ${rows ||
                '<p class="text-sm text-gray-500">No candidates yet.</p>'
                }
                    </div>

                </section>
            `;
        }
    ).join("");

    if (!positionsData.length) {
        sidebar.textContent =
            "No positions or candidates found.";
    }

    if ($("No.candidates")) {
        $("No.candidates").textContent =
            candidateCount.toLocaleString();
    }

    if ($("No.voters")) {
        $("No.voters").textContent =
            "Not available";
    }

    if ($("Voted")) {
    const votesCast = Number(dashboardStatistics.scanned_ballots ?? 0);
    $("Voted").textContent = votesCast.toLocaleString();
}
}

// OPEN LIVE DASHBOARD

function openLiveDashboard() {
    if (!activeElectionId) {
        showElectionNotice(
            "No active election found.",
            "error"
        );
        return;
    }

    window.location.href =
        `dashboard.html?election_id=${encodeURIComponent(
            activeElectionId
        )}`;
}

// DOM CONTENT LOADED

document.addEventListener(
    "DOMContentLoaded",
    async () => {

        if (window.lucide) {
            lucide.createIcons();
        }

        initializeScheduleInputs();

        // LISTEN FOR SCHEDULE CHANGES

        for (const id of [
            "startDate",
            "startTime",
            "endDate",
            "closingTime"
        ]) {
            const input = $(id);

            if (!input) continue;

            input.addEventListener(
                "input",
                () => {
                    scheduleDirty = true;

                    if ($("scheduleInfo")) {
                        $("scheduleInfo").textContent =
                            "Unsaved changes — click " +
                            "Save Voting Schedule.";
                    }

                    refreshStatusUI();
                }
            );
        }

        // VIEW LIVE RESULTS

        const liveButton =
            $("viewLiveResultsBtn");

        if (liveButton) {
            liveButton.addEventListener(
                "click",
                openLiveDashboard
            );
        }

        // LOAD CURRENT ELECTION

        try {
            await resolveCurrentElection();

            await refreshDashboard();

            setInterval(
                refreshDashboard,
                REFRESH_INTERVAL
            );

        } catch (error) {
            console.error(
                "Election initialization error:",
                error
            );

            if ($("statusText")) {
                $("statusText").textContent =
                    "NOT FOUND";
            }

            if ($("dynamicSidebarPositions")) {
                $("dynamicSidebarPositions").textContent =
                    error.message;
            }

            for (const id of [
                "startElectionBtn",
                "stopVotingBtn",
                "maskToggleBtn",
                "finishScanningBtn",
                "saveScheduleBtn"
            ]) {
                const button = $(id);

                if (button) {
                    button.disabled = true;
                }
            }

            updateElectionLifecycle();

            showElectionNotice(
                error.message,
                "error"
            );
        }
    }
);
