
"use strict";

const API_BASE = "https://voting-backend-cdrj.onrender.com/api";
const DPI = 300;

const $ = id => document.getElementById(id);

let template = null;
let coordinates = [];
let sourceImage = null;
let cameraStream = null;

let busy = false;
let imageVersion = 0;
let retakeRequired = false;

let qrData = null;
let qrResult = null;

// Backend ang final QR verification authority.
let backendQRPending = false;
let backendQRVerified = false;

// Corrected A5 preview state.
let correctedBallotURL = null;
let correctedBallotImage = null;

// Para sa scan result at retake diagnostics.
let lastScanResult = null;
let lastQualityIssue = null;

// Browser QR is optional; backend verification is required.
window.campusVoteQRVerified = false;
window.confirmedOMRCounting = false;

const canvas = $("scanCanvas");

const ctx = canvas?.getContext("2d", {
    willReadFrequently: true
});

if (!canvas || !ctx) {
    console.error(
        "Scanner canvas not found. Check #scanCanvas."
    );
}


// AUTHENTICATION

function token() {
    return (
        sessionStorage.getItem("voting_token") ||
        localStorage.getItem("voting_token") ||
        localStorage.getItem("token")
    );
}

function validId(value) {
    return (
        value !== null &&
        value !== undefined &&
        String(value).trim() !== "" &&
        Number.isSafeInteger(Number(value)) &&
        Number(value) > 0
    );
}

function getElectionId() {
    return Number($("electionId")?.value);
}

function getTemplateId() {
    return Number($("templateSelect")?.value);
}

// Shared API request handler.
async function request(path, options = {}) {
    const t = token();

    if (!t) {
        throw new Error(
            "Session not found. Please log in again."
        );
    }

    const response = await fetch(API_BASE + path, {
        ...options,
        headers: {
            Authorization: "Bearer " + t,
            ...(options.headers || {})
        }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        const error = new Error(
            data.message || `API error ${response.status}`
        );

        error.status = response.status;
        error.data = data;

        throw error;
    }

    return data;
}


// STATUS AND RESET

function status(id, message, error = false) {
    const el = $(id);

    if (!el) return;

    el.textContent = message;
    el.className = "status" + (error ? " error" : "");
}

function debug(message) {
    if ($("debugInfo")) {
        $("debugInfo").textContent = message;
    }
}

function disableSubmission() {
    if ($("submitBtn")) {
        $("submitBtn").disabled = true;
    }
}

// Scan button is no longer blocked by browser QR failure.
function updateAnalyzeButton() {
    const button = $("analyzeBtn");

    if (!button) return;

    button.disabled =
        busy ||
        window.confirmedOMRCounting === true ||
        retakeRequired ||
        !template ||
        !sourceImage ||
        !validId(getElectionId()) ||
        !validId(getTemplateId());

    // QR validation happens independently in the backend.
}

// Release old corrected preview resources.
function clearCorrectedPreview() {
    if (correctedBallotURL) {
        URL.revokeObjectURL(correctedBallotURL);
        correctedBallotURL = null;
    }

    correctedBallotImage = null;

    const preview = $("correctedBallotPreview");

    if (preview) {
        preview.removeAttribute("src");
        preview.style.display = "none";
    }
}

// Clear state from the previous ballot.
function resetBallotVerification() {
    qrData = null;
    qrResult = null;

    backendQRPending = false;
    backendQRVerified = false;

    window.campusVoteQRVerified = false;
    window.confirmedOMRCounting = false;

    lastScanResult = null;
    lastQualityIssue = null;

    clearCorrectedPreview();
}

function reset() {
    if ($("results")) {
        $("results").innerHTML =
            "<p>No ballot analyzed yet.</p>";
    }

    status("analysisStatus", "");

    debug(
        "Load a template and ballot image, then scan."
    );

    window.confirmedOMRCounting = false;

    lastScanResult = null;
    lastQualityIssue = null;

    disableSubmission();
    updateAnalyzeButton();
}


// ELECTION AND TEMPLATES

async function loadTemplates() {
    if (busy) return;

    try {
        const electionId = getElectionId();

        if (!validId(electionId)) {
            throw new Error(
                "Current election ID unavailable."
            );
        }

        const data = await request(
            `/ballots/templates/election/${electionId}`
        );

        const select = $("templateSelect");

        if (!select) {
            throw new Error(
                "Template selector not found."
            );
        }

        select.replaceChildren(
            new Option("Select a template", "")
        );

        for (const item of data.templates || []) {
            if (
                String(item.paper_size).toUpperCase() !== "A5"
            ) {
                continue;
            }

            select.add(
                new Option(
                    `#${item.template_id} - ` +
                    `${item.template_name} ` +
                    `(${item.paper_size})`,
                    item.template_id
                )
            );
        }

        template = null;
        coordinates = [];

        resetBallotVerification();

        imageVersion++;

        reset();

        status(
            "scannerStatus",
            `${select.options.length - 1} templates loaded.`
        );

    } catch (error) {
        status(
            "scannerStatus",
            error.message,
            true
        );
    }
}

async function selectTemplate() {
    if (busy) return;

    template = null;
    coordinates = [];

    resetBallotVerification();

    const version = ++imageVersion;

    const select = $("templateSelect");
    const id = select?.value;

    reset();

    if (!id) return;

    try {
        const data = await request(
            `/ballots/templates/${encodeURIComponent(id)}`
        );

        if (version !== imageVersion) return;

        if (
            !data.template ||
            !Array.isArray(data.coordinates) ||
            !data.coordinates.length
        ) {
            throw new Error(
                "Template or coordinates missing."
            );
        }

        if (
            String(data.template.paper_size).toUpperCase() !== "A5"
        ) {
            throw new Error(
                "A4 counting is not yet supported. " +
                "Select an A5 portrait template."
            );
        }

        template = data.template;
        coordinates = data.coordinates;

        status(
            "scannerStatus",
            `Template #${id} loaded ` +
            `(${template.paper_size}), ` +
            `${coordinates.length} bubbles.`
        );

        reset();

        // Browser QR check is optional.
        // Backend can still read the uploaded image.
        if (sourceImage) {
            status(
                "imageStatus",
                "Template loaded. Ballot image is ready " +
                "for backend QR and OMR verification."
            );

            if ($("qrStatus")) {
                $("qrStatus").textContent =
                    "QR will be verified by the backend. " +
                    "Browser QR detection is optional.";
            }

            updateAnalyzeButton();
        }

    } catch (error) {
        if (version === imageVersion) {
            status(
                "scannerStatus",
                error.message,
                true
            );
        }
    }
}

async function currentElection() {
    try {
        const data = await request(
            "/positions/election/current"
        );

        const positions = Array.isArray(data)
            ? data
            : Array.isArray(data.positions)
                ? data.positions
                : [];

        const id = Number(
            data.election_id ??
            data.election?.election_id ??
            data.current_election?.election_id ??
            data.data?.election_id ??
            data.data?.election?.election_id ??
            positions[0]?.election_id
        );

        if (!validId(id)) {
            throw new Error(
                "Current election ID not found."
            );
        }

        const electionInput = $("electionId");

        if (!electionInput) {
            throw new Error(
                "Election ID input not found."
            );
        }

        electionInput.value = id;

        await loadTemplates();

    } catch (error) {
        status(
            "scannerStatus",
            "Failed to load current election: " +
            error.message,
            true
        );
    }
}

// IMAGE HANDLING

function drawOriginal() {
    if (!sourceImage || !canvas || !ctx) return;

    canvas.width =
        sourceImage.naturalWidth ||
        sourceImage.width;

    canvas.height =
        sourceImage.naturalHeight ||
        sourceImage.height;

    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );

    ctx.drawImage(
        sourceImage,
        0,
        0,
        canvas.width,
        canvas.height
    );
}

