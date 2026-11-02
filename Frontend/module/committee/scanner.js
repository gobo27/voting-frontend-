
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

let qrData = null;
let qrResult = null;

window.campusVoteQRVerified = false;
window.confirmedOMRCounting = false;

const canvas = $("scanCanvas");
const ctx = canvas.getContext("2d", {
    willReadFrequently: true
});


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

function updateAnalyzeButton() {
    const button = $("analyzeBtn");

    if (!button) return;

    button.disabled =
        busy ||
        !template ||
        !sourceImage ||
        !validId(getElectionId()) ||
        !validId(getTemplateId());
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

    disableSubmission();
    updateAnalyzeButton();
}


// ELECTION AND TEMPLATES


async function loadTemplates() {
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

        select.replaceChildren(
            new Option("Select a template", "")
        );

        for (const item of data.templates || []) {
            if (!["A4", "A5"].includes(item.paper_size)) {
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

        qrData = null;
        qrResult = null;

        window.campusVoteQRVerified = false;

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
    template = null;
    coordinates = [];

    qrData = null;
    qrResult = null;

    window.campusVoteQRVerified = false;

    const version = ++imageVersion;
    const id = $("templateSelect").value;

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

        template = data.template;
        coordinates = data.coordinates;

        status(
            "scannerStatus",
            `Template #${id} loaded ` +
            `(${template.paper_size}), ` +
            `${coordinates.length} bubbles.`
        );

        reset();

        if (sourceImage) {
            await debugQR();
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

        $("electionId").value = id;

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
    if (!sourceImage) return;

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

function showImage(image) {
    imageVersion++;

    sourceImage = image;

    qrData = null;
    qrResult = null;

    window.campusVoteQRVerified = false;

    drawOriginal();
    reset();

    status(
        "imageStatus",
        `Image loaded: ${canvas.width} × ` +
        `${canvas.height}. Checking QR code...`
    );

    if ($("qrStatus")) {
        $("qrStatus").textContent =
            "Automatically reading QR code...";
    }

    // Automatic QR verification after photo capture.
    // This does NOT count votes.
    if (template && validId(getTemplateId())) {
        debugQR().then(result => {
            if (result && sourceImage === image) {
                status(
                    "imageStatus",
                    "Ballot image loaded. QR verified. " +
                    "Ready for Scan & Count Ballot."
                );
            }
        }).catch(error => {
            if (sourceImage === image) {
                status(
                    "imageStatus",
                    "Image loaded, but QR verification failed: " +
                    error.message,
                    true
                );
            }
        });
    } else {
        status(
            "imageStatus",
            "Image loaded. Select a ballot template " +
            "to verify its QR code."
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
        file.size > 10 * 1024 * 1024
    ) {
        status(
            "imageStatus",
            "Use PNG/JPG/WEBP up to 10MB.",
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


// DIRECT PHONE CAMERA - OPTION 1


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

    // After the native camera returns the photo,
    // showImage() automatically starts QR verification.
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

    // First attempt: scan the entire ballot image.

    let result = window.jsQR(
        image.data,
        image.width,
        image.height,
        {
            inversionAttempts: "attemptBoth"
        }
    );

    // Second attempt: scan the top-right area
    // where the ballot QR code is normally printed.

    if (!result) {
        const temp = document.createElement("canvas");

        temp.width = image.width;
        temp.height = image.height;

        const c = temp.getContext("2d", {
            willReadFrequently: true
        });

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
            "QR NOT DETECTED. " +
            "Retake a clearer photo with the " +
            "entire A5 ballot visible."
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

    const parts = raw.split("|");

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
        ballot_id: parts[2],
        template_id: qrTemplateId
    };
}


// AUTOMATIC QR VERIFICATION


async function debugQR() {
    const version = imageVersion;
    const selectedImage = sourceImage;
    const selectedTemplateId = getTemplateId();
    const selectedElectionId = getElectionId();

    // Clear the previous QR verification result.

    qrData = null;
    qrResult = null;

    window.campusVoteQRVerified = false;

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

        if ($("qrStatus")) {
            $("qrStatus").textContent =
                "Reading QR code automatically...";
        }

        //Detect QR from the captured image.

        const raw = readQR();

        //Check the ballot.

        const parsedQR = validateQR(raw);

        if (
            version !== imageVersion ||
            selectedImage !== sourceImage ||
            selectedTemplateId !== getTemplateId() ||
            selectedElectionId !== getElectionId()
        ) {
            return null;
        }

        if ($("qrStatus")) {
            $("qrStatus").textContent =
                "QR DETECTED\n" +
                "Checking ballot record with server...";
        }

        //Verify the ballot with the backend.

        const data = await request("/omr/verify-qr", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                qr_data: raw
            })
        });

        if (
            version !== imageVersion ||
            selectedImage !== sourceImage ||
            selectedTemplateId !== getTemplateId() ||
            selectedElectionId !== getElectionId()
        ) {
            return null;
        }

        //Reject duplicate ballots.

        if (
            data.duplicate === true ||
            data.status === "COUNTED"
        ) {
            throw new Error(
                "DUPLICATE BALLOT. " +
                "This ballot has already been counted."
            );
        }

        //Reject void ballots.

        if (data.status === "VOID") {
            throw new Error(
                "VOID BALLOT. " +
                "This ballot cannot be counted."
            );
        }

        //Check supported ballot status.

        if (!["ISSUED", "CAST"].includes(data.status)) {
            throw new Error(
                "Unsupported ballot status: " +
                (data.status || "UNKNOWN")
            );
        }

        // Require explicit backend validation.

        if (data.valid !== true) {
            throw new Error(
                "QR verification was not approved " +
                "by the backend."
            );
        }

        // Save verified QR information.

        qrData = raw;
        qrResult = {
            ...data,
            parsedQR
        };

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
            "You can now press Scan & Count Ballot."
        );

        debug(
            "QR VERIFICATION SUCCESSFUL\n" +
            `Election: #${parsedQR.election_id}\n` +
            `Template: #${parsedQR.template_id}\n` +
            `Ballot status: ${data.status}\n` +
            "No votes have been saved yet."
        );

        return data;

    } catch (error) {

        if (
            version === imageVersion &&
            selectedImage === sourceImage &&
            selectedTemplateId === getTemplateId() &&
            selectedElectionId === getElectionId()
        ) {
            qrData = null;
            qrResult = null;

            window.campusVoteQRVerified = false;

            if ($("qrStatus")) {
                $("qrStatus").textContent =
                    "QR VERIFICATION FAILED\n" +
                    error.message;
            }

            status(
                "imageStatus",
                error.message,
                true
            );

            debug(
                "QR VERIFICATION ERROR\n" +
                error.message
            );
        }

        throw error;
    }
}

// CONVERT BALLOT IMAGE TO PNG BLOB


async function imageToBlob() {
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

    const c = temp.getContext("2d");

    if (!c) {
        throw new Error(
            "Unable to create image canvas."
        );
    }

    c.drawImage(
        sourceImage,
        0,
        0,
        temp.width,
        temp.height
    );

    return new Promise((resolve, reject) => {
        temp.toBlob(blob => {
            if (blob) {
                resolve(blob);
            } else {
                reject(
                    new Error(
                        "Unable to prepare ballot image."
                    )
                );
            }
        }, "image/png");
    });
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

        `Mode: ${
            countingEnabled
                ? "LIVE COUNTING"
                : "READ ONLY"
        }`,

        `Template: #${getTemplateId()} ` +
        `(${data.paper_size || template?.paper_size || "A5"})`,

        `Source: ${
            data.source?.width || "?"
        } × ${
            data.source?.height || "?"
        }`,

        `Markers: ${
            data.markers_detected ?? "?"
        } detected`,

        `Sensitivity: ${
            data.sensitivity || "Balanced"
        }`,

        `Positions: ${positions.length}`,

        `Selected bubbles: ${
            data.selected_bubbles ?? "?"
        }`,

        `Overvotes: ${
            data.overvotes ?? "?"
        }`,

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

        // ---------------------------------------------
        // DISPLAY CANDIDATES AND SHADED BUBBLES
        // ---------------------------------------------

        for (const candidate of position.candidates || []) {
            const filled = candidate.filled === true;

            const candidateText =
                `${filled ? "●" : "○"} ` +
                `${candidate.name || "Unknown Candidate"} - ` +
                `${filled ? "SHADED" : "BLANK"}`;

            const p = document.createElement("p");

            p.textContent = candidateText;

            if (filled) {
                p.className = "valid";
            }

            section.appendChild(p);
            lines.push(candidateText);
        }

        // ---------------------------------------------
        // POSITION VALIDATION
        // ---------------------------------------------

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

        } else if (result.startsWith("SKIPPED")) {
            info.textContent = "SKIPPED: UNCLEAR SHADE";
            info.className = "overvote";

        } else if (result === "BLANK") {
            info.textContent = "BLANK POSITION";

        } else {
            info.textContent = countingEnabled
                ? "VALID POSITION"
                : "VALID POSITION";

            info.className = "valid";
        }

        section.appendChild(info);
        results.appendChild(section);

        lines.push(info.textContent, "");
    }
    // COUNTING SUMMARY
    const summary = document.createElement("div");
    summary.className = "counting-note";

    if (countingEnabled && data.counted === true) {
        const savedVotes = Number(
            data.saved_votes ?? 0
        );

        summary.textContent =
            `Ballot counted successfully. ` +
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


// BACKEND OMR PROCESSING AND LIVE VOTE COUNTING


async function backendPreview() {
    // Prevent simultaneous scans.

    if (busy) return;

    
    // STEP 1: CHECK TEMPLATE AND IMAGE
    

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

    const version = imageVersion;
    const selectedImage = sourceImage;

    busy = true;
    updateAnalyzeButton();
    disableSubmission();

    try {
        
        // STEP 2: VERIFY QR CODE
        

        status(
            "analysisStatus",
            "Verifying QR code..."
        );

        debug(
            "Checking ballot QR code before OMR counting..."
        );

        // Always reverify before counting.
        // The backend must independently verify the QR.

        await debugQR();

        if (
            version !== imageVersion ||
            selectedImage !== sourceImage ||
            electionId !== getElectionId() ||
            templateId !== getTemplateId()
        ) {
            throw new Error(
                "Ballot image or template changed " +
                "during verification. Please retry."
            );
        }

        if (
            window.campusVoteQRVerified !== true ||
            !qrData ||
            !qrResult
        ) {
            throw new Error(
                "QR verification failed. " +
                "No votes will be counted."
            );
        }

        
        // STEP 3: PREPARE BALLOT IMAGE
        

        status(
            "analysisStatus",
            "Preparing ballot image for OMR scanning..."
        );

        const blob = await imageToBlob();

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
            "ballot-scan.png"
        );

        
        // STEP 4: SEND TO BACKEND
        

        status(
            "analysisStatus",
            "Checking registration marks and shaded bubbles..."
        );

        debug(
            "OMR PROCESSING\n" +
            "QR: Verified\n" +
            "Checking four registration marks...\n" +
            "Analyzing shaded bubbles...\n" +
            "Waiting for backend counting result..."
        );

        // The /omr/scan endpoint is responsible for:
        // - QR validation
        // - Registration mark alignment
        // - Bubble detection
        // - Vote limit validation
        // - Duplicate ballot protection
        // - Database vote counting

        const data = await request(
            "/omr/scan",
            {
                method: "POST",
                body: form
            }
        );

        
        // STEP 5: CHECK RESPONSE CONTEXT
        

        if (
            version !== imageVersion ||
            selectedImage !== sourceImage ||
            electionId !== getElectionId() ||
            templateId !== getTemplateId()
        ) {
            throw new Error(
                "Image or template changed during scanning. " +
                "Check the ballot status before retrying."
            );
        }

        if (
            Number(data.election_id) !== electionId ||
            Number(data.template_id) !== templateId
        ) {
            throw new Error(
                "Backend returned a different " +
                "election or template. " +
                "Check ballot status before retrying."
            );
        }

        if (data.preview_only !== false) {
            throw new Error(
                "Unexpected backend counting mode. " +
                "Check ballot status before retrying."
            );
        }

        
        // STEP 6: DISPLAY DETECTED RESULTS
        

        displayResults(data, true);

        
        // STEP 7: CONFIRM ACTUAL COUNTING
        

        if (
            data.counted === true &&
            data.valid === true
        ) {
            window.confirmedOMRCounting = true;

            if ($("qrStatus")) {
                $("qrStatus").textContent =
                    "QR VALIDATED\n" +
                    "Status: COUNTED\n" +
                    "Template: #" + templateId + "\n" +
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

            // Prevent another scan of the same image.
            if ($("analyzeBtn")) {
                $("analyzeBtn").disabled = true;
            }

        } else {
            window.confirmedOMRCounting = false;

            status(
                "analysisStatus",
                data.message ||
                "Ballot was not confirmed as counted.",
                true
            );

            window.showToast?.(
                "Ballot was not confirmed as counted.",
                "warning"
            );
        }

    } catch (error) {
        
        // STEP 8: HANDLE REJECTED OR FAILED BALLOTS
        

        window.confirmedOMRCounting = false;

        const duplicate =
            error.data?.duplicate === true ||
            error.status === 409;

        const blankBallot =
            error.status === 422 &&
            error.message?.includes(
                "Blank ballot detected"
            );

        let message;

        if (blankBallot) {
            message =
                "Blank ballot detected. No votes saved. " +
                "This ballot can still be used.";

            window.showToast?.(
                message,
                "warning"
            );

        } else if (duplicate) {
            message =
                "Duplicate or unavailable ballot. " +
                "No new votes saved.";

            window.showToast?.(
                message,
                "error"
            );

        } else {
            message =
                "OMR scan failed: " +
                error.message;

            window.showToast?.(
                message,
                "error"
            );
        }

        status(
            "analysisStatus",
            message,
            !blankBallot
        );

        debug(
            "OMR SCAN RESULT\n" +
            message
        );

    } finally {
        busy = false;

        // Keep counted images from being submitted again.
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
    // Prevent changing the image during counting.

    if (busy) {
        status(
            "imageStatus",
            "Please wait for the current scan to finish.",
            true
        );
        return;
    }

    // Stop any previous live camera stream.

    stopCamera();

    // Clear previous ballot information.

    sourceImage = null;
    qrData = null;
    qrResult = null;

    window.campusVoteQRVerified = false;
    window.confirmedOMRCounting = false;

    // Invalidate any previous QR verification requests.

    imageVersion++;

    // Clear ballot preview.

    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );

    canvas.width = 1;
    canvas.height = 1;

    // Clear uploaded image input.

    if ($("fileInput")) {
        $("fileInput").value = "";
    }

    // Clear native phone camera input.

    if ($("phoneCameraInput")) {
        $("phoneCameraInput").value = "";
    }

    // Reset QR diagnostics.

    if ($("qrStatus")) {
        $("qrStatus").textContent =
            "Waiting for a new ballot image.";
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
        "Capture or upload an A5 ballot to begin."
    );

    updateAnalyzeButton();
}


// SCANNER EVENT LISTENERS


function setupScanner() {

    // ---------------------------------------------
    // LOAD BALLOT TEMPLATES
    // ---------------------------------------------

    $("loadBtn")?.addEventListener(
        "click",
        async () => {
            if (busy) return;

            await loadTemplates();
        }
    );

    // ---------------------------------------------
    // SELECT BALLOT TEMPLATE
    // ---------------------------------------------

    $("templateSelect")?.addEventListener(
        "change",
        async () => {
            if (busy) return;

            await selectTemplate();
        }
    );

    // ---------------------------------------------
    // UPLOAD BALLOT IMAGE
    // ---------------------------------------------

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

    // ---------------------------------------------
    // OPEN NATIVE PHONE CAMERA
    // ---------------------------------------------

    $("cameraBtn")?.addEventListener(
        "click",
        event => {
            event.preventDefault();

            openCamera();
        }
    );

    // ---------------------------------------------
    // RECEIVE CAPTURED PHONE CAMERA PHOTO
    // ---------------------------------------------

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

    // ---------------------------------------------
    // LEGACY CAPTURE BUTTON
    // ---------------------------------------------

    $("captureBtn")?.addEventListener(
        "click",
        event => {
            event.preventDefault();

            capture();
        }
    );

    // ---------------------------------------------
    // STOP CAMERA
    // ---------------------------------------------

    $("stopCameraBtn")?.addEventListener(
        "click",
        event => {
            event.preventDefault();

            stopCamera();
        }
    );

    // ---------------------------------------------
    // SCAN AND COUNT BALLOT
    // ---------------------------------------------

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

            await backendPreview();
        }
    );

    // ---------------------------------------------
    // PREVENT LEGACY SUBMISSION
    // ---------------------------------------------

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

    // ---------------------------------------------
    // RETAKE / CLEAR BALLOT
    // ---------------------------------------------

    $("retakeBtn")?.addEventListener(
        "click",
        event => {
            event.preventDefault();

            retakePhoto();
        }
    );

    // ---------------------------------------------
    // OPTIONAL SENSITIVITY CONTROL
    // ---------------------------------------------

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

    // ---------------------------------------------
    // INITIAL BUTTON STATES
    // ---------------------------------------------

    disableSubmission();

    if ($("captureBtn")) {
        $("captureBtn").disabled = true;
    }

    if ($("stopCameraBtn")) {
        $("stopCameraBtn").disabled = true;
    }

    if ($("qrStatus")) {
        $("qrStatus").textContent =
            "QR not scanned yet.";
    }

    if ($("imageStatus")) {
        status(
            "imageStatus",
            "Ready. Open Phone Camera or upload " +
            "an A5 ballot image."
        );
    }

    updateAnalyzeButton();

    // ---------------------------------------------
    // LOAD CURRENT ELECTION
    // ---------------------------------------------

    currentElection();
}


// CLEANUP WHEN LEAVING PAGE


window.addEventListener(
    "pagehide",
    () => {
        stopCamera();
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
