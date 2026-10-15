
"use strict";

const API_BASE = "http://localhost:3000/api";
const DPI = 300;
const DARK_CUTOFF = 110;
const FILL_THRESHOLD = 0.60;

const $ = id => document.getElementById(id);

let template = null;
let coordinates = [];
let sourceImage = null;
let cameraStream = null;
let scanResults = null;

const canvas = $("scanCanvas");
const ctx = canvas.getContext("2d", {
    willReadFrequently: true
});

function token() {
    return (
        sessionStorage.getItem("voting_token") ||
        localStorage.getItem("voting_token") ||
        localStorage.getItem("token")
    );
}

async function api(path) {
    const response = await fetch(API_BASE + path, {
        headers: {
            Authorization: `Bearer ${token()}`
        }
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.message || "API request failed");
    }

    return data;
}

function setStatus(id, message, error = false) {
    const element = $(id);
    element.textContent = message;
    element.className = "status " + (error ? "error" : "");
}

function resetAnalysis() {
    scanResults = null;
    $("results").innerHTML = "<p>No ballot analyzed yet.</p>";
    $("submitBtn").disabled = true;
    setStatus("analysisStatus", "");
    $("analyzeBtn").disabled = !(template && sourceImage);
}

function dimensions() {
    if (template?.paper_size === "A4") {
        return {
            width: 2480,
            height: 3508,
            paperHeight: 297,
            bottomMark: 287
        };
    }

    return {
        width: 2480,
        height: 1754,
        paperHeight: 148.5,
        bottomMark: 139
    };
}

async function loadTemplates() {
    try {
        const electionId = Number($("electionId").value);

        if (!Number.isSafeInteger(electionId) || electionId < 1) {
            throw new Error("Enter a valid election ID.");
        }

        const data = await api(
            `/ballots/templates/election/${electionId}`
        );

        const select = $("templateSelect");

        select.innerHTML =
            '<option value="">Select a template</option>';

        for (const item of data.templates || []) {
            if (!["A4", "A5"].includes(item.paper_size)) {
                continue;
            }

            const option = document.createElement("option");
            option.value = item.template_id;
            option.textContent =
                `#${item.template_id} - ${item.template_name} (${item.paper_size})`;

            select.appendChild(option);
        }

        template = null;
        coordinates = [];
        resetAnalysis();

        setStatus(
            "scannerStatus",
            `${select.options.length - 1} templates loaded.`
        );

    } catch (error) {
        setStatus("scannerStatus", error.message, true);
    }
}

async function loadSelectedTemplate() {
    try {
        const id = $("templateSelect").value;

        template = null;
        coordinates = [];
        resetAnalysis();

        if (!id) return;

        const data = await api(`/ballots/templates/${id}`);

        if (!data.template || !Array.isArray(data.coordinates)) {
            throw new Error("Invalid template response.");
        }

        if (!data.coordinates.length) {
            throw new Error("Template has no saved bubble coordinates.");
        }

        template = data.template;
        coordinates = data.coordinates;

        setStatus(
            "scannerStatus",
            `Template #${id} loaded (${template.paper_size}). ` +
            `${coordinates.length} bubbles.`
        );

        $("analyzeBtn").disabled = !sourceImage;

    } catch (error) {
        setStatus("scannerStatus", error.message, true);
    }
}

function setImage(image) {
    sourceImage = image;

    canvas.width = image.width || image.videoWidth;
    canvas.height = image.height || image.videoHeight;

    ctx.drawImage(
        image,
        0,
        0,
        canvas.width,
        canvas.height
    );

    resetAnalysis();

    setStatus(
        "imageStatus",
        `Image loaded: ${canvas.width} × ${canvas.height}.`
    );
}

function loadFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
        return setStatus(
            "imageStatus",
            "Only JPG, PNG and WEBP images are supported.",
            true
        );
    }

    if (file.size > 10 * 1024 * 1024) {
        return setStatus(
            "imageStatus",
            "Image must be 10 MB or smaller.",
            true
        );
    }

    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
        setImage(image);
        URL.revokeObjectURL(url);
    };

    image.onerror = () => {
        URL.revokeObjectURL(url);
        setStatus("imageStatus", "Cannot read image.", true);
    };

    image.src = url;
}

async function openCamera() {
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: "environment" },
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            },
            audio: false
        });

        $("video").srcObject = cameraStream;
        $("video").style.display = "block";

        $("captureBtn").disabled = false;
        $("stopCameraBtn").disabled = false;

    } catch (error) {
        setStatus(
            "imageStatus",
            "Camera unavailable: " + error.message,
            true
        );
    }
}