// I-display ang uploaded o captured ballot.
function showImage(image) {
    if (busy) {
        status(
            "imageStatus",
            "Wait until the current scan finishes.",
            true
        );
        return;
    }

    imageVersion++;

    sourceImage = image;
    retakeRequired = false;

    resetBallotVerification();

    drawOriginal();
    reset();

    status(
        "imageStatus",
        `Image loaded: ${canvas.width} × ` +
        `${canvas.height}. Ready for backend verification.`
    );

    if ($("qrStatus")) {
        $("qrStatus").textContent =
            "QR verification pending.\n" +
            "The backend will verify the ballot during scanning.";
    }

    // Optional browser QR check para sa mabilis na feedback.
    // Hindi nito haharangin ang backend kapag hindi mabasa.
    if (template && validId(getTemplateId())) {
        debugQR().catch(error => {
            if (sourceImage !== image) return;

            status(
                "imageStatus",
                "Image loaded. Browser QR check unavailable. " +
                "Backend scanning is still available."
            );

            debug(
                "BROWSER QR CHECK\n" +
                error.message + "\n" +
                "Backend verification remains available."
            );
        });
    } else {
        status(
            "imageStatus",
            "Image loaded. Select an A5 ballot template " +
            "before scanning."
        );
    }

    updateAnalyzeButton();
}

function loadImageFile(file) {
    if (!file) return;

    const acceptedTypes = [
        "image/png",
        "image/jpeg",
        "image/webp"
    ];

    if (
        !acceptedTypes.includes(file.type) ||
        file.size > 30 * 1024 * 1024
    ) {
        status(
            "imageStatus",
            "Use PNG/JPG/WEBP up to 30MB.",
            true
        );
        return;
    }

    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
        URL.revokeObjectURL(url);
        showImage(image);
    };

    image.onerror = () => {
        URL.revokeObjectURL(url);

        status(
            "imageStatus",
            "Cannot open image.",
            true
        );
    };

    image.src = url;
}

function upload(event) {
    const file = event.target.files?.[0];

    loadImageFile(file);
}


// DIRECT PHONE CAMERA

function openCamera() {
    if (busy) {
        status(
            "imageStatus",
            "Please wait for the current scan to finish.",
            true
        );
        return;
    }

    const phoneCameraInput = $("phoneCameraInput");

    if (!phoneCameraInput) {
        status(
            "imageStatus",
            "Phone camera input not found.",
            true
        );
        return;
    }

    // Native camera picker para sa Android at iPhone.
    // Kailangan ang capture attribute sa HTML.
    phoneCameraInput.value = "";

    status(
        "imageStatus",
        "Opening phone camera. Capture the complete " +
        "A5 ballot with all four registration marks."
    );

    phoneCameraInput.click();
}

