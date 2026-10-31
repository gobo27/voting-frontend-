
"use strict";

const DPI = 300;
const mmToPx = mm => Math.round(mm * DPI / 25.4);
const el = id => document.getElementById(id);

const state = {
    electionId: null,
    election: null,
    positions: [],
    layout: [],
    savedTemplateId: null,
    copies: 2,
    printBatchId: null,
    printing: false,
    saving: false,
    deleting: false,
    loadingTemplate: false,
    loadingTemplates: false,
    savedTemplates: [],
    selectedTemplateLabel: ""
};

const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
}[ch]));


function status(message, error = false, notify = true) {
    const element = el("status");

    // Huwag ipakita ang notification sa ilalim ng page.
    if (element) {
        element.textContent = "";
        element.style.display = "none";
    }

    // Floating toast notification.
    if (notify && typeof window.showToast === "function") {
        window.showToast(
            message,
            error ? "error" : "success",
            5000
        );
    } else if (notify) {
        console.warn("Toast unavailable:", message);
    }
}

function electionLocked() {
    const election = state.election;
    if (!election) return true;

    return (
        String(election.status || "").toLowerCase() === "completed" ||
        Number(election.is_active) === 1 ||
        Number(election.scanning_open) === 1 ||
        Boolean(election.archived_at)
    );
}

function canDeleteTemplates() {
    const election = state.election;
    if (!election || !state.electionId) return false;

    return (
        Number(election.is_current) === 1 &&
        !election.archived_at &&
        String(election.status || "").toLowerCase() !== "completed"
    );
}

function updateActionButtons() {
    const saveButton = el("saveButton");
    const generateButton = el("generatePrintButton");
    const reprintButton = el("reprintBatchButton");

    const busy = state.printing ||
        state.saving ||
        state.deleting ||
        state.loadingTemplate;

    if (saveButton) {
        saveButton.disabled = electionLocked() || busy;
    }

    if (generateButton) {
        generateButton.disabled = !state.savedTemplateId || busy;
    }

    if (reprintButton) {
        reprintButton.disabled = busy;
    }

    document.querySelectorAll(".saved-template-delete")
        .forEach(button => {
            button.disabled = busy;
        });
}

function setEditorLocked(locked) {
    for (const id of [
        "titleInput",
        "yearInput",
        "instructionsInput",
        "copiesInput"
    ]) {
        const element = el(id);
        if (element) element.disabled = locked;
    }

    const inputs = el("positionSettings")
        ?.querySelectorAll("input") || [];

    inputs.forEach(input => {
        input.disabled = locked;
    });

    updateActionButtons();
}

function templateText(template) {
    return `#${template.template_id} - ${template.template_name} (${template.paper_size})`;
}

function closeSavedDropdown() {
    const menu = el("savedTemplateMenu");
    const toggle = el("savedTemplateToggle");

    if (menu) menu.hidden = true;
    if (toggle) toggle.setAttribute("aria-expanded", "false");
}

function toggleSavedDropdown() {
    const menu = el("savedTemplateMenu");
    const toggle = el("savedTemplateToggle");

    if (!menu || !toggle) return;

    const shouldOpen = menu.hidden;
    menu.hidden = !shouldOpen;

    toggle.setAttribute(
        "aria-expanded",
        shouldOpen ? "true" : "false"
    );
}

function updateSelectedTemplateLabel() {
    const label = el("selectedTemplateLabel");
    if (!label) return;

    const template = state.savedTemplates.find(item =>
        Number(item.template_id) === Number(state.savedTemplateId)
    );

    label.textContent = template
        ? templateText(template)
        : "Select saved ballot";
}

function renderSavedTemplateMenu() {
    const menu = el("savedTemplateMenu");
    if (!menu) return;

    menu.replaceChildren();

    if (!state.savedTemplates.length) {
        const empty = document.createElement("div");
        empty.style.padding = "14px";
        empty.style.color = "#666";
        empty.textContent = "No saved ballot templates found.";
        menu.appendChild(empty);
        return;
    }

    for (const template of state.savedTemplates) {
        const templateId = Number(template.template_id);

        const row = document.createElement("div");
        row.className = "saved-template-row";

        const choose = document.createElement("button");
        choose.type = "button";
        choose.className = "saved-template-choice";
        choose.textContent = templateText(template);

        choose.addEventListener("click", async () => {
            closeSavedDropdown();
            await selectSavedTemplate(templateId);
        });

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "saved-template-delete";
        deleteButton.textContent = "Delete";
        deleteButton.title = `Delete ballot #${templateId}`;

        deleteButton.addEventListener("click", async event => {
            event.stopPropagation();
            closeSavedDropdown();
            await deleteSavedTemplate(templateId);
        });

        row.append(choose, deleteButton);
        menu.appendChild(row);
    }

    updateActionButtons();
}

// ============================================================
// BALLOT LAYOUT
// 1 = One A4 portrait ballot
// 2 = Two A5 portrait ballots on A4 landscape
// ============================================================

function layoutBallot() {
    const rows = [];
    const isA5 = state.copies === 2;

    let y = 35;

    const bottom = isA5 ? 195 : 283;
    const rowHeight = isA5 ? 6 : 7;
    const headingHeight = isA5 ? 6 : 8;
    const sectionGap = isA5 ? 1 : 3;

    for (const position of state.positions) {
        if (!position.candidates.length) continue;

        const headingY = y;
        y += headingHeight;

        for (const candidate of position.candidates) {
            if (y + rowHeight > bottom) {
                throw new Error(
                    "Too many candidates for this layout. Choose 1 ballot per A4."
                );
            }

            rows.push({
                candidate,
                position,
                x: isA5 ? 12 : 18,
                y
            });

            y += rowHeight;
        }

        y += sectionGap;
        position._headingY = headingY;
    }

    return rows;
}

// ============================================================
// REGISTRATION MARKS FOR OMR SCANNING
// ============================================================

