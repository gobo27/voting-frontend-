
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
const ctx = canvas.getContext("2d", { willReadFrequently: true });

// AUTHENTICATION

function token() {
    return sessionStorage.getItem("voting_token") ||
        localStorage.getItem("voting_token") ||
        localStorage.getItem("token");
}

function validId(value) {
    return Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

function getElectionId() {
    return Number($("electionId")?.value);
}

function getTemplateId() {
    return Number($("templateSelect")?.value);
}

async function request(path, options = {}) {
    const t = token();
    if (!t) throw new Error("Session not found. Please log in again.");

    const response = await fetch(API_BASE + path, {
        ...options,
        headers: {
            Authorization: "Bearer " + t,
            ...(options.headers || {})
        }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        const error = new Error(data.message || `API error ${response.status}`);
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
    if ($("debugInfo")) $("debugInfo").textContent = message;
}

function disableSubmission() {
    if ($("submitBtn")) $("submitBtn").disabled = true;
}

function reset() {
    if ($("results")) {
        $("results").innerHTML = "<p>No ballot analyzed yet.</p>";
    }

    if ($("analyzeBtn")) {
        $("analyzeBtn").disabled = busy || !template || !sourceImage;
    }

    status("analysisStatus", "");
    debug("Load a template and image, then analyze.");
    disableSubmission();
}

// ELECTION AND TEMPLATES

async function loadTemplates() {
    try {
        const electionId = getElectionId();

        if (!validId(electionId)) {
            throw new Error("Current election ID unavailable.");
        }

        const data = await request(`/ballots/templates/election/${electionId}`);
        const select = $("templateSelect");

        select.replaceChildren(new Option("Select a template", ""));

        for (const item of data.templates || []) {
            if (!["A4", "A5"].includes(item.paper_size)) continue;

            select.add(new Option(
                `#${item.template_id} - ${item.template_name} (${item.paper_size})`,
                item.template_id
            ));
        }

        template = null;
        coordinates = [];
        qrData = null;
        qrResult = null;
        window.campusVoteQRVerified = false;

        imageVersion++;
        reset();

        status("scannerStatus", `${select.options.length - 1} templates loaded.`);
    } catch (error) {
        status("scannerStatus", error.message, true);
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
        const data = await request(`/ballots/templates/${encodeURIComponent(id)}`);

        if (version !== imageVersion) return;

        if (!data.template ||
            !Array.isArray(data.coordinates) ||
            !data.coordinates.length) {
            throw new Error("Template or coordinates missing.");
        }

        template = data.template;
        coordinates = data.coordinates;

        status(
            "scannerStatus",
            `Template #${id} loaded (${template.paper_size}), ${coordinates.length} bubbles.`
        );

        reset();

        if (sourceImage) await debugQR();
    } catch (error) {
        if (version === imageVersion) {
            status("scannerStatus", error.message, true);
        }
    }
}

async function currentElection() {
    try {
        const data = await request("/positions/election/current");

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
            throw new Error("Current election ID not found.");
        }

        $("electionId").value = id;
        await loadTemplates();
    } catch (error) {
        status(
            "scannerStatus",
            "Failed to load current election: " + error.message,
            true
        );
    }
}

// IMAGE HANDLING

function drawOriginal() {
    if (!sourceImage) return;

    canvas.width = sourceImage.naturalWidth || sourceImage.width;
    canvas.height = sourceImage.naturalHeight || sourceImage.height;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);
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
        `Image loaded: ${canvas.width} × ${canvas.height}.`
    );

    if ($("qrStatus")) {
        $("qrStatus").textContent = "QR will be checked during analysis.";
    }
}

function upload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (
        !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
        file.size > 10 * 1024 * 1024
    ) {
        status("imageStatus", "Use PNG/JPG/WEBP up to 10MB.", true);
        return;
    }

    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
        showImage(image);
        URL.revokeObjectURL(url);
    };

    image.onerror = () => {
        URL.revokeObjectURL(url);
        status("imageStatus", "Cannot open image.", true);
    };

    image.src = url;
}

// CAMERA