function phoneCameraCapture(event) {
    const file = event.target.files?.[0];

    if (!file) {
        status(
            "imageStatus",
            "No photo captured."
        );
        return;
    }

    // Hindi kailangang mabasa agad ang QR sa browser.
    // Backend ang gagawa ng final validation.
    loadImageFile(file);
}


// OPTIONAL LEGACY CAMERA CLEANUP

function stopCamera() {
    cameraStream?.getTracks().forEach(track => {
        track.stop();
    });

    cameraStream = null;

    const video = $("video");

    if (video) {
        video.srcObject = null;
        video.style.display = "none";
    }

    if ($("captureBtn")) {
        $("captureBtn").disabled = true;
    }

    if ($("stopCameraBtn")) {
        $("stopCameraBtn").disabled = true;
    }
}

function capture() {
    status(
        "imageStatus",
        "Use Open Phone Camera to capture a ballot."
    );
}


// GET BALLOT IMAGE PIXELS

function getSource() {
    if (!sourceImage) {
        throw new Error("No ballot image loaded.");
    }

    const temp = document.createElement("canvas");

    temp.width =
        sourceImage.naturalWidth ||
        sourceImage.width;

    temp.height =
        sourceImage.naturalHeight ||
        sourceImage.height;

    const c = temp.getContext("2d", {
        willReadFrequently: true
    });

    if (!c) {
        throw new Error("Image canvas unavailable.");
    }

    c.drawImage(
        sourceImage,
        0,
        0,
        temp.width,
        temp.height
    );

    return c.getImageData(
        0,
        0,
        temp.width,
        temp.height
    );
}


// READ QR CODE FROM IMAGE

function readQR() {
    if (typeof window.jsQR !== "function") {
        throw new Error(
            "QR library not loaded. Check jsQR.min.js."
        );
    }

    const image = getSource();

    // Unang attempt: buong ballot image.
    let result = window.jsQR(
        image.data,
        image.width,
        image.height,
        {
            inversionAttempts: "attemptBoth"
        }
    );

    // Ikalawang attempt: upper-right QR region.
    if (!result) {
        const temp = document.createElement("canvas");

        temp.width = image.width;
        temp.height = image.height;

        const c = temp.getContext("2d", {
            willReadFrequently: true
        });

        if (!c) {
            throw new Error("QR canvas unavailable.");
        }

        c.putImageData(image, 0, 0);

        const x = Math.floor(image.width * 0.65);

        const crop = c.getImageData(
            x,
            0,
            image.width - x,
            Math.max(
                1,
                Math.floor(image.height * 0.4)
            )
        );

        result = window.jsQR(
            crop.data,
            crop.width,
            crop.height,
            {
                inversionAttempts: "attemptBoth"
            }
        );
    }

    if (!result) {
        throw new Error(
            "QR not detected in browser. " +
            "Backend verification is still available."
        );
    }

    return result.data;
}


// VALIDATE CAMPUSVOTE QR FORMAT

function validateQR(raw) {
    if (typeof raw !== "string" || !raw.trim()) {
        throw new Error(
            "INVALID QR CODE. QR data is empty."
        );
    }

    const parts = raw.trim().split("|");

    const uuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (
        parts.length !== 4 ||
        parts[0] !== "CV1" ||
        !validId(parts[1]) ||
        !uuid.test(parts[2]) ||
        !validId(parts[3])
    ) {
        throw new Error(
            "INVALID QR CODE. " +
            "Not a valid CampusVote ballot."
        );
    }

    const qrElectionId = Number(parts[1]);
    const qrTemplateId = Number(parts[3]);

    if (qrElectionId !== getElectionId()) {
        throw new Error(
            "WRONG ELECTION. " +
            "This ballot belongs to another election."
        );
    }

    if (qrTemplateId !== getTemplateId()) {
        throw new Error(
            "TEMPLATE MISMATCH. " +
            `QR belongs to template #${qrTemplateId}.`
        );
    }

    return {
        election_id: qrElectionId,
        ballot_id: parts[2].toLowerCase(),
        template_id: qrTemplateId
    };
}


// OPTIONAL BROWSER QR VERIFICATION

