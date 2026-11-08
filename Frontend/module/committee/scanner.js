"use strict";

(() => {
    const API_BASE = "https://voting-backend-cdrj.onrender.com/api";
    const MAX_SIDE = 2600;
    const MAX_FILE_BYTES = 30 * 1024 * 1024;
    const SCAN_TIMEOUT_MS = 45000;

    const $ = id => document.getElementById(id);
    const uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const state = {
        electionId: 0,
        template: null,
        photo: null,
        upload: null,
        revision: 0,
        photoTicket: 0,
        templateTicket: 0,
        listTicket: 0,
        loading: false,
        preparing: false,
        busy: false,
        checking: false,
        counted: false,
        unavailable: false,
        uncertain: false,
        qrRaw: null,
        photoInfo: null
    };

    let activeScan = null;

    window.campusVoteQRVerified = false;
    window.confirmedOMRCounting = false;

    const validId = value =>
        Number.isSafeInteger(Number(value)) && Number(value) > 0;

    const selectedTemplateId = () =>
        Number($("templateSelect").value);

    function status(id, message, error = false) {
        const element = $(id);
        if (!element) return;

        element.textContent = message;
        element.className = "status" + (error ? " error" : "");
    }

    function debug(value) {
        $("debugInfo").textContent =
            typeof value === "string"
                ? value
                : JSON.stringify(value, null, 2);
    }

    function controls() {
        const locked =
            state.busy || state.checking || state.loading;

        for (const id of [
            "loadBtn",
            "templateSelect",
            "fileInput",
            "phoneCameraInput",
            "cameraBtn"
        ]) {
            $(id).disabled = locked;
        }

        $("retakeBtn").disabled = locked;

        $("analyzeBtn").disabled =
            locked ||
            state.preparing ||
            !state.photo ||
            !state.upload ||
            !state.template ||
            state.counted ||
            state.unavailable ||
            state.uncertain;

        $("checkStatusBtn").disabled =
            locked ||
            state.preparing ||
            !state.photo ||
            !state.template;

        $("cancelBtn").hidden = !state.busy;
        $("cancelBtn").disabled = !activeScan;

        $("analyzeBtn").setAttribute(
            "aria-busy",
            String(state.busy)
        );
    }

    async function api(route, options = {}) {
        const auth =
            sessionStorage.getItem("voting_token") ||
            localStorage.getItem("voting_token") ||
            localStorage.getItem("token");

        if (!auth) {
            const error = new Error(
                "Session not found. Please log in again."
            );
            error.requestNotSent = true;
            throw error;
        }

        const {
            timeoutMs = 15000,
            signal,
            ...requestOptions
        } = options;

        const controller = new AbortController();
        let timedOut = false;

        const stop = () => controller.abort();

        if (signal?.aborted) {
            controller.abort();
        } else {
            signal?.addEventListener(
                "abort",
                stop,
                { once: true }
            );
        }

        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs);

        try {
            const response = await fetch(API_BASE + route, {
                ...requestOptions,
                headers: {
                    ...requestOptions.headers,
                    Authorization: "Bearer " + auth
                },
                signal: controller.signal
            });

            const data = await response.json().catch(() => null);

            if (!response.ok || !data) {
                const error = new Error(
                    data?.message ||
                    `Unexpected server response (${response.status}).`
                );

                error.status = response.status;
                error.data = data;
                throw error;
            }

            return data;
        } catch (error) {
            if (controller.signal.aborted) {
                const stopped = new Error(
                    timedOut
                        ? `The server did not respond within ${Math.round(timeoutMs / 1000)} seconds.`
                        : "Stopped waiting for the response."
                );

                stopped.code = timedOut
                    ? "TIMEOUT"
                    : "STOPPED_WAITING";

                throw stopped;
            }

            throw error;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener("abort", stop);
        }
    }

    function clearResults() {
        $("results").replaceChildren();

        const note = document.createElement("p");
        note.textContent = "No ballot analyzed yet.";

        $("results").appendChild(note);
    }

    function clearPhoto() {
        state.photoTicket++;
        state.revision++;

        state.photo = null;
        state.upload = null;
        state.photoInfo = null;
        state.qrRaw = null;

        state.preparing = false;
        state.counted = false;
        state.unavailable = false;
        state.uncertain = false;

        window.campusVoteQRVerified = false;
        window.confirmedOMRCounting = false;

        const canvas = $("scanCanvas");
        canvas.width = 1;
        canvas.height = 1;

        $("fileInput").value = "";
        $("phoneCameraInput").value = "";

        clearResults();

        status("analysisStatus", "");
        status(
            "imageStatus",
            "Upload or capture one complete A5 ballot."
        );
        status(
            "qrStatus",
            "QR and registration marks are verified during scanning."
        );
        status("timingInfo", "");

        debug("Load an A5 template and one ballot photo.");
        controls();
    }

    async function loadTemplates() {
        if (state.busy || state.checking || state.loading) {
            return;
        }

        const ticket = ++state.listTicket;

        state.templateTicket++;
        state.loading = true;
        state.template = null;
        state.qrRaw = null;
        state.revision++;

        controls();

        try {
            if (!validId(state.electionId)) {
                status(
                    "scannerStatus",
                    "Loading current election..."
                );

                const data = await api(
                    "/positions/election/current"
                );

                const positions = Array.isArray(data)
                    ? data
                    : data.positions || [];

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
                        "Current election ID was not found."
                    );
                }

                if (ticket !== state.listTicket) return;

                state.electionId = id;
                $("electionId").value = id;
            }

            const data = await api(
                `/ballots/templates/election/${state.electionId}`
            );

            if (ticket !== state.listTicket) return;

            const select = $("templateSelect");

            select.replaceChildren(
                new Option("Select an A5 template", "")
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
                        `${item.template_name} (${item.paper_size})`,
                        item.template_id
                    )
                );
            }

            status(
                "scannerStatus",
                `${select.options.length - 1} A5 templates loaded.`
            );
        } catch (error) {
            if (ticket === state.listTicket) {
                status("scannerStatus", error.message, true);
            }
        } finally {
            if (ticket === state.listTicket) {
                state.loading = false;
                controls();
            }
        }
    }

    async function selectTemplate() {
        if (state.busy || state.checking || state.loading) {
            return;
        }

        const ticket = ++state.templateTicket;
        const id = selectedTemplateId();

        state.template = null;
        state.qrRaw = null;
        state.revision++;

        window.campusVoteQRVerified = false;

        clearResults();

        if (!validId(id)) {
            controls();
            return;
        }

        state.loading = true;
        controls();

        try {
            const data = await api(
                `/ballots/templates/${id}`
            );

            if (
                ticket !== state.templateTicket ||
                id !== selectedTemplateId()
            ) {
                return;
            }

            if (
                !data.template ||
                !Array.isArray(data.coordinates) ||
                !data.coordinates.length
            ) {
                throw new Error(
                    "Template or bubble coordinates are missing."
                );
            }

            if (
                String(data.template.paper_size).toUpperCase() !== "A5" ||
                Number(data.template.election_id) !== state.electionId ||
                Number(data.template.template_id) !== id
            ) {
                throw new Error(
                    "Select an A5 template belonging to the current election."
                );
            }

            state.template = data.template;

            status(
                "scannerStatus",
                `Template #${id}: ${data.coordinates.length} bubbles.`
            );

            status(
                "qrStatus",
                "Ready. The server will verify the QR against this template."
            );
        } catch (error) {
            if (ticket === state.templateTicket) {
                status("scannerStatus", error.message, true);
            }
        } finally {
            if (ticket === state.templateTicket) {
                state.loading = false;
                controls();
            }
        }
    }

    async function loadPhoto(file) {
        if (
            !file ||
            state.busy ||
            state.checking ||
            state.loading
        ) {
            return;
        }

        const allowed = [
            "image/jpeg",
            "image/png",
            "image/webp"
        ];

        if (
            !allowed.includes(file.type) ||
            file.size > MAX_FILE_BYTES
        ) {
            status(
                "imageStatus",
                "Use a JPEG, PNG, or WebP image up to 30 MB.",
                true
            );
            return;
        }

        const ticket = ++state.photoTicket;

        state.revision++;
        state.photo = null;
        state.upload = null;
        state.qrRaw = null;
        state.counted = false;
        state.unavailable = false;
        state.uncertain = false;
        state.preparing = true;

        window.campusVoteQRVerified = false;
        window.confirmedOMRCounting = false;

        clearResults();
        controls();

        status("analysisStatus", "");
        status("imageStatus", "Preparing photo...");

        const started = performance.now();
        const url = URL.createObjectURL(file);
        const original = new Image();

        try {
            await new Promise((resolve, reject) => {
                original.onload = resolve;

                original.onerror = () => {
                    reject(
                        new Error("The image could not be opened.")
                    );
                };

                original.src = url;
            });

            if (
                ticket !== state.photoTicket ||
                state.busy
            ) {
                return;
            }

            const inputWidth = original.naturalWidth;
            const inputHeight = original.naturalHeight;

            const scale = Math.min(
                1,
                MAX_SIDE / Math.max(inputWidth, inputHeight)
            );

            const photo = document.createElement("canvas");

            photo.width = Math.max(
                1,
                Math.round(inputWidth * scale)
            );

            photo.height = Math.max(
                1,
                Math.round(inputHeight * scale)
            );

            const context = photo.getContext("2d");

            if (!context) {
                throw new Error(
                    "This browser cannot prepare the photo."
                );
            }

            context.fillStyle = "#fff";
            context.fillRect(
                0,
                0,
                photo.width,
                photo.height
            );

            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = "high";

            context.drawImage(
                original,
                0,
                0,
                photo.width,
                photo.height
            );

            let upload = await new Promise(resolve => {
                photo.toBlob(resolve, "image/jpeg", 0.92);
            });

            if (!upload) {
                throw new Error(
                    "Could not prepare the ballot image."
                );
            }

            if (upload.size > 9 * 1024 * 1024) {
                upload = await new Promise(resolve => {
                    photo.toBlob(resolve, "image/jpeg", 0.86);
                });
            }

            if (!upload || upload.size > 9 * 1024 * 1024) {
                throw new Error(
                    "The prepared image is too large."
                );
            }

            if (
                ticket !== state.photoTicket ||
                state.busy
            ) {
                return;
            }

            // Commit the preview and upload together.
            state.photo = photo;
            state.upload = upload;

            state.photoInfo = {
                original_width: inputWidth,
                original_height: inputHeight,
                width: photo.width,
                height: photo.height,
                original_bytes: file.size,
                upload_bytes: upload.size,
                prepare_ms: Math.round(
                    performance.now() - started
                )
            };

            const preview = $("scanCanvas");

            preview.width = photo.width;
            preview.height = photo.height;

            preview.getContext("2d").drawImage(
                photo,
                0,
                0
            );

            status(
                "imageStatus",
                `Photo ready: ${photo.width} × ${photo.height}, ` +
                `${(upload.size / 1048576).toFixed(2)} MB.`
            );

            status(
                "qrStatus",
                "QR and all four markers will be checked during scanning."
            );

            status("timingInfo", "");
            debug({ photo: state.photoInfo });
        } catch (error) {
            if (ticket === state.photoTicket) {
                status("imageStatus", error.message, true);
            }
        } finally {
            original.onload = null;
            original.onerror = null;
            original.src = "";

            URL.revokeObjectURL(url);

            if (ticket === state.photoTicket) {
                state.preparing = false;
                controls();
            }
        }
    }

    function displayResults(data) {
        const output = $("results");
        output.replaceChildren();

        const positions = Array.isArray(data.positions)
            ? data.positions
            : [];

        for (const position of positions) {
            const section = document.createElement("div");
            section.className = "result-position";

            const title = document.createElement("h4");

            title.textContent =
                `${position.position_name || "Position"} ` +
                `(${position.marked ?? 0}/${position.max_selection ?? 1})`;

            section.appendChild(title);

            const candidates = Array.isArray(position.candidates)
                ? position.candidates
                : [];

            for (const candidate of candidates) {
                const text = document.createElement("p");

                const label = candidate.unclear
                    ? "UNCLEAR — REVIEW"
                    : candidate.filled
                        ? "SHADED"
                        : "BLANK";

                text.textContent =
                    `${candidate.filled ? "●" : "○"} ` +
                    `${candidate.name || "Candidate"} — ${label}`;

                text.className = candidate.unclear
                    ? "error"
                    : candidate.filled
                        ? "valid"
                        : "";

                section.appendChild(text);
            }

            const note = document.createElement("p");
            const result = position.result || "";

            if (
                position.unclear ||
                result === "NEEDS_REVIEW"
            ) {
                note.textContent =
                    "NEEDS REVIEW: UNCLEAR SHADING";
                note.className = "error";
            } else if (
                position.overvoted ||
                result === "SKIPPED_OVERVOTE"
            ) {
                note.textContent = "SKIPPED: OVERVOTE";
                note.className = "overvote";
            } else if (result === "BLANK") {
                note.textContent = "BLANK POSITION";
            } else if (result.startsWith("SKIPPED")) {
                note.textContent = result.replaceAll("_", " ");
                note.className = "error";
            } else {
                note.textContent = "VALID POSITION";
                note.className = "valid";
            }

            section.appendChild(note);
            output.appendChild(section);
        }

        const summary = document.createElement("div");
        summary.className = "counting-note";

        summary.textContent = data.counted === true
            ? `Ballot counted. Saved votes: ${data.saved_votes ?? 0}.`
            : data.message || "No counting result confirmed.";

        output.appendChild(summary);
    }

    function showTiming(data, elapsed) {
        const processing = Number(data?.processing_ms);

        status(
            "timingInfo",
            `Request: ${(elapsed / 1000).toFixed(1)} s` +
            (
                Number.isFinite(processing)
                    ? ` · Server processing: ${(processing / 1000).toFixed(1)} s`
                    : ""
            )
        );

        debug({
            photo: state.photoInfo,
            request_ms: Math.round(elapsed),
            processing_ms: data?.processing_ms,
            stages_ms: data?.timing_ms,
            preprocessing: data?.preprocessing,
            alignment: data?.alignment_diagnostic
        });
    }

    async function scan() {
        if (
            state.busy ||
            state.checking ||
            state.loading ||
            state.preparing ||
            !state.template ||
            !state.photo ||
            !state.upload ||
            state.counted ||
            state.unavailable ||
            state.uncertain
        ) {
            return;
        }

        const snapshot = {
            revision: state.revision,
            photo: state.photo,
            upload: state.upload,
            electionId: state.electionId,
            templateId: selectedTemplateId(),
            qrRaw: state.qrRaw
        };

        if (
            !validId(snapshot.electionId) ||
            !validId(snapshot.templateId)
        ) {
            return;
        }

        state.busy = true;
        activeScan = new AbortController();

        controls();

        const started = performance.now();

        const clock = setInterval(() => {
            status(
                "analysisStatus",
                `Scanning ballot… ${Math.floor(
                    (performance.now() - started) / 1000
                )} s`
            );
        }, 500);

        let sent = false;

        try {
            status(
                "analysisStatus",
                "Uploading and scanning ballot..."
            );

            const form = new FormData();

            form.append(
                "election_id",
                String(snapshot.electionId)
            );

            form.append(
                "template_id",
                String(snapshot.templateId)
            );

            form.append(
                "ballot_image",
                snapshot.upload,
                "ballot-scan.jpg"
            );

            sent = true;

            const data = await api("/omr/scan", {
                method: "POST",
                body: form,
                timeoutMs: SCAN_TIMEOUT_MS,
                signal: activeScan.signal
            });

            showTiming(
                data,
                performance.now() - started
            );

            const parsed = snapshot.qrRaw
                ? parseQR(snapshot.qrRaw)
                : null;

            if (
                state.revision !== snapshot.revision ||
                state.photo !== snapshot.photo ||
                Number(data.election_id) !== snapshot.electionId ||
                Number(data.template_id) !== snapshot.templateId ||
                !uuidPattern.test(String(data.ballot_id || "")) ||
                (
                    parsed &&
                    parsed.ballotId !==
                        String(data.ballot_id).toLowerCase()
                ) ||
                data.preview_only !== false ||
                data.counted !== true ||
                data.valid !== true
            ) {
                throw new Error(
                    "The counting result could not be confirmed. " +
                    "Check the ballot status."
                );
            }

            state.counted = true;
            state.uncertain = false;

            state.qrRaw =
                `CV1|${snapshot.electionId}|` +
                `${String(data.ballot_id).toLowerCase()}|` +
                `${snapshot.templateId}`;

            window.campusVoteQRVerified = true;
            window.confirmedOMRCounting = true;

            displayResults(data);

            status(
                "analysisStatus",
                data.message || "Ballot counted successfully."
            );

            status(
                "qrStatus",
                `QR verified by server. Status: COUNTED. ` +
                `Ballot: ${data.ballot_id}`
            );

            window.showToast?.(
                "Ballot counted successfully.",
                "success"
            );
        } catch (error) {
            const data = error.data;

            showTiming(
                data,
                performance.now() - started
            );

            if (data?.positions) {
                displayResults(data);
            }

            const rejected =
                error.status >= 400 &&
                error.status < 500 &&
                data?.counted === false;

            if (
                sent &&
                !rejected &&
                !error.requestNotSent
            ) {
                state.uncertain = true;

                status(
                    "analysisStatus",
                    `${error.message} Counting status is unknown. ` +
                    "Use Check Ballot Status before retrying.",
                    true
                );
            } else {
                if (
                    data?.status === "COUNTED" ||
                    data?.duplicate === true
                ) {
                    state.counted = true;
                    window.confirmedOMRCounting = true;
                } else if (error.status === 409) {
                    state.unavailable = true;
                }

                status(
                    "analysisStatus",
                    data?.message || error.message,
                    true
                );
            }
        } finally {
            clearInterval(clock);

            activeScan = null;
            state.busy = false;

            controls();
        }
    }

    function parseQR(raw) {
        const parts = String(raw || "")
            .trim()
            .split("|");

        if (
            parts.length !== 4 ||
            parts[0] !== "CV1" ||
            !validId(parts[1]) ||
            !uuidPattern.test(parts[2]) ||
            !validId(parts[3])
        ) {
            throw new Error(
                "This is not a valid CampusVote ballot QR."
            );
        }

        return {
            electionId: Number(parts[1]),
            ballotId: parts[2].toLowerCase(),
            templateId: Number(parts[3])
        };
    }

    async function checkBallotStatus() {
        if (
            state.busy ||
            state.checking ||
            state.loading ||
            state.preparing ||
            !state.photo ||
            !state.template
        ) {
            return;
        }

        state.checking = true;
        controls();

        const revision = state.revision;

        try {
            status(
                "qrStatus",
                "Reading ballot identity for a status check..."
            );

            const raw =
                state.qrRaw ||
                await readPhotoQR(state.photo);

            const parsed = parseQR(raw);

            if (revision !== state.revision) return;

            if (
                parsed.electionId !== state.electionId ||
                parsed.templateId !== selectedTemplateId()
            ) {
                throw new Error(
                    "The QR belongs to a different election or template."
                );
            }

            state.qrRaw = raw;

            const data = await api("/omr/verify-qr", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    qr_data: raw
                })
            });

            if (revision !== state.revision) return;

            if (
                data.valid !== true ||
                !["ISSUED", "CAST"].includes(data.status) ||
                String(data.ballot_id).toLowerCase() !== parsed.ballotId ||
                Number(data.election_id) !== state.electionId ||
                Number(data.template_id) !== selectedTemplateId()
            ) {
                throw new Error(
                    "The ballot status could not be verified."
                );
            }

            window.campusVoteQRVerified = true;

            status(
                "qrStatus",
                `Ballot ${parsed.ballotId}: ${data.status}.`
            );

            if (state.uncertain) {
                status(
                    "analysisStatus",
                    "The ballot is not yet marked counted. " +
                    "An earlier request may still complete. " +
                    "Check again before retrying.",
                    true
                );
            }
        } catch (error) {
            if (revision !== state.revision) return;

            if (
                error.data?.status === "COUNTED" ||
                error.data?.duplicate === true
            ) {
                state.counted = true;
                state.uncertain = false;

                window.campusVoteQRVerified = true;
                window.confirmedOMRCounting = true;

                status(
                    "qrStatus",
                    "This ballot is already COUNTED."
                );

                status(
                    "analysisStatus",
                    "Ballot already recorded. Load the next ballot."
                );
            } else {
                if (error.status === 409) {
                    state.unavailable = true;
                }

                status(
                    "qrStatus",
                    error.message,
                    true
                );
            }
        } finally {
            state.checking = false;
            controls();
        }
    }

    // This worker is used only for the read-only status action.
    function makeReadOnlyQRWorkerSource() {
        return String.raw`
"use strict";

self.onmessage = function (event) {
    try {
        importScripts(
            "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js"
        );

        if (typeof self.jsQR !== "function") {
            throw new Error("QR library unavailable.");
        }

        const { pixels, width, height } = event.data;
        const rgba = new Uint8ClampedArray(pixels);

        if (
            !Number.isInteger(width) ||
            !Number.isInteger(height) ||
            width < 1 ||
            height < 1 ||
            width > 1800 ||
            height > 1800 ||
            rgba.length !== width * height * 4
        ) {
            throw new Error(
                "Invalid photo for ballot status check."
            );
        }

        const regions = [
            [0.46, 0, 0.54, 0.50],
            [0, 0.50, 0.54, 0.50],
            [0, 0, 1, 0.55],
            [0, 0, 1, 1]
        ];

        for (const inversionAttempts of [
            "dontInvert",
            "attemptBoth"
        ]) {
            for (const region of regions) {
                const left = Math.floor(region[0] * width);
                const top = Math.floor(region[1] * height);

                const cropWidth = Math.max(
                    1,
                    Math.min(
                        width - left,
                        Math.round(region[2] * width)
                    )
                );

                const cropHeight = Math.max(
                    1,
                    Math.min(
                        height - top,
                        Math.round(region[3] * height)
                    )
                );

                let crop;

                if (
                    left === 0 &&
                    top === 0 &&
                    cropWidth === width &&
                    cropHeight === height
                ) {
                    crop = rgba;
                } else {
                    crop = new Uint8ClampedArray(
                        cropWidth * cropHeight * 4
                    );

                    for (let row = 0; row < cropHeight; row++) {
                        const start =
                            ((top + row) * width + left) * 4;

                        crop.set(
                            rgba.subarray(
                                start,
                                start + cropWidth * 4
                            ),
                            row * cropWidth * 4
                        );
                    }
                }

                const result = self.jsQR(
                    crop,
                    cropWidth,
                    cropHeight,
                    { inversionAttempts }
                );

                if (result && result.data) {
                    self.postMessage({
                        data: result.data
                    });
                    return;
                }
            }
        }

        throw new Error(
            "QR code could not be read. Keep this ballot aside " +
            "and check its record before retrying."
        );
    } catch (error) {
        self.postMessage({
            error: error && error.message
                ? error.message
                : "Ballot status QR check failed."
        });
    } finally {
        self.close();
    }
};
`;
    }

    async function readPhotoQR(photoCanvas) {
        if (
            !photoCanvas ||
            typeof photoCanvas.getContext !== "function" ||
            !Number.isInteger(photoCanvas.width) ||
            !Number.isInteger(photoCanvas.height) ||
            photoCanvas.width < 2 ||
            photoCanvas.height < 2
        ) {
            throw new Error(
                "Load the ballot photo before checking its status."
            );
        }

        if (
            typeof Worker !== "function" ||
            typeof Blob !== "function" ||
            typeof URL.createObjectURL !== "function"
        ) {
            throw new Error(
                "This browser cannot read the status QR. " +
                "Keep this ballot aside and check its record before retrying."
            );
        }

        const started = performance.now();
        const timeoutMs = 6000;

        const scale = Math.min(
            1,
            1800 / Math.max(
                photoCanvas.width,
                photoCanvas.height
            )
        );

        const work = document.createElement("canvas");

        work.width = Math.max(
            1,
            Math.round(photoCanvas.width * scale)
        );

        work.height = Math.max(
            1,
            Math.round(photoCanvas.height * scale)
        );

        const context = work.getContext("2d", {
            willReadFrequently: true
        });

        if (!context) {
            throw new Error(
                "This browser cannot prepare the ballot status photo."
            );
        }

        context.fillStyle = "#fff";
        context.fillRect(0, 0, work.width, work.height);

        context.drawImage(
            photoCanvas,
            0,
            0,
            work.width,
            work.height
        );

        const pixels = context.getImageData(
            0,
            0,
            work.width,
            work.height
        );

        const remaining =
            timeoutMs - (performance.now() - started);

        if (remaining <= 0) {
            throw new Error(
                "Ballot status QR reading timed out. " +
                "This status check did not send a counting request."
            );
        }

        return new Promise((resolve, reject) => {
            let worker = null;
            let workerUrl = null;
            let settled = false;
            let timer = null;

            function finish(error, data) {
                if (settled) return;
                settled = true;

                clearTimeout(timer);

                if (worker) worker.terminate();
                if (workerUrl) URL.revokeObjectURL(workerUrl);

                work.width = 1;
                work.height = 1;

                if (error) reject(error);
                else resolve(data);
            }

            timer = setTimeout(() => {
                finish(
                    new Error(
                        "Ballot status QR reading timed out. " +
                        "This status check did not send a counting request."
                    )
                );
            }, remaining);

            try {
                workerUrl = URL.createObjectURL(
                    new Blob(
                        [makeReadOnlyQRWorkerSource()],
                        { type: "text/javascript" }
                    )
                );

                worker = new Worker(workerUrl);

                worker.onmessage = event => {
                    if (
                        performance.now() - started >= timeoutMs
                    ) {
                        finish(
                            new Error(
                                "Ballot status QR reading timed out. " +
                                "This status check did not send a counting request."
                            )
                        );
                    } else if (
                        event.data &&
                        typeof event.data.data === "string" &&
                        event.data.data.trim()
                    ) {
                        finish(null, event.data.data);
                    } else {
                        finish(
                            new Error(
                                event.data?.error ||
                                "Ballot status QR could not be read."
                            )
                        );
                    }
                };

                worker.onerror = event => {
                    event.preventDefault?.();

                    finish(
                        new Error(
                            "The status QR reader could not start or load its library. " +
                            "Keep this ballot aside and check its record before retrying."
                        )
                    );
                };

                worker.postMessage(
                    {
                        pixels: pixels.data.buffer,
                        width: pixels.width,
                        height: pixels.height
                    },
                    [pixels.data.buffer]
                );
            } catch (_) {
                finish(
                    new Error(
                        "The browser blocked the status QR reader. " +
                        "Keep this ballot aside and check its record before retrying."
                    )
                );
            }
        });
    }

    function setup() {
        $("loadBtn").addEventListener(
            "click",
            loadTemplates
        );

        $("templateSelect").addEventListener(
            "change",
            selectTemplate
        );

        $("fileInput").addEventListener(
            "change",
            event => loadPhoto(event.target.files?.[0])
        );

        $("phoneCameraInput").addEventListener(
            "change",
            event => loadPhoto(event.target.files?.[0])
        );

        $("cameraBtn").addEventListener("click", () => {
            if (
                state.busy ||
                state.checking ||
                state.loading
            ) {
                return;
            }

            $("phoneCameraInput").value = "";
            $("phoneCameraInput").click();
        });

        $("retakeBtn").addEventListener("click", () => {
            if (
                state.busy ||
                state.checking ||
                state.loading
            ) {
                return;
            }

            const wasUncertain = state.uncertain;

            clearPhoto();

            if (wasUncertain) {
                status(
                    "analysisStatus",
                    "Keep the previous ballot aside until its counting status is confirmed.",
                    true
                );
            }
        });

        $("analyzeBtn").addEventListener(
            "click",
            scan
        );

        $("cancelBtn").addEventListener(
            "click",
            () => activeScan?.abort()
        );

        $("checkStatusBtn").addEventListener(
            "click",
            checkBallotStatus
        );

        window.addEventListener(
            "pagehide",
            () => activeScan?.abort()
        );

        clearPhoto();
        loadTemplates();
    }

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            setup,
            { once: true }
        );
    } else {
        setup();
    }
})();