function addRegistrationMarks(half) {
    const isA5 = state.copies === 2;

    const right = isA5 ? 137 : 199;
    const bottom = isA5 ? 199 : 287;

    const marks = [
        [8, 6],
        [right, 6],
        [8, bottom],
        [right, bottom]
    ];

    for (const [left, top] of marks) {
        const mark = document.createElement("span");
        mark.className = "registration-mark";
        mark.style.left = `${left}mm`;
        mark.style.top = `${top}mm`;
        half.appendChild(mark);
    }
}

// ============================================================
// TEMPLATE COORDINATE VALIDATION
// Prevent accidental conversion of older A5 landscape ballots.
// ============================================================

function detectSavedLayout(template, coordinates) {
    const paperSize = String(template.paper_size || "")
        .toUpperCase();

    if (!["A4", "A5"].includes(paperSize)) {
        throw new Error("Unsupported saved paper size.");
    }

    if (!Array.isArray(coordinates) || !coordinates.length) {
        throw new Error("Saved template has no OMR coordinates.");
    }

    if (paperSize === "A4") {
        return {
            copies: 1,
            legacy: false
        };
    }

    const oldX = mmToPx(18);
    const newX = mmToPx(12);

    const xValues = coordinates.map(coordinate =>
        Number(coordinate.x_pos)
    );

    if (xValues.every(x => x === oldX)) {
        return {
            copies: 2,
            legacy: true
        };
    }

    if (xValues.every(x => x === newX)) {
        return {
            copies: 2,
            legacy: false
        };
    }

    throw new Error(
        "Saved A5 template has an unknown OMR layout."
    );
}

function verifySavedCoordinates(coordinates, expectedLayout) {
    if (!Array.isArray(coordinates)) {
        throw new Error("Invalid saved OMR coordinates.");
    }

    if (coordinates.length !== expectedLayout.length) {
        throw new Error(
            "Saved template candidate count differs from current ballot."
        );
    }

    const savedByCandidate = new Map();

    for (const coordinate of coordinates) {
        const candidateId = Number(coordinate.candidate_id);

        if (
            !Number.isSafeInteger(candidateId) ||
            savedByCandidate.has(candidateId)
        ) {
            throw new Error(
                "Saved template contains duplicate or invalid candidates."
            );
        }

        savedByCandidate.set(candidateId, coordinate);
    }

    for (const row of expectedLayout) {
        const saved = savedByCandidate.get(
            Number(row.candidate.id)
        );

        if (
            !saved ||
            Number(saved.x_pos) !== mmToPx(row.x) ||
            Number(saved.y_pos) !== mmToPx(row.y)
        ) {
            throw new Error(
                "Saved OMR coordinates do not match the current layout."
            );
        }
    }
}

// ============================================================
// BALLOT PRINT AND PREVIEW CSS
// ============================================================

function installBallotLayoutStyles() {
    if (document.getElementById("ballot-layout-runtime-css")) {
        return;
    }

    const style = document.createElement("style");
    style.id = "ballot-layout-runtime-css";

    style.textContent = `
        #ballotPage.layout-a5 {
            width: 297mm;
            min-height: 210mm;
        }

        #ballotPage.layout-a4 {
            width: 210mm;
            min-height: 297mm;
        }

        #ballotPage.layout-a5:not(.batch-mode) {
            display: flex;
            flex-direction: row;
            flex-wrap: nowrap;
        }

        #ballotPage.layout-a4:not(.batch-mode) {
            display: block;
        }

        #ballotPage .ballot-half {
            box-sizing: border-box;
            position: relative;
            overflow: hidden;
        }

        #ballotPage.layout-a5 .ballot-half {
            width: 148.5mm;
            height: 210mm;
            min-width: 148.5mm;
            flex: 0 0 148.5mm;
            border-bottom: 0;
        }

        #ballotPage.layout-a5 .ballot-half:first-child {
            border-right: 0.25mm dashed #999;
        }

        #ballotPage.layout-a4 .ballot-half,
        #ballotPage .ballot-half.full {
            width: 210mm;
            height: 297mm;
            min-width: 210mm;
            flex: 0 0 210mm;
        }

        #ballotPage.layout-a5 .position-heading,
        #ballotPage.layout-a5 .candidate-line {
            left: 12mm;
            right: 5mm;
        }

        #ballotPage.layout-a5 .candidate-line {
            height: 6mm;
        }

        #ballotPage.layout-a5 .ballot-heading {
            left: 12mm;
            right: 36mm;
            top: 8mm;
        }

        #ballotPage.layout-a5 .ballot-heading h1 {
            font-size: 12px;
        }

        #ballotPage.layout-a5 .ballot-heading p {
            font-size: 9px;
        }

        #ballotPage.layout-a5 .ballot-qr {
            top: 8mm;
            right: 7mm;
            width: 23mm;
            height: 23mm;
        }

        #ballotPage.layout-a5 .position-heading {
            font-size: 10px;
        }

        #ballotPage.layout-a5 .candidate-line {
            font-size: 10px;
        }

        #ballotPage .print-sheet {
            display: flex;
            flex-direction: row;
            flex-wrap: nowrap;
            box-sizing: border-box;
            width: 297mm;
            height: 210mm;
            overflow: hidden;
            break-after: page;
            page-break-after: always;
        }

        #ballotPage .print-sheet.layout-a4 {
            display: block;
            width: 210mm;
            height: 297mm;
        }

        @media print {
            html, body {
                margin: 0 !important;
                padding: 0 !important;
            }

            #ballotPage.batch-mode {
                display: block !important;
            }

            #ballotPage.batch-mode .print-sheet {
                margin: 0 !important;
                padding: 0 !important;
                break-inside: avoid;
                page-break-inside: avoid;
            }

            #ballotPage.batch-mode .print-sheet:last-child {
                break-after: auto;
                page-break-after: auto;
            }
        }
    `;

    document.head.appendChild(style);
}