async function debugQR() {
    const version = imageVersion;
    const selectedImage = sourceImage;
    const selectedTemplateId = getTemplateId();
    const selectedElectionId = getElectionId();

    qrData = null;
    qrResult = null;

    backendQRPending = false;
    backendQRVerified = false;

    window.campusVoteQRVerified = false;

    // Hindi dini-disable ang scan button dito.
    updateAnalyzeButton();

    const isCurrent = () => (
        version === imageVersion &&
        selectedImage === sourceImage &&
        selectedTemplateId === getTemplateId() &&
        selectedElectionId === getElectionId()
    );

    try {
        if (!selectedImage) {
            throw new Error(
                "No ballot image loaded."
            );
        }

        if (
            !template ||
            !validId(selectedTemplateId) ||
            !validId(selectedElectionId)
        ) {
            throw new Error(
                "Load the current election and " +
                "select a ballot template first."
            );
        }

        if (
            String(template.paper_size).toUpperCase() !== "A5"
        ) {
            throw new Error(
                "Only A5 portrait ballots are currently supported."
            );
        }

        if ($("qrStatus")) {
            $("qrStatus").textContent =
                "Checking QR in browser...";
        }

        // Browser detection ay optional.
        const raw = readQR();
        const parsedQR = validateQR(raw);

        if (!isCurrent()) return null;

        if ($("qrStatus")) {
            $("qrStatus").textContent =
                "QR DETECTED\n" +
                "Checking ballot record with server...";
        }

        backendQRPending = true;

        // Verify ang nabasang QR sa database.
        const data = await request("/omr/verify-qr", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                qr_data: raw
            })
        });

        if (!isCurrent()) return null;

        backendQRPending = false;

        if (
            data.duplicate === true ||
            data.status === "COUNTED"
        ) {
            throw new Error(
                "DUPLICATE BALLOT. " +
                "This ballot has already been counted."
            );
        }

        if (data.status === "VOID") {
            throw new Error(
                "VOID BALLOT. " +
                "This ballot cannot be counted."
            );
        }

        if (!["ISSUED", "CAST"].includes(data.status)) {
            throw new Error(
                "Unsupported ballot status: " +
                (data.status || "UNKNOWN")
            );
        }

        if (data.valid !== true) {
            throw new Error(
                "QR verification was not approved " +
                "by the backend."
            );
        }

        qrData = raw;
        qrResult = {
            ...data,
            parsedQR
        };

        backendQRVerified = true;
        window.campusVoteQRVerified = true;

        if ($("qrStatus")) {
            $("qrStatus").textContent =
                "QR VERIFIED SUCCESSFULLY\n" +
                `Status: ${data.status}\n` +
                "Duplicate: NO\n" +
                `Election: #${parsedQR.election_id}\n` +
                `Template: #${parsedQR.template_id}\n` +
                "Ready for OMR scanning.";
        }

        status(
            "imageStatus",
            "QR verified successfully. " +
            "Ready for backend OMR scanning."
        );

        debug(
            "QR VERIFICATION SUCCESSFUL\n" +
            `Election: #${parsedQR.election_id}\n` +
            `Template: #${parsedQR.template_id}\n` +
            `Ballot status: ${data.status}\n` +
            "No votes have been saved yet."
        );

        updateAnalyzeButton();

        return data;

    } catch (error) {
        if (isCurrent()) {
            qrData = null;
            qrResult = null;

            backendQRPending = false;
            backendQRVerified = false;

            window.campusVoteQRVerified = false;

            if ($("qrStatus")) {
                $("qrStatus").textContent =
                    "BROWSER QR CHECK INCOMPLETE\n" +
                    error.message + "\n" +
                    "Backend verification remains available.";
            }

            status(
                "imageStatus",
                "Browser QR check incomplete. " +
                "The backend can still verify the ballot."
            );

            debug(
                "BROWSER QR CHECK\n" +
                error.message + "\n" +
                "No votes saved."
            );
        }

        // Hindi nito ibo-block ang backend-first scan.
        updateAnalyzeButton();

        throw error;
    }
}


// CONVERT BALLOT IMAGE TO JPEG BLOB

async function imageToBlob() {
    if (!sourceImage) {
        throw new Error("No ballot image loaded.");
    }

    const MAX_BYTES = 9 * 1024 * 1024;
    const MAX_DIMENSION = 4000;

    const originalWidth =
        sourceImage.naturalWidth || sourceImage.width;

    const originalHeight =
        sourceImage.naturalHeight || sourceImage.height;

    const scale = Math.min(
        1,
        MAX_DIMENSION / Math.max(
            originalWidth,
            originalHeight
        )
    );

    let width = Math.round(originalWidth * scale);
    let height = Math.round(originalHeight * scale);

    function encodeJPEG(w, h, quality) {
        return new Promise((resolve, reject) => {
            const temp = document.createElement("canvas");

            temp.width = w;
            temp.height = h;

            const c = temp.getContext("2d");

            if (!c) {
                reject(new Error("Canvas unavailable."));
                return;
            }

            c.fillStyle = "#ffffff";
            c.fillRect(0, 0, w, h);

            c.drawImage(
                sourceImage,
                0,
                0,
                w,
                h
            );

            temp.toBlob(blob => {
                if (!blob) {
                    reject(
                        new Error(
                            "Image conversion failed."
                        )
                    );
                    return;
                }

                resolve(blob);
            }, "image/jpeg", quality);
        });
    }

    let blob = await encodeJPEG(
        width,
        height,
        0.92
    );

    if (blob.size > MAX_BYTES) {
        blob = await encodeJPEG(
            width,
            height,
            0.82
        );
    }

    while (
        blob.size > MAX_BYTES &&
        Math.max(width, height) > 1600
    ) {
        width = Math.round(width * 0.85);
        height = Math.round(height * 0.85);

        blob = await encodeJPEG(
            width,
            height,
            0.85
        );
    }

    if (blob.size > MAX_BYTES) {
        throw new Error(
            "Photo is still too large. " +
            "Please use a lower camera resolution."
        );
    }

    return blob;
}


// DISPLAY DETECTED OMR RESULTS