function captureCamera() {
    const video = $("video");

    if (!video.videoWidth || !video.videoHeight) {
        return;
    }

    const temporary = document.createElement("canvas");
    temporary.width = video.videoWidth;
    temporary.height = video.videoHeight;

    temporary.getContext("2d").drawImage(video, 0, 0);

    const image = new Image();

    image.onload = () => setImage(image);
    image.src = temporary.toDataURL("image/png");

    stopCamera();
}

function stopCamera() {
    cameraStream?.getTracks().forEach(track => track.stop());
    cameraStream = null;

    $("video").srcObject = null;
    $("video").style.display = "none";
    $("captureBtn").disabled = true;
    $("stopCameraBtn").disabled = true;
}

function grayscale(data, index) {
    return (
        data[index] * 0.299 +
        data[index + 1] * 0.587 +
        data[index + 2] * 0.114
    );
}

// Find black registration marks using connected components.
// Work on a smaller image for faster detection.
function detectMarkers(image) {
    const scale = Math.min(
        1,
        1000 / Math.max(image.width, image.height)
    );

    const w = Math.round(image.width * scale);
    const h = Math.round(image.height * scale);

    const small = document.createElement("canvas");
    small.width = w;
    small.height = h;

    const smallCtx = small.getContext("2d", {
        willReadFrequently: true
    });

    smallCtx.drawImage(image, 0, 0, w, h);

    const pixels = smallCtx.getImageData(0, 0, w, h).data;
    const dark = new Uint8Array(w * h);
    const visited = new Uint8Array(w * h);

    for (let i = 0; i < w * h; i++) {
        dark[i] = grayscale(pixels, i * 4) < 95 ? 1 : 0;
    }

    const corners = [
        [0, 0],
        [w, 0],
        [0, h],
        [w, h]
    ];

    const markers = [];

    for (const [cornerX, cornerY] of corners) {
        const x0 = cornerX === 0 ? 0 : Math.floor(w * 0.65);
        const x1 = cornerX === 0 ? Math.ceil(w * 0.35) : w;
        const y0 = cornerY === 0 ? 0 : Math.floor(h * 0.65);
        const y1 = cornerY === 0 ? Math.ceil(h * 0.35) : h;

        let best = null;

        for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
                const start = y * w + x;

                if (!dark[start] || visited[start]) continue;

                const stack = [start];
                visited[start] = 1;

                let area = 0;
                let minX = x, maxX = x;
                let minY = y, maxY = y;
                let sumX = 0, sumY = 0;

                while (stack.length) {
                    const p = stack.pop();
                    const px = p % w;
                    const py = Math.floor(p / w);

                    area++;
                    sumX += px;
                    sumY += py;

                    minX = Math.min(minX, px);
                    maxX = Math.max(maxX, px);
                    minY = Math.min(minY, py);
                    maxY = Math.max(maxY, py);

                    const neighbors = [
                        p - 1, p + 1, p - w, p + w
                    ];

                    for (const n of neighbors) {
                        if (n < 0 || n >= w * h) continue;

                        const nx = n % w;
                        const ny = Math.floor(n / w);

                        if (
                            Math.abs(nx - px) +
                            Math.abs(ny - py) !== 1
                        ) continue;

                        if (
                            nx < x0 || nx >= x1 ||
                            ny < y0 || ny >= y1
                        ) continue;

                        if (!dark[n] || visited[n]) continue;

                        visited[n] = 1;
                        stack.push(n);
                    }
                }

                const bw = maxX - minX + 1;
                const bh = maxY - minY + 1;
                const ratio = bw / bh;
                const density = area / (bw * bh);

                if (
                    area < 8 ||
                    bw < 3 ||
                    bh < 3 ||
                    ratio < 0.55 ||
                    ratio > 1.8 ||
                    density < 0.65 ||
                    bw > w * 0.08 ||
                    bh > h * 0.08
                ) continue;

                const cx = sumX / area;
                const cy = sumY / area;

                const distance = Math.hypot(
                    cx - cornerX,
                    cy - cornerY
                );

                const score = area / (1 + distance);

                if (!best || score > best.score) {
                    best = {
                        x: cx / scale,
                        y: cy / scale,
                        score
                    };
                }
            }
        }

        if (!best) {
            throw new Error(
                "Could not detect all four registration marks. " +
                "Crop one ballot and keep all four black squares visible."
            );
        }

        markers.push(best);
    }

    const [tl, tr, bl, br] = markers;

    const topWidth = Math.hypot(tr.x - tl.x, tr.y - tl.y);
    const bottomWidth = Math.hypot(br.x - bl.x, br.y - bl.y);
    const leftHeight = Math.hypot(bl.x - tl.x, bl.y - tl.y);
    const rightHeight = Math.hypot(br.x - tr.x, br.y - tr.y);

    if (
        Math.min(topWidth, bottomWidth) < image.width * 0.25 ||
        Math.min(leftHeight, rightHeight) < image.height * 0.25
    ) {
        throw new Error(
            "Registration marks are too close together. " +
            "Check the image and selected template."
        );
    }

    return markers;
}