function setPrintPageOrientation() {
    let style = document.getElementById("ballot-print-page-css");

    if (!style) {
        style = document.createElement("style");
        style.id = "ballot-print-page-css";
        document.head.appendChild(style);
    }

    style.textContent = state.copies === 2
        ? "@media print { @page { size: A4 landscape; margin: 0; } }"
        : "@media print { @page { size: A4 portrait; margin: 0; } }";
}


/* ============================================================
   CREATE BALLOT
   ============================================================ */

function createHalf(ballot = null) {
    const half = document.createElement("section");

    half.className = "ballot-half" +
        (state.copies === 1 ? " full" : "");

    addRegistrationMarks(half);

    const title = el("titleInput").value.trim() ||
        "Official Election Ballot";

    const year = el("yearInput").value.trim();
    const instructions = el("instructionsInput").value.trim();

    const heading = document.createElement("div");
    heading.className = "ballot-heading";

    heading.innerHTML = `
        <h1>${esc(title)}</h1>
        <p>Academic Year: ${esc(year)}</p>
        <p>${esc(instructions)}</p>
        <p>Template ID: ${esc(state.savedTemplateId ?? "UNSAVED")}</p>
    `;

    half.appendChild(heading);

    // Each registered ballot receives its own QR code.
    if (ballot) {
        const qrBox = document.createElement("div");
        qrBox.className = "ballot-qr";

        const image = document.createElement("img");
        image.src = ballot.qr_code;
        image.alt = "Unique Ballot QR Code";

        const code = document.createElement("div");
        code.className = "ballot-qr-id";
        code.textContent = ballot.ballot_id;

        qrBox.append(image, code);
        half.appendChild(qrBox);
    }

    // Display all election positions and candidates.
    for (const position of state.positions) {
        if (!position.candidates.length) continue;

        const headingElement = document.createElement("div");
        headingElement.className = "position-heading";
        headingElement.style.top = `${position._headingY}mm`;

        headingElement.textContent =
            `${String(position.title).toUpperCase()} — ` +
            `Select up to ${position.max_selection}`;

        half.appendChild(headingElement);

        const candidates = state.layout.filter(
            row => row.position === position
        );

        for (const row of candidates) {
            const line = document.createElement("div");
            line.className = "candidate-line";
            line.style.top = `${row.y}mm`;

            line.innerHTML = `
                <span class="omr-bubble"></span>
                <span>${esc(row.candidate.name)}</span>
            `;

            half.appendChild(line);
        }
    }

    return half;
}


/* ============================================================
   BALLOT PREVIEW
   ============================================================ */

function render() {
    state.layout = layoutBallot();

    installBallotLayoutStyles();

    const page = el("ballotPage");
    const isA5 = state.copies === 2;

    page.classList.remove(
        "batch-mode",
        "layout-a4",
        "layout-a5"
    );

    page.classList.add(
        isA5 ? "layout-a5" : "layout-a4"
    );

    page.replaceChildren(
        ...Array.from(
            { length: state.copies },
            () => createHalf()
        )
    );

    el("loadedCandidates").textContent =
        state.positions.map(position =>
            `${String(position.title).toUpperCase()}: ` +
            `${position.candidates.length} candidate(s)`
        ).join(" | ") || "No candidates found";

    updateActionButtons();
}


/* ============================================================
   LOAD ELECTION DATA
   ============================================================ */

async function loadData() {
    try {
        status(
            "Loading positions and candidates...",
            false,
            false
        );

        const requestedId = new URLSearchParams(
            location.search
        ).get("election_id") || "current";

        const election = await BallotAPI.resolveElection(
            requestedId
        );

        const result = await BallotAPI.getPositions(
            election.election_id
        );

        const positions = Array.isArray(result)
            ? result
            : result.positions;

        if (!Array.isArray(positions)) {
            throw new Error(
                "Unexpected positions API response"
            );
        }

        state.election = election;
        state.electionId = Number(election.election_id);

        state.positions = positions.map(position => ({
            id: Number(position.position_id),
            title: position.title,
            max_selection: Number(
                position.max_selection || 1
            ),
            candidates: (
                position.candidates || []
            ).map(candidate => ({
                id: Number(candidate.candidate_id),
                name: candidate.name
            }))
        }));

        state.savedTemplateId = null;
        state.printBatchId = null;
        state.copies = Number(
            el("copiesInput").value
        );

        el("titleInput").value =
            election.title || "Official Election Ballot";

        renderPositionSettings();
        render();

        await loadSavedTemplates();
        await loadPrintBatches();

        setEditorLocked(electionLocked());

        status(
            `Loaded ${state.positions.length} positions ` +
            `and ${state.layout.length} candidates.`,
            false,
            false
        );

    } catch (error) {
        console.error("Load error:", error);
        status(error.message, true);
    }
}


/* ============================================================
   OMR COORDINATE PAYLOAD
   ============================================================ */

function coordinatePayload() {
    return state.layout.map(({
        candidate,
        x,
        y
    }) => ({
        candidate_id: candidate.id,
        bubble_code: `C${candidate.id}`,
        x_pos: mmToPx(x),
        y_pos: mmToPx(y),
        width: mmToPx(5),
        height: mmToPx(5)
    }));
}


/* ============================================================
   INVALIDATE SAVED TEMPLATE AFTER CHANGES
   ============================================================ */

function invalidateAndRender() {
    state.savedTemplateId = null;
    state.printBatchId = null;

    updateSelectedTemplateLabel();

    try {
        render();

        status(
            "Layout changed. Save a new template " +
            "before generating ballots.",
            false,
            false
        );

    } catch (error) {
        status(error.message, true);
    }
}


/* ============================================================
   POSITION SETTINGS
   ============================================================ */