function displayResults(data, countingEnabled) {
    const positions = Array.isArray(data.positions)
        ? data.positions
        : [];

    const results = $("results");

    if (!results) return;

    results.replaceChildren();

    const lines = [
        countingEnabled
            ? "OMR COUNTING RESULT"
            : "BACKEND OMR PREVIEW",

        `Mode: ${countingEnabled
            ? "LIVE COUNTING"
            : "READ ONLY"
        }`,

        `Template: #${getTemplateId()} ` +
        `(${data.paper_size || template?.paper_size || "A5"})`,

        `Source: ${data.source?.width || "?"
        } × ${data.source?.height || "?"
        }`,

        `Markers: ${data.markers_detected ?? "?"
        } detected`,

        `Sensitivity: ${data.sensitivity || "Balanced"}`,

        `Positions: ${positions.length}`,

        `Selected bubbles: ${data.selected_bubbles ?? "?"}`,

        `Overvotes: ${data.overvotes ?? "?"}`,

        ""
    ];

    for (const position of positions) {
        const section = document.createElement("div");
        section.className = "result-position";

        const title = document.createElement("h4");

        const marked = Number(position.marked ?? 0);
        const maxSelection = Number(
            position.max_selection ?? 1
        );

        title.textContent =
            `${position.position_name || "Position"} ` +
            `(${marked}/${maxSelection})`;

        section.appendChild(title);
        lines.push(title.textContent);

        // Ipakita ang candidates at detected shading.
        for (const candidate of position.candidates || []) {
            const filled = candidate.filled === true;
            const unclear = candidate.unclear === true;

            const shadingStatus = unclear
                ? "UNCLEAR"
                : filled
                    ? "SHADED"
                    : "BLANK";

            const candidateText =
                `${unclear ? "◐" : filled ? "●" : "○"} ` +
                `${candidate.name || "Unknown Candidate"} - ` +
                shadingStatus;

            const p = document.createElement("p");
            p.textContent = candidateText;

            if (unclear) {
                p.className = "overvote";
            } else if (filled) {
                p.className = "valid";
            }

            section.appendChild(p);
            lines.push(candidateText);
        }

        // Preserve ang overvote at blank rules.
        const result =
            position.result ||
            (
                position.overvoted
                    ? "SKIPPED_OVERVOTE"
                    : marked === 0
                        ? "BLANK"
                        : "VALID"
            );

        const info = document.createElement("p");

        if (result === "SKIPPED_OVERVOTE") {
            info.textContent = "SKIPPED: OVERVOTE";
            info.className = "overvote";

        } else if (
            result === "NEEDS_REVIEW" ||
            position.unclear === true
        ) {
            info.textContent =
                "UNCLEAR SHADING — RETAKE REQUIRED";
            info.className = "overvote";

        } else if (result.startsWith("SKIPPED")) {
            info.textContent = "SKIPPED POSITION";
            info.className = "overvote";

        } else if (result === "BLANK") {
            info.textContent = "BLANK POSITION";

        } else {
            info.textContent = "VALID POSITION";
            info.className = "valid";
        }

        section.appendChild(info);
        results.appendChild(section);

        lines.push(info.textContent, "");
    }

    // Counting summary mula sa backend.
    const summary = document.createElement("div");
    summary.className = "counting-note";

    if (countingEnabled && data.counted === true) {
        const savedVotes = Number(
            data.saved_votes ?? 0
        );

        summary.textContent =
            "Ballot counted successfully. " +
            `Saved votes: ${savedVotes}.`;

        lines.push(
            "Ballot counted successfully.",
            `Saved votes: ${savedVotes}`
        );

    } else if (countingEnabled) {
        summary.textContent =
            "No confirmed vote-counting result.";

        lines.push(
            "No confirmed vote-counting result."
        );

    } else {
        summary.textContent =
            "Preview only. No votes saved.";

        lines.push(
            "Preview only. No votes saved."
        );
    }

    results.appendChild(summary);

    debug(lines.join("\n"));
}


// CORRECTED A5 BALLOT PREVIEW

function displayCorrectedBallotPreview(data) {
    if (!data || typeof data !== "object") {
        return false;
    }

    // Optional backend response fields.
    // Hindi available sa kasalukuyang controller.
    const previewData =
        data.corrected_preview ||
        data.corrected_image ||
        data.corrected_image_url ||
        null;

    if (!previewData) {
        return false;
    }

    let imageURL = null;
    let shouldRevoke = false;

    if (
        typeof previewData === "string" &&
        /^data:image\/(?:jpeg|png|webp);base64,/i.test(previewData)
    ) {
        imageURL = previewData;

    } else if (
        typeof previewData === "object" &&
        typeof previewData.base64 === "string" &&
        /^[A-Za-z0-9+/]+={0,2}$/.test(previewData.base64) &&
        ["image/jpeg", "image/png", "image/webp"].includes(
            previewData.mime_type
        )
    ) {
        imageURL =
            `data:${previewData.mime_type};base64,` +
            previewData.base64;

    } else if (
        typeof previewData === "string" &&
        previewData.startsWith("blob:")
    ) {
        // Blob URLs are usable only in the same browser context.
        imageURL = previewData;
    }

    if (!imageURL) {
        return false;
    }

    clearCorrectedPreview();

    const preview = $("correctedBallotPreview");

    if (!preview) {
        // Walang dedicated preview element sa HTML.
        // Huwag palitan ang original scan canvas.
        return false;
    }

    const image = new Image();

    image.onload = () => {
        if (correctedBallotImage !== image) return;

        preview.src = imageURL;
        preview.style.display = "block";
    };

    image.onerror = () => {
        if (correctedBallotImage !== image) return;

        clearCorrectedPreview();

        console.warn(
            "Corrected A5 preview could not be displayed."
        );
    };

    correctedBallotImage = image;

    if (shouldRevoke) {
        correctedBallotURL = imageURL;
    }

    image.src = imageURL;

    return true;
}


