
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

// Crop state para sa A5 document correction.
let originalImage = null;
let cropCorners = null;
let cropConfirmed = false;
let cropEditing = false;
let cropDragging = null;
let cropProcessing = false;
let cropDetectionConfidence = null;

let cropSourceVersion = 0;

const A5_WIDTH_MM = 148.5;
const A5_HEIGHT_MM = 210;

const CROP_OUTPUT_WIDTH = 1800;
const CROP_OUTPUT_HEIGHT = Math.round(
    CROP_OUTPUT_WIDTH *
    A5_HEIGHT_MM /
    A5_WIDTH_MM
);

const CROP_CORNER_NAMES = [
    "tl",
    "tr",
    "br",
    "bl"
];

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

// Hindi puwedeng mag-count habang ina-adjust ang crop.
function updateAnalyzeButton() {
    const button = $("analyzeBtn");

    if (!button) return;

    button.disabled =
        busy ||
        cropProcessing ||
        cropEditing ||
        cropConfirmed !== true ||
        window.confirmedOMRCounting === true ||
        window.campusVoteQRVerified !== true ||
        !template ||
        !sourceImage ||
        !validId(getElectionId()) ||
        !validId(getTemplateId());
}

function updateCropButtons() {
    const hasImage = Boolean(originalImage);

    const autoButton = $("cropAutoBtn");
    const resetButton = $("cropResetBtn");
    const confirmButton = $("cropConfirmBtn");

    if (autoButton) {
        autoButton.disabled =
            !hasImage ||
            busy ||
            cropProcessing ||
            window.confirmedOMRCounting === true;
    }

    if (resetButton) {
        resetButton.disabled =
            !hasImage ||
            busy ||
            cropProcessing ||
            window.confirmedOMRCounting === true;
    }

    if (confirmButton) {
        confirmButton.disabled =
            !hasImage ||
            !cropCorners ||
            busy ||
            cropProcessing ||
            window.confirmedOMRCounting === true;
    }
}

function setCropStatus(message, error = false) {
    status("cropStatus", message, error);
}

function invalidateQRVerification() {
    qrData = null;
    qrResult = null;

    window.campusVoteQRVerified = false;

    if ($("qrStatus")) {
        $("qrStatus").textContent =
            "QR verification required for the corrected ballot.";
    }

    updateAnalyzeButton();
}

// I-reset ang image verification kapag nagbago ang crop.
function invalidateCropConfirmation() {
    cropConfirmed = false;

    invalidateQRVerification();

    updateCropButtons();
    updateAnalyzeButton();
}

