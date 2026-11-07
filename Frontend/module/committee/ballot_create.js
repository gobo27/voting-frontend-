
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
    const additionalButton = el("generateAdditionalButton");

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

    if (additionalButton) {
        additionalButton.disabled = !state.savedTemplateId || busy;
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

// Ballot layout: A4 portrait or 2 A5 portrait.
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

// Registration marks para sa OMR scanner.
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

// Verify saved OMR coordinates bago mag-print.
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
            Number(saved.y_pos) !== mmToPx(row.y) ||
            Number(saved.width) !== mmToPx(5) ||
            Number(saved.height) !== mmToPx(5)

        ) {
            throw new Error(
                "Saved OMR coordinates do not match the current layout."
            );
        }
    }
}

// Runtime CSS para sa ballot preview at printing.
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



// CREATE BALLOT

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



// BALLOT PREVIEW

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



// LOAD ELECTION DATA

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



// OMR COORDINATE PAYLOAD

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



// INVALIDATE SAVED TEMPLATE AFTER CHANGES

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



// POSITION SETTINGS

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

// SAVE POSITION LIMITS

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

// SAVE BALLOT TEMPLATE

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

// PRINT REGISTERED QR BALLOTS

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

// CONFIRM PHYSICAL PRINTING

async function confirmPrintedBatch(
    batchId,
    printType,
    quantity
) {
    const ballotSize =
        state.copies === 2 ? "A5" : "A4";

    const confirmed = await window.showConfirmToast(
        `Did the printer successfully produce all ${quantity} ` +
        `individual ${ballotSize} ballots for batch #${batchId}?\n\n` +
        `Choose Confirm Printed only after checking the printed pages.`,
        {
            title: "Confirm Ballot Printing",
            confirmText: "Confirm Printed",
            cancelText: "Cancel"
        }
    );

    if (!confirmed) {
        return;
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

// GENERATE AND PRINT REGISTERED QR BALLOTS

async function generateAndPrintBallots(batchType = "ORIGINAL") {
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
        el(batchType === "ADDITIONAL" ? "additionalQuantity" : "ballotQuantity").value
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

        // Verify saved template bago mag-generate.
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

        // Same request ID ang gagamitin kapag nag-retry.
        const pendingKey = batchType === "ADDITIONAL"
            ? "campusvote_pending_additional_qr_batch"
            : "campusvote_pending_qr_batch";

        const details = {
            election_id: state.electionId,
            template_id: state.savedTemplateId,
            quantity,
            batch_type: batchType
        };

        let pending = null;

        try {
            pending = JSON.parse(
                sessionStorage.getItem(pendingKey) || "null"
            );
        } catch (_) {
            pending = null;
        }

        // Bagong request ID kapag walang matching pending request.
        if (
            !pending ||
            Number(pending.election_id) !== Number(details.election_id) ||
            Number(pending.template_id) !== Number(details.template_id) ||
            Number(pending.quantity) !== Number(details.quantity) ||
            pending.batch_type !== details.batch_type ||
            !pending.request_id
        ) {
            pending = {
                ...details,
                request_id: crypto.randomUUID()
            };

            sessionStorage.setItem(
                pendingKey,
                JSON.stringify(pending)
            );
        }

        // Backend ang magche-check ng existing request ID.
        const result = await BallotAPI.generateQRBatch(pending);

        const batchId = Number(result?.batch_id);

        if (!Number.isSafeInteger(batchId) || batchId < 1) {
            throw new Error("Backend did not return a valid Batch ID.");
        }

        sessionStorage.setItem(
            pendingKey,
            JSON.stringify({
                ...pending,
                batch_id: Number(result.batch_id),
                status: "GENERATED"
            })
        );

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

        // Isang print call lang para sa registered QR ballots
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
            // Confirmed na ang printing; puwede nang gumawa ng bagong batch.
            sessionStorage.removeItem(pendingKey);

            await loadPrintingSummary();

            status(
                `${result.quantity ?? quantity} ` +
                `${batchType === "ADDITIONAL" ? "additional " : ""}unique ballots generated. ` +
                `Batch ID: ${batchId}`
            );
        } else {
            // Panatilihin ang request ID kapag hindi confirmed ang printing.
            status(
                `Batch #${batchId} is registered but printing is not confirmed. ` +
                `Use the same quantity and template to retry this batch.`,
                true
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


// LOAD SAVED BALLOT TEMPLATES

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

// SELECT SAVED BALLOT TEMPLATE

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
            // Keep the original template loading error.

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

// DELETE SAVED BALLOT TEMPLATE

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
                (
                    document.activeElement === cancel
                        ? confirm
                        : cancel
                ).focus();
            }
        };

        cancel.addEventListener(
            "click",
            () => finish(false)
        );

        confirm.addEventListener(
            "click",
            () => finish(true)
        );

        backdrop.addEventListener("click", event => {
            if (event.target === backdrop) {
                finish(false);
            }
        });

        actions.append(cancel, confirm);
        dialog.append(title, description, actions);
        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);
        document.addEventListener(
            "keydown",
            onKeydown,
            true
        );

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

    if (
        !Number.isSafeInteger(templateId) ||
        templateId < 1
    ) {
        status("Invalid saved ballot ID.", true);
        return;
    }

    const template = state.savedTemplates.find(
        item => Number(item.template_id) === templateId
    );

    if (!template) {
        status(
            "Saved ballot template not found. Refresh the list.",
            true
        );
        return;
    }

    if (!canDeleteTemplates()) {
        status(
            "This ballot cannot be deleted because the election is archived, completed, or is not the current election.",
            true
        );
        return;
    }

    try {
        // Kunin ang latest registered batches sa database.
        const batchResult = await BallotAPI.getQRBatches(
            state.electionId
        );

        const batches = Array.isArray(batchResult.batches)
            ? batchResult.batches
            : [];

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
        console.error(
            "Ballot usage check failed:",
            error
        );

        status(
            "Unable to verify whether this ballot is in use. Deletion cancelled.",
            true
        );
        return;
    }

    const confirmed =
        await confirmSavedBallotDeletion(template);

    if (!confirmed) return;

    state.deleting = true;
    updateActionButtons();

    try {
        const result =
            await BallotAPI.deleteTemplate(templateId);

        if (
            Number(state.savedTemplateId) === templateId
        ) {
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
        console.error(
            "Delete template error:",
            error
        );

        status(
            `Unable to delete the ballot: ${error.message}`,
            true
        );

    } finally {
        state.deleting = false;
        updateActionButtons();
    }
}


// PRINT ADDITIONAL BALLOTS

async function printAdditionalBallots() {
    if (
        state.printing ||
        state.saving ||
        state.deleting ||
        state.loadingTemplate
    ) {
        return;
    }

    if (!state.electionId) {
        return status(
            "Election has not loaded.",
            true
        );
    }

    if (!state.savedTemplateId) {
        return status(
            "Select a saved ballot template first.",
            true
        );
    }

    const quantityInput = el("additionalQuantity");

    if (!quantityInput) {
        return status(
            "Additional ballot quantity input is missing from ballot.html.",
            true
        );
    }

    const quantity = Number(quantityInput.value);

    if (
        !Number.isSafeInteger(quantity) ||
        quantity < 1 ||
        quantity > 500
    ) {
        return status(
            "Enter 1 to 500 additional ballots.",
            true
        );
    }

    // Gagamitin ang existing saved template.
    // Backend ang gagawa ng bagong unique QR IDs.
    await generateAndPrintBallots("ADDITIONAL");
}

// RETRY PROTECTION FOR QR GENERATION

const ADDITIONAL_PENDING_KEY =
    "campusvote_pending_additional_qr_batch";

function getPendingAdditionalBatch() {
    try {
        const raw = sessionStorage.getItem(
            ADDITIONAL_PENDING_KEY
        );

        if (!raw) return null;

        const pending = JSON.parse(raw);

        if (
            !pending ||
            !pending.request_id ||
            !Number.isSafeInteger(Number(pending.election_id)) ||
            !Number.isSafeInteger(Number(pending.template_id)) ||
            !Number.isSafeInteger(Number(pending.quantity))
        ) {
            return null;
        }

        return pending;

    } catch (error) {
        console.warn(
            "Invalid pending additional batch:",
            error
        );

        return null;
    }
}

function clearPendingAdditionalBatch() {
    sessionStorage.removeItem(
        ADDITIONAL_PENDING_KEY
    );
}

// Pinapakita kung may unfinished additional request.
function checkPendingAdditionalBatch() {
    const pending = getPendingAdditionalBatch();

    if (!pending) return;

    if (
        Number(pending.election_id) !==
        Number(state.electionId)
    ) {
        return;
    }

    const info = el("batchInfo");

    if (info) {
        info.textContent =
            `Unfinished additional ballot request detected: ` +
            `${pending.quantity} ballots for Template #${pending.template_id}. ` +
            `Retrying the same request ID will not create duplicate ballots.`;
    }
}

// PREPARE ADDITIONAL BALLOT CONTROLS

function initializeAdditionalBallotControls() {
    const generateButton = el(
        "generateAdditionalButton"
    );

    const quantityInput = el(
        "additionalQuantity"
    );

    if (quantityInput) {
        quantityInput.min = "1";
        quantityInput.max = "500";

        if (!quantityInput.value) {
            quantityInput.value = "20";
        }
    }

    if (generateButton) {
        generateButton.addEventListener(
            "click",
            printAdditionalBallots
        );
    }
}

// PRINTING SUMMARY

async function loadPrintingSummary() {
    if (!state.electionId) return;

    try {
        const result =
            await BallotAPI.getPrintSummary(
                state.electionId
            );

        const summary =
            result.summary || result;

        const original = Number(
            summary.initial_printed || 0
        );

        const additional = Number(
            summary.additional_printed || 0
        );

        const total = original + additional;

        const summaryElement = el(
            "printingSummary"
        );

        if (summaryElement) {
            summaryElement.textContent =
                `Original: ${original} | ` +
                `Additional: ${additional} | ` +
                `Total: ${total}`;
        }

    } catch (error) {
        console.error(
            "Printing summary error:",
            error
        );
    }
}

// UPDATE BALLOT COPIES

function updateBallotCopies() {
    if (
        state.printing ||
        state.saving ||
        state.loadingTemplate
    ) {
        return;
    }

    const input = el("copiesInput");

    if (!input) return;

    const copies = Number(input.value);

    if (![1, 2].includes(copies)) {
        input.value = String(state.copies);

        return status(
            "Choose 1 A4 ballot or 2 A5 ballots per sheet.",
            true
        );
    }

    if (copies === state.copies) {
        return;
    }

    if (state.savedTemplateId) {
        input.value = String(state.copies);

        return status(
            "Saved ballot layout cannot be changed. " +
            "Create a new template to change paper size.",
            true
        );
    }

    state.copies = copies;

    try {
        render();

        status(
            copies === 2
                ? "Layout changed to 2 A5 ballots per A4 sheet."
                : "Layout changed to 1 A4 ballot per sheet.",
            false,
            false
        );

    } catch (error) {
        status(
            error.message,
            true
        );
    }
}

// REFRESH SAVED TEMPLATES

async function refreshSavedTemplates() {
    if (state.loadingTemplates) return;

    await loadSavedTemplates();

    status(
        "Saved ballot templates refreshed."
    );
}

// INITIALIZE BALLOT CREATOR

document.addEventListener(
    "DOMContentLoaded",
    async () => {
        installBallotLayoutStyles();

        const savedTemplateToggle = el(
            "savedTemplateToggle"
        );

        const refreshTemplatesButton = el(
            "refreshTemplatesButton"
        );

        const reloadButton = el(
            "reloadButton"
        );

        const saveButton = el(
            "saveButton"
        );

        const generatePrintButton = el(
            "generatePrintButton"
        );

        const copiesInput = el(
            "copiesInput"
        );

        if (savedTemplateToggle) {
            savedTemplateToggle.addEventListener(
                "click",
                toggleSavedDropdown
            );
        }

        document.addEventListener(
            "click",
            event => {
                const menu = el(
                    "savedTemplateMenu"
                );

                const toggle = el(
                    "savedTemplateToggle"
                );

                if (
                    menu &&
                    toggle &&
                    !menu.contains(event.target) &&
                    !toggle.contains(event.target)
                ) {
                    closeSavedDropdown();
                }
            }
        );

        if (refreshTemplatesButton) {
            refreshTemplatesButton.addEventListener(
                "click",
                refreshSavedTemplates
            );
        }

        if (reloadButton) {
            reloadButton.addEventListener(
                "click",
                loadData
            );
        }

        if (saveButton) {
            saveButton.addEventListener(
                "click",
                saveBallot
            );
        }

        if (generatePrintButton) {
            generatePrintButton.addEventListener(
                "click",
                () => generateAndPrintBallots("ORIGINAL")
            );
        }

        if (copiesInput) {
            copiesInput.addEventListener(
                "change",
                updateBallotCopies
            );
        }

        initializeAdditionalBallotControls();

        await loadData();

        checkPendingAdditionalBatch();

        await loadPrintingSummary();

        updateActionButtons();
    }
);