function renderPositionSettings() {
    const container = el("positionSettings");
    container.replaceChildren();

    for (const position of state.positions) {
        if (!position.candidates.length) continue;

        const label = document.createElement("label");

        label.textContent =
            `${position.title} ` +
            `(${position.candidates.length} candidates)`;

        const input = document.createElement("input");
        input.type = "number";
        input.min = "1";
        input.max = String(
            position.candidates.length
        );
        input.value = String(
            position.max_selection
        );

        input.disabled = electionLocked();

        input.addEventListener("change", () => {
            if (electionLocked()) {
                input.value = String(
                    position.max_selection
                );

                return status(
                    "Position limits are locked " +
                    "during the election.",
                    true
                );
            }

            const value = Number(input.value);

            if (
                !Number.isSafeInteger(value) ||
                value < 1 ||
                value > position.candidates.length
            ) {
                input.value = String(
                    position.max_selection
                );

                return status(
                    `Choose 1 to ` +
                    `${position.candidates.length} ` +
                    `for ${position.title}.`,
                    true
                );
            }

            position.max_selection = value;
            invalidateAndRender();
        });

        container.append(label, input);
    }
}


/* ============================================================
   SAVE POSITION LIMITS
   ============================================================ */

async function savePositionLimits() {
    for (const position of state.positions) {
        if (!position.candidates.length) continue;

        await BallotAPI.updatePosition(
            position.id,
            {
                max_selection: position.max_selection
            }
        );
    }
}


/* ============================================================
   SAVE BALLOT TEMPLATE
   ============================================================ */

async function saveBallot() {
    if (
        state.saving ||
        state.printing ||
        state.deleting
    ) {
        return;
    }

    if (electionLocked()) {
        return status(
            "Cannot save a new ballot while " +
            "voting/scanning is active or the " +
            "election is completed.",
            true
        );
    }

    if (state.savedTemplateId) {
        return status(
            `Ballot template #${state.savedTemplateId} ` +
            `is already saved.`,
            true
        );
    }

    state.saving = true;
    updateActionButtons();

    try {
        if (!state.electionId) {
            throw new Error(
                "Election has not loaded."
            );
        }

        // Recalculate before saving to ensure that
        // coordinates match the current print layout.
        state.layout = layoutBallot();

        if (!state.layout.length) {
            throw new Error(
                "No candidates to save."
            );
        }

        const title = el("titleInput").value.trim();

        if (!title) {
            throw new Error(
                "Ballot title is required."
            );
        }

        await savePositionLimits();

        const result =
            await BallotAPI.saveCompleteTemplate({
                election_id: state.electionId,
                template_name: title,
                paper_size:
                    state.copies === 2 ? "A5" : "A4",
                coordinates: coordinatePayload()
            });

        const templateId = Number(
            result.template?.template_id
        );

        if (
            !Number.isSafeInteger(templateId) ||
            templateId < 1
        ) {
            throw new Error(
                "Backend did not return " +
                "a valid template ID."
            );
        }

        state.savedTemplateId = templateId;

        render();

        await loadSavedTemplates();
        updateSelectedTemplateLabel();

        status(
            result.duplicate
                ? `Identical ballot already exists ` +
                `as template #${templateId}.`
                : `Ballot template #${templateId} ` +
                `saved successfully!`
        );

    } catch (error) {
        console.error("Save error:", error);

        status(
            `Save failed: ${error.message}`,
            true
        );

    } finally {
        state.saving = false;
        updateActionButtons();
    }
}


/* ============================================================
   PRINT REGISTERED QR BALLOTS
   ============================================================ */

async function printRegisteredBallots(ballots) {
    if (
        !Array.isArray(ballots) ||
        !ballots.length
    ) {
        throw new Error(
            "No registered ballots to print."
        );
    }

    installBallotLayoutStyles();
    setPrintPageOrientation();

    const page = el("ballotPage");
    const isA5 = state.copies === 2;

    page.replaceChildren();

    page.classList.remove(
        "layout-a4",
        "layout-a5"
    );

    page.classList.add(
        "batch-mode",
        isA5 ? "layout-a5" : "layout-a4"
    );

    // A4 portrait: one ballot per sheet.
    // A4 landscape: two A5 portrait ballots per sheet.
    for (
        let i = 0;
        i < ballots.length;
        i += state.copies
    ) {
        const sheet = document.createElement("div");

        sheet.className =
            "print-sheet" +
            (isA5 ? "" : " layout-a4");

        for (
            let j = 0;
            j < state.copies;
            j++
        ) {
            const ballot = ballots[i + j];

            if (!ballot) break;

            sheet.appendChild(
                createHalf(ballot)
            );
        }

        page.appendChild(sheet);
    }

    // Wait for QR images to finish loading
    // before opening the print dialog.
    const images = [
        ...page.querySelectorAll(
            ".ballot-qr img"
        )
    ];

    await Promise.all(
        images.map(async image => {
            if (
                typeof image.decode === "function"
            ) {
                await image.decode();
            } else {
                await new Promise(
                    (resolve, reject) => {
                        if (
                            image.complete &&
                            image.naturalWidth > 0
                        ) {
                            resolve();
                            return;
                        }

                        image.onload = resolve;
                        image.onerror = reject;
                    }
                );
            }
        })
    );

    window.print();
}


/* ============================================================
   CONFIRM PHYSICAL PRINTING
   ============================================================ */

async function confirmPrintedBatch(
    batchId,
    printType,
    quantity
) {
    const ballotSize =
        state.copies === 2 ? "A5" : "A4";

    const confirmed = window.confirm(
        `Did the printer successfully produce all ` +
        `${quantity} individual ${ballotSize} ballots ` +
        `for batch #${batchId}?\n\n` +
        "Choose OK only after checking the printed pages.\n" +
        "Choose Cancel if printing failed, was cancelled, or was incomplete."
    );

    if (!confirmed) {
        status(
            "Printing was not confirmed. " +
            "No physical print quantity was recorded.",
            true
        );

        return false;
    }

    const eventId = crypto.randomUUID();

    await BallotAPI.confirmPrint(
        batchId,
        printType,
        quantity,
        eventId
    );

    status(
        `${quantity} physical ${ballotSize} ballots ` +
        `confirmed (${printType.toLowerCase()}).`
    );

    return true;
}