function resetCropState(clearOriginal = false) {
    cropCorners = null;
    cropConfirmed = false;
    cropEditing = false;
    cropDragging = null;
    cropProcessing = false;
    cropDetectionConfidence = null;

    cropSourceVersion++;

    if (clearOriginal) {
        originalImage = null;
    }

    const overlay = $("cropOverlay");
    const wrapper = $("canvasWrap");

    if (overlay) {
        overlay.classList.remove("active");
    }

    if (wrapper) {
        wrapper.classList.remove("crop-editing");
    }

    if ($("cropPreviewNote")) {
        $("cropPreviewNote").textContent =
            "Capture an A5 ballot to begin document " +
            "detection and perspective correction.";
    }

    setCropStatus(
        originalImage
            ? "Adjust the four corners before scanning."
            : "Load a ballot image to start cropping."
    );

    invalidateQRVerification();

    updateCropButtons();
    updateAnalyzeButton();
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
    updateCropButtons();
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
    if (busy) return;

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

        // QR check lang kapag confirmed na ang crop.
        if (sourceImage && cropConfirmed) {
            await debugQR().catch(() => {
                // QR error is already shown in scanner status.
            });
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

function getImageWidth(image) {
    return Number(
        image?.naturalWidth ||
        image?.videoWidth ||
        image?.width ||
        0
    );
}

function getImageHeight(image) {
    return Number(
        image?.naturalHeight ||
        image?.videoHeight ||
        image?.height ||
        0
    );
}

function getImageDimensions(image) {
    return {
        width: getImageWidth(image),
        height: getImageHeight(image)
    };
}

function createImageCanvas(image, maxDimension = 4000) {
    if (!image) {
        throw new Error("No ballot image available.");
    }

    const dimensions = getImageDimensions(image);

    if (
        dimensions.width <= 0 ||
        dimensions.height <= 0
    ) {
        throw new Error("Invalid ballot image dimensions.");
    }

    const scale = Math.min(
        1,
        maxDimension / Math.max(
            dimensions.width,
            dimensions.height
        )
    );

    const output = document.createElement("canvas");

    output.width = Math.max(
        1,
        Math.round(dimensions.width * scale)
    );

    output.height = Math.max(
        1,
        Math.round(dimensions.height * scale)
    );

    const context = output.getContext("2d", {
        willReadFrequently: true
    });

    if (!context) {
        throw new Error("Canvas context unavailable.");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(
        0,
        0,
        output.width,
        output.height
    );

    context.drawImage(
        image,
        0,
        0,
        output.width,
        output.height
    );

    return output;
}

// Ipakita ang original o corrected ballot sa preview.
function drawOriginal() {
    if (!canvas || !ctx) return;

    if (!sourceImage) {
        canvas.width = 1;
        canvas.height = 1;
        ctx.clearRect(0, 0, 1, 1);
        return;
    }

    const dimensions = getImageDimensions(sourceImage);

    if (
        dimensions.width <= 0 ||
        dimensions.height <= 0
    ) {
        return;
    }

    const maxPreviewDimension = 1800;

    const scale = Math.min(
        1,
        maxPreviewDimension / Math.max(
            dimensions.width,
            dimensions.height
        )
    );

    canvas.width = Math.max(
        1,
        Math.round(dimensions.width * scale)
    );

    canvas.height = Math.max(
        1,
        Math.round(dimensions.height * scale)
    );

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(
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

    updateCropOverlay();
}

// Gumawa ng Image object mula sa canvas.
function canvasToImage(inputCanvas) {
    return new Promise((resolve, reject) => {
        if (!inputCanvas) {
            reject(new Error("Canvas is missing."));
            return;
        }

        const image = new Image();

        image.onload = () => resolve(image);

        image.onerror = () => reject(
            new Error("Unable to prepare ballot image.")
        );

        image.src = inputCanvas.toDataURL(
            "image/jpeg",
            0.96
        );
    });
}

// Basahin ang uploaded file nang hindi binabago ang original.
function fileToImage(file) {
    return new Promise((resolve, reject) => {
        if (!file) {
            reject(new Error("No image file selected."));
            return;
        }

        const url = URL.createObjectURL(file);
        const image = new Image();

        image.onload = () => {
            URL.revokeObjectURL(url);
            resolve(image);
        };

        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(
                new Error("Unable to open the ballot image.")
            );
        };

        image.src = url;
    });
}

async function loadImageFile(file) {
    if (busy || cropProcessing) {
        status(
            "imageStatus",
            "Please wait for the current operation.",
            true
        );
        return;
    }

    if (!file) return;

    const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/webp"
    ];

    if (!allowedTypes.includes(file.type)) {
        status(
            "imageStatus",
            "Only JPEG, PNG, and WEBP images are supported.",
            true
        );
        return;
    }

    if (file.size > 30 * 1024 * 1024) {
        status(
            "imageStatus",
            "Image is too large. Maximum size is 30 MB.",
            true
        );
        return;
    }

    const version = ++imageVersion;

    try {
        status(
            "imageStatus",
            "Loading ballot image..."
        );

        const image = await fileToImage(file);

        if (version !== imageVersion) return;

        await showImage(image);

        status(
            "imageStatus",
            "Image loaded. Adjust the four corners, " +
            "then press Crop & Straighten."
        );

    } catch (error) {
        if (version === imageVersion) {
            status(
                "imageStatus",
                error.message,
                true
            );
        }
    }
}

async function showImage(image) {
    if (!image) {
        throw new Error("No ballot image available.");
    }

    const dimensions = getImageDimensions(image);

    if (
        dimensions.width < 500 ||
        dimensions.height < 500
    ) {
        throw new Error(
            "Image resolution is too low. " +
            "Use a clearer photo of the entire A5 ballot."
        );
    }

    // Original photo ang gagamitin sa crop editing.
    originalImage = image;
    sourceImage = image;

    resetCropState(false);

    window.confirmedOMRCounting = false;

    if ($("results")) {
        $("results").innerHTML =
            "<p>No ballot analyzed yet.</p>";
    }

    status("analysisStatus", "");

    drawOriginal();

    initializeCropCorners();

    setCropEditing(true);

    setCropStatus(
        "Position the four corners on the outer edges " +
        "of the A5 ballot. Use Auto Detect if available."
    );

    if ($("cropPreviewNote")) {
        $("cropPreviewNote").textContent =
            "Original photo. Drag the corner handles " +
            "to match the paper edges.";
    }

    updateCropButtons();
    updateAnalyzeButton();
}

// Native phone camera ang ginagamit sa mobile browser.
function openPhoneCamera() {
    if (busy || cropProcessing) return;

    const input = $("phoneCameraInput");

    if (!input) {
        status(
            "imageStatus",
            "Phone camera input not found.",
            true
        );
        return;
    }

    input.value = "";
    input.click();
}

function stopCamera() {
    if (cameraStream) {
        for (const track of cameraStream.getTracks()) {
            track.stop();
        }

        cameraStream = null;
    }

    const video = $("video");

    if (video) {
        video.pause();

        if (video.srcObject) {
            video.srcObject = null;
        }

        video.style.display = "none";
    }
}

function retakePhoto() {
    if (busy || cropProcessing) {
        status(
            "imageStatus",
            "Cannot clear the image during processing.",
            true
        );
        return;
    }

    imageVersion++;

    stopCamera();

    sourceImage = null;
    originalImage = null;

    if ($("fileInput")) {
        $("fileInput").value = "";
    }

    if ($("phoneCameraInput")) {
        $("phoneCameraInput").value = "";
    }

    resetCropState(true);
    reset();

    drawOriginal();

    status(
        "imageStatus",
        "Image cleared. Capture or upload another A5 ballot."
    );
}

// CROP CORNER INITIALIZATION

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function cloneCropCorners(corners) {
    if (!corners) return null;

    return {
        tl: { ...corners.tl },
        tr: { ...corners.tr },
        br: { ...corners.br },
        bl: { ...corners.bl }
    };
}

// Corner positions ay normalized mula 0 hanggang 1.
function getDefaultCropCorners() {
    return {
        tl: { x: 0.04, y: 0.04 },
        tr: { x: 0.96, y: 0.04 },
        br: { x: 0.96, y: 0.96 },
        bl: { x: 0.04, y: 0.96 }
    };
}

function initializeCropCorners() {
    if (!originalImage) return;

    cropCorners = getDefaultCropCorners();

    cropDetectionConfidence = null;

    invalidateCropConfirmation();
    updateCropOverlay();
    updateCropButtons();
}

function setCropEditing(editing) {
    cropEditing = Boolean(editing);

    const overlay = $("cropOverlay");
    const wrapper = $("canvasWrap");

    if (overlay) {
        overlay.classList.toggle(
            "active",
            cropEditing && Boolean(cropCorners)
        );
    }

    if (wrapper) {
        wrapper.classList.toggle(
            "crop-editing",
            cropEditing
        );
    }

    if (cropEditing) {
        cropConfirmed = false;
        invalidateQRVerification();
    }

    updateCropOverlay();
    updateCropButtons();
    updateAnalyzeButton();
}

// Kunin ang actual canvas position sa screen.
function getCanvasDisplayRect() {
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();

    if (
        rect.width <= 0 ||
        rect.height <= 0
    ) {
        return null;
    }

    return rect;
}

// I-align ang overlay sa rendered canvas, hindi sa wrapper.
function updateCropOverlay() {
    const overlay = $("cropOverlay");
    const wrapper = $("canvasWrap");

    if (
        !overlay ||
        !wrapper ||
        !canvas ||
        !cropCorners
    ) {
        return;
    }

    const canvasRect = getCanvasDisplayRect();
    const wrapperRect = wrapper.getBoundingClientRect();

    if (!canvasRect) return;

    const wrapperScrollLeft = wrapper.scrollLeft;
    const wrapperScrollTop = wrapper.scrollTop;

    const left =
        canvasRect.left -
        wrapperRect.left +
        wrapperScrollLeft -
        wrapper.clientLeft;

    const top =
        canvasRect.top -
        wrapperRect.top +
        wrapperScrollTop -
        wrapper.clientTop;

    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.right = "auto";
    overlay.style.bottom = "auto";
    overlay.style.width = `${canvasRect.width}px`;
    overlay.style.height = `${canvasRect.height}px`;

    const polygon = $("cropPolygon");
    const svg = $("cropSvg");

    if (svg) {
        svg.setAttribute("viewBox", "0 0 100 100");
    }

    if (polygon) {
        const points = CROP_CORNER_NAMES.map(name => {
            const point = cropCorners[name];

            return (
                `${point.x * 100},${point.y * 100}`
            );
        });

        polygon.setAttribute(
            "points",
            points.join(" ")
        );
    }

    const handles = {
        tl: $("cropCornerTL"),
        tr: $("cropCornerTR"),
        br: $("cropCornerBR"),
        bl: $("cropCornerBL")
    };

    for (const name of CROP_CORNER_NAMES) {
        const handle = handles[name];
        const point = cropCorners[name];

        if (!handle || !point) continue;

        handle.style.left = `${point.x * 100}%`;
        handle.style.top = `${point.y * 100}%`;
    }
}

// MANUAL CORNER DRAGGING

function getPointerNormalizedPosition(event) {
    const rect = getCanvasDisplayRect();

    if (!rect) return null;

    return {
        x: clamp(
            (event.clientX - rect.left) / rect.width,
            0,
            1
        ),
        y: clamp(
            (event.clientY - rect.top) / rect.height,
            0,
            1
        )
    };
}

function cropPolygonArea(corners) {
    if (!corners) return 0;

    const points = CROP_CORNER_NAMES.map(
        name => corners[name]
    );

    let area = 0;

    for (let i = 0; i < points.length; i++) {
        const current = points[i];
        const next = points[
            (i + 1) % points.length
        ];

        area += (
            current.x * next.y -
            next.x * current.y
        );
    }

    return Math.abs(area / 2);
}

function cropCrossProduct(a, b, c) {
    return (
        (b.x - a.x) * (c.y - a.y) -
        (b.y - a.y) * (c.x - a.x)
    );
}

// Iwasan ang crossed corners at invalid crop shape.
function isValidCropQuadrilateral(corners) {
    if (!corners) return false;

    const points = CROP_CORNER_NAMES.map(
        name => corners[name]
    );

    if (
        points.some(point =>
            !point ||
            !Number.isFinite(point.x) ||
            !Number.isFinite(point.y) ||
            point.x < 0 ||
            point.x > 1 ||
            point.y < 0 ||
            point.y > 1
        )
    ) {
        return false;
    }

    if (cropPolygonArea(corners) < 0.05) {
        return false;
    }

    const signs = [];

    for (let i = 0; i < 4; i++) {
        const a = points[i];
        const b = points[(i + 1) % 4];
        const c = points[(i + 2) % 4];

        const cross = cropCrossProduct(a, b, c);

        if (Math.abs(cross) < 0.0001) {
            return false;
        }

        signs.push(Math.sign(cross));
    }

    return signs.every(sign => sign === signs[0]);
}

function moveCropCorner(name, position) {
    if (
        !cropEditing ||
        !cropCorners ||
        !CROP_CORNER_NAMES.includes(name) ||
        !position
    ) {
        return;
    }

    const nextCorners = cloneCropCorners(cropCorners);

    nextCorners[name] = {
        x: clamp(position.x, 0, 1),
        y: clamp(position.y, 0, 1)
    };

    if (!isValidCropQuadrilateral(nextCorners)) {
        return;
    }

    cropCorners = nextCorners;

    cropDetectionConfidence = null;

    invalidateCropConfirmation();

    updateCropOverlay();

    setCropStatus(
        "Corners adjusted. Press Crop & Straighten " +
        "when the paper edges are correctly selected."
    );
}

function onCropPointerDown(event) {
    if (
        !cropEditing ||
        !cropCorners ||
        busy ||
        cropProcessing
    ) {
        return;
    }

    const handle = event.currentTarget;
    const name = handle?.dataset?.corner;

    if (!CROP_CORNER_NAMES.includes(name)) {
        return;
    }

    event.preventDefault();

    cropDragging = {
        name,
        pointerId: event.pointerId
    };

    try {
        handle.setPointerCapture(event.pointerId);
    } catch (_) {
        // Some browsers do not support pointer capture.
    }

    const position = getPointerNormalizedPosition(event);

    if (position) {
        moveCropCorner(name, position);
    }
}

function onCropPointerMove(event) {
    if (
        !cropDragging ||
        cropDragging.pointerId !== event.pointerId
    ) {
        return;
    }

    event.preventDefault();

    const position = getPointerNormalizedPosition(event);

    if (position) {
        moveCropCorner(
            cropDragging.name,
            position
        );
    }
}

function onCropPointerUp(event) {
    if (
        !cropDragging ||
        cropDragging.pointerId !== event.pointerId
    ) {
        return;
    }

    const handle = event.currentTarget;

    try {
        if (
            handle.hasPointerCapture &&
            handle.hasPointerCapture(event.pointerId)
        ) {
            handle.releasePointerCapture(
                event.pointerId
            );
        }
    } catch (_) {
        // Safe fallback for mobile browsers.
    }

    cropDragging = null;

    updateCropOverlay();
}

function setupCropCornerDragging() {
    const handles = [
        $("cropCornerTL"),
        $("cropCornerTR"),
        $("cropCornerBR"),
        $("cropCornerBL")
    ];

    for (const handle of handles) {
        if (!handle) continue;

        handle.addEventListener(
            "pointerdown",
            onCropPointerDown
        );

        handle.addEventListener(
            "pointermove",
            onCropPointerMove
        );

        handle.addEventListener(
            "pointerup",
            onCropPointerUp
        );

        handle.addEventListener(
            "pointercancel",
            onCropPointerUp
        );

        handle.addEventListener(
            "lostpointercapture",
            () => {
                cropDragging = null;
            }
        );
    }

    window.addEventListener(
        "resize",
        updateCropOverlay
    );

    $("canvasWrap")?.addEventListener(
        "scroll",
        updateCropOverlay,
        { passive: true }
    );
}

// AUTO DOCUMENT DETECTION

const OPENCV_WAIT_TIMEOUT = 15000;
const DOCUMENT_DETECTION_SIZE = 1200;

let openCVReadyPromise = null;

// Hintayin ang OpenCV bago gamitin ang document detection.
function waitForOpenCV(timeout = OPENCV_WAIT_TIMEOUT) {
    if (openCVReadyPromise) {
        return openCVReadyPromise;
    }

    openCVReadyPromise = new Promise((resolve, reject) => {
        const started = Date.now();

        function checkOpenCV() {
            const cv = window.cv;

            if (
                cv &&
                typeof cv.Mat === "function" &&
                typeof cv.imread === "function" &&
                typeof cv.findContours === "function" &&
                typeof cv.getPerspectiveTransform === "function"
            ) {
                resolve(cv);
                return;
            }

            if (Date.now() - started >= timeout) {
                reject(
                    new Error(
                        "OpenCV failed to initialize. " +
                        "Check your internet connection or " +
                        "adjust the corners manually."
                    )
                );
                return;
            }

            setTimeout(checkOpenCV, 100);
        }

        checkOpenCV();
    }).catch(error => {
        openCVReadyPromise = null;
        throw error;
    });

    return openCVReadyPromise;
}

// Convert OpenCV point into normalized image coordinates.
function normalizeDocumentPoint(point, width, height) {
    return {
        x: clamp(point.x / width, 0, 1),
        y: clamp(point.y / height, 0, 1)
    };
}

function distanceBetweenPoints(a, b) {
    return Math.hypot(
        a.x - b.x,
        a.y - b.y
    );
}

// Iayos ang apat na points bilang TL, TR, BR, BL.
function orderDocumentCorners(points) {
    if (!Array.isArray(points) || points.length !== 4) {
        throw new Error(
            "Document detection requires four corners."
        );
    }

    const sorted = [...points].sort(
        (a, b) => a.y - b.y
    );

    const top = sorted.slice(0, 2).sort(
        (a, b) => a.x - b.x
    );

    const bottom = sorted.slice(2).sort(
        (a, b) => a.x - b.x
    );

    return {
        tl: top[0],
        tr: top[1],
        br: bottom[1],
        bl: bottom[0]
    };
}

function getDocumentAspectScore(corners) {
    const top = distanceBetweenPoints(
        corners.tl,
        corners.tr
    );

    const bottom = distanceBetweenPoints(
        corners.bl,
        corners.br
    );

    const left = distanceBetweenPoints(
        corners.tl,
        corners.bl
    );

    const right = distanceBetweenPoints(
        corners.tr,
        corners.br
    );

    const width = (top + bottom) / 2;
    const height = (left + right) / 2;

    if (width <= 0 || height <= 0) {
        return 0;
    }

    const measuredRatio = width / height;
    const expectedRatio = A5_WIDTH_MM / A5_HEIGHT_MM;

    const difference = Math.abs(
        measuredRatio - expectedRatio
    );

    return Math.max(
        0,
        1 - difference / expectedRatio
    );
}

function getDocumentDetectionScore(corners) {
    const area = cropPolygonArea(corners);
    const aspectScore = getDocumentAspectScore(corners);

    const minX = Math.min(
        ...CROP_CORNER_NAMES.map(
            name => corners[name].x
        )
    );

    const maxX = Math.max(
        ...CROP_CORNER_NAMES.map(
            name => corners[name].x
        )
    );

    const minY = Math.min(
        ...CROP_CORNER_NAMES.map(
            name => corners[name].y
        )
    );

    const maxY = Math.max(
        ...CROP_CORNER_NAMES.map(
            name => corners[name].y
        )
    );

    const width = maxX - minX;
    const height = maxY - minY;

    if (width <= 0 || height <= 0) {
        return 0;
    }

    const coverage = Math.min(
        1,
        area / (width * height)
    );

    return (
        area * 0.55 +
        aspectScore * 0.30 +
        coverage * 0.15
    );
}

// Detect A5 paper boundary using OpenCV contours.
async function detectDocumentCorners() {
    if (!originalImage) {
        throw new Error(
            "Capture or upload a ballot image first."
        );
    }

    const cv = await waitForOpenCV();

    const detectionCanvas = createImageCanvas(
        originalImage,
        DOCUMENT_DETECTION_SIZE
    );

    let src = null;
    let gray = null;
    let blurred = null;
    let edges = null;
    let contours = null;
    let hierarchy = null;
    let kernel = null;

    try {
        src = cv.imread(detectionCanvas);

        gray = new cv.Mat();
        blurred = new cv.Mat();
        edges = new cv.Mat();

        cv.cvtColor(
            src,
            gray,
            cv.COLOR_RGBA2GRAY
        );

        cv.GaussianBlur(
            gray,
            blurred,
            new cv.Size(5, 5),
            0
        );

        cv.Canny(
            blurred,
            edges,
            50,
            150
        );

        kernel = cv.getStructuringElement(
            cv.MORPH_RECT,
            new cv.Size(5, 5)
        );

        cv.morphologyEx(
            edges,
            edges,
            cv.MORPH_CLOSE,
            kernel
        );

        contours = new cv.MatVector();
        hierarchy = new cv.Mat();

        cv.findContours(
            edges,
            contours,
            hierarchy,
            cv.RETR_LIST,
            cv.CHAIN_APPROX_SIMPLE
        );

        let bestCorners = null;
        let bestScore = 0;

        const imageArea = src.cols * src.rows;

        for (let i = 0; i < contours.size(); i++) {
            const contour = contours.get(i);

            let approximation = null;

            try {
                const perimeter = cv.arcLength(
                    contour,
                    true
                );

                approximation = new cv.Mat();

                cv.approxPolyDP(
                    contour,
                    approximation,
                    0.025 * perimeter,
                    true
                );

                if (approximation.rows !== 4) {
                    continue;
                }

                if (!cv.isContourConvex(approximation)) {
                    continue;
                }

                const contourArea = Math.abs(
                    cv.contourArea(approximation)
                );

                if (contourArea < imageArea * 0.12) {
                    continue;
                }

                const rawPoints = [];

                for (let j = 0; j < 4; j++) {
                    rawPoints.push({
                        x: approximation.data32S[j * 2],
                        y: approximation.data32S[j * 2 + 1]
                    });
                }

                const ordered = orderDocumentCorners(
                    rawPoints
                );

                const normalized = {
                    tl: normalizeDocumentPoint(
                        ordered.tl,
                        src.cols,
                        src.rows
                    ),
                    tr: normalizeDocumentPoint(
                        ordered.tr,
                        src.cols,
                        src.rows
                    ),
                    br: normalizeDocumentPoint(
                        ordered.br,
                        src.cols,
                        src.rows
                    ),
                    bl: normalizeDocumentPoint(
                        ordered.bl,
                        src.cols,
                        src.rows
                    )
                };

                if (!isValidCropQuadrilateral(normalized)) {
                    continue;
                }

                const score = getDocumentDetectionScore(
                    normalized
                );

                if (score > bestScore) {
                    bestScore = score;
                    bestCorners = normalized;
                }

            } finally {
                approximation?.delete();
                contour.delete();
            }
        }

        if (!bestCorners) {
            throw new Error(
                "Unable to detect all four paper corners. " +
                "Adjust the corners manually."
            );
        }

        return {
            corners: bestCorners,
            confidence: bestScore
        };

    } finally {
        src?.delete();
        gray?.delete();
        blurred?.delete();
        edges?.delete();
        contours?.delete();
        hierarchy?.delete();
        kernel?.delete();
    }
}

// AUTO DETECT BUTTON

async function autoDetectCrop() {
    if (
        busy ||
        cropProcessing ||
        !originalImage ||
        window.confirmedOMRCounting
    ) {
        return;
    }

    const version = cropSourceVersion;

    cropProcessing = true;

    updateCropButtons();
    updateAnalyzeButton();

    setCropStatus(
        "Detecting A5 ballot boundaries..."
    );

    try {
        const result = await detectDocumentCorners();

        if (version !== cropSourceVersion) {
            return;
        }

        if (!isValidCropQuadrilateral(result.corners)) {
            throw new Error(
                "Detected document corners are invalid."
            );
        }

        cropCorners = cloneCropCorners(
            result.corners
        );

        cropDetectionConfidence = result.confidence;

        invalidateCropConfirmation();

        setCropEditing(true);

        updateCropOverlay();

        setCropStatus(
            "Paper corners detected. Review all four " +
            "handles and adjust them if needed. " +
            "Then press Crop & Straighten."
        );

    } catch (error) {
        if (version === cropSourceVersion) {
            setCropStatus(
                error.message,
                true
            );
        }
    } finally {
        cropProcessing = false;

        updateCropButtons();
        updateAnalyzeButton();
    }
}

// RESET CORNERS BUTTON

function resetCropCorners() {
    if (
        !originalImage ||
        busy ||
        cropProcessing ||
        window.confirmedOMRCounting
    ) {
        return;
    }

    sourceImage = originalImage;

    cropCorners = getDefaultCropCorners();
    cropDetectionConfidence = null;

    invalidateCropConfirmation();

    drawOriginal();

    setCropEditing(true);

    setCropStatus(
        "Corners reset. Drag each handle to the " +
        "outer edges of the A5 ballot."
    );

    if ($("cropPreviewNote")) {
        $("cropPreviewNote").textContent =
            "Original photo. Crop corners have been reset.";
    }
}

// PERSPECTIVE CORRECTION

function getCropPixelCorners(image, corners) {
    const dimensions = getImageDimensions(image);

    if (
        dimensions.width <= 0 ||
        dimensions.height <= 0
    ) {
        throw new Error(
            "Invalid image dimensions for cropping."
        );
    }

    const result = {};

    for (const name of CROP_CORNER_NAMES) {
        result[name] = {
            x: corners[name].x * dimensions.width,
            y: corners[name].y * dimensions.height
        };
    }

    return result;
}

async function perspectiveCorrectBallot(
    image,
    corners
) {
    if (!image || !corners) {
        throw new Error(
            "Image and crop corners are required."
        );
    }

    if (!isValidCropQuadrilateral(corners)) {
        throw new Error(
            "Crop corners form an invalid document shape."
        );
    }

    const cv = await waitForOpenCV();

    // Keep enough resolution for QR and OMR bubbles.
    const inputCanvas = createImageCanvas(
        image,
        4000
    );

    const pixelCorners = getCropPixelCorners(
        inputCanvas,
        corners
    );

    let src = null;
    let destination = null;
    let sourcePoints = null;
    let destinationPoints = null;
    let transform = null;

    try {
        src = cv.imread(inputCanvas);

        destination = new cv.Mat();

        sourcePoints = cv.matFromArray(
            4,
            1,
            cv.CV_32FC2,
            [
                pixelCorners.tl.x,
                pixelCorners.tl.y,

                pixelCorners.tr.x,
                pixelCorners.tr.y,

                pixelCorners.br.x,
                pixelCorners.br.y,

                pixelCorners.bl.x,
                pixelCorners.bl.y
            ]
        );

        destinationPoints = cv.matFromArray(
            4,
            1,
            cv.CV_32FC2,
            [
                0,
                0,

                CROP_OUTPUT_WIDTH - 1,
                0,

                CROP_OUTPUT_WIDTH - 1,
                CROP_OUTPUT_HEIGHT - 1,

                0,
                CROP_OUTPUT_HEIGHT - 1
            ]
        );

        transform = cv.getPerspectiveTransform(
            sourcePoints,
            destinationPoints
        );

        cv.warpPerspective(
            src,
            destination,
            transform,
            new cv.Size(
                CROP_OUTPUT_WIDTH,
                CROP_OUTPUT_HEIGHT
            ),
            cv.INTER_LINEAR,
            cv.BORDER_CONSTANT,
            new cv.Scalar(255, 255, 255, 255)
        );

        const outputCanvas = document.createElement(
            "canvas"
        );

        outputCanvas.width = CROP_OUTPUT_WIDTH;
        outputCanvas.height = CROP_OUTPUT_HEIGHT;

        cv.imshow(
            outputCanvas,
            destination
        );

        return outputCanvas;

    } finally {
        src?.delete();
        destination?.delete();
        sourcePoints?.delete();
        destinationPoints?.delete();
        transform?.delete();
    }
}

// CONFIRM CROP AND STRAIGHTEN

async function confirmCrop() {
    if (
        busy ||
        cropProcessing ||
        !originalImage ||
        !cropCorners ||
        window.confirmedOMRCounting
    ) {
        return;
    }

    if (!isValidCropQuadrilateral(cropCorners)) {
        setCropStatus(
            "Invalid crop corners. Adjust the four handles.",
            true
        );
        return;
    }

    const version = cropSourceVersion;

    cropProcessing = true;

    updateCropButtons();
    updateAnalyzeButton();

    setCropStatus(
        "Correcting ballot perspective..."
    );

    try {
        const correctedCanvas =
            await perspectiveCorrectBallot(
                originalImage,
                cropCorners
            );

        if (version !== cropSourceVersion) {
            return;
        }

        const correctedImage = await canvasToImage(
            correctedCanvas
        );

        if (version !== cropSourceVersion) {
            return;
        }

        sourceImage = correctedImage;

        drawOriginal();

        cropConfirmed = true;
        cropEditing = false;

        invalidateQRVerification();

        const overlay = $("cropOverlay");
        const wrapper = $("canvasWrap");

        overlay?.classList.remove("active");
        wrapper?.classList.remove("crop-editing");

        setCropStatus(
            "Ballot cropped and straightened. " +
            "Verifying QR code..."
        );

        if ($("cropPreviewNote")) {
            $("cropPreviewNote").textContent =
                "Corrected A5 ballot preview. " +
                "Check that all registration squares " +
                "and bubbles are clearly visible.";
        }

        if (template) {
            await debugQR();
        } else {
            setCropStatus(
                "Crop confirmed. Select an A5 template " +
                "to verify the ballot QR code."
            );
        }

        updateAnalyzeButton();

    } catch (error) {
        if (version === cropSourceVersion) {
            cropConfirmed = false;

            invalidateQRVerification();

            setCropStatus(
                "Crop correction failed: " +
                error.message,
                true
            );
        }
    } finally {
        cropProcessing = false;

        updateCropButtons();
        updateAnalyzeButton();
    }
}

// QR CODE DETECTION AND VERIFICATION

function getSource() {
    if (!sourceImage) {
        throw new Error("No ballot image loaded.");
    }

    const temp = createImageCanvas(
        sourceImage,
        2400
    );

    const context = temp.getContext("2d", {
        willReadFrequently: true
    });

    if (!context) {
        throw new Error("Image canvas unavailable.");
    }

    return context.getImageData(
        0,
        0,
        temp.width,
        temp.height
    );
}

// Basahin ang QR mula sa corrected A5 ballot.
function readQR() {
    if (typeof window.jsQR !== "function") {
        throw new Error(
            "QR library not loaded. Check jsQR.min.js."
        );
    }

    if (!cropConfirmed || cropEditing) {
        throw new Error(
            "Crop & Straighten must be confirmed " +
            "before QR verification."
        );
    }

    const image = getSource();

    // Unang attempt: buong ballot.
    let result = window.jsQR(
        image.data,
        image.width,
        image.height,
        {
            inversionAttempts: "attemptBoth"
        }
    );

    // Pangalawang attempt: top-right QR area.
    if (!result) {
        const temp = document.createElement("canvas");

        temp.width = image.width;
        temp.height = image.height;

        const context = temp.getContext("2d", {
            willReadFrequently: true
        });

        if (!context) {
            throw new Error("QR canvas unavailable.");
        }

        context.putImageData(image, 0, 0);

        const x = Math.floor(image.width * 0.65);

        const cropped = context.getImageData(
            x,
            0,
            image.width - x,
            Math.max(
                1,
                Math.floor(image.height * 0.4)
            )
        );

        result = window.jsQR(
            cropped.data,
            cropped.width,
            cropped.height,
            {
                inversionAttempts: "attemptBoth"
            }
        );
    }

    if (!result) {
        throw new Error(
            "QR NOT DETECTED. Check the corrected " +
            "ballot preview. Make sure the QR code " +
            "is visible and not blurred."
        );
    }

    return result.data;
}

// I-check ang CampusVote QR format at election.
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

// I-verify ang QR sa backend bago counting.
async function debugQR() {
    const version = imageVersion;
    const cropVersion = cropSourceVersion;

    const selectedImage = sourceImage;
    const selectedTemplateId = getTemplateId();
    const selectedElectionId = getElectionId();

    qrData = null;
    qrResult = null;

    window.campusVoteQRVerified = false;

    updateAnalyzeButton();

    const selectionUnchanged = () => (
        version === imageVersion &&
        cropVersion === cropSourceVersion &&
        selectedImage === sourceImage &&
        selectedTemplateId === getTemplateId() &&
        selectedElectionId === getElectionId() &&
        cropConfirmed === true &&
        cropEditing === false
    );

    try {
        if (!selectedImage) {
            throw new Error(
                "No ballot image loaded."
            );
        }

        if (!cropConfirmed || cropEditing) {
            throw new Error(
                "Confirm Crop & Straighten before " +
                "verifying the ballot QR."
            );
        }

        if (
            !template ||
            !validId(selectedTemplateId) ||
            !validId(selectedElectionId)
        ) {
            throw new Error(
                "Load the current election and " +
                "select an A5 ballot template first."
            );
        }

        if (
            String(template.paper_size).toUpperCase()
            !== "A5"
        ) {
            throw new Error(
                "Only A5 portrait ballots are supported."
            );
        }

        if ($("qrStatus")) {
            $("qrStatus").textContent =
                "Reading QR code from corrected ballot...";
        }

        const raw = readQR();
        const parsedQR = validateQR(raw);

        if (!selectionUnchanged()) {
            return null;
        }

        if ($("qrStatus")) {
            $("qrStatus").textContent =
                "QR DETECTED\n" +
                "Checking ballot record with server...";
        }

        const data = await request(
            "/omr/verify-qr",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    qr_data: raw
                })
            }
        );

        if (!selectionUnchanged()) {
            return null;
        }

        // Reject already-counted ballots.
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

        if (
            !["ISSUED", "CAST"].includes(data.status)
        ) {
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

        window.campusVoteQRVerified = true;

        updateAnalyzeButton();

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
        if (selectionUnchanged()) {
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
    } finally {
        updateAnalyzeButton();
    }
}

// Convert corrected ballot image into JPEG blob.
async function imageToBlob() {
    if (!sourceImage) {
        throw new Error("No ballot image loaded.");
    }

    if (!cropConfirmed || cropEditing) {
        throw new Error(
            "Confirm the corrected A5 ballot " +
            "before uploading it for counting."
        );
    }

    const selectedImage = sourceImage;

    const MAX_BYTES = 9 * 1024 * 1024;
    const MAX_DIMENSION = 4000;

    const originalWidth = getImageWidth(
        selectedImage
    );

    const originalHeight = getImageHeight(
        selectedImage
    );

    if (
        originalWidth <= 0 ||
        originalHeight <= 0
    ) {
        throw new Error(
            "Invalid corrected image dimensions."
        );
    }

    const scale = Math.min(
        1,
        MAX_DIMENSION / Math.max(
            originalWidth,
            originalHeight
        )
    );

    let width = Math.max(
        1,
        Math.round(originalWidth * scale)
    );

    let height = Math.max(
        1,
        Math.round(originalHeight * scale)
    );

    function encodeJPEG(w, h, quality) {
        return new Promise((resolve, reject) => {
            const temp = document.createElement(
                "canvas"
            );

            temp.width = w;
            temp.height = h;

            const context = temp.getContext("2d");

            if (!context) {
                reject(
                    new Error("Canvas unavailable.")
                );
                return;
            }

            context.fillStyle = "#ffffff";

            context.fillRect(
                0,
                0,
                w,
                h
            );

            context.drawImage(
                selectedImage,
                0,
                0,
                w,
                h
            );

            temp.toBlob(
                blob => {
                    if (!blob) {
                        reject(
                            new Error(
                                "Image conversion failed."
                            )
                        );
                        return;
                    }

                    resolve(blob);
                },
                "image/jpeg",
                quality
            );
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

// Display backend-detected candidates and bubbles.
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
        `(${data.paper_size ||
            template?.paper_size ||
            "A5"})`,

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

        const marked = Number(
            position.marked ?? 0
        );

        const maxSelection = Number(
            position.max_selection ?? 1
        );

        title.textContent =
            `${position.position_name || "Position"} ` +
            `(${marked}/${maxSelection})`;

        section.appendChild(title);
        lines.push(title.textContent);

        // Ipakita ang shading result per candidate.
        for (
            const candidate of position.candidates || []
        ) {
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
            info.textContent =
                "SKIPPED: OVERVOTE";

            info.className = "overvote";

        } else if (
            typeof result === "string" &&
            result.startsWith("SKIPPED")
        ) {
            info.textContent =
                "SKIPPED: UNCLEAR SHADE";

            info.className = "overvote";

        } else if (result === "BLANK") {
            info.textContent =
                "BLANK POSITION";

        } else {
            info.textContent =
                "VALID POSITION";

            info.className = "valid";
        }

        section.appendChild(info);
        results.appendChild(section);

        lines.push(info.textContent, "");
    }

    // Backend counting summary.
    const summary = document.createElement("div");
    summary.className = "counting-note";

    if (
        countingEnabled &&
        data.counted === true
    ) {
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

// BACKEND OMR PROCESSING AND LIVE VOTE COUNTING

async function backendPreview() {
    if (busy || cropProcessing) return;

    if (!template || !sourceImage) {
        status(
            "analysisStatus",
            "Load a template and ballot image first.",
            true
        );
        return;
    }

    if (!cropConfirmed || cropEditing) {
        status(
            "analysisStatus",
            "Crop & Straighten the A5 ballot first.",
            true
        );
        return;
    }

    if (window.confirmedOMRCounting === true) {
        status(
            "analysisStatus",
            "This image has already been counted. " +
            "Capture another ballot.",
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
        String(template.paper_size).toUpperCase()
        !== "A5"
    ) {
        status(
            "analysisStatus",
            "Only A5 portrait ballots are supported.",
            true
        );
        return;
    }

    const version = imageVersion;
    const cropVersion = cropSourceVersion;
    const selectedImage = sourceImage;

    busy = true;

    updateAnalyzeButton();
    updateCropButtons();
    disableSubmission();

    try {
        status(
            "analysisStatus",
            "Verifying QR code..."
        );

        debug(
            "Checking ballot QR code before OMR counting..."
        );

        await debugQR();

        if (
            version !== imageVersion ||
            cropVersion !== cropSourceVersion ||
            selectedImage !== sourceImage ||
            electionId !== getElectionId() ||
            templateId !== getTemplateId() ||
            !cropConfirmed
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

        status(
            "analysisStatus",
            "Preparing corrected A5 ballot..."
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
            "ballot-scan.jpg"
        );

        status(
            "analysisStatus",
            "Checking registration marks " +
            "and shaded bubbles..."
        );

        debug(
            "OMR PROCESSING\n" +
            "QR: Verified\n" +
            "Crop: Confirmed\n" +
            "Checking four registration marks...\n" +
            "Analyzing shaded bubbles...\n" +
            "Waiting for backend counting result..."
        );

        // Backend pa rin ang final authority sa counting.
        const data = await request(
            "/omr/scan",
            {
                method: "POST",
                body: form
            }
        );

        if (
            version !== imageVersion ||
            cropVersion !== cropSourceVersion ||
            selectedImage !== sourceImage ||
            electionId !== getElectionId() ||
            templateId !== getTemplateId()
        ) {
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
                "or template. Check ballot status."
            );
        }

        if (data.preview_only !== false) {
            throw new Error(
                "Unexpected backend counting mode. " +
                "Check ballot status before retrying."
            );
        }

        displayResults(data, true);

        if (
            data.counted === true &&
            data.valid === true
        ) {
            window.confirmedOMRCounting = true;

            if ($("qrStatus")) {
                $("qrStatus").textContent =
                    "QR VALIDATED\n" +
                    "Status: COUNTED\n" +
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

        updateCropButtons();
        updateAnalyzeButton();

        if (window.confirmedOMRCounting === true) {
            if ($("analyzeBtn")) {
                $("analyzeBtn").disabled = true;
            }
        }
    }
}

// SCANNER INITIALIZATION AND EVENT LISTENERS

function setupScanner() {
    const requiredElements = [
        "electionId",
        "loadBtn",
        "templateSelect",
        "scannerStatus",
        "fileInput",
        "phoneCameraInput",
        "cameraBtn",
        "video",
        "imageStatus",
        "retakeBtn",
        "analyzeBtn",
        "analysisStatus",
        "debugInfo",
        "qrStatus",
        "scanCanvas",
        "canvasWrap",
        "results",
        "cropAutoBtn",
        "cropResetBtn",
        "cropConfirmBtn",
        "cropStatus",
        "cropOverlay",
        "cropSvg",
        "cropPolygon",
        "cropCornerTL",
        "cropCornerTR",
        "cropCornerBR",
        "cropCornerBL"
    ];

    const missing = requiredElements.filter(
        id => !$(id)
    );

    if (missing.length > 0) {
        console.error(
            "CampusVote scanner missing elements:",
            missing
        );

        status(
            "scannerStatus",
            "Scanner initialization failed. " +
            "Missing HTML elements: " +
            missing.join(", "),
            true
        );

        return;
    }

    // Prevent duplicate event listeners.
    if (window.campusVoteScannerInitialized) {
        return;
    }

    window.campusVoteScannerInitialized = true;

    // Load templates for the current election.
    $("loadBtn").addEventListener(
        "click",
        async () => {
            await loadTemplates();
        }
    );

    // Load selected A5 template and coordinates.
    $("templateSelect").addEventListener(
        "change",
        async () => {
            await selectTemplate();
        }
    );

    // Upload an existing ballot image.
    $("fileInput").addEventListener(
        "change",
        async event => {
            const file = event.target.files?.[0];

            if (!file) return;

            await loadImageFile(file);
        }
    );

    // Open native phone camera.
    $("cameraBtn").addEventListener(
        "click",
        () => {
            openPhoneCamera();
        }
    );

    // Receive captured photo from the phone camera.
    $("phoneCameraInput").addEventListener(
        "change",
        async event => {
            const file = event.target.files?.[0];

            if (!file) return;

            await loadImageFile(file);
        }
    );

    // Clear image and prepare for another ballot.
    $("retakeBtn").addEventListener(
        "click",
        () => {
            retakePhoto();
        }
    );

    // Automatically detect the four paper corners.
    $("cropAutoBtn").addEventListener(
        "click",
        async () => {
            await autoDetectCrop();
        }
    );

    // Restore default corner positions.
    $("cropResetBtn").addEventListener(
        "click",
        () => {
            resetCropCorners();
        }
    );

    // Apply perspective correction and verify QR.
    $("cropConfirmBtn").addEventListener(
        "click",
        async () => {
            await confirmCrop();
        }
    );

    // Connect draggable corner handles.
    setupCropCornerDragging();

    // Actual backend vote counting.
    $("analyzeBtn").addEventListener(
        "click",
        async () => {
            if (
                busy ||
                cropProcessing ||
                !cropConfirmed ||
                cropEditing
            ) {
                status(
                    "analysisStatus",
                    "Confirm the corrected A5 ballot " +
                    "before scanning.",
                    true
                );
                return;
            }

            if (
                window.campusVoteQRVerified !== true
            ) {
                status(
                    "analysisStatus",
                    "QR verification is required " +
                    "before vote counting.",
                    true
                );
                return;
            }

            await backendPreview();
        }
    );

    // Update crop overlay after screen changes.
    window.addEventListener(
        "orientationchange",
        () => {
            requestAnimationFrame(
                updateCropOverlay
            );
        }
    );

    window.addEventListener(
        "resize",
        () => {
            requestAnimationFrame(
                updateCropOverlay
            );
        }
    );

    // Initial scanner state.
    sourceImage = null;
    originalImage = null;

    template = null;
    coordinates = [];

    qrData = null;
    qrResult = null;

    busy = false;

    cropConfirmed = false;
    cropEditing = false;
    cropProcessing = false;
    cropCorners = null;

    window.campusVoteQRVerified = false;
    window.confirmedOMRCounting = false;

    drawOriginal();
    resetCropState(true);
    reset();

    status(
        "imageStatus",
        "Capture or upload one A5 portrait ballot."
    );

    setCropStatus(
        "Load a ballot image to start cropping."
    );

    if ($("qrStatus")) {
        $("qrStatus").textContent =
            "QR not scanned yet.";
    }

    updateCropButtons();
    updateAnalyzeButton();

    // Load the active election from the backend.
    currentElection().catch(error => {
        status(
            "scannerStatus",
            "Unable to initialize current election: " +
            error.message,
            true
        );
    });

    // OpenCV is optional for initialization,
    // but required for automatic crop correction.
    waitForOpenCV().then(() => {
        console.info(
            "CampusVote OpenCV document correction ready."
        );
    }).catch(error => {
        console.warn(
            "CampusVote OpenCV initialization:",
            error.message
        );

        setCropStatus(
            "OpenCV is not ready. Check your internet " +
            "connection before cropping.",
            true
        );
    });

    console.info(
        "CampusVote A5 OMR Scanner initialized."
    );
}

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