// Solve an 8-variable linear system for projective alignment.
function solveLinear(A, b) {
    const n = 8;

    for (let i = 0; i < n; i++) {
        let pivot = i;

        for (let j = i + 1; j < n; j++) {
            if (Math.abs(A[j][i]) > Math.abs(A[pivot][i])) {
                pivot = j;
            }
        }

        [A[i], A[pivot]] = [A[pivot], A[i]];
        [b[i], b[pivot]] = [b[pivot], b[i]];

        if (Math.abs(A[i][i]) < 1e-10) {
            throw new Error("Cannot calculate image alignment.");
        }

        const divisor = A[i][i];

        for (let k = i; k < n; k++) A[i][k] /= divisor;
        b[i] /= divisor;

        for (let j = 0; j < n; j++) {
            if (j === i) continue;

            const factor = A[j][i];

            for (let k = i; k < n; k++) {
                A[j][k] -= factor * A[i][k];
            }

            b[j] -= factor * b[i];
        }
    }

    return b;
}

function homography(from, to) {
    const A = [];
    const b = [];

    for (let i = 0; i < 4; i++) {
        const { x, y } = from[i];
        const { x: u, y: v } = to[i];

        A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
        b.push(u);

        A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
        b.push(v);
    }

    return solveLinear(A, b);
}

function mm(value) {
    return value * DPI / 25.4;
}

function alignImage() {
    const markers = detectMarkers(sourceImage);
    const dim = dimensions();

    const target = [
        { x: mm(9.5), y: mm(7.5) },
        { x: mm(200.5), y: mm(7.5) },
        { x: mm(9.5), y: mm(dim.bottomMark + 1.5) },
        { x: mm(200.5), y: mm(dim.bottomMark + 1.5) }
    ];

    // Destination coordinates -> source image coordinates.
    const H = homography(target, markers);

    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = sourceImage.width;
    sourceCanvas.height = sourceImage.height;

    const sourceCtx = sourceCanvas.getContext("2d", {
        willReadFrequently: true
    });

    sourceCtx.drawImage(sourceImage, 0, 0);

    const source = sourceCtx.getImageData(
        0, 0, sourceCanvas.width, sourceCanvas.height
    );

    canvas.width = dim.width;
    canvas.height = dim.height;

    const output = ctx.createImageData(dim.width, dim.height);

    const src = source.data;
    const dst = output.data;
    const sw = source.width;
    const sh = source.height;

    for (let y = 0; y < dim.height; y++) {
        for (let x = 0; x < dim.width; x++) {
            const denominator = H[6] * x + H[7] * y + 1;

            if (Math.abs(denominator) < 1e-9) continue;

            const sx = Math.round(
                (H[0] * x + H[1] * y + H[2]) / denominator
            );

            const sy = Math.round(
                (H[3] * x + H[4] * y + H[5]) / denominator
            );

            const di = (y * dim.width + x) * 4;

            if (sx >= 0 && sx < sw && sy >= 0 && sy < sh) {
                const si = (sy * sw + sx) * 4;

                dst[di] = src[si];
                dst[di + 1] = src[si + 1];
                dst[di + 2] = src[si + 2];
                dst[di + 3] = 255;
            } else {
                dst[di] = 255;
                dst[di + 1] = 255;
                dst[di + 2] = 255;
                dst[di + 3] = 255;
            }
        }
    }

    ctx.putImageData(output, 0, 0);
    return output;
}

function measureBubble(image, coordinate) {
    const x = Number(coordinate.x_pos);
    const y = Number(coordinate.y_pos);
    const w = Number(coordinate.width);
    const h = Number(coordinate.height);

    if (
        ![x, y, w, h].every(Number.isFinite) ||
        w <= 0 || h <= 0 ||
        x < 0 || y < 0 ||
        x + w > image.width ||
        y + h > image.height
    ) {
        throw new Error("Bubble coordinates are outside the ballot.");
    }

    const cx = x + w / 2;
    const cy = y + h / 2;

    // Sample the inner part to avoid the printed circle outline.
    const rx = w * 0.28;
    const ry = h * 0.28;

    let dark = 0;
    let total = 0;

    for (let py = Math.floor(cy - ry); py <= cy + ry; py++) {
        for (let px = Math.floor(cx - rx); px <= cx + rx; px++) {
            const dx = (px - cx) / rx;
            const dy = (py - cy) / ry;

            if (dx * dx + dy * dy > 1) continue;

            const index = (py * image.width + px) * 4;

            if (grayscale(image.data, index) < DARK_CUTOFF) {
                dark++;
            }

            total++;
        }
    }

    const fill = total ? dark / total : 0;

    return {
        fill,
        selected: fill >= FILL_THRESHOLD
    };
}