/* ============================================================
   GENERATE AND PRINT REGISTERED QR BALLOTS
   ============================================================ */

async function generateAndPrintBallots() {
    if (
        state.printing ||
        state.saving ||
        state.deleting ||
        state.loadingTemplate
    ) {
        return;
    }

    if (!state.electionId || !state.savedTemplateId) {
        return status(
            "Select a saved ballot template first.",
            true
        );
    }

    const quantity = Number(
        el("ballotQuantity").value
    );

    if (
        !Number.isSafeInteger(quantity) ||
        quantity < 1 ||
        quantity > 500
    ) {
        return status(
            "Enter 1 to 500 ballots.",
            true
        );
    }

    state.printing = true;
    updateActionButtons();

    try {
        status(
            "Verifying saved ballot template...",
            false,
            false
        );

        // Verify that the saved template matches
        // the currently selected printing layout.
        const saved = await BallotAPI.getTemplate(
            state.savedTemplateId
        );

        const template = saved.template || saved;

        const coordinates =
            saved.coordinates ||
            template.coordinates ||
            saved.grid_coordinates ||
            template.grid_coordinates;

        if (
            Number(template.election_id) !==
            state.electionId
        ) {
            throw new Error(
                "Selected template belongs to another election."
            );
        }

        const format = detectSavedLayout(
            template,
            coordinates
        );

        if (format.legacy) {
            throw new Error(
                "This is an old A5 landscape template. " +
                "Use the previous ballot creator to print it. " +
                "A new A5 portrait layout requires a new template."
            );
        }

        if (format.copies !== state.copies) {
            throw new Error(
                "Saved template paper size differs from " +
                "the selected printing layout."
            );
        }

        state.layout = layoutBallot();

        verifySavedCoordinates(
            coordinates,
            state.layout
        );

        status(
            "Generating registered QR ballots...",
            false,
            false
        );

        const result =
            await BallotAPI.generateQRBatch({
                election_id: state.electionId,
                template_id: state.savedTemplateId,
                quantity
            });

        const batchId = Number(result.batch_id);

        if (
            !Number.isSafeInteger(batchId) ||
            batchId < 1
        ) {
            throw new Error(
                "Backend did not return a valid Batch ID."
            );
        }

        if (
            !Array.isArray(result.ballots) ||
            result.ballots.length !== quantity
        ) {
            throw new Error(
                "Backend did not return the expected " +
                "number of registered QR ballots."
            );
        }

        state.printBatchId = batchId;

        const reprintInput = el("reprintBatchId");
        if (reprintInput) {
            reprintInput.value = String(batchId);
        }

        await loadPrintBatches();

        const batchSelect = el(
            "reprintBatchSelect"
        );

        if (batchSelect) {
            batchSelect.value = String(batchId);
            updateSelectedBatchInfo();
        }

        await printRegisteredBallots(
            result.ballots
        );

        const recorded =
            await confirmPrintedBatch(
                batchId,
                "ORIGINAL",
                result.ballots.length
            );

        if (recorded) {
            status(
                `${result.quantity ?? quantity} ` +
                `unique ballots generated. ` +
                `Batch ID: ${batchId}`
            );
        }

    } catch (error) {
        console.error(
            "Generate error:",
            error
        );

        status(
            `Print failed: ${error.message}`,
            true
        );

    } finally {
        state.printing = false;
        updateActionButtons();
    }
}


async function reprintRegisteredBatch() {
    if (
        state.printing ||
        state.saving ||
        state.deleting ||
        state.loadingTemplate
    ) {
        return;
    }

    const batchId = Number(
        el("reprintBatchId")?.value
    );

    if (
        !Number.isSafeInteger(batchId) ||
        batchId < 1
    ) {
        return status(
            "Please select a valid Batch ID.",
            true
        );
    }

    state.printing = true;
    updateActionButtons();

    const previous = {
        copies: state.copies,
        savedTemplateId: state.savedTemplateId,
        printBatchId: state.printBatchId,
        title: el("titleInput").value,
        layout: state.layout
    };

    let prepared = false;

    try {
        status(
            `Loading existing Batch #${batchId}...`,
            false,
            false
        );

        const result =
            await BallotAPI.getQRBatch(
                batchId
            );

        const ballots = result.ballots;

        if (
            !Array.isArray(ballots) ||
            !ballots.length
        ) {
            throw new Error(
                "No registered ballots found in this batch."
            );
        }

        const templateId = Number(
            ballots[0].template_id
        );

        const electionId = Number(
            ballots[0].election_id
        );

        if (
            !Number.isSafeInteger(templateId) ||
            templateId < 1 ||
            !Number.isSafeInteger(electionId) ||
            electionId < 1
        ) {
            throw new Error(
                "Batch is missing its template " +
                "or election information."
            );
        }

        if (
            ballots.some(ballot =>
                Number(ballot.template_id) !==
                templateId ||
                Number(ballot.election_id) !==
                electionId
            )
        ) {
            throw new Error(
                "Batch contains mismatched " +
                "templates or elections."
            );
        }

        if (electionId !== state.electionId) {
            throw new Error(
                "This batch belongs to another election."
            );
        }

        const saved =
            await BallotAPI.getTemplate(
                templateId
            );

        const template =
            saved.template || saved;

        if (
            Number(template.template_id) !==
            templateId ||
            Number(template.election_id) !==
            electionId
        ) {
            throw new Error(
                "Saved template could not be verified."
            );
        }

        const coordinates =
            saved.coordinates ||
            template.coordinates ||
            saved.grid_coordinates ||
            template.grid_coordinates;

        const format = detectSavedLayout(
            template,
            coordinates
        );

        // Old A5 landscape ballots must keep their
        // original OMR coordinates and orientation.
        if (format.legacy) {
            throw new Error(
                "This batch uses the old A5 landscape " +
                "layout. Reprint it using the previous " +
                "ballot creator to preserve OMR coordinates."
            );
        }

        state.copies = format.copies;

        const expectedLayout = layoutBallot();

        verifySavedCoordinates(
            coordinates,
            expectedLayout
        );

        state.savedTemplateId = templateId;
        state.printBatchId = batchId;
        state.layout = expectedLayout;

        el("copiesInput").value =
            String(format.copies);

        if (template.template_name) {
            el("titleInput").value =
                template.template_name;
        }

        updateSelectedTemplateLabel();

        prepared = true;

        await printRegisteredBallots(
            ballots
        );

        const recorded =
            await confirmPrintedBatch(
                batchId,
                "REPRINT",
                ballots.length
            );

        if (recorded) {
            status(
                `Batch #${batchId} reprinted successfully. ` +
                "Existing QR codes reused; " +
                "no new ballots created."
            );
        }

    } catch (error) {
        console.error(
            "Reprint error:",
            error
        );

        status(
            `Reprint failed: ${error.message}`,
            true
        );

    } finally {
        if (!prepared) {
            state.copies = previous.copies;

            state.savedTemplateId =
                previous.savedTemplateId;

            state.printBatchId =
                previous.printBatchId;

            state.layout =
                previous.layout;

            el("copiesInput").value =
                String(previous.copies);

            el("titleInput").value =
                previous.title;

            updateSelectedTemplateLabel();
        }

        state.printing = false;
        updateActionButtons();

        try {
            render();
        } catch (error) {
            console.error(
                "Reprint preview error:",
                error
            );
        }
    }
}