async function openCamera() {
    try {
        stopCamera();

        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error("Camera requires HTTPS or localhost.");
        }

        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: "environment" }
            },
            audio: false
        });

        $("video").srcObject = cameraStream;
        $("video").style.display = "block";
        $("captureBtn").disabled = false;
        $("stopCameraBtn").disabled = false;

        status(
            "imageStatus",
            "Camera ready. Position the entire ballot inside the frame."
        );
    } catch (error) {
        status("imageStatus", "Camera unavailable: " + error.message, true);
    }
}

function stopCamera() {
    cameraStream?.getTracks().forEach(track => track.stop());
    cameraStream = null;

    if ($("video")) {
        $("video").srcObject = null;
        $("video").style.display = "none";
    }

    if ($("captureBtn")) $("captureBtn").disabled = true;
    if ($("stopCameraBtn")) $("stopCameraBtn").disabled = true;
}

function capture() {
    const video = $("video");

    if (!video.videoWidth) {
        status("imageStatus", "Camera is not ready.", true);
        return;
    }

    const temp = document.createElement("canvas");
    temp.width = video.videoWidth;
    temp.height = video.videoHeight;

    temp.getContext("2d").drawImage(video, 0, 0);

    const image = new Image();

    image.onload = () => showImage(image);
    image.src = temp.toDataURL("image/png");

    stopCamera();
}

// QR DETECTION

function getSource() {
    if (!sourceImage) {
        throw new Error("No image loaded.");
    }

    const temp = document.createElement("canvas");

    temp.width = sourceImage.naturalWidth || sourceImage.width;
    temp.height = sourceImage.naturalHeight || sourceImage.height;

    const c = temp.getContext("2d", { willReadFrequently: true });

    c.drawImage(sourceImage, 0, 0);

    return c.getImageData(0, 0, temp.width, temp.height);
}

function readQR() {
    if (typeof window.jsQR !== "function") {
        throw new Error("QR library not loaded. Check jsQR.min.js.");
    }

    const image = getSource();

    let result = window.jsQR(
        image.data,
        image.width,
        image.height,
        { inversionAttempts: "attemptBoth" }
    );

    if (!result) {
        const temp = document.createElement("canvas");

        temp.width = image.width;
        temp.height = image.height;

        const c = temp.getContext("2d", { willReadFrequently: true });
        c.putImageData(image, 0, 0);

        const x = Math.floor(image.width * 0.65);

        const crop = c.getImageData(
            x,
            0,
            image.width - x,
            Math.max(1, Math.floor(image.height * 0.4))
        );

        result = window.jsQR(
            crop.data,
            crop.width,
            crop.height,
            { inversionAttempts: "attemptBoth" }
        );
    }

    if (!result) {
        throw new Error("QR NOT DETECTED. Retake a clearer photo.");
    }

    return result.data;
}

function validateQR(raw) {
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
        throw new Error("INVALID QR CODE. Not a CampusVote ballot.");
    }

    if (Number(parts[1]) !== getElectionId()) {
        throw new Error(
            "WRONG ELECTION. This ballot belongs to another election."
        );
    }

    if (Number(parts[3]) !== getTemplateId()) {
        throw new Error(
            `TEMPLATE MISMATCH. QR belongs to template #${parts[3]}.`
        );
    }

    return {
        election_id: Number(parts[1]),
        ballot_id: parts[2],
        template_id: Number(parts[3])
    };
}

// QR VERIFICATION

