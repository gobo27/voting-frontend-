
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
    if (element) {
        element.textContent = message;
        element.style.color = error ? "#b91c1c" : "#555";
    }
    if (notify && typeof window.showToast === "function") {
        window.showToast(message, error ? "error" : "success");
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

    const busy = state.printing || state.saving ||
        state.deleting || state.loadingTemplate;

    if (saveButton) saveButton.disabled = electionLocked() || busy;
    if (generateButton) generateButton.disabled = !state.savedTemplateId || busy;
    if (reprintButton) reprintButton.disabled = busy;

    document.querySelectorAll(".saved-template-delete").forEach(button => {
        button.disabled = !canDeleteTemplates() || busy;
    });
}

function setEditorLocked(locked) {
    for (const id of [
        "titleInput", "yearInput", "instructionsInput", "copiesInput"
    ]) {
        const element = el(id);
        if (element) element.disabled = locked;
    }

    const inputs = el("positionSettings")?.querySelectorAll("input") || [];
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
    toggle.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
}

function updateSelectedTemplateLabel() {
    const label = el("selectedTemplateLabel");
    if (!label) return;

    const template = state.savedTemplates.find(item =>
        Number(item.template_id) === Number(state.savedTemplateId)
    );

    label.textContent = template ? templateText(template) : "Select saved ballot";
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

function layoutBallot() {
    const rows = [];
    let y = 36;
    const bottom = state.copies === 2 ? 137 : 283;

    for (const position of state.positions) {
        if (!position.candidates.length) continue;

        const headingY = y;
        y += 8;

        for (const candidate of position.candidates) {
            if (y + 7 > bottom) {
                throw new Error(
                    "Too many candidates. Choose 1 ballot per A4 or reduce candidates."
                );
            }

            rows.push({
                candidate,
                position,
                x: 18,
                y
            });

            y += 7;
        }

        y += 3;
        position._headingY = headingY;
    }

    return rows;
}

function addRegistrationMarks(half) {
    const bottom = state.copies === 2 ? 139 : 287;
    const marks = [
        [8, 6],
        [199, 6],
        [8, bottom],
        [199, bottom]
    ];

    for (const [left, top] of marks) {
        const mark = document.createElement("span");
        mark.className = "registration-mark";
        mark.style.left = `${left}mm`;
        mark.style.top = `${top}mm`;
        half.appendChild(mark);
    }
}

function createHalf(ballot = null) {
    const half = document.createElement("section");
    half.className = "ballot-half" + (state.copies === 1 ? " full" : "");

    addRegistrationMarks(half);

    const title = el("titleInput").value.trim() || "Official Election Ballot";
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

    for (const position of state.positions) {
        if (!position.candidates.length) continue;

        const headingElement = document.createElement("div");
        headingElement.className = "position-heading";
        headingElement.style.top = `${position._headingY}mm`;
        headingElement.textContent =
            `${position.title.toUpperCase()} — Select up to ${position.max_selection}`;

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

function render() {
    state.layout = layoutBallot();

    const page = el("ballotPage");
    page.classList.remove("batch-mode");

    page.replaceChildren(
        ...Array.from({ length: state.copies }, () => createHalf())
    );

    el("loadedCandidates").textContent = state.positions.map(position =>
        `${String(position.title).toUpperCase()}: ${position.candidates.length} candidate(s)`
    ).join(" | ") || "No candidates found";

    updateActionButtons();
}

async function loadData() {
    try {
        status("Loading positions and candidates...", false, false);

        const requestedId = new URLSearchParams(location.search)
            .get("election_id") || "current";

        const election = await BallotAPI.resolveElection(requestedId);
        const result = await BallotAPI.getPositions(election.election_id);
        const positions = Array.isArray(result) ? result : result.positions;

        if (!Array.isArray(positions)) {
            throw new Error("Unexpected positions API response");
        }

        state.election = election;
        state.electionId = Number(election.election_id);

        state.positions = positions.map(position => ({
            id: Number(position.position_id),
            title: position.title,
            max_selection: Number(position.max_selection || 1),
            candidates: (position.candidates || []).map(candidate => ({
                id: Number(candidate.candidate_id),
                name: candidate.name
            }))
        }));

        state.savedTemplateId = null;
        state.printBatchId = null;
        state.copies = Number(el("copiesInput").value);
        el("titleInput").value = election.title || "Official Election Ballot";

        renderPositionSettings();
        render();

        await loadSavedTemplates();
        await loadPrintBatches();

        setEditorLocked(electionLocked());

        status(
            `Loaded ${state.positions.length} positions and ${state.layout.length} candidates.`,
            false,
            false
        );
    } catch (error) {
        console.error("Load error:", error);
        status(error.message, true);
    }
}

function coordinatePayload() {
    return state.layout.map(({ candidate, x, y }) => ({
        candidate_id: candidate.id,
        bubble_code: `C${candidate.id}`,
        x_pos: mmToPx(x),
        y_pos: mmToPx(y),
        width: mmToPx(5),
        height: mmToPx(5)
    }));
}

function invalidateAndRender() {
    state.savedTemplateId = null;
    state.printBatchId = null;
    updateSelectedTemplateLabel();

    try {
        render();
        status(
            "Layout changed. Save a new template before generating ballots.",
            false,
            false
        );
    } catch (error) {
        status(error.message, true);
    }
}

function renderPositionSettings() {
    const container = el("positionSettings");
    container.replaceChildren();

    for (const position of state.positions) {
        if (!position.candidates.length) continue;

        const label = document.createElement("label");
        label.textContent =
            `${position.title} (${position.candidates.length} candidates)`;

        const input = document.createElement("input");
        input.type = "number";
        input.min = "1";
        input.max = String(position.candidates.length);
        input.value = String(position.max_selection);
        input.disabled = electionLocked();

        input.addEventListener("change", () => {
            if (electionLocked()) {
                input.value = String(position.max_selection);
                return status(
                    "Position limits are locked during the election.",
                    true
                );
            }

            const value = Number(input.value);

            if (
                !Number.isSafeInteger(value) ||
                value < 1 ||
                value > position.candidates.length
            ) {
                input.value = String(position.max_selection);
                return status(
                    `Choose 1 to ${position.candidates.length} for ${position.title}.`,
                    true
                );
            }

            position.max_selection = value;
            invalidateAndRender();
        });

        container.append(label, input);
    }
}

async function savePositionLimits() {
    for (const position of state.positions) {
        if (!position.candidates.length) continue;

        await BallotAPI.updatePosition(position.id, {
            max_selection: position.max_selection
        });
    }
}

async function saveBallot() {
    if (state.saving || state.printing || state.deleting) return;

    if (electionLocked()) {
        return status("Cannot save a new ballot while voting/scanning is active or the election is completed.", true);
    }
    if (state.savedTemplateId) {
        return status(`Ballot template #${state.savedTemplateId} is already saved.`, true);
    }

    state.saving = true;
    updateActionButtons();

    try {
        if (!state.electionId) throw new Error("Election has not loaded.");
        if (!state.layout.length) throw new Error("No candidates to save.");

        const title = el("titleInput").value.trim();
        if (!title) throw new Error("Ballot title is required.");

        await savePositionLimits();

        const result = await BallotAPI.saveCompleteTemplate({
            election_id: state.electionId,
            template_name: title,
            paper_size: state.copies === 2 ? "A5" : "A4",
            coordinates: coordinatePayload()
        });

        const templateId = Number(result.template?.template_id);
        if (!Number.isSafeInteger(templateId) || templateId < 1) {
            throw new Error("Backend did not return a valid template ID.");
        }

        state.savedTemplateId = templateId;
        render();
        await loadSavedTemplates();
        updateSelectedTemplateLabel();

        status(result.duplicate
            ? `Identical ballot already exists as template #${templateId}.`
            : `Ballot template #${templateId} saved successfully!`
        );
    } catch (error) {
        console.error("Save error:", error);
        status(`Save failed: ${error.message}`, true);
    } finally {
        state.saving = false;
        updateActionButtons();
    }
}

async function printRegisteredBallots(ballots) {
    if (!Array.isArray(ballots) || !ballots.length) {
        throw new Error("No registered ballots to print.");
    }

    const page = el("ballotPage");
    page.replaceChildren();
    page.classList.add("batch-mode");

    for (let i = 0; i < ballots.length; i += state.copies) {
        const sheet = document.createElement("div");
        sheet.className = "print-sheet";

        for (let j = 0; j < state.copies; j++) {
            const ballot = ballots[i + j];
            if (!ballot) break;
            sheet.appendChild(createHalf(ballot));
        }

        page.appendChild(sheet);
    }

    const images = [...page.querySelectorAll(".ballot-qr img")];

    await Promise.all(images.map(async image => {
        if (typeof image.decode === "function") {
            await image.decode();
        } else {
            await new Promise((resolve, reject) => {
                if (image.complete && image.naturalWidth > 0) {
                    resolve();
                    return;
                }
                image.onload = resolve;
                image.onerror = reject;
            });
        }
    }));

    window.print();
}

async function confirmPrintedBatch(batchId, printType, quantity) {
    const confirmed = window.confirm(
        `Did the printer successfully produce all ${quantity} individual A5 ballots for batch #${batchId}?\n\n` +
        "Choose OK only after checking the printed pages.\n" +
        "Choose Cancel if printing failed, was cancelled, or was incomplete."
    );

    if (!confirmed) {
        status("Printing was not confirmed. No physical print quantity was recorded.", true);
        return false;
    }

    const eventId = crypto.randomUUID();

    await BallotAPI.confirmPrint(batchId, printType, quantity, eventId);

    status(`${quantity} physical A5 ballots confirmed (${printType.toLowerCase()}).`);
    return true;
}

async function generateAndPrintBallots() {
    if (state.printing || state.saving || state.deleting || state.loadingTemplate) return;

    if (!state.electionId || !state.savedTemplateId) {
        return status("Select a saved ballot template first.", true);
    }
    if (state.copies !== 2) {
        return status("QR scanning currently requires 2 A5 ballots per A4.", true);
    }

    const quantity = Number(el("ballotQuantity").value);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 500) {
        return status("Enter 1 to 500 ballots.", true);
    }

    state.printing = true;
    updateActionButtons();

    try {
        status("Generating registered QR ballots...", false, false);

        const result = await BallotAPI.generateQRBatch({
            election_id: state.electionId,
            template_id: state.savedTemplateId,
            quantity
        });

        state.printBatchId = Number(result.batch_id);
        el("reprintBatchId").value = String(result.batch_id);

        await loadPrintBatches();

        const batchSelect = el("reprintBatchSelect");
        if (batchSelect) {
            batchSelect.value = String(result.batch_id);
            updateSelectedBatchInfo();
        }

        await printRegisteredBallots(result.ballots);

        const recorded = await confirmPrintedBatch(
            Number(result.batch_id),
            "ORIGINAL",
            result.ballots.length
        );

        if (recorded) {
            status(`${result.quantity ?? quantity} unique ballots generated. Batch ID: ${result.batch_id}`);
        }
    } catch (error) {
        console.error("Generate error:", error);
        status(`Print failed: ${error.message}`, true);
    } finally {
        state.printing = false;
        updateActionButtons();
    }
}

async function reprintRegisteredBatch() {
    if (state.printing || state.saving || state.deleting || state.loadingTemplate) return;

    const batchId = Number(el("reprintBatchId").value);
    if (!Number.isSafeInteger(batchId) || batchId < 1) {
        return status("Please enter a valid Batch ID.", true);
    }

    state.printing = true;
    const button = el("reprintBatchButton");
    button.disabled = true;
    updateActionButtons();

    try {
        status(`Loading existing Batch #${batchId}...`, false, false);

        const result = await BallotAPI.getQRBatch(batchId);
        const ballots = result.ballots;

        if (!Array.isArray(ballots) || !ballots.length) {
            throw new Error("No registered ballots found in this batch.");
        }

        const templateId = Number(ballots[0].template_id);
        const electionId = Number(ballots[0].election_id);

        if (!Number.isSafeInteger(templateId) || templateId < 1 ||
            !Number.isSafeInteger(electionId) || electionId < 1) {
            throw new Error("Batch is missing its template or election information.");
        }

        if (ballots.some(ballot =>
            Number(ballot.template_id) !== templateId ||
            Number(ballot.election_id) !== electionId
        )) {
            throw new Error("Batch contains mismatched templates or elections.");
        }

        if (electionId !== state.electionId) {
            throw new Error("This batch belongs to another election.");
        }

        const saved = await BallotAPI.getTemplate(templateId);
        const template = saved.template || saved;

        if (Number(template.template_id) !== templateId ||
            Number(template.election_id) !== electionId) {
            throw new Error("Saved template could not be verified.");
        }

        if (String(template.paper_size || "").toUpperCase() !== "A5") {
            throw new Error("This batch requires an A5 template.");
        }

        const rawCoordinates = saved.coordinates ||
            template.coordinates ||
            saved.grid_coordinates ||
            template.grid_coordinates;

        if (!Array.isArray(rawCoordinates) || !rawCoordinates.length) {
            throw new Error("Saved OMR coordinates were not returned by the API.");
        }

        const previousCopies = state.copies;
        state.copies = 2;

        let currentLayout;
        try {
            currentLayout = layoutBallot();
        } catch (error) {
            state.copies = previousCopies;
            throw error;
        }

        const expected = new Map(currentLayout.map(row => [
            Number(row.candidate.id),
            { x: mmToPx(row.x), y: mmToPx(row.y) }
        ]));

        if (rawCoordinates.length !== expected.size) {
            state.copies = previousCopies;
            throw new Error("Current layout differs from the saved ballot template.");
        }

        for (const coordinate of rawCoordinates) {
            const candidateId = Number(coordinate.candidate_id);
            const match = expected.get(candidateId);

            if (!match ||
                Number(coordinate.x_pos) !== match.x ||
                Number(coordinate.y_pos) !== match.y) {
                state.copies = previousCopies;
                throw new Error("Saved OMR coordinates do not match the current layout.");
            }
        }

        state.savedTemplateId = templateId;
        state.printBatchId = batchId;
        state.layout = currentLayout;
        el("copiesInput").value = "2";

        if (template.template_name) {
            el("titleInput").value = template.template_name;
        }

        updateSelectedTemplateLabel();

        await printRegisteredBallots(ballots);

        const recorded = await confirmPrintedBatch(
            batchId,
            "REPRINT",
            ballots.length
        );

        if (recorded) {
            status(`Batch #${batchId} reprinted successfully. No new ballots created.`);
        }
    } catch (error) {
        console.error("Reprint error:", error);
        status(`Reprint failed: ${error.message}`, true);
    } finally {
        state.printing = false;
        button.disabled = false;
        updateActionButtons();
    }
}

async function loadSavedTemplates() {
    if (state.loadingTemplates || !state.electionId) return;
    state.loadingTemplates = true;

    const menu = el("savedTemplateMenu");
    if (menu) {
        menu.replaceChildren();
        const loading = document.createElement("div");
        loading.textContent = "Loading saved ballots...";
        loading.style.padding = "12px";
        menu.appendChild(loading);
    }

    try {
        const result = await BallotAPI.getTemplates(state.electionId);
        state.savedTemplates = Array.isArray(result.templates) ? result.templates : [];
        renderSavedTemplateMenu();
        updateSelectedTemplateLabel();
    } catch (error) {
        console.error("Saved templates error:", error);
        status(`Unable to load saved ballots: ${error.message}`, true);
    } finally {
        state.loadingTemplates = false;
        updateActionButtons();
    }
}

async function selectSavedTemplate(templateId) {
    if (state.loadingTemplate || state.printing || state.deleting || state.saving) return;

    templateId = Number(templateId);
    if (!Number.isSafeInteger(templateId) || templateId < 1) return;

    state.loadingTemplate = true;
    updateActionButtons();

    const previousCopies = state.copies;

    try {
        const result = await BallotAPI.getTemplate(templateId);
        const template = result.template;
        const coordinates = result.coordinates;

        if (!template || !Array.isArray(coordinates)) {
            throw new Error("Invalid saved template response.");
        }
        if (Number(template.election_id) !== state.electionId) {
            throw new Error("Selected ballot belongs to another election.");
        }
        if (!coordinates.length) {
            throw new Error("Saved template has no OMR coordinates.");
        }

        const savedIds = new Set(coordinates.map(c => Number(c.candidate_id)));
        const currentIds = new Set(
            state.positions.flatMap(position =>
                position.candidates.map(candidate => Number(candidate.id))
            )
        );

        if (savedIds.size !== currentIds.size || [...savedIds].some(id => !currentIds.has(id))) {
            throw new Error("Saved ballot candidates do not match the current election.");
        }

        const copies = String(template.paper_size).toUpperCase() === "A5" ? 2 : 1;
        state.copies = copies;

        const expectedLayout = layoutBallot();
        if (expectedLayout.length !== coordinates.length) {
            throw new Error("Saved OMR layout does not match current positions.");
        }

        const savedByCandidate = new Map(
            coordinates.map(coordinate => [Number(coordinate.candidate_id), coordinate])
        );

        for (const row of expectedLayout) {
            const saved = savedByCandidate.get(Number(row.candidate.id));
            if (!saved || Number(saved.x_pos) !== mmToPx(row.x) ||
                Number(saved.y_pos) !== mmToPx(row.y)) {
                throw new Error("Saved OMR coordinates differ from current layout.");
            }
        }

        state.savedTemplateId = templateId;
        state.printBatchId = null;
        el("copiesInput").value = String(copies);

        if (template.template_name) {
            el("titleInput").value = template.template_name;
        }

        render();
        updateSelectedTemplateLabel();
        status(`Saved ballot #${templateId} loaded successfully.`);
    } catch (error) {
        console.error("Load template error:", error);
        state.copies = previousCopies;
        el("copiesInput").value = String(previousCopies);
        state.savedTemplateId = null;
        updateSelectedTemplateLabel();

        try {
            render();
        } catch (_) {}

        status("Unable to load saved ballot: " + error.message, true);
    } finally {
        state.loadingTemplate = false;
        updateActionButtons();
    }
}

async function deleteSavedTemplate(templateId) {
    if (state.deleting || state.printing || state.saving || state.loadingTemplate) return;

    templateId = Number(templateId);
    if (!Number.isSafeInteger(templateId) || templateId < 1) {
        return status("Invalid saved ballot ID.", true);
    }
    if (!canDeleteTemplates()) {
        return status("Cannot delete templates from completed or archived elections.", true);
    }

    const template = state.savedTemplates.find(item =>
        Number(item.template_id) === templateId
    );

    if (!template) {
        return status("Saved ballot template not found.", true);
    }
    if (typeof window.showConfirmToast !== "function") {
        return status("Confirmation toast is not available.", true);
    }

    const confirmed = await window.showConfirmToast(
        "Only unused templates without registered QR batches can be deleted. This action cannot be undone.",
        {
            title: `Delete Saved Ballot #${templateId} (${template.template_name})?`,
            confirmText: "Delete Ballot",
            cancelText: "Cancel"
        }
    );

    if (!confirmed) return;

    state.deleting = true;
    updateActionButtons();

    try {
        const result = await BallotAPI.deleteTemplate(templateId);

        if (state.savedTemplateId === templateId) {
            state.savedTemplateId = null;
            state.printBatchId = null;
        }

        await loadSavedTemplates();
        updateSelectedTemplateLabel();
        render();

        status(result.message || `Unused ballot #${templateId} deleted successfully.`);
    } catch (error) {
        console.error("Delete template error:", error);
        status(`Delete failed: ${error.message}`, true);
    } finally {
        state.deleting = false;
        updateActionButtons();
    }
}

let registeredPrintBatches = [];
let loadingPrintBatches = false;

async function loadPrintBatches() {
    const select = el("reprintBatchSelect");
    if (!select || !state.electionId || loadingPrintBatches) return;

    loadingPrintBatches = true;
    const previousValue = select.value;

    select.replaceChildren(new Option("Loading existing batches...", ""));
    select.disabled = true;

    try {
        const result = await BallotAPI.getQRBatches(state.electionId);
        registeredPrintBatches = Array.isArray(result.batches) ? result.batches : [];

        select.replaceChildren(new Option("Select QR print batch", ""));

        for (const batch of registeredPrintBatches) {
            const date = batch.created_at
                ? new Date(batch.created_at).toLocaleString()
                : "Date unavailable";

            const label = `Batch #${batch.batch_id} | ${batch.quantity} ballots | ` +
                `Template #${batch.template_id} - ${batch.template_name} | ${date}`;

            select.add(new Option(label, String(batch.batch_id)));
        }

        if (previousValue && registeredPrintBatches.some(batch =>
            String(batch.batch_id) === previousValue
        )) {
            select.value = previousValue;
        } else {
            select.value = "";
        }

        if (!registeredPrintBatches.length) {
            select.replaceChildren(new Option("No registered QR batches yet", ""));
        }

        updateSelectedBatchInfo();
    } catch (error) {
        console.error("Load print batches error:", error);
        select.replaceChildren(new Option("Unable to load QR batches", ""));
        status("Failed to load print batches: " + error.message, true);
    } finally {
        select.disabled = false;
        loadingPrintBatches = false;
    }
}

function updateSelectedBatchInfo() {
    const select = el("reprintBatchSelect");
    const info = el("batchInfo");
    const hiddenInput = el("reprintBatchId");

    if (!select || !info || !hiddenInput) return;

    const batchId = Number(select.value);
    const batch = registeredPrintBatches.find(item =>
        Number(item.batch_id) === batchId
    );

    if (!batch) {
        hiddenInput.value = "";
        info.textContent = "Select a batch to see its details.";
        return;
    }

    hiddenInput.value = String(batch.batch_id);
    info.textContent = `Batch #${batch.batch_id} | ` +
        `${batch.registered_count} registered ballots | ` +
        `Template #${batch.template_id} - ${batch.template_name} (${batch.paper_size})`;
}

async function reprintSelectedBatch() {
    const select = el("reprintBatchSelect");

    if (!select) {
        return status("Reprint batch dropdown not found.", true);
    }

    const batchId = Number(select.value);
    if (!Number.isSafeInteger(batchId) || batchId <= 0) {
        return status("Please select a QR print batch first.", true);
    }

    const batch = registeredPrintBatches.find(item =>
        Number(item.batch_id) === batchId
    );

    if (!batch) {
        return status("Selected batch is not available. Refresh the list.", true);
    }
    if (Number(batch.election_id) !== state.electionId) {
        return status("This batch belongs to another election.", true);
    }

    el("reprintBatchId").value = String(batchId);
    await reprintRegisteredBatch();
}

document.addEventListener("DOMContentLoaded", () => {
    const toggle = el("savedTemplateToggle");

    if (toggle) {
        toggle.addEventListener("click", toggleSavedDropdown);
    }

    document.addEventListener("click", event => {
        const dropdown = el("savedDropdown");
        if (dropdown && !dropdown.contains(event.target)) {
            closeSavedDropdown();
        }
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") closeSavedDropdown();
    });

    const refreshButton = el("refreshTemplatesButton");
    if (refreshButton) {
        refreshButton.addEventListener("click", loadSavedTemplates);
    }

    el("reloadButton").addEventListener("click", loadData);

    el("copiesInput").addEventListener("change", () => {
        if (electionLocked()) return;
        state.copies = Number(el("copiesInput").value);
        invalidateAndRender();
    });

    el("saveButton").addEventListener("click", saveBallot);
    el("generatePrintButton").addEventListener("click", generateAndPrintBallots);
    el("reprintBatchButton").addEventListener("click", reprintSelectedBatch);
    el("reprintBatchSelect").addEventListener("change", updateSelectedBatchInfo);
    el("refreshBatchesButton").addEventListener("click", loadPrintBatches);

    for (const id of ["titleInput", "yearInput", "instructionsInput"]) {
        el(id).addEventListener("input", () => {
            if (electionLocked()) return;

            if (state.savedTemplateId) {
                state.savedTemplateId = null;
                state.printBatchId = null;
                updateSelectedTemplateLabel();
            }

            try {
                render();
            } catch (error) {
                status(error.message, true);
            }
        });
    }

    window.addEventListener("afterprint", () => {
        try {
            render();
        } catch (error) {
            console.error(error);
        }
    });

    loadData();
});