function drawBubble(coordinate, selected) {
    ctx.strokeStyle = selected ? "#15803d" : "#2563eb";
    ctx.lineWidth = 5;

    ctx.strokeRect(
        coordinate.x_pos,
        coordinate.y_pos,
        coordinate.width,
        coordinate.height
    );
}

function analyzeBallot() {
    try {
        if (!template || !sourceImage) {
            throw new Error("Select a template and load an image first.");
        }

        setStatus("analysisStatus", "Aligning and analyzing ballot...");

        const image = alignImage();
        const groups = new Map();

        for (const coordinate of coordinates) {
            const positionId = Number(coordinate.position_id);

            if (!Number.isSafeInteger(positionId) || positionId < 1) {
                throw new Error(
                    "Template is missing position information."
                );
            }

            const maximum = Number(coordinate.max_selection);

            if (!Number.isSafeInteger(maximum) || maximum < 1) {
                throw new Error(
                    "Template is missing valid max_selection."
                );
            }

            if (!groups.has(positionId)) {
                groups.set(positionId, {
                    title: coordinate.position_name || `Position ${positionId}`,
                    maximum,
                    candidates: []
                });
            }

            const measurement = measureBubble(image, coordinate);

            groups.get(positionId).candidates.push({
                name: coordinate.candidate_name,
                candidate_id: coordinate.candidate_id,
                selected: measurement.selected,
                fill: measurement.fill
            });

            drawBubble(coordinate, measurement.selected);
        }

        scanResults = [];
        $("results").replaceChildren();

        let overvotes = 0;

        for (const [positionId, group] of groups) {
            const selected = group.candidates.filter(c => c.selected);
            const overvote = selected.length > group.maximum;

            if (overvote) overvotes++;

            const box = document.createElement("div");
            box.className = "result-position";

            const heading = document.createElement("h4");
            heading.textContent =
                `${group.title} — ${selected.length}/${group.maximum} selected`;

            const state = document.createElement("p");
            state.className = overvote ? "overvote" : "valid";

            state.textContent = overvote
                ? "OVERVOTE — selections for this position are invalid"
                : selected.length === 0
                    ? "VALID — No selection"
                    : "VALID";

            const list = document.createElement("ul");

            for (const candidate of group.candidates) {
                const item = document.createElement("li");

                item.textContent =
                    `${candidate.selected ? "●" : "○"} ` +
                    `${candidate.name} — ` +
                    `${Math.round(candidate.fill * 100)}%`;

                list.appendChild(item);
            }

            box.append(heading, state, list);
            $("results").appendChild(box);

            scanResults.push({
                position_id: positionId,
                position_name: group.title,
                max_selection: group.maximum,
                overvote,
                selected_candidate_ids: overvote
                    ? []
                    : selected.map(c => c.candidate_id)
            });
        }

        setStatus(
            "analysisStatus",
            `Analysis complete. ${groups.size} positions. ` +
            `${overvotes} overvote(s). No votes submitted to database.`
        );

    } catch (error) {
        scanResults = null;
        $("results").replaceChildren();

        setStatus(
            "analysisStatus",
            "Scan failed: " + error.message,
            true
        );
    }
}

document.addEventListener("DOMContentLoaded", () => {
    $("loadBtn").addEventListener("click", loadTemplates);

    $("templateSelect").addEventListener(
        "change",
        loadSelectedTemplate
    );

    $("fileInput").addEventListener("change", loadFile);

    $("cameraBtn").addEventListener("click", openCamera);
    $("captureBtn").addEventListener("click", captureCamera);
    $("stopCameraBtn").addEventListener("click", stopCamera);

    $("analyzeBtn").addEventListener("click", () => {
        $("analyzeBtn").disabled = true;

        // Allow the UI to paint before the expensive alignment.
        setTimeout(() => {
            try {
                analyzeBallot();
            } finally {
                $("analyzeBtn").disabled = false;
            }
        }, 50);
    });

    $("submitBtn").disabled = true;

    setStatus(
        "scannerStatus",
        "Enter Election ID and click Load Templates."
    );
});