async function debugQR() {
    const version = imageVersion;
    const selectedImage = sourceImage;

    window.campusVoteQRVerified = false;

    try {
        if (!sourceImage) {
            throw new Error("No image loaded.");
        }

        if ($("qrStatus")) {
            $("qrStatus").textContent = "Reading QR code...";
        }

        const raw = readQR();
        validateQR(raw);

        if (version !== imageVersion || selectedImage !== sourceImage) {
            return null;
        }

        const data = await request("/omr/verify-qr", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ qr_data: raw })
        });

        if (version !== imageVersion || selectedImage !== sourceImage) {
            return null;
        }

        if (data.duplicate || data.status === "COUNTED") {
            throw new Error(
                "DUPLICATE BALLOT. This ballot has already been counted."
            );
        }

        if (data.status === "VOID") {
            throw new Error(
                "VOID BALLOT. This ballot cannot be counted."
            );
        }

        if (!["ISSUED", "CAST"].includes(data.status)) {
            throw new Error(
                "Unsupported ballot status: " + data.status
            );
        }

        qrData = raw;
        qrResult = data;
        window.campusVoteQRVerified = data.valid === true;

        if ($("qrStatus")) {
            $("qrStatus").textContent =
                `QR DETECTED\nStatus: ${data.status}\n` +
                `Duplicate: NO\nTemplate: #${getTemplateId()}\n` +
                (data.status === "ISSUED"
                    ? "QR verified. Ready for backend OMR counting."
                    : "Ready for OMR analysis.");
        }

        return data;
    } catch (error) {
        if (version === imageVersion && selectedImage === sourceImage) {
            if ($("qrStatus")) {
                $("qrStatus").textContent = error.message;
            }
        }

        throw error;
    }
}

// IMAGE CONVERSION

async function imageToBlob() {
    if (!sourceImage) {
        throw new Error("No ballot image.");
    }

    const temp = document.createElement("canvas");

    temp.width = sourceImage.naturalWidth || sourceImage.width;
    temp.height = sourceImage.naturalHeight || sourceImage.height;

    temp.getContext("2d").drawImage(sourceImage, 0, 0);

    return new Promise((resolve, reject) => {
        temp.toBlob(blob => {
            if (blob) {
                resolve(blob);
            } else {
                reject(new Error("Unable to prepare ballot image."));
            }
        }, "image/png");
    });
}

// OMR RESULTS

function displayResults(data, countingEnabled) {
    const positions = Array.isArray(data.positions)
        ? data.positions
        : [];

    const results = $("results");
    results.replaceChildren();

    const lines = [
        countingEnabled ? "OMR COUNTING RESULT" : "BACKEND OMR PREVIEW",
        `Mode: ${countingEnabled ? "LIVE COUNTING" : "READ ONLY"}`,
        `Template: #${getTemplateId()} (${data.paper_size || template.paper_size})`,
        `Source: ${data.source?.width || "?"} × ${data.source?.height || "?"}`,
        `Markers: ${data.markers_detected ?? "?"} detected`,
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

        title.textContent =
            `${position.position_name} (${position.marked}/${position.max_selection})`;

        section.appendChild(title);
        lines.push(title.textContent);

        for (const candidate of position.candidates || []) {
            const text =
                `${candidate.filled ? "●" : "○"} ${candidate.name} - ` +
                (candidate.filled ? "SHADED" : "BLANK");

            const p = document.createElement("p");

            p.textContent = text;
            section.appendChild(p);
            lines.push(text);
        }

        const result = position.result ||
            (position.overvoted
                ? "SKIPPED_OVERVOTE"
                : Number(position.marked) === 0
                    ? "BLANK"
                    : "VALID");

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
                ? "COUNTED POSITION"
                : "VALID POSITION";

            info.className = "valid";
        }

        section.appendChild(info);
        results.appendChild(section);
        lines.push(info.textContent, "");
    }

    lines.push(
        countingEnabled
            ? `Saved votes: ${data.saved_votes ?? 0}`
            : "Preview only: no votes saved."
    );

    debug(lines.join("\n"));
}

// BACKEND OMR PROCESSING