// BACKEND-FIRST OMR SCANNING

async function backendPreview() {
    // Iwas sa simultaneous scans.
    if (busy) return;

    if (window.confirmedOMRCounting === true) {
        status(
            "analysisStatus",
            "This ballot has already been counted. " +
            "Load a new ballot before scanning again.",
            true
        );
        return;
    }

    if (retakeRequired) {
        status(
            "analysisStatus",
            "A new photo or ballot status verification " +
            "is required before scanning again.",
            true
        );
        return;
    }

    // Check template at ballot image.
    if (!template || !sourceImage) {
        status(
            "analysisStatus",
            "Load a template and ballot image first.",
            true
        );
        return;
    }

    const electionId = getElectionId();
    const templateId = getTemplateId();

    if (
        !validId(electionId) ||
        !validId(templateId)
    ) {
        status(
            "analysisStatus",
            "Invalid election or template.",
            true
        );
        return;
    }

    if (
        String(template.paper_size).toUpperCase() !== "A5"
    ) {
        status(
            "analysisStatus",
            "Only A5 portrait ballots are currently supported.",
            true
        );
        return;
    }

    const version = imageVersion;
    const selectedImage = sourceImage;

    const isCurrent = () => (
        version === imageVersion &&
        selectedImage === sourceImage &&
        electionId === getElectionId() &&
        templateId === getTemplateId()
    );

    busy = true;

    updateAnalyzeButton();
    disableSubmission();

    try {
        status(
            "analysisStatus",
            "Preparing ballot for backend QR and OMR verification..."
        );

        debug(
            "BACKEND-FIRST OMR SCANNING\n" +
            "Browser QR: Optional\n" +
            "Backend QR: Required\n" +
            "Automatic crop: Enabled on backend\n" +
            "Lighting correction: Enabled on backend\n" +
            "Four-marker alignment: Required\n" +
            "Vote counting: Pending"
        );

        // Browser QR failure ay hindi blocking.
        // Backend mismo ang magbabasa ng uploaded QR.
        if ($("qrStatus")) {
            $("qrStatus").textContent =
                "BACKEND VERIFICATION IN PROGRESS\n" +
                "Checking ballot QR and registration marks...";
        }

        // Prepare one A5 ballot image.
        const blob = await imageToBlob();

        if (!isCurrent()) {
            throw new Error(
                "Ballot image or template changed " +
                "during preparation. Please retry."
            );
        }

        const form = new FormData();

        form.append(
            "election_id",
            String(electionId)
        );

        form.append(
            "template_id",
            String(templateId)
        );

        form.append(
            "ballot_image",
            blob,
            "ballot-scan.jpg"
        );

        // Sensitivity control remains display-only.
        // Current backend uses COUNTING_SENSITIVITY = 2.
        status(
            "analysisStatus",
            "Verifying QR, correcting A5 alignment, " +
            "and analyzing shaded bubbles..."
        );

        // Backend ang final authority para sa counting.
        const data = await request(
            "/omr/scan",
            {
                method: "POST",
                body: form
            }
        );

        // Huwag mag-assume ng failure kapag nagbago
        // ang local state habang nagre-request.
        if (!isCurrent()) {
            throw new Error(
                "Image or template changed during scanning. " +
                "Check ballot status before retrying."
            );
        }

        if (
            Number(data.election_id) !== electionId ||
            Number(data.template_id) !== templateId
        ) {
            throw new Error(
                "Backend returned a different election " +
                "or template. Check ballot status before retrying."
            );
        }

        if (data.preview_only !== false) {
            throw new Error(
                "Unexpected backend counting mode. " +
                "Check ballot status before retrying."
            );
        }

        // Final result must come from backend.
        if (
            data.success !== true ||
            data.valid !== true ||
            data.counted !== true ||
            data.status !== "COUNTED" ||
            !validId(data.ballot_id) &&
                !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(
                    String(data.ballot_id || "")
                )
        ) {
            throw new Error(
                "Backend did not return a complete " +
                "confirmed counting result. " +
                "Verify ballot status before retrying."
            );
        }

        // Save successful backend response.
        lastScanResult = data;
        lastQualityIssue = null;

        // Corrected preview only kapag supported.
        displayCorrectedBallotPreview(data);

        // Ipakita ang actual detected votes.
        displayResults(data, true);

        window.confirmedOMRCounting = true;
        retakeRequired = false;

        backendQRPending = false;
        backendQRVerified = true;

        window.campusVoteQRVerified = true;

        qrResult = {
            valid: true,
            status: "COUNTED",
            election_id: electionId,
            template_id: templateId,
            ballot_id: data.ballot_id
        };

        if ($("qrStatus")) {
            $("qrStatus").textContent =
                "QR VALIDATED BY BACKEND\n" +
                "Status: COUNTED\n" +
                `Ballot: ${data.ballot_id}\n` +
                `Template: #${templateId}\n` +
                "Backend counting successful.";
        }

        status(
            "analysisStatus",
            data.message ||
            "Ballot counted successfully. " +
            "Votes saved to Live Results."
        );

        window.showToast?.(
            "Ballot counted successfully! " +
            "Votes saved to Live Results.",
            "success"
        );

        // Huwag i-submit muli ang counted image.
        if ($("analyzeBtn")) {
            $("analyzeBtn").disabled = true;
        }

    } catch (error) {
        // Failed o uncertain scan is never confirmed success.
        window.confirmedOMRCounting = false;

        const payload = error.data || {};
        const messageText = String(error.message || "");

        const duplicate =
            payload.duplicate === true ||
            (
                error.status === 409 &&
                (
                    payload.status === "COUNTED" ||
                    /duplicate|already counted/i.test(messageText)
                )
            );

        const unavailable =
            error.status === 409;

        const blankBallot =
            error.status === 422 &&
            (
                payload.quality_issue === "BLANK_BALLOT" ||
                /blank ballot detected/i.test(messageText)
            );

        // Explicit backend retake response.
        const qualityIssue =
            error.status === 422 &&
            (
                payload.retake_required === true ||
                payload.review_required === true ||
                [
                    "IMAGE",
                    "ALIGNMENT",
                    "CROP",
                    "EXPOSURE",
                    "LIGHTING",
                    "QR",
                    "BUBBLE_ALIGNMENT",
                    "UNCLEAR_SHADING",
                    "BLANK_BALLOT"
                ].includes(payload.quality_issue) ||
                /(?:alignment|registration marks?|four corners|shading|bubble samples?|exposure|lighting|retake|rescan|QR code not detected|insufficient)/i.test(
                    messageText
                )
            );

        let message;

        if (duplicate) {
            retakeRequired = true;

            message =
                "BALLOT ALREADY COUNTED. " +
                "Do not resubmit this ballot. " +
                "Verify its status.";

        } else if (unavailable) {
            retakeRequired = true;

            message =
                "BALLOT UNAVAILABLE. " +
                "The ballot may be void, counted, or otherwise " +
                "ineligible. Verify its status. " +
                messageText;

        } else if (blankBallot) {
            retakeRequired = true;

            message =
                "NO SHADING DETECTED — No votes saved. " +
                "Check the physical ballot and retake " +
                "a clearer photo of the SAME ballot. " +
                messageText;

        } else if (qualityIssue) {
            retakeRequired = true;

            message =
                "RETAKE PHOTO REQUIRED — No votes saved. " +
                "Keep all four registration marks visible, " +
                "avoid glare/shadows, and photograph " +
                "the SAME ballot again. " +
                messageText;

        } else if (!error.status) {
            // Network failure: posibleng na-commit sa server.
            retakeRequired = true;

            message =
                "SCAN STATUS UNKNOWN. " +
                "Check ballot status before retrying. " +
                "Do not assume votes were not saved. " +
                messageText;

        } else if (error.status >= 500) {
            // Server error: maaaring hindi tiyak ang commit.
            retakeRequired = true;

            message =
                "SERVER ERROR — COUNTING STATUS UNKNOWN. " +
                "Verify ballot status before retrying. " +
                messageText;

        } else {
            message =
                "OMR scan failed: " +
                messageText;
        }

        lastQualityIssue =
            payload.quality_issue || null;

        backendQRPending = false;

        // Huwag gawing confirmed ang QR sa failed scan.
        backendQRVerified = false;
        window.campusVoteQRVerified = false;

        status(
            "analysisStatus",
            message,
            true
        );

        window.showToast?.(
            message,
            "error"
        );

        if (retakeRequired) {
            if ($("imageStatus")) {
                status(
                    "imageStatus",
                    duplicate || unavailable
                        ? "Ballot unavailable. Verify ballot status."
                        : !error.status || error.status >= 500
                            ? "Counting status unknown. " +
                              "Verify ballot status before retrying."
                            : "Retake needed: use Open Phone Camera " +
                              "or upload a clearer photo of the SAME ballot.",
                    true
                );
            }

            if ($("results")) {
                $("results").replaceChildren();

                const notice = document.createElement("p");
                notice.className = "error";
                notice.textContent = message;

                $("results").appendChild(notice);
            }

            if ($("qrStatus")) {
                $("qrStatus").textContent =
                    "Scan not confirmed.\n" +
                    (
                        duplicate || unavailable
                            ? "Verify ballot status."
                            : !error.status || error.status >= 500
                                ? "Counting status unknown."
                                : "Backend rejected the scan. " +
                                  "Retake the same ballot."
                    );
            }
        }

        debug(
            "OMR SCAN RESULT\n" +
            message +
            (
                lastQualityIssue
                    ? "\nQuality issue: " + lastQualityIssue
                    : ""
            )
        );

    } finally {
        busy = false;

        // Counted images cannot be submitted again.
        if (window.confirmedOMRCounting === true) {
            if ($("analyzeBtn")) {
                $("analyzeBtn").disabled = true;
            }
        } else {
            updateAnalyzeButton();
        }
    }
}