/* ============================================================
   LOAD SAVED BALLOT TEMPLATES
   ============================================================ */

async function loadSavedTemplates() {
    if (
        state.loadingTemplates ||
        !state.electionId
    ) {
        return;
    }

    state.loadingTemplates = true;

    const menu = el(
        "savedTemplateMenu"
    );

    if (menu) {
        menu.replaceChildren();

        const loading =
            document.createElement("div");

        loading.textContent =
            "Loading saved ballots...";

        loading.style.padding = "12px";

        menu.appendChild(loading);
    }

    try {
        const result =
            await BallotAPI.getTemplates(
                state.electionId
            );

        state.savedTemplates =
            Array.isArray(result.templates)
                ? result.templates
                : [];

        renderSavedTemplateMenu();
        updateSelectedTemplateLabel();

    } catch (error) {
        console.error(
            "Saved templates error:",
            error
        );

        status(
            `Unable to load saved ballots: ` +
            error.message,
            true
        );

    } finally {
        state.loadingTemplates = false;
        updateActionButtons();
    }
}


/* ============================================================
   SELECT SAVED BALLOT TEMPLATE
   ============================================================ */

async function selectSavedTemplate(templateId) {
    if (
        state.loadingTemplate ||
        state.printing ||
        state.deleting ||
        state.saving
    ) {
        return;
    }

    templateId = Number(templateId);

    if (
        !Number.isSafeInteger(templateId) ||
        templateId < 1
    ) {
        return;
    }

    state.loadingTemplate = true;
    updateActionButtons();

    const previousCopies = state.copies;

    try {
        const result =
            await BallotAPI.getTemplate(
                templateId
            );

        const template = result.template;
        const coordinates = result.coordinates;

        if (
            !template ||
            !Array.isArray(coordinates)
        ) {
            throw new Error(
                "Invalid saved template response."
            );
        }

        if (
            Number(template.election_id) !==
            state.electionId
        ) {
            throw new Error(
                "Selected ballot belongs to another election."
            );
        }

        if (!coordinates.length) {
            throw new Error(
                "Saved template has no OMR coordinates."
            );
        }

        const savedIds = new Set(
            coordinates.map(
                coordinate =>
                    Number(coordinate.candidate_id)
            )
        );

        const currentIds = new Set(
            state.positions.flatMap(position =>
                position.candidates.map(
                    candidate =>
                        Number(candidate.id)
                )
            )
        );

        if (
            savedIds.size !== currentIds.size ||
            [...savedIds].some(
                id => !currentIds.has(id)
            )
        ) {
            throw new Error(
                "Saved ballot candidates do not " +
                "match the current election."
            );
        }

        const format = detectSavedLayout(
            template,
            coordinates
        );

        if (format.legacy) {
            throw new Error(
                "This is an old A5 landscape ballot. " +
                "Open it using the previous version. " +
                "Converting it would invalidate " +
                "saved OMR coordinates."
            );
        }

        const copies = format.copies;

        state.copies = copies;

        const expectedLayout =
            layoutBallot();

        verifySavedCoordinates(
            coordinates,
            expectedLayout
        );

        state.savedTemplateId =
            templateId;

        state.printBatchId = null;

        el("copiesInput").value =
            String(copies);

        if (template.template_name) {
            el("titleInput").value =
                template.template_name;
        }

        render();
        updateSelectedTemplateLabel();

        status(
            `Saved ballot #${templateId} ` +
            `loaded successfully.`
        );

    } catch (error) {
        console.error(
            "Load template error:",
            error
        );

        state.copies = previousCopies;

        el("copiesInput").value =
            String(previousCopies);

        state.savedTemplateId = null;

        updateSelectedTemplateLabel();

        try {
            render();
        } catch (_) {
            // Keep the error message from the
            // original template loading failure.
        }

        status(
            "Unable to load saved ballot: " +
            error.message,
            true
        );

    } finally {
        state.loadingTemplate = false;
        updateActionButtons();
    }
}


/* ============================================================
   DELETE SAVED BALLOT TEMPLATE
   ============================================================ */