async function backendPreview() {
    if (busy) return;

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

    if (!validId(electionId) || !validId(templateId)) {
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
    $("analyzeBtn").disabled = true;
    disableSubmission();

    try {
        status(
            "analysisStatus",
            "Reading QR and analyzing ballot..."
        );

        debug(
            "Checking QR, registration markers and shaded bubbles..."
        );

        await debugQR();

        if (version !== imageVersion || selectedImage !== sourceImage) {
            throw new Error(
                "Image changed during analysis. Please retry."
            );
        }

        const countingEnabled =true;

        const blob = await imageToBlob();
        const form = new FormData();

        form.append("election_id", String(electionId));
        form.append("template_id", String(templateId));
        form.append("ballot_image", blob, "ballot-scan.png");

        status(
            "analysisStatus",
            "Checking alignment and detecting shaded bubbles..."
        );

        const data = await request(
            countingEnabled ? "/omr/scan" : "/omr/preview",
            {
                method: "POST",
                body: form
            }
        );

        if (version !== imageVersion || selectedImage !== sourceImage) {
            throw new Error(
                "Image changed. Please retry."
            );
        }

        if (
            Number(data.election_id) !== electionId ||
            Number(data.template_id) !== templateId
        ) {
            throw new Error(
                "Backend returned a different election or template."
            );
        }

        if (data.preview_only !== !countingEnabled) {
            throw new Error(
                "Unexpected backend counting mode."
            );
        }

        displayResults(data, countingEnabled);

        if (
            countingEnabled &&
            data.counted === true &&
            data.valid === true
        ) {
            if ($("qrStatus")) {
                $("qrStatus").textContent =
                    `QR VALIDATED\n` +
                    `Status: COUNTED\n` +
                    `Duplicate: NO\n` +
                    `Template: #${templateId}\n` +
                    `Backend counting successful.`;
            }

            window.showToast?.(
                "Ballot counted successfully! Votes saved to Live Results.",
                "success"
            );
        }

        status(
            "analysisStatus",
            data.message ||
            (countingEnabled
                ? "Ballot counted successfully."
                : "OMR preview complete."),
            data.valid === false
        );
    } catch (error) {
        const duplicate =
            error.data?.duplicate === true ||
            error.status === 409;

        const blankBallot =
            error.status === 422 &&
            error.message?.includes("Blank ballot detected");

        let message;

        if (blankBallot) {
            message =
                "Blank ballot detected. No votes saved. " +
                "This ballot can still be used.";

            window.showToast?.(message, "warning");

        } else if (duplicate) {
            message =
                "Duplicate or unavailable ballot. No new votes saved.";

            window.showToast?.(message, "error");

        } else {
            message = "OMR scan failed: " + error.message;

            window.showToast?.(message, "error");
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
        updateAnalyzeButton();
    }
}

// RETAKE BALLOT

function retakePhoto() {
    if (busy) return;

    sourceImage = null;
    qrData = null;
    qrResult = null;
    window.campusVoteQRVerified = false;

    imageVersion++;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = 1;
    canvas.height = 1;

    if ($("fileInput")) {
        $("fileInput").value = "";
    }

    if ($("qrStatus")) {
        $("qrStatus").textContent =
            "Waiting for a new ballot image.";
    }

    status(
        "imageStatus",
        "Retake or upload a new photo."
    );

    reset();
}

// EVENT LISTENERS

function setupScanner() {
    $("loadBtn")?.addEventListener("click", loadTemplates);
    $("templateSelect")?.addEventListener("change", selectTemplate);
    $("fileInput")?.addEventListener("change", upload);
    $("cameraBtn")?.addEventListener("click", openCamera);
    $("captureBtn")?.addEventListener("click", capture);
    $("stopCameraBtn")?.addEventListener("click", stopCamera);

    $("analyzeBtn")?.addEventListener("click", event => {
        event.preventDefault();
        backendPreview();
    });

    $("submitBtn")?.addEventListener("click", event => {
        event.preventDefault();

        status(
            "analysisStatus",
            "Use Analyze Ballot for OMR processing.",
            true
        );
    });

    $("retakeBtn")?.addEventListener("click", retakePhoto);

    $("sensitivity")?.addEventListener("input", () => {
        const names = {
            1: "Strict",
            2: "Balanced",
            3: "Light Shade"
        };

        $("sensitivityValue").textContent =
            names[$("sensitivity").value] || "Balanced";
    });

    disableSubmission();
    currentElection();
}

// INITIALIZATION

if (document.readyState === "loading") {
    document.addEventListener(
        "DOMContentLoaded",
        setupScanner
    );
} else {
    setupScanner();
}