// RETAKE BALLOT / CLEAR IMAGE

function retakePhoto() {
    // Huwag palitan ang ballot habang may counting request.
    if (busy) {
        status(
            "imageStatus",
            "Please wait for the current scan to finish.",
            true
        );
        return;
    }

    // Stop previous camera stream.
    stopCamera();

    // Clear current ballot state.
    sourceImage = null;
    retakeRequired = false;

    resetBallotVerification();

    // Invalidate previous QR verification requests.
    imageVersion++;

    // Clear original ballot canvas.
    if (ctx && canvas) {
        ctx.clearRect(
            0,
            0,
            canvas.width,
            canvas.height
        );

        canvas.width = 1;
        canvas.height = 1;
    }

    // Clear uploaded image input.
    if ($("fileInput")) {
        $("fileInput").value = "";
    }

    // Clear native phone camera input.
    if ($("phoneCameraInput")) {
        $("phoneCameraInput").value = "";
    }

    // Clear corrected A5 preview.
    clearCorrectedPreview();

    // Reset QR diagnostics.
    if ($("qrStatus")) {
        $("qrStatus").textContent =
            "Waiting for a new ballot image.\n" +
            "Backend QR verification will run during scanning.";
    }

    // Reset analysis results and controls.
    reset();

    status(
        "imageStatus",
        "Ready for a new ballot. " +
        "Open Phone Camera or upload an A5 image."
    );

    debug(
        "No ballot loaded.\n" +
        "Capture or upload an A5 ballot to begin.\n" +
        "Browser QR verification is optional.\n" +
        "Backend QR verification is required."
    );

    updateAnalyzeButton();
}