function confirmSavedBallotDeletion(template) {
    return new Promise(resolve => {
        const backdrop = document.createElement("div");
        backdrop.style.cssText =
            "position:fixed;inset:0;z-index:2147483646;" +
            "background:rgba(0,0,0,.52);display:flex;" +
            "align-items:center;justify-content:center;padding:16px";

        const dialog = document.createElement("div");
        dialog.setAttribute("role", "alertdialog");
        dialog.setAttribute("aria-modal", "true");
        dialog.setAttribute("aria-label", "Delete Saved Ballot");
        dialog.style.cssText =
            "width:min(440px,100%);background:white;color:#222;" +
            "border-radius:14px;padding:24px;" +
            "box-shadow:0 15px 45px rgba(0,0,0,.25);font-family:inherit";

        const title = document.createElement("h3");
        title.textContent = "Delete Saved Ballot?";
        title.style.cssText = "margin:0 0 12px;font-size:20px";

        const description = document.createElement("p");
        description.textContent =
            `Are you sure you want to delete ballot #${template.template_id} ` +
            `(${template.template_name})? This action cannot be undone.`;
        description.style.cssText =
            "margin:0 0 22px;line-height:1.5";

        const actions = document.createElement("div");
        actions.style.cssText =
            "display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap";

        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.textContent = "Cancel";
        cancel.style.cssText =
            "padding:10px 18px;border:1px solid #ddd;" +
            "border-radius:8px;background:#f5f5f5;" +
            "color:#222;cursor:pointer";

        const confirm = document.createElement("button");
        confirm.type = "button";
        confirm.textContent = "Delete Ballot";
        confirm.style.cssText =
            "padding:10px 18px;border:0;border-radius:8px;" +
            "background:#b91c1c;color:white;cursor:pointer";

        const previousFocus = document.activeElement;
        let finished = false;

        const finish = answer => {
            if (finished) return;
            finished = true;
            document.removeEventListener("keydown", onKeydown, true);
            backdrop.remove();
            if (previousFocus?.isConnected) previousFocus.focus();
            resolve(answer);
        };

        const onKeydown = event => {
            if (event.key === "Escape") {
                event.preventDefault();
                finish(false);
            }

            if (event.key === "Tab") {
                event.preventDefault();
                (document.activeElement === cancel ? confirm : cancel).focus();
            }
        };

        cancel.addEventListener("click", () => finish(false));
        confirm.addEventListener("click", () => finish(true));

        backdrop.addEventListener("click", event => {
            if (event.target === backdrop) finish(false);
        });

        actions.append(cancel, confirm);
        dialog.append(title, description, actions);
        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);
        document.addEventListener("keydown", onKeydown, true);
        cancel.focus();
    });
}

async function deleteSavedTemplate(templateId) {
    if (
        state.deleting ||
        state.printing ||
        state.saving ||
        state.loadingTemplate
    ) {
        status(
            "Please wait until the current ballot operation is complete.",
            true
        );
        return;
    }

    templateId = Number(templateId);

    if (!Number.isSafeInteger(templateId) || templateId < 1) {
        status("Invalid saved ballot ID.", true);
        return;
    }

    const template = state.savedTemplates.find(
        item => Number(item.template_id) === templateId
    );

    if (!template) {
        status("Saved ballot template not found. Refresh the list.", true);
        return;
    }

    if (!canDeleteTemplates()) {
        status(
            "This ballot cannot be deleted because the election is archived, completed, or is not the current election.",
            true
        );
        return;
    }


    if (
        registeredPrintBatches.some(
            batch => Number(batch.template_id) === templateId
        )
    ) {
        const message =
            `Can't delete Ballot #${templateId} because this ballot ` +
            "is currently being used and has registered QR ballots.";

        status(message, true);

        if (typeof window.showToast !== "function") {
            alert(message);
        }

        return;
    }

    try {
        // Kunin ang latest registered QR batches sa database.
        const batchResult = await BallotAPI.getQRBatches(
            state.electionId
        );

        const batches = Array.isArray(batchResult.batches)
            ? batchResult.batches
            : [];

        registeredPrintBatches = batches;

        const isBallotInUse = batches.some(
            batch => Number(batch.template_id) === templateId
        );

        if (isBallotInUse) {
            const message =
                `Can't delete Ballot #${templateId}. ` +
                "This ballot is currently being used for registered QR ballots.";

            status(message, true);
            return;
        }

    } catch (error) {
        console.error("Ballot usage check failed:", error);

        status(
            "Unable to verify whether this ballot is in use. Deletion cancelled.",
            true
        );
        return;
    }

    const confirmed = await confirmSavedBallotDeletion(template);

    if (!confirmed) return;

    state.deleting = true;
    updateActionButtons();

    try {
        const result = await BallotAPI.deleteTemplate(templateId);

        if (Number(state.savedTemplateId) === templateId) {
            state.savedTemplateId = null;
            state.printBatchId = null;
        }

        await loadSavedTemplates();
        updateSelectedTemplateLabel();
        render();

        status(
            result?.message ||
            `Ballot #${templateId} has been deleted successfully.`
        );

    } catch (error) {
        console.error("Delete template error:", error);

        status(
            `Unable to delete the ballot: ${error.message}`,
            true
        );

    } finally {
        state.deleting = false;
        updateActionButtons();
    }
}

/* ============================================================
   REGISTERED PRINT BATCHES
   ============================================================ */

let registeredPrintBatches = [];
let loadingPrintBatches = false;


/* ============================================================
   LOAD PRINT BATCHES
   ============================================================ */