// SCANNER EVENT LISTENERS

function setupScanner() {
    // Load ballot templates.
    $("loadBtn")?.addEventListener(
        "click",
        async () => {
            if (busy) return;

            await loadTemplates();
        }
    );

    // Select ballot template.
    $("templateSelect")?.addEventListener(
        "change",
        async () => {
            if (busy) return;

            await selectTemplate();
        }
    );

    // Upload ballot image.
    $("fileInput")?.addEventListener(
        "change",
        event => {
            if (busy) {
                status(
                    "imageStatus",
                    "Please wait for the current scan.",
                    true
                );
                return;
            }

            upload(event);
        }
    );

    // Open native phone camera.
    $("cameraBtn")?.addEventListener(
        "click",
        event => {
            event.preventDefault();

            openCamera();
        }
    );

    // Receive captured phone camera photo.
    $("phoneCameraInput")?.addEventListener(
        "change",
        event => {
            if (busy) {
                status(
                    "imageStatus",
                    "Please wait for the current scan.",
                    true
                );
                return;
            }

            phoneCameraCapture(event);
        }
    );

    // Legacy capture button.
    $("captureBtn")?.addEventListener(
        "click",
        event => {
            event.preventDefault();

            capture();
        }
    );

    // Stop camera.
    $("stopCameraBtn")?.addEventListener(
        "click",
        event => {
            event.preventDefault();

            stopCamera();
        }
    );

    // Scan and count one A5 ballot.
    $("analyzeBtn")?.addEventListener(
        "click",
        async event => {
            event.preventDefault();

            if (busy) return;

            if (window.confirmedOMRCounting === true) {
                status(
                    "analysisStatus",
                    "This ballot has already been counted. " +
                    "Load a new ballot before scanning again.",
                    true
                );
                return;
            }

            if (retakeRequired) {
                status(
                    "analysisStatus",
                    "Retake or verify ballot status before scanning again.",
                    true
                );
                return;
            }

            // Backend-first QR and OMR processing.
            await backendPreview();
        }
    );

    // Prevent legacy submission.
    $("submitBtn")?.addEventListener(
        "click",
        event => {
            event.preventDefault();

            status(
                "analysisStatus",
                "Use Scan & Count Ballot " +
                "for OMR processing.",
                true
            );
        }
    );

    // Retake or clear the ballot.
    $("retakeBtn")?.addEventListener(
        "click",
        event => {
            event.preventDefault();

            retakePhoto();
        }
    );

    // Optional sensitivity control.
    $("sensitivity")?.addEventListener(
        "input",
        () => {
            const sensitivity = $("sensitivity");
            const sensitivityValue = $("sensitivityValue");

            if (!sensitivity || !sensitivityValue) {
                return;
            }

            const names = {
                1: "Strict",
                2: "Balanced",
                3: "Light Shade"
            };

            sensitivityValue.textContent =
                names[sensitivity.value] || "Balanced";
        }
    );

    // Initial button states.
    disableSubmission();

    if ($("captureBtn")) {
        $("captureBtn").disabled = true;
    }

    if ($("stopCameraBtn")) {
        $("stopCameraBtn").disabled = true;
    }

    if ($("qrStatus")) {
        $("qrStatus").textContent =
            "QR not scanned yet.\n" +
            "Backend will verify the ballot during scanning.";
    }

    if ($("imageStatus")) {
        status(
            "imageStatus",
            "Ready. Open Phone Camera or upload " +
            "an A5 ballot image."
        );
    }

    updateAnalyzeButton();

    // Load current election.
    currentElection();
}


// CLEANUP WHEN LEAVING PAGE

window.addEventListener(
    "pagehide",
    () => {
        stopCamera();
        clearCorrectedPreview();
    }
);


// INITIALIZATION

if (document.readyState === "loading") {
    document.addEventListener(
        "DOMContentLoaded",
        setupScanner,
        { once: true }
    );
} else {
    setupScanner();
}