async function loadPrintBatches() {
    const select = el(
        "reprintBatchSelect"
    );

    if (
        !select ||
        !state.electionId ||
        loadingPrintBatches
    ) {
        return;
    }

    loadingPrintBatches = true;

    const previousValue = select.value;

    select.replaceChildren(
        new Option(
            "Loading existing batches...",
            ""
        )
    );

    select.disabled = true;

    try {
        const result =
            await BallotAPI.getQRBatches(
                state.electionId
            );

        registeredPrintBatches =
            Array.isArray(result.batches)
                ? result.batches
                : [];

        select.replaceChildren(
            new Option(
                "Select QR print batch",
                ""
            )
        );

        for (
            const batch of
            registeredPrintBatches
        ) {
            const date = batch.created_at
                ? new Date(
                    batch.created_at
                ).toLocaleString()
                : "Date unavailable";

            const label =
                `Batch #${batch.batch_id} | ` +
                `${batch.quantity} ballots | ` +
                `Template #${batch.template_id} - ` +
                `${batch.template_name} | ${date}`;

            select.add(
                new Option(
                    label,
                    String(batch.batch_id)
                )
            );
        }

        if (
            previousValue &&
            registeredPrintBatches.some(
                batch =>
                    String(batch.batch_id) ===
                    previousValue
            )
        ) {
            select.value = previousValue;
        } else {
            select.value = "";
        }

        if (
            !registeredPrintBatches.length
        ) {
            select.replaceChildren(
                new Option(
                    "No registered QR batches yet",
                    ""
                )
            );
        }

        updateSelectedBatchInfo();

    } catch (error) {
        console.error(
            "Load print batches error:",
            error
        );

        select.replaceChildren(
            new Option(
                "Unable to load QR batches",
                ""
            )
        );

        status(
            "Failed to load print batches: " +
            error.message,
            true
        );

    } finally {
        select.disabled = false;
        loadingPrintBatches = false;
    }
}


/* ============================================================
   SELECTED BATCH INFORMATION
   ============================================================ */

function updateSelectedBatchInfo() {
    const select = el(
        "reprintBatchSelect"
    );

    const info = el(
        "batchInfo"
    );

    const hiddenInput = el(
        "reprintBatchId"
    );

    if (
        !select ||
        !info ||
        !hiddenInput
    ) {
        return;
    }

    const batchId = Number(
        select.value
    );

    const batch =
        registeredPrintBatches.find(
            item =>
                Number(item.batch_id) ===
                batchId
        );

    if (!batch) {
        hiddenInput.value = "";

        info.textContent =
            "Select a batch to see its details.";

        return;
    }

    hiddenInput.value =
        String(batch.batch_id);

    info.textContent =
        `Batch #${batch.batch_id} | ` +
        `${batch.registered_count} registered ballots | ` +
        `Template #${batch.template_id} - ` +
        `${batch.template_name} ` +
        `(${batch.paper_size})`;
}


/* ============================================================
   REPRINT SELECTED BATCH
   ============================================================ */

async function reprintSelectedBatch() {
    const select = el(
        "reprintBatchSelect"
    );

    if (!select) {
        return status(
            "Reprint batch dropdown not found.",
            true
        );
    }

    const batchId = Number(
        select.value
    );

    if (
        !Number.isSafeInteger(batchId) ||
        batchId <= 0
    ) {
        return status(
            "Please select a QR print batch first.",
            true
        );
    }

    const batch =
        registeredPrintBatches.find(
            item =>
                Number(item.batch_id) ===
                batchId
        );

    if (!batch) {
        return status(
            "Selected batch is not available. " +
            "Refresh the list.",
            true
        );
    }

    if (
        Number(batch.election_id) !==
        state.electionId
    ) {
        return status(
            "This batch belongs to another election.",
            true
        );
    }

    el("reprintBatchId").value =
        String(batchId);

    await reprintRegisteredBatch();
}


/* ============================================================
   DOM CONTENT LOADED
   ============================================================ */

document.addEventListener(
    "DOMContentLoaded",
    () => {
        const toggle = el(
            "savedTemplateToggle"
        );

        if (toggle) {
            toggle.addEventListener(
                "click",
                toggleSavedDropdown
            );
        }

        document.addEventListener(
            "click",
            event => {
                const dropdown = el(
                    "savedDropdown"
                );

                if (
                    dropdown &&
                    !dropdown.contains(
                        event.target
                    )
                ) {
                    closeSavedDropdown();
                }
            }
        );

        document.addEventListener(
            "keydown",
            event => {
                if (
                    event.key === "Escape"
                ) {
                    closeSavedDropdown();
                }
            }
        );

        const refreshButton = el(
            "refreshTemplatesButton"
        );

        if (refreshButton) {
            refreshButton.addEventListener(
                "click",
                loadSavedTemplates
            );
        }

        // Reload positions and candidates.
        el("reloadButton").addEventListener(
            "click",
            loadData
        );

        // Change A4 / A5 printing layout.
        el("copiesInput").addEventListener(
            "change",
            () => {
                if (electionLocked()) {
                    return;
                }

                state.copies = Number(
                    el("copiesInput").value
                );

                invalidateAndRender();
            }
        );

        // Save ballot template.
        el("saveButton").addEventListener(
            "click",
            saveBallot
        );

        // Generate unique QR ballots.
        el("generatePrintButton")
            .addEventListener(
                "click",
                generateAndPrintBallots
            );

        // Reprint existing QR batch.
        el("reprintBatchButton")
            .addEventListener(
                "click",
                reprintSelectedBatch
            );

        // Select batch.
        el("reprintBatchSelect")
            .addEventListener(
                "change",
                updateSelectedBatchInfo
            );

        // Refresh batch history.
        el("refreshBatchesButton")
            .addEventListener(
                "click",
                loadPrintBatches
            );

        // Invalidate template when
        // ballot details are edited.
        for (const id of [
            "titleInput",
            "yearInput",
            "instructionsInput"
        ]) {
            el(id).addEventListener(
                "input",
                () => {
                    if (electionLocked()) {
                        return;
                    }

                    if (
                        state.savedTemplateId
                    ) {
                        state.savedTemplateId =
                            null;

                        state.printBatchId =
                            null;

                        updateSelectedTemplateLabel();
                    }

                    try {
                        render();
                    } catch (error) {
                        status(
                            error.message,
                            true
                        );
                    }
                }
            );
        }

        // Restore ballot preview after printing.
        window.addEventListener(
            "afterprint",
            () => {
                try {
                    render();
                } catch (error) {
                    console.error(
                        "Preview restore error:",
                        error
                    );
                }
            }
        );

        // Initial load.
        loadData();
    }
);
